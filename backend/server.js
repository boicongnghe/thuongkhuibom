require('dotenv').config();
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors         = require('cors');
const cookieParser = require('cookie-parser');
const helmet       = require('helmet');

const tiktok   = require('./src/tiktok');
const printer  = require('./src/printer');
const db       = require('./src/database');
const settings = require('./src/settings');
const authRoutes = require('./src/authRoutes');
const { getSecret, requireAuth, requireAppHeader, socketAuth } = require('./src/authMiddleware');

// Dừng ngay nếu thiếu JWT_SECRET, tránh chạy với cấu hình không an toàn
try {
  getSecret();
} catch (err) {
  console.error('[Auth]', err.message);
  process.exit(1);
}

// Chỉ cho phép các domain frontend liệt kê trong CORS_ORIGINS (cách nhau bởi dấu phẩy)
const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

const app        = express();
const httpServer = createServer(app);
const io         = new Server(httpServer, {
  cors: { origin: allowedOrigins.length ? allowedOrigins : false, credentials: true },
});

app.set('io', io);  // cho các route (vd logout-all) dùng Socket.io

const PORT = process.env.PORT || 3001;

// Chạy sau proxy (Cloudflare Tunnel, Vercel rewrite...) để lấy đúng IP người dùng
if (process.env.TRUST_PROXY) {
  const hops = Number(process.env.TRUST_PROXY);
  app.set('trust proxy', Number.isNaN(hops) ? process.env.TRUST_PROXY : hops);
}

// ── Middleware ────────────────────────────────────────────
// Header bảo mật mặc định (CSP mặc định của helmet đã cho phép Google Fonts và style inline)
app.use(helmet());
app.use(cors({
  origin: (origin, cb) => cb(null, !origin || allowedOrigins.includes(origin)),
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// ── Auth: /api/auth tự do, mọi /api khác phải đăng nhập ───
app.use('/api', requireAppHeader);
app.use('/api/auth', authRoutes);
app.use('/api', requireAuth);
io.use(socketAuth);

// Serve React build (production) or old frontend (fallback)
const reactDist = path.join(__dirname, '../frontend-react-dist');
const oldFront  = path.join(__dirname, '../frontend');
const fs        = require('fs');
const staticDir = fs.existsSync(reactDist) ? reactDist : oldFront;
app.use(express.static(staticDir));

// SPA fallback for React Router (Express 5 uses /*path syntax)
app.get('/*path', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return next();
  const indexFile = path.join(staticDir, 'index.html');
  if (fs.existsSync(indexFile)) res.sendFile(indexFile);
  else next();
});

// ── Sanitize helper ───────────────────────────────────────
function sanitizeStr(val, max = 500) {
  return String(val || '').trim().slice(0, max);
}

// ── Validate ObjectId ─────────────────────────────────────
const OBJECTID_RE = /^[0-9a-fA-F]{24}$/;
function isValidObjectId(id) {
  return OBJECTID_RE.test(id);
}

// ── Error helper ──────────────────────────────────────────
// Lỗi nghiệp vụ (err.expose) hiện nguyên văn; lỗi khác chỉ ghi log, không lộ chi tiết nội bộ
function sendError(res, err, context) {
  if (err?.expose) return res.status(err.status || 400).json({ error: err.message });
  console.error(`[API Error] ${context}:`, err);
  res.status(500).json({ error: 'Lỗi máy chủ, vui lòng thử lại' });
}

// Số tiền VND: số nguyên, 0 → 1 tỷ
const MAX_AMOUNT = 1_000_000_000;
function parseAmount(val) {
  if (val === undefined) return undefined;
  const n = typeof val === 'string' && val.trim() !== '' ? Number(val) : val;
  return Number.isSafeInteger(n) && n >= 0 && n <= MAX_AMOUNT ? n : NaN;
}

// ── Order status machine ──────────────────────────────────
const VALID_STATUSES = new Set(['pending', 'deposit', 'confirmed', 'shipping', 'completed', 'cancelled']);
const STATUS_TRANSITIONS = {
  pending:   ['deposit', 'confirmed', 'cancelled'],
  deposit:   ['confirmed', 'cancelled'],
  confirmed: ['shipping', 'cancelled'],
  shipping:  ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

// ══════════════════════════════════════════════════════════
// ── REST API ──────────────────────────────────────────────
// ══════════════════════════════════════════════════════════

// ── Dashboard ─────────────────────────────────────────────
app.get('/api/dashboard', async (req, res) => {
  try {
    res.json(await db.getDashboardStats());
  } catch (err) {
    sendError(res, err, 'dashboard');
  }
});

// ── Stats / Chart ─────────────────────────────────────────
app.get('/api/stats/chart', async (req, res) => {
  try {
    const period = ['day', 'week', 'month'].includes(req.query.period) ? req.query.period : 'day';
    const count  = Math.min(Math.max(1, parseInt(req.query.count) || 7), 365);
    res.json(await db.getChartData(period, count));
  } catch (err) {
    sendError(res, err, 'stats/chart');
  }
});

// ── Comments ──────────────────────────────────────────────
// Bình luận gần nhất của phiên đang live (hoặc phiên gần nhất) — dùng khi tải lại trang
app.get('/api/comments/recent', async (req, res) => {
  try {
    const limit     = Math.min(500, Math.max(1, parseInt(req.query.limit) || 200));
    const sessionId = currentSessionId || await db.getLatestSessionId();
    res.json({ sessionId, live: tiktok.isConnected(), comments: await db.getRecentComments(sessionId, limit) });
  } catch (err) {
    sendError(res, err, 'comments/recent');
  }
});

// ── Orders ────────────────────────────────────────────────
app.get('/api/orders', async (req, res) => {
  try {
    const status = req.query.status && req.query.status !== 'all' && VALID_STATUSES.has(req.query.status)
      ? req.query.status : undefined;
    const search = sanitizeStr(req.query.search, 200);
    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    res.json(await db.getOrders({ status, search, page, limit }));
  } catch (err) {
    sendError(res, err, 'orders');
  }
});

app.post('/api/orders', async (req, res) => {
  try {
    // Sanitize inputs
    const tiktokUserId = sanitizeStr(req.body.tiktokUserId, 100);
    const username     = sanitizeStr(req.body.username, 100).replace('@', '');
    const displayName  = sanitizeStr(req.body.displayName, 200);
    const note         = sanitizeStr(req.body.note, 1000);

    if (!tiktokUserId || !username) {
      return res.status(400).json({ error: 'Thiếu tiktokUserId hoặc username' });
    }

    const s   = settings.load();
    const ord = await db.createOrder({
      tiktokUserId, username, displayName, note,
      prefix: sanitizeStr(s.system?.orderPrefix, 10) || 'ORD',
    });
    io.emit('order:updated', { orderId: String(ord._id) });
    res.status(201).json(ord);
  } catch (err) {
    sendError(res, err, 'create order');
  }
});

app.put('/api/orders/:id/status', async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: 'ID đơn hàng không hợp lệ' });
    }

    const newStatus = req.body.status;
    if (!newStatus || !VALID_STATUSES.has(newStatus)) {
      return res.status(400).json({ error: 'Trạng thái không hợp lệ' });
    }

    // FIX: Validate state transition (không cho nhảy trạng thái sai luồng)
    const current = await db.getOrderById(req.params.id);
    if (!current) return res.status(404).json({ error: 'Không tìm thấy đơn hàng' });

    const allowed = STATUS_TRANSITIONS[current.status] || [];
    if (!allowed.includes(newStatus)) {
      return res.status(400).json({
        error: `Không thể chuyển từ "${current.status}" sang "${newStatus}"`,
      });
    }

    // Chỉ ghi nếu trạng thái vẫn là current.status — chống 2 thiết bị bấm cùng lúc
    const order = await db.updateOrderStatus(req.params.id, current.status, newStatus);
    if (!order) {
      return res.status(409).json({ error: 'Đơn vừa được cập nhật ở thiết bị khác, hãy tải lại' });
    }
    io.emit('order:status_changed', { orderId: req.params.id, status: newStatus });
    res.json(order);
  } catch (err) {
    sendError(res, err, 'order status');
  }
});

app.put('/api/orders/:id/amount', async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: 'ID đơn hàng không hợp lệ' });
    }

    const amount        = parseAmount(req.body.amount);
    const depositAmount = parseAmount(req.body.depositAmount);

    // Validate numbers: số nguyên, không âm, không vô cực
    if (Number.isNaN(amount)) {
      return res.status(400).json({ error: 'Số tiền phải là số nguyên từ 0 đến 1 tỷ' });
    }
    if (Number.isNaN(depositAmount)) {
      return res.status(400).json({ error: 'Số tiền đặt cọc phải là số nguyên từ 0 đến 1 tỷ' });
    }

    const order = await db.updateOrderAmount(req.params.id, { amount, depositAmount });
    if (!order) return res.status(404).json({ error: 'Không tìm thấy đơn hàng' });
    io.emit('order:updated', { orderId: req.params.id });
    res.json(order);
  } catch (err) {
    // Lỗi nghiệp vụ như "đặt cọc vượt quá tổng tiền" có err.expose
    sendError(res, err, 'order amount');
  }
});

// ── Customers ─────────────────────────────────────────────
// /search phải đứng TRƯỚC /:userId
app.get('/api/customers/search', async (req, res) => {
  try {
    const q = sanitizeStr(req.query.q, 100);
    res.json(await db.searchCustomers(q));
  } catch (err) {
    sendError(res, err, 'customers/search');
  }
});

app.get('/api/customers', async (req, res) => {
  try {
    res.json(await db.getAllCustomers());
  } catch (err) {
    sendError(res, err, 'customers');
  }
});

app.get('/api/customers/:userId', async (req, res) => {
  try {
    const customer = await db.getCustomerByTiktokId(sanitizeStr(req.params.userId, 100));
    if (!customer) return res.status(404).json({ error: 'Không tìm thấy khách hàng' });
    res.json(customer);
  } catch (err) {
    sendError(res, err, 'customer');
  }
});

app.get('/api/customers/:userId/comments', async (req, res) => {
  try {
    res.json(await db.getCustomerComments(sanitizeStr(req.params.userId, 100)));
  } catch (err) {
    sendError(res, err, 'customer comments');
  }
});

app.get('/api/customers/:userId/orders', async (req, res) => {
  try {
    res.json(await db.getCustomerOrders(sanitizeStr(req.params.userId, 100)));
  } catch (err) {
    sendError(res, err, 'customer orders');
  }
});

app.put('/api/customers/:userId', async (req, res) => {
  try {
    const userId = sanitizeStr(req.params.userId, 100);
    const customer = await db.updateCustomer(userId, {
      phone:       sanitizeStr(req.body.phone,       50),
      email:       sanitizeStr(req.body.email,       200),
      notes:       sanitizeStr(req.body.notes,       1000),
      displayName: sanitizeStr(req.body.displayName, 200),
    });
    if (!customer) return res.status(404).json({ error: 'Không tìm thấy khách hàng' });
    io.emit('customer:updated', { tiktokUserId: userId });
    res.json(customer);
  } catch (err) {
    sendError(res, err, 'update customer');
  }
});

// ── Printer ───────────────────────────────────────────────
app.get('/api/printer/check', async (req, res) => {
  const result = await printer.checkPrinter();
  res.json(result);
});

app.post('/api/printer/test-ip', (req, res) => {
  const ip      = sanitizeStr(req.body.ip, 50);
  const portRaw = req.body.port;

  if (!ip || !portRaw) return res.status(400).json({ error: 'Thiếu địa chỉ IP hoặc Port' });

  const portNum = Number(portRaw);
  if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
    return res.status(400).json({ error: 'Port không hợp lệ (1–65535)' });
  }

  const ipRegex = /^((25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(25[0-5]|2[0-4]\d|[01]?\d\d?)$/;
  if (!ipRegex.test(ip)) {
    return res.status(400).json({ error: 'Địa chỉ IP không hợp lệ' });
  }

  const net    = require('net');
  const data   = printer.buildTestEscPos();
  const client = new net.Socket();
  let done     = false;

  client.setTimeout(5000);
  client.connect(portNum, ip, () => { client.write(data, () => { client.end(); }); });
  client.on('close', () => {
    if (!done) { done = true; res.json({ ok: true, message: 'In thử thành công!' }); }
  });
  client.on('error', (err) => {
    // Lỗi mạng (ECONNREFUSED, EHOSTUNREACH...) có ích cho người dùng tự kiểm tra máy in
    if (!done) { done = true; res.status(500).json({ error: `Không kết nối được máy in: ${err.code || err.message}` }); }
  });
  client.on('timeout', () => {
    client.destroy();
    if (!done) { done = true; res.status(500).json({ error: 'Timeout kết nối máy in' }); }
  });
});

// ── Settings ──────────────────────────────────────────────
app.get('/api/settings', (req, res) => {
  res.json(settings.load());
});

app.put('/api/settings', (req, res) => {
  try {
    const saved = settings.save(req.body);
    // Thiết bị khác (web/điện thoại) cập nhật cài đặt ngay, vd bật/tắt tự động in
    io.emit('settings:updated', saved);
    res.json(saved);
  } catch (err) {
    sendError(res, err, 'settings');
  }
});

// ══════════════════════════════════════════════════════════
// ── State ─────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════
let currentSessionId = null;
const recentComments = new Set();

// ══════════════════════════════════════════════════════════
// ── Socket.io ─────────────────────────────────────────────
// ══════════════════════════════════════════════════════════
io.on('connection', (socket) => {
  console.log('[Socket] Client kết nối:', socket.id);

  socket.emit('tiktok:status', {
    connected: tiktok.isConnected(),
    username:  null,
  });

  // ── Kết nối TikTok Live ──
  // payload = {}: client gửi event không kèm dữ liệu cũng không làm sập server
  socket.on('tiktok:connect', async (payload = {}) => {
    let sessionId = null;
    try {
      const cleanUsername = sanitizeStr(payload?.username, 100).replace('@', '');
      if (!cleanUsername) {
        socket.emit('tiktok:error', { message: 'Username không hợp lệ' });
        return;
      }

      socket.emit('tiktok:status', { connected: false, username: cleanUsername, loading: true });

      // Đóng phiên cũ (nếu đang live) trước khi mở phiên mới
      if (currentSessionId) await db.endSession(currentSessionId);
      sessionId = await db.createSession(cleanUsername);
      currentSessionId = sessionId;

      await tiktok.connect(cleanUsername, {
        onConnected: ({ username: u, roomId }) => {
          io.emit('tiktok:status', { connected: true, username: u, roomId });
        },

        onComment: async (data) => {
          try {
            // FIX: filter comment rỗng tại tầng socket
            if (!data.comment || !data.comment.trim()) return;

            const dedupKey = `${data.tiktokUserId}_${data.comment}_${Math.floor(Date.now() / 3000)}`;
            if (recentComments.has(dedupKey)) return;
            recentComments.add(dedupKey);
            setTimeout(() => recentComments.delete(dedupKey), 3000);

            const commentId = await db.saveComment({
              tiktokUserId: data.tiktokUserId,
              username:     data.username,
              displayName:  data.displayName,
              comment:      data.comment,
              sessionId,
            });

            if (!commentId) return;  // saveComment trả null nếu comment rỗng

            io.emit('comment:new', {
              id:           commentId,
              tiktokUserId: data.tiktokUserId,
              username:     data.username,
              displayName:  data.displayName,
              comment:      data.comment,
              timestamp:    data.timestamp,
            });
          } catch (err) {
            console.error('[Comment Error]', err.message);
          }
        },

        onDisconnected: async () => {
          // Chỉ đóng đúng phiên của kết nối này, không đụng phiên mới hơn
          await db.endSession(sessionId).catch(e => console.error('[Session]', e.message));
          if (currentSessionId === sessionId) currentSessionId = null;
          io.emit('tiktok:status', { connected: false, username: null });
        },

        onError: (msg) => {
          io.emit('tiktok:error', { message: msg });
        },
      });

    } catch (err) {
      console.error('[TikTok Connect Error]', err.message);
      // Kết nối thất bại → đóng phiên vừa tạo, không để phiên "mở mãi"
      if (sessionId) {
        await db.endSession(sessionId).catch(() => {});
        if (currentSessionId === sessionId) currentSessionId = null;
      }
      socket.emit('tiktok:error', { message: err.message });
      socket.emit('tiktok:status', { connected: false, username: null });
    }
  });

  // ── Ngắt kết nối TikTok ──
  socket.on('tiktok:disconnect', async () => {
    try {
      if (currentSessionId) {
        await db.endSession(currentSessionId);
        currentSessionId = null;
      }
      await tiktok.disconnect();
      io.emit('tiktok:status', { connected: false, username: null });
    } catch (err) {
      console.error('[TikTok Disconnect Error]', err.message);
    }
  });

  // ── Chốt đơn từ bình luận + in phiếu ──
  // Thứ tự an toàn: TẠO ĐƠN trước (unique theo commentId) → đánh dấu → IN.
  // In lỗi thì đơn vẫn còn, bấm "In lại" (reprint: true) chỉ in, không tạo đơn mới.
  socket.on('print:comment', async (payload = {}) => {
    const commentId = payload?.commentId;
    const reprint   = payload?.reprint === true;
    console.log(`[Print] Nhận yêu cầu ${reprint ? 'in lại' : 'chốt'} commentId: ${commentId}`);

    const fail = (message) => socket.emit('printer:status', { status: 'error', commentId, message });

    // Validate ObjectId
    if (typeof commentId !== 'string' || !OBJECTID_RE.test(commentId)) {
      fail('commentId không hợp lệ');
      return;
    }

    let order;
    try {
      const comment = await db.getCommentById(commentId);
      if (!comment) { fail('Không tìm thấy bình luận trong CSDL'); return; }

      order = await db.getOrderByCommentId(commentId);

      if (order && !reprint) {
        fail(`Bình luận này đã chốt thành đơn ${order.orderNumber}. Bấm "In lại" nếu cần in thêm.`);
        socket.emit('order:exists', { commentId, orderNumber: order.orderNumber });
        return;
      }
      if (!order && reprint) { fail('Bình luận này chưa có đơn để in lại'); return; }

      if (!order) {
        const s = settings.load();
        try {
          order = await db.createOrder({
            commentId,
            tiktokUserId: comment.tiktokUserId,
            username:     comment.username,
            displayName:  comment.displayName,
            note:         comment.comment,
            sessionId:    comment.sessionId || currentSessionId,
            prefix:       sanitizeStr(s.system?.orderPrefix, 10) || 'ORD',
          });
        } catch (err) {
          // Thiết bị khác vừa chốt cùng bình luận (unique index commentId chặn đơn thứ 2)
          if (err.code === 11000 && err.keyPattern?.commentId) {
            fail('Bình luận này vừa được chốt ở thiết bị khác');
            return;
          }
          throw err;
        }

        // Đơn đã tồn tại → nếu bước này lỗi, lần sau vẫn nhận ra nhờ Order.commentId
        await db.markPrinted(commentId).catch(e => console.error('[Print] markPrinted:', e.message));

        const customer = await db.getCustomerByTiktokId(comment.tiktokUserId);
        io.emit('order:saved', {
          commentId,
          orderId:      String(order._id),
          orderNumber:  order.orderNumber,
          tiktokUserId: comment.tiktokUserId,
          username:     comment.username,
          displayName:  comment.displayName,
          comment:      comment.comment,
          timestamp:    comment.timestamp,
          totalOrders:  customer?.totalOrders || 1,
        });
      }

      try {
        await printer.printComment({
          tiktokUserId: comment.tiktokUserId,
          username:     comment.username,
          displayName:  comment.displayName,
          comment:      comment.comment,
          timestamp:    comment.timestamp,
          orderNum:     order.orderNumber,
        });
      } catch (err) {
        console.error('[Print Error]', err.message);
        io.emit('printer:status', {
          status: 'error',
          commentId,
          message: `Đã tạo đơn ${order.orderNumber} nhưng in lỗi: ${err.message}. Bấm "In lại" khi máy in sẵn sàng.`,
        });
        return;
      }

      io.emit('printer:status', {
        status: 'ok',
        commentId,
        message: `${reprint ? 'In lại' : 'In'} thành công! ${order.orderNumber}`,
      });
      console.log('[Print] Hoàn tất —', order.orderNumber);

    } catch (err) {
      console.error('[Chốt đơn Error]', err);
      fail(order
        ? `Đã tạo đơn ${order.orderNumber} nhưng có lỗi khi xử lý tiếp, hãy kiểm tra trang Đơn hàng`
        : 'Lỗi máy chủ khi chốt đơn, chưa có đơn nào được tạo. Hãy thử lại.');
    }
  });

  socket.on('disconnect', () => {
    console.log('[Socket] Client ngắt kết nối:', socket.id);
  });
});

// ── Bootstrap ─────────────────────────────────────────────
(async () => {
  try {
    await db.connectDB();
    httpServer.listen(PORT, () => {
      console.log(`\n🚀 TikTok Chốt Đơn đang chạy tại: http://localhost:${PORT}`);
      console.log(`🖨️  Printer: ${process.env.PRINTER_NAME || 'chưa cấu hình'}`);
      console.log(`🏪 Shop: ${process.env.SHOP_NAME || 'SHOP CỦA BẠN'}\n`);
    });
  } catch (err) {
    console.error('[MongoDB] Kết nối thất bại:', err.message);
    process.exit(1);
  }
})();
