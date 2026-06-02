require('dotenv').config();
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');

const tiktok   = require('./src/tiktok');
const printer  = require('./src/printer');
const db       = require('./src/database');
const settings = require('./src/settings');

const app        = express();
const httpServer = createServer(app);
const io         = new Server(httpServer, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3001;

// ── Middleware ────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));

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
    res.status(500).json({ error: err.message });
  }
});

// ── Stats / Chart ─────────────────────────────────────────
app.get('/api/stats/chart', async (req, res) => {
  try {
    const period = ['day', 'week', 'month'].includes(req.query.period) ? req.query.period : 'day';
    const count  = Math.min(Math.max(1, parseInt(req.query.count) || 7), 365);
    res.json(await db.getChartData(period, count));
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
    res.status(201).json(ord);
  } catch (err) {
    res.status(500).json({ error: err.message });
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

    const order = await db.updateOrderStatus(req.params.id, newStatus);
    io.emit('order:status_changed', { orderId: req.params.id, status: newStatus });
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/orders/:id/amount', async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: 'ID đơn hàng không hợp lệ' });
    }

    const amount        = req.body.amount        !== undefined ? Number(req.body.amount)        : undefined;
    const depositAmount = req.body.depositAmount !== undefined ? Number(req.body.depositAmount) : undefined;

    // Validate numbers
    if (amount !== undefined && (isNaN(amount) || amount < 0)) {
      return res.status(400).json({ error: 'Số tiền không hợp lệ' });
    }
    if (depositAmount !== undefined && (isNaN(depositAmount) || depositAmount < 0)) {
      return res.status(400).json({ error: 'Số tiền đặt cọc không hợp lệ' });
    }

    const order = await db.updateOrderAmount(req.params.id, { amount, depositAmount });
    if (!order) return res.status(404).json({ error: 'Không tìm thấy đơn hàng' });
    res.json(order);
  } catch (err) {
    // Bao gồm lỗi "đặt cọc vượt quá tổng tiền"
    res.status(400).json({ error: err.message });
  }
});

// ── Customers ─────────────────────────────────────────────
// /search phải đứng TRƯỚC /:userId
app.get('/api/customers/search', async (req, res) => {
  try {
    const q = sanitizeStr(req.query.q, 100);
    res.json(await db.searchCustomers(q));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/customers', async (req, res) => {
  try {
    res.json(await db.getAllCustomers());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/customers/:userId', async (req, res) => {
  try {
    const customer = await db.getCustomerByTiktokId(sanitizeStr(req.params.userId, 100));
    if (!customer) return res.status(404).json({ error: 'Không tìm thấy khách hàng' });
    res.json(customer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/customers/:userId/comments', async (req, res) => {
  try {
    res.json(await db.getCustomerComments(sanitizeStr(req.params.userId, 100)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/customers/:userId/orders', async (req, res) => {
  try {
    res.json(await db.getCustomerOrders(sanitizeStr(req.params.userId, 100)));
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    res.json(customer);
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    if (!done) { done = true; res.status(500).json({ error: err.message }); }
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
    res.json(settings.save(req.body));
  } catch (err) {
    res.status(500).json({ error: err.message });
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
  socket.on('tiktok:connect', async ({ username }) => {
    try {
      const cleanUsername = sanitizeStr(username, 100).replace('@', '');
      if (!cleanUsername) {
        socket.emit('tiktok:error', { message: 'Username không hợp lệ' });
        return;
      }

      socket.emit('tiktok:status', { connected: false, username: cleanUsername, loading: true });

      currentSessionId = await db.createSession(cleanUsername);

      await tiktok.connect(cleanUsername, {
        onConnected: ({ username: u, roomId }) => {
          io.emit('tiktok:status', { connected: true, username: u, roomId });
        },

        onComment: async (data) => {
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
            sessionId:    currentSessionId,
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
        },

        onDisconnected: async () => {
          if (currentSessionId) {
            await db.endSession(currentSessionId);
            currentSessionId = null;
          }
          io.emit('tiktok:status', { connected: false, username: null });
        },

        onError: (msg) => {
          io.emit('tiktok:error', { message: msg });
        },
      });

    } catch (err) {
      console.error('[TikTok Connect Error]', err.message);
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

  // ── In bình luận → tạo Order ──
  socket.on('print:comment', async ({ commentId }) => {
    console.log(`[Print] Nhận yêu cầu in commentId: ${commentId}`);

    // Validate ObjectId
    if (!commentId || !OBJECTID_RE.test(commentId)) {
      socket.emit('printer:status', { status: 'error', message: 'commentId không hợp lệ' });
      return;
    }

    try {
      const comment = await db.getCommentById(commentId);
      if (!comment) throw new Error('Không tìm thấy bình luận trong CSDL');

      // FIX: markPrinted sẽ trả về null nếu đã in rồi (atomic check)
      const marked = await db.markPrinted(commentId);
      if (!marked) {
        socket.emit('printer:status', { status: 'error', message: 'Đơn hàng này đã được in rồi' });
        return;
      }

      await printer.printComment({
        tiktokUserId: comment.tiktokUserId,
        username:     comment.username,
        displayName:  comment.displayName,
        comment:      comment.comment,
        timestamp:    comment.timestamp,
      });

      // Tạo Order record khi chốt đơn
      const s     = settings.load();
      const order = await db.createOrder({
        commentId,
        tiktokUserId: comment.tiktokUserId,
        username:     comment.username,
        displayName:  comment.displayName,
        note:         comment.comment,
        sessionId:    currentSessionId,
        prefix:       sanitizeStr(s.system?.orderPrefix, 10) || 'ORD',
      });

      const customers = await db.getAllCustomers();
      const customer  = customers.find(c => c.tiktokUserId === comment.tiktokUserId);

      io.emit('order:saved', {
        commentId,
        orderId:      order._id.toString(),
        orderNumber:  order.orderNumber,
        tiktokUserId: comment.tiktokUserId,
        username:     comment.username,
        displayName:  comment.displayName,
        comment:      comment.comment,
        timestamp:    comment.timestamp,
        totalOrders:  customer?.totalOrders || 1,
      });

      io.emit('printer:status', { status: 'ok', message: `In thành công! ${order.orderNumber}` });
      console.log('[Print] Hoàn tất —', order.orderNumber);

    } catch (err) {
      console.error('[Print Error]', err.message);
      io.emit('printer:status', { status: 'error', message: err.message });
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
