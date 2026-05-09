require('dotenv').config();
const express  = require('express');
const { createServer } = require('http');
const { Server }       = require('socket.io');
const path             = require('path');

const tiktok  = require('./src/tiktok');
const printer = require('./src/printer');
const db      = require('./src/database');

const app        = express();
const httpServer = createServer(app);
const io         = new Server(httpServer, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;

// ── Khởi động MongoDB rồi mới lắng nghe ──────────────────
db.connectDB().catch((err) => {
  console.error('[MongoDB] Kết nối thất bại:', err.message);
  process.exit(1);
});

// ── Static files (frontend) ───────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// ── REST API ──────────────────────────────────────────────
app.get('/api/customers', async (req, res) => {
  try {
    res.json(await db.getAllCustomers());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/customers/:userId/comments', async (req, res) => {
  try {
    res.json(await db.getCustomerComments(req.params.userId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/printer/check', async (req, res) => {
  const result = await printer.checkPrinter();
  res.json(result);
});

// ── State ─────────────────────────────────────────────────
let currentSessionId = null;

// Bộ lọc bình luận trùng lặp (TikTok đôi khi emit 2 lần)
const recentComments = new Set();

// ── Socket.io ─────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log('[Socket] Client kết nối:', socket.id);

  // Gửi trạng thái hiện tại cho client mới
  socket.emit('tiktok:status', {
    connected: tiktok.isConnected(),
    username: null,
  });

  // ── Kết nối TikTok Live ──
  socket.on('tiktok:connect', async ({ username }) => {
    try {
      socket.emit('tiktok:status', { connected: false, username, loading: true });

      // Tạo session mới trong MongoDB
      currentSessionId = await db.createSession(username);

      await tiktok.connect(username, {
        onConnected: ({ username: u, roomId }) => {
          io.emit('tiktok:status', { connected: true, username: u, roomId });
        },

        onComment: async (data) => {
          // Lọc trùng lặp: cùng userId + comment trong vòng 3 giây
          const dedupKey = `${data.tiktokUserId}_${data.comment}_${Math.floor(Date.now() / 3000)}`;
          if (recentComments.has(dedupKey)) return;
          recentComments.add(dedupKey);
          setTimeout(() => recentComments.delete(dedupKey), 3000);

          // Lưu vào MongoDB
          const commentId = await db.saveComment({
            tiktokUserId: data.tiktokUserId,
            username:     data.username,
            displayName:  data.displayName,
            comment:      data.comment,
            sessionId:    currentSessionId,
          });

          // Broadcast cho tất cả client
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
          if (currentSessionId) await db.endSession(currentSessionId);
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
    if (currentSessionId) {
      await db.endSession(currentSessionId);
      currentSessionId = null;
    }
    await tiktok.disconnect();
    io.emit('tiktok:status', { connected: false, username: null });
  });

  // ── In bình luận ──
  socket.on('print:comment', async ({ commentId }) => {
    try {
      const comment = await db.getCommentById(commentId);
      if (!comment) throw new Error('Không tìm thấy bình luận');

      await printer.printComment({
        tiktokUserId: comment.tiktokUserId,
        username:     comment.username,
        comment:      comment.comment,
        timestamp:    comment.timestamp,
      });

      const updated = await db.markPrinted(commentId);

      // Lấy thông tin khách để lấy tổng đơn
      const customers = await db.getAllCustomers();
      const customer  = customers.find(c => c.tiktokUserId === comment.tiktokUserId);

      io.emit('order:saved', {
        commentId,
        tiktokUserId: comment.tiktokUserId,
        username:     comment.username,
        comment:      comment.comment,
        timestamp:    comment.timestamp,
        totalOrders:  customer?.totalOrders || 1,
      });

      io.emit('printer:status', { status: 'ok', message: 'In thành công!' });

    } catch (err) {
      console.error('[Print Error]', err.message);
      io.emit('printer:status', { status: 'error', message: err.message });
    }
  });

  socket.on('disconnect', () => {
    console.log('[Socket] Client ngắt kết nối:', socket.id);
  });
});

// ── Start server ──────────────────────────────────────────
httpServer.listen(PORT, () => {
  console.log(`\n🚀 TikTok Chốt Đơn đang chạy tại: http://localhost:${PORT}`);
  console.log(`🖨️  Máy in: ${process.env.PRINTER_NAME || 'POS-80'}`);
  console.log(`🏪 Shop: ${process.env.SHOP_NAME || 'SHOP CỦA BẠN'}\n`);
});
