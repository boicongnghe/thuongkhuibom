// Express app = API của DỊCH VỤ TRUNG TÂM (chạy trên Vercel: api/index.js; chạy thử ở máy: server.js).
// Mọi route sau đăng nhập đều dùng req.shopId → dữ liệu mỗi shop tách riêng.
// App desktop ở shop KHÔNG có chuỗi database: nó đăng nhập như người dùng và gọi các API dưới đây.
require('dotenv').config();
const express      = require('express');
const cors         = require('cors');
const cookieParser = require('cookie-parser');
const helmet       = require('helmet');

const db          = require('./src/database');
const holds       = require('./src/holds');
const settings    = require('./src/settings');
const authRoutes  = require('./src/authRoutes');
const User        = require('./models/User');
const { getSecret, requireAuth, requireAppHeader, requireAdmin } = require('./src/authMiddleware');

// ── Helpers ───────────────────────────────────────────────
function sanitizeStr(val, max = 500) {
  return String(val || '').trim().slice(0, max);
}

const OBJECTID_RE = /^[0-9a-fA-F]{24}$/;
function isValidObjectId(id) {
  return typeof id === 'string' && OBJECTID_RE.test(id);
}

// Lỗi nghiệp vụ (err.expose) hiện nguyên văn; lỗi khác chỉ ghi log, không lộ chi tiết nội bộ
function sendError(res, err, context) {
  if (err?.expose) return res.status(err.status || 400).json({ error: err.message });
  console.error(`[API Error] ${context}:`, err);
  res.status(500).json({ error: 'Lỗi máy chủ, vui lòng thử lại' });
}

// Bọc handler async: lỗi nào cũng về sendError
const handle = (context, fn) => async (req, res) => {
  try { await fn(req, res); } catch (err) { sendError(res, err, context); }
};

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

// App desktop báo trạng thái mỗi 10 giây; quá 45 giây không có tin → coi như app ở shop đang tắt
const AGENT_STALE_SEC = 45;

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

function agentView(state) {
  const ageSec = state.updatedAt ? Math.round((Date.now() - new Date(state.updatedAt).getTime()) / 1000) : null;
  const online = ageSec !== null && ageSec <= AGENT_STALE_SEC;
  return {
    online,
    lastSeenSec: ageSec,
    printer: state.printer || {},
    tiktok:  online ? (state.tiktok || {}) : { connected: false },
  };
}

// Phiên live "hiện tại" của shop: phiên app desktop đang chạy, không thì phiên gần nhất
async function currentSessionId(shopId) {
  const agent = agentView(await db.getLiveState(shopId));
  if (agent.tiktok.connected && isValidObjectId(agent.tiktok.sessionId)) return agent.tiktok.sessionId;
  return await db.getLatestSessionId(shopId);
}

function createApp() {
  getSecret();  // ném lỗi ngay nếu thiếu JWT_SECRET

  // Chỉ cho phép các domain frontend liệt kê trong CORS_ORIGINS (cách nhau bởi dấu phẩy)
  const allowedOrigins = (process.env.CORS_ORIGINS || '')
    .split(',').map(s => s.trim()).filter(Boolean);

  const app = express();

  // Chạy sau proxy (Vercel, Cloudflare Tunnel...) để lấy đúng IP người dùng
  if (process.env.TRUST_PROXY) {
    const hops = Number(process.env.TRUST_PROXY);
    app.set('trust proxy', Number.isNaN(hops) ? process.env.TRUST_PROXY : hops);
  } else if (process.env.VERCEL) {
    app.set('trust proxy', 1);
  }

  // ── Middleware ──────────────────────────────────────────
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

  // Công khai (trang chủ): link tải app desktop do quản trị đặt
  app.get('/api/public/download', handle('public/download', async (req, res) => {
    res.set('Cache-Control', 'public, max-age=60');
    res.json(await db.getAppDownload());
  }));

  app.use('/api', requireAuth);

  // ══════════════════════════════════════════════════════
  // Quản trị dịch vụ: duyệt / khoá tài khoản shop
  // ══════════════════════════════════════════════════════
  const STATUS_ACTIONS = {
    approve: { from: ['pending', 'rejected'], to: 'active' },
    reject:  { from: ['pending'],             to: 'rejected' },
    disable: { from: ['active'],              to: 'disabled' },
    enable:  { from: ['disabled'],            to: 'active' },
  };

  app.post('/api/admin/users/:username/:action', requireAdmin, handle('admin/users action', async (req, res) => {
    const rule = STATUS_ACTIONS[req.params.action];
    if (!rule) return res.status(404).json({ error: 'Không tìm thấy API' });
    const username = sanitizeStr(req.params.username, 30).toLowerCase();
    if (username === req.user.username) return res.status(400).json({ error: 'Không thể tự đổi trạng thái tài khoản quản trị' });

    const target = await User.findOne({ username }).lean();
    if (!target) return res.status(404).json({ error: 'Không tìm thấy tài khoản' });
    const current = target.status || 'active';
    if (!rule.from.includes(current)) return res.status(409).json({ error: `Tài khoản đang ở trạng thái "${current}", không làm được thao tác này` });

    const update = { $set: { status: rule.to, reviewedBy: req.user.username, reviewedAt: new Date() } };
    // Khoá / từ chối → đá văng mọi phiên đăng nhập đang mở
    if (rule.to !== 'active') update.$inc = { tokenVersion: 1 };
    await User.updateOne({ _id: target._id }, update);
    console.log(`[Admin] ${req.user.username} ${req.params.action} ${username}`);
    res.json({ ok: true, username, status: rule.to });
  }));

  // Đặt link tải app (Google Drive, GitHub Releases...) — đổi bản mới không cần deploy lại
  app.put('/api/admin/download', requireAdmin, handle('admin/download', async (req, res) => {
    const url = sanitizeStr(req.body?.url, 1000);
    if (url) {
      let u;
      try { u = new URL(url); } catch { u = null; }
      if (!u || u.protocol !== 'https:') return res.status(400).json({ error: 'Link tải phải bắt đầu bằng https://' });
    }
    res.json(await db.setAppDownload({
      url,
      version: sanitizeStr(req.body?.version, 30),
      note:    sanitizeStr(req.body?.note, 300),
    }));
  }));

  app.get('/api/admin/shops', requireAdmin, handle('admin/shops', async (req, res) => {
    const users = await User.find().sort({ createdAt: 1 }).limit(500).lean();
    const counts = await db.Order.aggregate([{ $group: { _id: '$shopId', orders: { $sum: 1 } } }]);
    const byShop = new Map(counts.map(c => [c._id, c.orders]));
    res.json(users.map(u => {
      const shopId = u.shopId || String(u._id);
      return {
        username: u.username, shopName: u.shopName || '', phone: u.phone || '', isAdmin: !!u.isAdmin,
        status: u.status || 'active',
        createdAt: u.createdAt, lastLoginAt: u.lastLoginAt, reviewedAt: u.reviewedAt || null,
        orders: byShop.get(shopId) || 0,
      };
    }));
  }));

  // ══════════════════════════════════════════════════════
  // Dashboard / thống kê
  // ══════════════════════════════════════════════════════
  app.get('/api/dashboard', handle('dashboard', async (req, res) => {
    res.json(await db.getDashboardStats(req.shopId));
  }));

  app.get('/api/stats/chart', handle('stats/chart', async (req, res) => {
    const period = ['day', 'week', 'month'].includes(req.query.period) ? req.query.period : 'day';
    const count  = Math.min(Math.max(1, parseInt(req.query.count) || 7), 365);
    res.json(await db.getChartData(req.shopId, period, count));
  }));

  // scope: session (phiên live hiện tại/gần nhất) | today | 7d | 30d | all
  app.get('/api/stats/summary', handle('stats/summary', async (req, res) => {
    const scope = SUMMARY_SCOPES.includes(req.query.scope) ? req.query.scope : 'session';
    let filter = {};
    if (scope === 'session') {
      const sessionId = isValidObjectId(req.query.sessionId) ? req.query.sessionId : await currentSessionId(req.shopId);
      if (!sessionId) return res.json({ scope, session: null, totals: null, byStatus: [], topCustomers: [] });
      filter = { sessionId };
    } else if (scope !== 'all') {
      filter = { from: vnDayStart(scope === 'today' ? 0 : scope === '7d' ? 6 : 29) };
    }
    res.json({ scope, ...(await db.getOrderSummary(req.shopId, filter)) });
  }));

  // ══════════════════════════════════════════════════════
  // Live: trạng thái app desktop + lệnh từ thiết bị khác
  // ══════════════════════════════════════════════════════
  app.get('/api/live/state', handle('live/state', async (req, res) => {
    const state = await db.getLiveState(req.shopId);
    res.json({ agent: agentView(state), desired: state.desired || { on: false, username: '' } });
  }));

  // Điện thoại / máy bất kỳ bấm "Kết nối Live" → app desktop ở shop tự kết nối trong vài giây
  app.put('/api/live/desired', handle('live/desired', async (req, res) => {
    const on = req.body?.on === true;
    const username = sanitizeStr(req.body?.username, 100).replace('@', '');
    if (on && !username) return res.status(400).json({ error: 'Vui lòng nhập username TikTok' });
    res.json({ desired: await db.setDesiredLive(req.shopId, { on, username }) });
  }));

  // App desktop báo trạng thái máy in + TikTok (mỗi 10 giây)
  app.post('/api/agent/status', handle('agent/status', async (req, res) => {
    const p = req.body?.printer || {};
    const t = req.body?.tiktok || {};
    await db.saveAgentStatus(req.shopId, {
      printer: { ok: p.ok === true, printerName: sanitizeStr(p.printerName, 200), status: sanitizeStr(p.status, 100) },
      tiktok: {
        connected:  t.connected === true,
        connecting: t.connecting === true,
        username:   sanitizeStr(t.username, 100),
        sessionId:  isValidObjectId(t.sessionId) ? t.sessionId : null,
        error:      sanitizeStr(t.error, 300),
      },
    });
    res.json({ ok: true });
  }));

  app.post('/api/live/sessions', handle('live/sessions', async (req, res) => {
    const tiktokUsername = sanitizeStr(req.body?.tiktokUsername, 100).replace('@', '');
    if (!tiktokUsername) return res.status(400).json({ error: 'Thiếu username TikTok' });
    res.status(201).json({ sessionId: await db.createSession(req.shopId, tiktokUsername) });
  }));

  app.post('/api/live/sessions/:id/end', handle('live/sessions end', async (req, res) => {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'ID phiên không hợp lệ' });
    await db.endSession(req.shopId, req.params.id);
    res.json({ ok: true });
  }));

  // ══════════════════════════════════════════════════════
  // Bình luận
  // ══════════════════════════════════════════════════════
  // App desktop gửi bình luận nhận từ TikTok (gom 1 lô ≤ 100)
  app.post('/api/comments/batch', handle('comments/batch', async (req, res) => {
    const sessionId = req.body?.sessionId;
    if (!isValidObjectId(sessionId) || !(await db.getSession(req.shopId, sessionId))) {
      return res.status(400).json({ error: 'Phiên live không hợp lệ' });
    }
    const list = Array.isArray(req.body?.comments) ? req.body.comments.slice(0, 100) : [];
    const ids = await db.saveComments(req.shopId, sessionId, list);
    res.status(201).json({ ids });
  }));

  // Bình luận mới nhất của phiên (afterId: chỉ lấy bình luận mới hơn — thiết bị khác hỏi định kỳ)
  app.get('/api/comments/recent', handle('comments/recent', async (req, res) => {
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 200));
    const sessionId = isValidObjectId(req.query.sessionId) ? req.query.sessionId : await currentSessionId(req.shopId);
    const afterId = isValidObjectId(req.query.afterId) ? req.query.afterId : undefined;
    const agent = agentView(await db.getLiveState(req.shopId));
    res.json({
      sessionId,
      live: !!agent.tiktok.connected,
      comments: sessionId ? await db.getRecentComments(req.shopId, sessionId, { afterId, limit }) : [],
    });
  }));

  // ══════════════════════════════════════════════════════
  // Đơn hàng
  // ══════════════════════════════════════════════════════
  app.get('/api/orders', handle('orders', async (req, res) => {
    const status = req.query.status && req.query.status !== 'all' && VALID_STATUSES.has(req.query.status)
      ? req.query.status : undefined;
    const search = sanitizeStr(req.query.search, 200);
    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const sessionId = isValidObjectId(req.query.sessionId) ? req.query.sessionId : undefined;
    res.json(await db.getOrders(req.shopId, { status, search, sessionId, page, limit }));
  }));

  app.post('/api/orders', handle('create order', async (req, res) => {
    const tiktokUserId = sanitizeStr(req.body.tiktokUserId, 100);
    const username     = sanitizeStr(req.body.username, 100).replace('@', '');
    const displayName  = sanitizeStr(req.body.displayName, 200);
    const note         = sanitizeStr(req.body.note, 1000);
    if (!tiktokUserId || !username) {
      return res.status(400).json({ error: 'Thiếu tiktokUserId hoặc username' });
    }
    const s = await settings.load(req.shopId);
    const ord = await db.createOrder(req.shopId, {
      tiktokUserId, username, displayName, note,
      prefix: sanitizeStr(s.system?.orderPrefix, 10) || 'ORD',
      requestPrint: req.body.print === true,
    });
    res.status(201).json(ord);
  }));

  // Chốt đơn từ bình luận (bấm "In đơn" ở bất kỳ thiết bị nào) → vào hàng đợi in của shop
  app.post('/api/orders/from-comment', handle('orders/from-comment', async (req, res) => {
    if (!isValidObjectId(req.body?.commentId)) return res.status(400).json({ error: 'commentId không hợp lệ' });
    const s = await settings.load(req.shopId);
    const { order, created } = await db.createOrderFromComment(req.shopId, req.body.commentId, {
      prefix: sanitizeStr(s.system?.orderPrefix, 10) || 'ORD',
      requestPrint: req.body.print !== false,
    });
    res.status(created ? 201 : 200).json({ order, created });
  }));

  // In lại phiếu của đơn đã có
  app.post('/api/orders/:id/print', handle('orders print', async (req, res) => {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'ID đơn hàng không hợp lệ' });
    res.json(await db.requestPrint(req.shopId, req.params.id));
  }));

  app.put('/api/orders/:id/status', handle('order status', async (req, res) => {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: 'ID đơn hàng không hợp lệ' });
    }
    const newStatus = req.body.status;
    if (!newStatus || !VALID_STATUSES.has(newStatus)) {
      return res.status(400).json({ error: 'Trạng thái không hợp lệ' });
    }
    // Validate state transition (không cho nhảy trạng thái sai luồng)
    const current = await db.getOrderById(req.shopId, req.params.id);
    if (!current) return res.status(404).json({ error: 'Không tìm thấy đơn hàng' });

    const allowed = STATUS_TRANSITIONS[current.status] || [];
    if (!allowed.includes(newStatus)) {
      return res.status(400).json({ error: `Không thể chuyển từ "${current.status}" sang "${newStatus}"` });
    }
    // Chỉ ghi nếu trạng thái vẫn là current.status — chống 2 thiết bị bấm cùng lúc
    const order = await db.updateOrderStatus(req.shopId, req.params.id, current.status, newStatus);
    if (!order) {
      return res.status(409).json({ error: 'Đơn vừa được cập nhật ở thiết bị khác, hãy tải lại' });
    }
    res.json(order);
  }));

  app.put('/api/orders/:id/amount', handle('order amount', async (req, res) => {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: 'ID đơn hàng không hợp lệ' });
    }
    const amount        = parseAmount(req.body.amount);
    const depositAmount = parseAmount(req.body.depositAmount);
    if (Number.isNaN(amount)) {
      return res.status(400).json({ error: 'Số tiền phải là số nguyên từ 0 đến 1 tỷ' });
    }
    if (Number.isNaN(depositAmount)) {
      return res.status(400).json({ error: 'Số tiền đặt cọc phải là số nguyên từ 0 đến 1 tỷ' });
    }
    const order = await db.updateOrderAmount(req.shopId, req.params.id, { amount, depositAmount });
    if (!order) return res.status(404).json({ error: 'Không tìm thấy đơn hàng' });
    res.json(order);
  }));

  // ══════════════════════════════════════════════════════
  // Hàng đợi in — chỉ app desktop ở shop gọi
  // ══════════════════════════════════════════════════════
  app.post('/api/print-queue/claim', handle('print-queue claim', async (req, res) => {
    // App cũ không gửi kinds → chỉ nhận phiếu đơn (không in nhầm phiếu tổng)
    const kinds = Array.isArray(req.body?.kinds) ? req.body.kinds.filter(k => ['order', 'report'].includes(k)) : ['order'];
    const claimed = await db.claimPrintJob(req.shopId, { kinds: kinds.length ? kinds : ['order'] });
    if (!claimed) return res.json({ job: null });
    const s = await settings.load(req.shopId);
    const shopName = s.storeInfo?.storeName || req.user.shopName || '';
    if (claimed.kind === 'report') {
      const j = claimed.job;
      return res.json({
        job: {
          kind: 'report', jobId: String(j._id), title: j.title, subtitle: j.subtitle,
          rows: j.rows, footer: j.footer, shopName,
        },
      });
    }
    const order = claimed.order;
    res.json({
      job: {
        kind:        'order',
        orderId:     String(order._id),
        orderNumber: order.orderNumber,
        username:    order.username,
        displayName: order.displayName,
        comment:     order.note,
        timestamp:   order.createdAt,
        reprint:     (order.printCount || 0) > 0,
        shopName:    s.storeInfo?.storeName || req.user.shopName || '',
      },
    });
  }));

  app.post('/api/print-queue/:id/done', handle('print-queue done', async (req, res) => {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'ID đơn hàng không hợp lệ' });
    if (req.body?.kind === 'report') {
      const job = await db.finishReportJob(req.shopId, req.params.id, { ok: req.body?.ok === true, error: sanitizeStr(req.body?.error, 300) });
      return res.json({ ok: true, printedAt: job.printedAt, printError: job.printError });
    }
    const order = await db.finishPrintJob(req.shopId, req.params.id, {
      ok: req.body?.ok === true,
      error: sanitizeStr(req.body?.error, 300),
    });
    res.json({ ok: true, printedAt: order.printedAt, printError: order.printError });
  }));

  // ══════════════════════════════════════════════════════
  // Dồn đơn · xả hàng · đi đơn · thống kê theo ngày
  // ══════════════════════════════════════════════════════
  const amountOf = (v) => parseAmount(v === undefined ? 0 : v);
  const idList = (v) => (Array.isArray(v) ? v.filter(isValidObjectId).slice(0, 200) : null);

  app.get('/api/holds', handle('holds', async (req, res) => {
    const s = await settings.load(req.shopId);
    res.json(await holds.getHolds(req.shopId, { search: sanitizeStr(req.query.search, 100), settings: s }));
  }));

  app.put('/api/holds/:userId/deposit', handle('holds deposit', async (req, res) => {
    const amount = amountOf(req.body?.amount);
    if (Number.isNaN(amount)) return res.status(400).json({ error: 'Tiền cọc phải là số nguyên từ 0 đến 1 tỷ' });
    res.json(await holds.setHoldDeposit(req.shopId, sanitizeStr(req.params.userId, 100), amount));
  }));

  app.post('/api/holds/:userId/release', handle('holds release', async (req, res) => {
    const orderIds = req.body?.orderIds === undefined ? null : idList(req.body.orderIds);
    if (orderIds && !orderIds.length) return res.status(400).json({ error: 'Chưa chọn đơn nào' });
    res.json(await holds.releaseHold(req.shopId, sanitizeStr(req.params.userId, 100), { orderIds, by: req.user.username }));
  }));

  app.post('/api/holds/release-overdue', handle('holds release-overdue', async (req, res) => {
    const s = await settings.load(req.shopId);
    res.json(await holds.releaseOverdue(req.shopId, { settings: s, by: req.user.username }));
  }));

  // In phiếu tổng của khách (các đơn đã chọn, không đổi trạng thái)
  app.post('/api/holds/:userId/print', handle('holds print', async (req, res) => {
    const userId = sanitizeStr(req.params.userId, 100);
    const orderIds = req.body?.orderIds === undefined ? undefined : idList(req.body.orderIds);
    const orders = await holds.heldOrdersOf(req.shopId, userId, orderIds || undefined);
    if (!orders.length) return res.status(400).json({ error: 'Không có đơn nào để in' });
    const customer = (await db.getCustomerByTiktokId(req.shopId, userId)) || { username: orders[0].username };
    const holdDeposit = orderIds ? 0 : customer.holdDeposit || 0;
    const job = await db.createPrintJob(req.shopId, { ...holds.customerSummaryReport(customer, orders, holdDeposit), ref: `summary:${userId}` });
    res.status(201).json({ ok: true, jobId: String(job._id) });
  }));

  app.post('/api/shipments', handle('shipments create', async (req, res) => {
    const userId = sanitizeStr(req.body?.tiktokUserId, 100);
    const orderIds = idList(req.body?.orderIds);
    if (!userId || !orderIds?.length) return res.status(400).json({ error: 'Chưa chọn khách hoặc đơn để đi' });
    let useHoldDeposit;
    if (req.body?.useHoldDeposit !== undefined) {
      useHoldDeposit = amountOf(req.body.useHoldDeposit);
      if (Number.isNaN(useHoldDeposit)) return res.status(400).json({ error: 'Tiền cọc trừ không hợp lệ' });
    }
    const { shipment, orders } = await holds.shipOrders(req.shopId, userId, orderIds, { useHoldDeposit, by: req.user.username });
    if (req.body?.print !== false) {
      await db.createPrintJob(req.shopId, { ...holds.shipmentReport(shipment, orders), ref: `shipment:${shipment._id}` });
    }
    res.status(201).json({ shipment });
  }));

  app.get('/api/shipments', handle('shipments', async (req, res) => {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : undefined;
    res.json(await holds.getShipments(req.shopId, { date }));
  }));

  app.post('/api/shipments/:id/print', handle('shipments print', async (req, res) => {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'ID phiếu không hợp lệ' });
    const shipment = await db.Shipment.findOne({ _id: req.params.id, shopId: req.shopId }).lean();
    if (!shipment) return res.status(404).json({ error: 'Không tìm thấy phiếu đi đơn' });
    const orders = await db.Order.find({ shopId: req.shopId, _id: { $in: shipment.orderIds } }).sort({ createdAt: 1 }).lean();
    await db.createPrintJob(req.shopId, { ...holds.shipmentReport(shipment, orders), ref: `shipment:${shipment._id}` });
    res.status(201).json({ ok: true });
  }));

  app.get('/api/customers/daily', handle('customers daily', async (req, res) => {
    res.json(await holds.getDaily(req.shopId, req.query.date));
  }));

  app.post('/api/customers/daily/print', handle('customers daily print', async (req, res) => {
    const daily = await holds.getDaily(req.shopId, req.body?.date);
    await db.createPrintJob(req.shopId, { ...holds.dailyReport(daily), ref: `daily:${daily.date}` });
    res.status(201).json({ ok: true });
  }));

  // ══════════════════════════════════════════════════════
  // Khách hàng
  // ══════════════════════════════════════════════════════
  // /search phải đứng TRƯỚC /:userId
  app.get('/api/customers/search', handle('customers/search', async (req, res) => {
    res.json(await db.searchCustomers(req.shopId, sanitizeStr(req.query.q, 100)));
  }));

  app.get('/api/customers', handle('customers', async (req, res) => {
    res.json(await db.getAllCustomers(req.shopId));
  }));

  app.get('/api/customers/:userId', handle('customer', async (req, res) => {
    const customer = await db.getCustomerByTiktokId(req.shopId, sanitizeStr(req.params.userId, 100));
    if (!customer) return res.status(404).json({ error: 'Không tìm thấy khách hàng' });
    res.json(customer);
  }));

  app.get('/api/customers/:userId/comments', handle('customer comments', async (req, res) => {
    res.json(await db.getCustomerComments(req.shopId, sanitizeStr(req.params.userId, 100)));
  }));

  app.get('/api/customers/:userId/orders', handle('customer orders', async (req, res) => {
    res.json(await db.getCustomerOrders(req.shopId, sanitizeStr(req.params.userId, 100)));
  }));

  app.put('/api/customers/:userId', handle('update customer', async (req, res) => {
    const customer = await db.updateCustomer(req.shopId, sanitizeStr(req.params.userId, 100), {
      phone:       sanitizeStr(req.body.phone,       50),
      email:       sanitizeStr(req.body.email,       200),
      notes:       sanitizeStr(req.body.notes,       1000),
      displayName: sanitizeStr(req.body.displayName, 200),
    });
    if (!customer) return res.status(404).json({ error: 'Không tìm thấy khách hàng' });
    res.json(customer);
  }));

  // ══════════════════════════════════════════════════════
  // Cài đặt của shop
  // ══════════════════════════════════════════════════════
  app.get('/api/settings', handle('settings', async (req, res) => {
    res.json(await settings.load(req.shopId));
  }));

  app.put('/api/settings', handle('settings', async (req, res) => {
    res.json(await settings.save(req.shopId, req.body));
  }));

  // API không tồn tại
  app.use('/api', (req, res) => res.status(404).json({ error: 'Không tìm thấy API' }));

  return app;
}

module.exports = { createApp, sanitizeStr, OBJECTID_RE, vnDayStart };
