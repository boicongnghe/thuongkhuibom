require('dotenv').config();
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');

const tiktok = require('./src/tiktok');
const printer = require('./src/printer');
const db = require('./src/database');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3001;

// ── Middleware ────────────────────────────────────────────
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
const recentComments = new Set();

// ── Socket.io ─────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log('[Socket] Client kết nối:', socket.id);

  socket.emit('tiktok:status', {
    connected: tiktok.isConnected(),
    username: null,
  });

  socket.on('tiktok:connect', async ({ username }) => {
    try {
      socket.emit('tiktok:status', { connected: false, username, loading: true });

      currentSessionId = await db.createSession(username);

      await tiktok.connect(username, {
        onConnected: ({ username: u, roomId }) => {
          io.emit('tiktok:status', { connected: true, username: u, roomId });
        },

        onComment: async (data) => {
          const dedupKey = `${data.tiktokUserId}_${data.comment}_${Math.floor(Date.now() / 3000)}`;
          if (recentComments.has(dedupKey)) return;
          recentComments.add(dedupKey);
          setTimeout(() => recentComments.delete(dedupKey), 3000);

          const commentId = await db.saveComment({
            tiktokUserId: data.tiktokUserId,
            username: data.username,
            displayName: data.displayName,
            comment: data.comment,
            sessionId: currentSessionId,
          });

          io.emit('comment:new', {
            id: commentId,
            tiktokUserId: data.tiktokUserId,
            username: data.username,
            displayName: data.displayName,
            comment: data.comment,
            timestamp: data.timestamp,
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
    console.log(`[Print] Nhận yêu cầu in commentId: ${commentId}`);
    try {
      const comment = await db.getCommentById(commentId);
      console.log(`[Print] getCommentById result:`, comment ? `tìm thấy (${comment.username})` : 'NULL - không tìm thấy');

      if (!comment) throw new Error('Không tìm thấy bình luận trong CSDL');

      console.log('[Print] Đang gọi printer.printComment...');
      await printer.printComment({
        tiktokUserId: comment.tiktokUserId,
        username: comment.username,
        displayName: comment.displayName,
        comment: comment.comment,
        timestamp: comment.timestamp,
      });
      console.log('[Print] printComment hoàn thành, đang markPrinted...');

      await db.markPrinted(commentId);

      const customers = await db.getAllCustomers();
      const customer = customers.find(c => c.tiktokUserId === comment.tiktokUserId);

      io.emit('order:saved', {
        commentId,
        tiktokUserId: comment.tiktokUserId,
        username: comment.username,
        comment: comment.comment,
        timestamp: comment.timestamp,
        totalOrders: customer?.totalOrders || 1,
      });

      io.emit('printer:status', { status: 'ok', message: 'In thành công!' });
      console.log('[Print] Hoàn tất — emit order:saved + printer:status ok');

    } catch (err) {
      console.error('[Print Error]', err.message, err.stack);
      io.emit('printer:status', { status: 'error', message: err.message });
    }
  });


  socket.on('disconnect', () => {
    console.log('[Socket] Client ngắt kết nối:', socket.id);
  });
});

// ── BOOTSTRAP ĐÚNG CÁCH (QUAN TRỌNG) ─────────────────────
(async () => {
  try {
    await db.connectDB();

    httpServer.listen(PORT, () => {
      console.log(`\n🚀 TikTok Chốt Đơn đang chạy tại: http://localhost:${PORT}`);
      console.log(`🖨️  Printer USB (ESC/POS)`);
      console.log(`🏪 Shop: ${process.env.SHOP_NAME || 'SHOP CỦA BẠN'}\n`);
    });

  } catch (err) {
    console.error('[MongoDB] Kết nối thất bại:', err.message);
    process.exit(1);
  }
})();
