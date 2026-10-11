// Express app chứa toàn bộ REST API (đăng nhập, đơn hàng, khách hàng, cài đặt...).
// Dùng chung cho 2 nơi:
//   - backend/server.js  : chạy trên máy tính (thêm Socket.io, TikTok Live, máy in)
//   - api/index.js       : chạy trên Vercel Serverless (không có realtime / máy in)
require('dotenv').config();
const express      = require('express');
const cors         = require('cors');
const cookieParser = require('cookie-parser');
const helmet       = require('helmet');

const db         = require('./src/database');
const settings   = require('./src/settings');
const authRoutes = require('./src/authRoutes');
const { getSecret, requireAuth, requireAppHeader } = require('./src/authMiddleware');

// ── Helpers ───────────────────────────────────────────────
function sanitizeStr(val, max = 500) {
  return String(val || '').trim().slice(0, max);
}

const OBJECTID_RE = /^[0-9a-fA-F]{24}$/;
function isValidObjectId(id) {
  return OBJECTID_RE.test(id);
}

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

const SUMMARY_SCOPES = ['session', 'today', '7d', '30d', 'all'];

// 0h ngày hôm nay (giờ Việt Nam, UTC+7, không có giờ mùa hè) lùi về `daysBack` ngày
function vnDayStart(daysBack = 0) {
  const VN_OFFSET = 7 * 3600 * 1000;
  const vnNow = new Date(Date.now() + VN_OFFSET);
  const startUtc = Date.UTC(vnNow.getUTCFullYear(), vnNow.getUTCMonth(), vnNow.getUTCDate()) - VN_OFFSET;
  return new Date(startUtc - daysBack * 24 * 3600 * 1000);
}

// Máy tính gửi trạng thái mỗi 20 giây; quá 60 giây không có tin → coi như máy tính chưa mở app
const PC_STALE_SEC = 60;

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

/**
 * @param {object}   opts
 * @param {object}   [opts.io]                  Socket.io server (chỉ có khi chạy trên máy tính)
 * @param {function} [opts.getLive]             () => ({ sessionId, live }) trạng thái TikTok Live
 * @param {function} [opts.registerLocalRoutes] (app) => void — route chỉ có trên máy tính (máy in)
 */
function createApp({ io = null, getLive = () => ({ sessionId: null, live: false }), registerLocalRoutes } = {}) {
  getSecret();  // ném lỗi ngay nếu thiếu JWT_SECRET

  // Không có Socket.io (Vercel) thì emit không làm gì
  const emit = (event, data) => io?.emit(event, data);

  // Chỉ cho phép các domain frontend liệt kê trong CORS_ORIGINS (cách nhau bởi dấu phẩy)
  const allowedOrigins = (process.env.CORS_ORIGINS || '')
    .split(',').map(s => s.trim()).filter(Boolean);

  const app = express();
  app.set('io', io);  // cho các route (vd logout-all) dùng Socket.io

  // Chạy sau proxy (Vercel, Cloudflare Tunnel...) để lấy đúng IP người dùng
  if (process.env.TRUST_PROXY) {
    const hops = Number(process.env.TRUST_PROXY);
    app.set('trust proxy', Number.isNaN(hops) ? process.env.TRUST_PROXY : hops);
  } else if (process.env.VERCEL) {
    app.set('trust proxy', 1);
  }

  // ── Middleware ──────────────────────────────────────────
  // Header bảo mật mặc định (CSP mặc định của helmet đã cho phép Google Fonts và style inline)
  app.use(helmet());
  app.use(cors({
    origin: (origin, cb) => cb(null, !origin || allowedOrigins.includes(origin)),
    credentials: true,
  }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  // ── Auth: /api/auth tự do, mọi /api khác phải đăng nhập ─
  app.use('/api', requireAppHeader);
  app.use('/api/auth', authRoutes);
  app.use('/api', requireAuth);

  // ── Dashboard ───────────────────────────────────────────
  app.get('/api/dashboard', async (req, res) => {
    try {
      res.json(await db.getDashboardStats());
    } catch (err) {
      sendError(res, err, 'dashboard');
    }
  });

  // ── Stats / Chart ───────────────────────────────────────
  app.get('/api/stats/chart', async (req, res) => {
    try {
      const period = ['day', 'week', 'month'].includes(req.query.period) ? req.query.period : 'day';
      const count  = Math.min(Math.max(1, parseInt(req.query.count) || 7), 365);
      res.json(await db.getChartData(period, count));
    } catch (err) {
      sendError(res, err, 'stats/chart');
    }
  });

  // ── Tổng kết đơn hàng ───────────────────────────────────
  // scope: session (phiên live hiện tại/gần nhất) | today | 7d | 30d | all
  app.get('/api/stats/summary', async (req, res) => {
    try {
      const scope = SUMMARY_SCOPES.includes(req.query.scope) ? req.query.scope : 'session';
      let filter = {};
      if (scope === 'session') {
        const reqSession = typeof req.query.sessionId === 'string' && isValidObjectId(req.query.sessionId)
          ? req.query.sessionId : null;
        const sessionId = reqSession || getLive().sessionId || await db.getLatestSessionId();
        if (!sessionId) return res.json({ scope, session: null, totals: null, byStatus: [], topCustomers: [] });
        filter = { sessionId };
      } else if (scope !== 'all') {
        filter = { from: vnDayStart(scope === 'today' ? 0 : scope === '7d' ? 6 : 29) };
      }
      res.json({ scope, ...(await db.getOrderSummary(filter)) });
    } catch (err) {
      sendError(res, err, 'stats/summary');
    }
  });

  // ── Comments ────────────────────────────────────────────
  // Bình luận gần nhất của phiên đang live (hoặc phiên gần nhất) — dùng khi tải lại trang
  app.get('/api/comments/recent', async (req, res) => {
    try {
      const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 200));
      const { sessionId: liveSession, live } = getLive();
      const sessionId = liveSession || await db.getLatestSessionId();
      res.json({ sessionId, live, comments: await db.getRecentComments(sessionId, limit) });
    } catch (err) {
      sendError(res, err, 'comments/recent');
    }
  });

  // ── Orders ──────────────────────────────────────────────
  app.get('/api/orders', async (req, res) => {
    try {
      const status = req.query.status && req.query.status !== 'all' && VALID_STATUSES.has(req.query.status)
        ? req.query.status : undefined;
      const search = sanitizeStr(req.query.search, 200);
      const page   = Math.max(1, parseInt(req.query.page)  || 1);
      const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
      const sessionId = typeof req.query.sessionId === 'string' && isValidObjectId(req.query.sessionId)
        ? req.query.sessionId : undefined;
      res.json(await db.getOrders({ status, search, sessionId, page, limit }));
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

      const s   = await settings.load();
      const ord = await db.createOrder({
        tiktokUserId, username, displayName, note,
        prefix: sanitizeStr(s.system?.orderPrefix, 10) || 'ORD',
      });
      emit('order:updated', { orderId: String(ord._id) });
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

      // Validate state transition (không cho nhảy trạng thái sai luồng)
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
      emit('order:status_changed', { orderId: req.params.id, status: newStatus });
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
      emit('order:updated', { orderId: req.params.id });
      res.json(order);
    } catch (err) {
      // Lỗi nghiệp vụ như "đặt cọc vượt quá tổng tiền" có err.expose
      sendError(res, err, 'order amount');
    }
  });

  // ── Customers ───────────────────────────────────────────
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
      emit('customer:updated', { tiktokUserId: userId });
      res.json(customer);
    } catch (err) {
      sendError(res, err, 'update customer');
    }
  });

  // ── Settings ────────────────────────────────────────────
  app.get('/api/settings', async (req, res) => {
    try {
      res.json(await settings.load());
    } catch (err) {
      sendError(res, err, 'settings');
    }
  });

  app.put('/api/settings', async (req, res) => {
    try {
      const saved = await settings.save(req.body);
      // Thiết bị khác (web/điện thoại) cập nhật cài đặt ngay, vd bật/tắt tự động in
      emit('settings:updated', saved);
      res.json(saved);
    } catch (err) {
      sendError(res, err, 'settings');
    }
  });

  // ── Máy in: chỉ có khi chạy trên máy tính ───────────────
  if (registerLocalRoutes) {
    registerLocalRoutes(app);
  } else {
    // Vercel không thấy máy in → đọc trạng thái mà máy tính chạy app gửi lên MongoDB
    app.get('/api/printer/check', async (req, res) => {
      try {
        const pc = await db.getLocalStatus();
        const ageSec = pc ? Math.round((Date.now() - new Date(pc.updatedAt).getTime()) / 1000) : null;
        if (!pc || ageSec > PC_STALE_SEC) {
          return res.json({
            ok: false, printerName: pc?.printer?.printerName || '', status: 'PC_OFFLINE', remote: true,
            lastSeenSec: ageSec, tiktok: { connected: false },
          });
        }
        res.json({ ...pc.printer, remote: true, lastSeenSec: ageSec, tiktok: pc.tiktok || { connected: false } });
      } catch (err) {
        sendError(res, err, 'printer/check (remote)');
      }
    });
    app.post('/api/printer/test-ip', (req, res) => {
      res.status(400).json({ error: 'In thử chỉ dùng được khi chạy app trên máy tính có máy in' });
    });
  }

  // API không tồn tại
  app.use('/api', (req, res) => res.status(404).json({ error: 'Không tìm thấy API' }));

  return app;
}

module.exports = { createApp, sanitizeStr, OBJECTID_RE, vnDayStart };
