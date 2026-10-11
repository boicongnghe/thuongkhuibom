require('dotenv').config();
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs   = require('fs');

const tiktok   = require('./src/tiktok');
const printer  = require('./src/printer');
const db       = require('./src/database');
const settings = require('./src/settings');
const { socketAuth } = require('./src/authMiddleware');
const { createApp, sanitizeStr, OBJECTID_RE } = require('./app');

// Chỉ cho phép các domain frontend liệt kê trong CORS_ORIGINS (cách nhau bởi dấu phẩy)
const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

let app;
const httpServer = createServer((req, res) => app(req, res));
const io         = new Server(httpServer, {
  cors: { origin: allowedOrigins.length ? allowedOrigins : false, credentials: true },
});
io.use(socketAuth);

const PORT = process.env.PORT || 3001;

// ══════════════════════════════════════════════════════════
// ── REST API (dùng chung với Vercel, xem backend/app.js) ──
// ══════════════════════════════════════════════════════════
try {
  app = createApp({
    io,
    getLive: () => ({ sessionId: currentSessionId, live: tiktok.isConnected() }),
    // Máy in chỉ có trên máy tính
    registerLocalRoutes: (app) => {
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
    },
  });
} catch (err) {
  // Thiếu JWT_SECRET → dừng ngay, tránh chạy với cấu hình không an toàn
  console.error('[Auth]', err.message);
  process.exit(1);
}

// Serve React build (production) or old frontend (fallback)
const reactDist = path.join(__dirname, '../frontend-react-dist');
const oldFront  = path.join(__dirname, '../frontend');
const staticDir = fs.existsSync(reactDist) ? reactDist : oldFront;
const express   = require('express');
app.use(express.static(staticDir));

// SPA fallback for React Router (Express 5 uses /*path syntax)
app.get('/*path', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return next();
  const indexFile = path.join(staticDir, 'index.html');
  if (fs.existsSync(indexFile)) res.sendFile(indexFile);
  else next();
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
        const s = await settings.load();
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
