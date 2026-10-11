require('dotenv').config();
const mongoose = require('mongoose');

// ── Helper ────────────────────────────────────────────────
function escapeRegex(str) {
  return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Schemas ───────────────────────────────────────────────
const commentSchema = new mongoose.Schema({
  tiktokUserId: { type: String, required: true },
  username:     { type: String, required: true },
  displayName:  { type: String, default: '' },
  comment:      { type: String, required: true, maxlength: 500 },
  printed:      { type: Boolean, default: false },
  sessionId:    { type: String, default: null },
  timestamp:    { type: Date, default: Date.now },
});
// Indexes cho query thường gặp
commentSchema.index({ tiktokUserId: 1, timestamp: -1 });
commentSchema.index({ sessionId: 1 });
commentSchema.index({ printed: 1 });
const Comment = mongoose.model('Comment', commentSchema);

const customerSchema = new mongoose.Schema({
  tiktokUserId:  { type: String, required: true, unique: true },
  username:      { type: String, required: true },
  displayName:   { type: String, default: '' },
  phone:         { type: String, default: '' },
  email:         { type: String, default: '' },
  totalComments: { type: Number, default: 0 },
  totalOrders:   { type: Number, default: 0 },
  totalSpent:    { type: Number, default: 0 },
  notes:         { type: String, default: '' },
  firstSeen:     { type: Date, default: Date.now },
  lastSeen:      { type: Date, default: Date.now },
});
customerSchema.index({ totalOrders: -1, lastSeen: -1 });
const Customer = mongoose.model('Customer', customerSchema);

const sessionSchema = new mongoose.Schema({
  tiktokUsername: { type: String, required: true },
  startedAt:      { type: Date, default: Date.now },
  endedAt:        { type: Date, default: null },
});
const Session = mongoose.model('Session', sessionSchema);

const orderSchema = new mongoose.Schema({
  orderNumber:   { type: String },
  commentId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Comment', default: null },
  tiktokUserId:  { type: String, required: true },
  username:      { type: String, required: true },
  displayName:   { type: String, default: '' },
  note:          { type: String, default: '', maxlength: 1000 },
  amount:        { type: Number, default: 0, min: 0 },
  depositAmount: { type: Number, default: 0, min: 0 },
  status: {
    type: String,
    enum: ['pending', 'deposit', 'confirmed', 'shipping', 'completed', 'cancelled'],
    default: 'pending',
  },
  sessionId: { type: String, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});
// Indexes cho query thường gặp
orderSchema.index({ status: 1, createdAt: -1 });
orderSchema.index({ tiktokUserId: 1, createdAt: -1 });
orderSchema.index({ createdAt: -1 });
// Mỗi bình luận chỉ tạo được 1 đơn (đơn tạo tay có commentId = null nên không bị ràng buộc)
orderSchema.index(
  { commentId: 1 },
  { unique: true, partialFilterExpression: { commentId: { $type: 'objectId' } } },
);
orderSchema.index(
  { orderNumber: 1 },
  { unique: true, partialFilterExpression: { orderNumber: { $type: 'string' } } },
);
const Order = mongoose.model('Order', orderSchema);

// Bộ đếm số thứ tự đơn theo ngày — tăng nguyên tử trong MongoDB
const counterSchema = new mongoose.Schema({ _id: String, seq: { type: Number, default: 0 } });
const Counter = mongoose.model('Counter', counterSchema);

// Trạng thái máy tính chạy app (máy in, TikTok Live) — để bản web trên Vercel xem được
const pcStatusSchema = new mongoose.Schema({
  _id:       String,
  printer:   { type: Object, default: {} },
  tiktok:    { type: Object, default: {} },
  updatedAt: { type: Date, default: Date.now },
}, { minimize: false });
const PcStatus = mongoose.model('PcStatus', pcStatusSchema);

async function saveLocalStatus({ printer, tiktok }) {
  await PcStatus.updateOne(
    { _id: 'local' },
    { $set: { printer, tiktok, updatedAt: new Date() } },
    { upsert: true },
  );
}

async function getLocalStatus() {
  return await PcStatus.findById('local').lean();
}

// ── Lỗi nghiệp vụ: được phép hiện nguyên thông báo cho người dùng ──
function businessError(message, status = 400) {
  const err = new Error(message);
  err.expose = true;
  err.status = status;
  return err;
}

// ── Order number sequence ─────────────────────────────────
function _todayYmd() {
  // sv-SE cho định dạng YYYY-MM-DD; cố định múi giờ VN để không lệch ngày khi server ở nơi khác
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).replaceAll('-', '');
}

// Lần đầu dùng bộ đếm của 1 ngày: bắt đầu sau số lớn nhất đã có (dữ liệu tạo trước khi có Counter)
async function _seedCounter(ymd) {
  const latest = await Order.find({ orderNumber: { $regex: `-${ymd}-\\d+$` } })
    .select('orderNumber').lean();
  const maxSeq = latest.reduce((m, o) => Math.max(m, parseInt(o.orderNumber.split('-').pop(), 10) || 0), 0);
  await Counter.updateOne({ _id: `order-${ymd}` }, { $max: { seq: maxSeq } }, { upsert: true });
}

const _seededDays = new Set();
async function _nextOrderNumber(prefix) {
  const ymd = _todayYmd();
  if (!_seededDays.has(ymd)) {
    await _seedCounter(ymd);
    _seededDays.add(ymd);
  }
  const { seq } = await Counter.findByIdAndUpdate(
    `order-${ymd}`, { $inc: { seq: 1 } }, { upsert: true, new: true },
  ).lean();
  return `${prefix || 'ORD'}-${ymd}-${String(seq).padStart(3, '0')}`;
}

// ── Connect ────────────────────────────────────────────────
// Gọi nhiều lần vẫn chỉ kết nối 1 lần — cần cho Vercel (mỗi request có thể gọi lại)
let _connecting = null;
async function connectDB() {
  if (mongoose.connection.readyState === 1) return;
  if (_connecting) return _connecting;

  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI chưa được cấu hình (.env trên máy hoặc Environment Variables trên Vercel)');

  _connecting = (async () => {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });

    // Tạo index ngay và báo rõ nếu dữ liệu cũ bị trùng (chạy scripts/check-orders.js để dọn)
    try {
      await Order.createIndexes();
    } catch (err) {
      console.error('[MongoDB] ⚠️ Không tạo được unique index cho Order — dữ liệu cũ đang bị trùng.');
      console.error('           Chạy: node scripts/check-orders.js để kiểm tra và dọn.', err.message);
    }
    console.log('[MongoDB] Đã kết nối Atlas ✓');
  })();

  try {
    await _connecting;
  } catch (err) {
    _connecting = null;   // lần sau thử kết nối lại
    throw err;
  }
}

// ── Sessions ──────────────────────────────────────────────
async function createSession(tiktokUsername) {
  const s = await Session.create({ tiktokUsername });
  return s._id.toString();
}

async function endSession(sessionId) {
  await Session.findByIdAndUpdate(sessionId, { endedAt: new Date() });
}

// ── Comments ──────────────────────────────────────────────
async function saveComment({ tiktokUserId, username, displayName, comment, sessionId }) {
  // Filter comment rỗng
  const trimmed = (comment || '').trim();
  if (!trimmed) return null;

  const doc = await Comment.create({
    tiktokUserId, username,
    displayName: displayName || username,
    comment:     trimmed.slice(0, 500),
    sessionId,
  });

  // FIX: displayName chỉ set khi INSERT lần đầu ($setOnInsert)
  // Không ghi đè displayName đã được operator chỉnh sửa thủ công
  await Customer.findOneAndUpdate(
    { tiktokUserId },
    {
      $set:         { username, lastSeen: new Date() },
      $inc:         { totalComments: 1 },
      $setOnInsert: { displayName: displayName || username, firstSeen: new Date() },
    },
    { upsert: true, new: true }
  );

  return doc._id.toString();
}

// Đánh dấu bình luận đã chốt. Nguồn sự thật là Order (unique theo commentId),
// cờ này chỉ để hiển thị — nên gọi SAU khi đã tạo đơn thành công
async function markPrinted(commentId) {
  await Comment.updateOne({ _id: commentId }, { printed: true });
}

async function getCommentById(id) {
  return await Comment.findById(id).lean();
}

// Bình luận gần nhất của 1 phiên, kèm cờ "đã có đơn" lấy từ Order
async function getRecentComments(sessionId, limit = 200) {
  const query = sessionId ? { sessionId } : {};
  const comments = await Comment.find(query).sort({ timestamp: -1 }).limit(limit).lean();
  const ordered = await Order.find({ commentId: { $in: comments.map(c => c._id) } })
    .select('commentId').lean();
  const orderedIds = new Set(ordered.map(o => String(o.commentId)));
  return comments.map(c => ({
    id:           String(c._id),
    tiktokUserId: c.tiktokUserId,
    username:     c.username,
    displayName:  c.displayName,
    comment:      c.comment,
    timestamp:    c.timestamp,
    printed:      orderedIds.has(String(c._id)),
  }));
}

async function getLatestSessionId() {
  const s = await Session.findOne().sort({ startedAt: -1 }).select('_id').lean();
  return s ? String(s._id) : null;
}

// ── Orders ────────────────────────────────────────────────
// Ném lỗi E11000 (keyPattern.commentId) nếu bình luận này đã có đơn
async function createOrder({ commentId, tiktokUserId, username, displayName, note, sessionId, prefix } = {}) {
  const orderNumber = await _nextOrderNumber(prefix);
  const order = await Order.create({
    orderNumber,
    commentId: commentId || null,
    tiktokUserId,
    username,
    displayName: displayName || username,
    note:        (note || '').slice(0, 1000),
    sessionId:   sessionId || null,
  });

  // Mọi đơn (từ bình luận hay tạo tay) đều được tính vào số đơn của khách
  await Customer.updateOne(
    { tiktokUserId },
    {
      $inc:         { totalOrders: 1 },
      $set:         { username, lastSeen: new Date() },
      $setOnInsert: { displayName: displayName || username, firstSeen: new Date() },
    },
    { upsert: true },
  );

  return order.toObject();
}

async function getOrderByCommentId(commentId) {
  return await Order.findOne({ commentId }).lean();
}

// ── Thống kê đơn hàng ─────────────────────────────────────
const ORDER_STATUSES = ['pending', 'deposit', 'confirmed', 'shipping', 'completed', 'cancelled'];

/**
 * Tổng kết đơn theo khoảng thời gian và/hoặc phiên live.
 * Quy ước: đơn Đã huỷ không tính vào tổng.
 *   Đã thu       = tiền đơn Hoàn thành + tiền cọc của đơn chưa hoàn thành
 *   Còn phải thu = Σ max(0, tiền − cọc) của đơn chưa hoàn thành
 */
async function getOrderSummary({ from, to, sessionId } = {}) {
  const match = {};
  if (sessionId) match.sessionId = sessionId;
  if (from || to) {
    match.createdAt = {};
    if (from) match.createdAt.$gte = from;
    if (to)   match.createdAt.$lt  = to;
  }
  const active = { ...match, status: { $ne: 'cancelled' } };

  const [byStatusRaw, customerCount, topCustomers, comments, commenters, session] = await Promise.all([
    Order.aggregate([
      { $match: match },
      { $group: {
        _id:       '$status',
        count:     { $sum: 1 },
        amount:    { $sum: '$amount' },
        deposit:   { $sum: '$depositAmount' },
        remaining: { $sum: { $max: [0, { $subtract: ['$amount', '$depositAmount'] }] } },
        noAmount:  { $sum: { $cond: [{ $lte: ['$amount', 0] }, 1, 0] } },
      } },
    ]),
    Order.aggregate([{ $match: active }, { $group: { _id: '$tiktokUserId' } }, { $count: 'n' }]),
    Order.aggregate([
      { $match: active },
      { $sort: { createdAt: 1 } },
      { $group: {
        _id:         '$tiktokUserId',
        username:    { $last: '$username' },
        displayName: { $last: '$displayName' },
        orders:      { $sum: 1 },
        amount:      { $sum: '$amount' },
      } },
      { $sort: { amount: -1, orders: -1 } },
      { $limit: 5 },
    ]),
    sessionId ? Comment.countDocuments({ sessionId }) : null,
    sessionId ? Comment.distinct('tiktokUserId', { sessionId }) : null,
    sessionId ? Session.findById(sessionId).lean().catch(() => null) : null,
  ]);

  const empty = { count: 0, amount: 0, deposit: 0, remaining: 0, noAmount: 0 };
  const byKey = Object.fromEntries(byStatusRaw.map(r => [r._id, r]));
  const byStatus = ORDER_STATUSES.map(s => ({ status: s, ...empty, ...(byKey[s] || {}), _id: undefined }));

  const act       = byStatus.filter(s => s.status !== 'cancelled');
  const notDone   = act.filter(s => s.status !== 'completed');
  const completed = byStatus.find(s => s.status === 'completed');
  const cancelled = byStatus.find(s => s.status === 'cancelled');
  const sum = (list, k) => list.reduce((t, s) => t + (s[k] || 0), 0);

  const orders     = sum(act, 'count');
  const amount     = sum(act, 'amount');
  const noAmount   = sum(act, 'noAmount');
  const customers  = customerCount[0]?.n || 0;
  const pricedOrds = orders - noAmount;

  return {
    session: session ? {
      id: String(session._id), tiktokUsername: session.tiktokUsername,
      startedAt: session.startedAt, endedAt: session.endedAt,
    } : null,
    totals: {
      orders,
      customers,
      amount,
      collected:      completed.amount + sum(notDone, 'deposit'),
      deposit:        sum(notDone, 'deposit'),
      completed:      completed.amount,
      remaining:      sum(notDone, 'remaining'),
      noAmount,
      avgOrderValue:  pricedOrds > 0 ? Math.round(amount / pricedOrds) : 0,
      cancelledCount: cancelled.count,
      cancelledAmount: cancelled.amount,
      comments:       comments,
      commenters:     commenters ? commenters.length : null,
      // Tỉ lệ chốt = số khách đặt / số người bình luận (chỉ tính được theo phiên live)
      conversionRate: commenters && commenters.length ? Math.round((customers / commenters.length) * 1000) / 10 : null,
    },
    byStatus: byStatus.map(({ _id, ...s }) => s),
    topCustomers: topCustomers.map(c => ({
      tiktokUserId: c._id, username: c.username, displayName: c.displayName, orders: c.orders, amount: c.amount,
    })),
  };
}

async function getOrders({ status, search, sessionId, page = 1, limit = 20 } = {}) {
  const query = {};
  if (status && status !== 'all') query.status = status;
  if (sessionId) query.sessionId = sessionId;
  if (search) {
    // FIX: escape RegEx để tránh ReDoS injection
    const safe = escapeRegex(search);
    query.$or = [
      { username:    { $regex: safe, $options: 'i' } },
      { displayName: { $regex: safe, $options: 'i' } },
      { note:        { $regex: safe, $options: 'i' } },
      { orderNumber: { $regex: safe, $options: 'i' } },
    ];
  }
  const skip = Math.max(0, (page - 1) * limit);
  // Tổng tiền của các đơn đang lọc (bỏ đơn huỷ, trừ khi đang lọc riêng "Đã huỷ")
  const sumQuery = status === 'cancelled' ? query : { ...query, status: query.status || { $ne: 'cancelled' } };
  const [orders, total, sums] = await Promise.all([
    Order.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Order.countDocuments(query),
    Order.aggregate([
      { $match: sumQuery },
      { $group: {
        _id: null,
        count:   { $sum: 1 },
        amount:  { $sum: '$amount' },
        deposit: { $sum: '$depositAmount' },
        noAmount: { $sum: { $cond: [{ $lte: ['$amount', 0] }, 1, 0] } },
      } },
    ]),
  ]);
  const s = sums[0] || { count: 0, amount: 0, deposit: 0, noAmount: 0 };
  return {
    orders, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)),
    summary: { count: s.count, amount: s.amount, deposit: s.deposit, noAmount: s.noAmount },
  };
}

async function getOrderById(id) {
  return await Order.findById(id).lean();
}

// Chỉ đổi trạng thái nếu đơn VẪN đang ở fromStatus (không bị thiết bị khác đổi trước).
// Trả về null nếu đã bị đổi → server báo 409 cho người dùng tải lại.
async function updateOrderStatus(id, fromStatus, toStatus) {
  const updated = await Order.findOneAndUpdate(
    { _id: id, status: fromStatus },
    { status: toStatus, updatedAt: new Date() },
    { new: true },
  ).lean();
  if (!updated) return null;

  // Chỉ 1 request đổi được trạng thái → totalSpent / totalOrders không bị cộng/trừ 2 lần
  if (toStatus === 'completed' && updated.amount > 0) {
    await Customer.updateOne({ tiktokUserId: updated.tiktokUserId }, { $inc: { totalSpent: updated.amount } });
  }
  if (toStatus === 'cancelled') {
    await Customer.updateOne(
      { tiktokUserId: updated.tiktokUserId, totalOrders: { $gt: 0 } },
      { $inc: { totalOrders: -1 } },
    );
  }

  return updated;
}

// Đơn đã Hoàn thành / Đã huỷ thì khoá số tiền để doanh thu cũ không bị thay đổi
const AMOUNT_LOCKED_STATUSES = ['completed', 'cancelled'];

async function updateOrderAmount(id, { amount, depositAmount } = {}) {
  const current = await Order.findById(id).lean();
  if (!current) return null;
  if (AMOUNT_LOCKED_STATUSES.includes(current.status)) {
    throw businessError('Đơn đã hoàn thành hoặc đã huỷ, không thể sửa số tiền', 409);
  }

  const upd = { updatedAt: new Date() };
  if (amount !== undefined)        upd.amount        = amount;
  if (depositAmount !== undefined) upd.depositAmount = depositAmount;

  // Validate: đặt cọc không được vượt quá tổng tiền
  const finalAmount        = upd.amount        ?? current.amount;
  const finalDepositAmount = upd.depositAmount ?? current.depositAmount;
  if (finalAmount > 0 && finalDepositAmount > finalAmount) {
    throw businessError(`Đặt cọc (${finalDepositAmount.toLocaleString('vi-VN')}đ) không thể vượt quá tổng tiền (${finalAmount.toLocaleString('vi-VN')}đ)`);
  }

  // Điều kiện status trong filter: nếu vừa bị chuyển Hoàn thành ở thiết bị khác thì không ghi
  const order = await Order.findOneAndUpdate(
    { _id: id, status: { $nin: AMOUNT_LOCKED_STATUSES } },
    { $set: upd },
    { new: true },
  ).lean();
  if (!order) throw businessError('Đơn vừa được cập nhật ở thiết bị khác, hãy tải lại', 409);
  return order;
}

// ── Customers ─────────────────────────────────────────────
async function getAllCustomers() {
  return await Customer.find().sort({ totalOrders: -1, lastSeen: -1 }).lean();
}

async function getCustomerByTiktokId(tiktokUserId) {
  return await Customer.findOne({ tiktokUserId }).lean();
}

async function getCustomerComments(tiktokUserId) {
  return await Comment.find({ tiktokUserId }).sort({ timestamp: -1 }).limit(100).lean();
}

async function getCustomerOrders(tiktokUserId) {
  return await Order.find({ tiktokUserId }).sort({ createdAt: -1 }).limit(100).lean();
}

async function updateCustomer(tiktokUserId, data) {
  const allowed = ['phone', 'email', 'notes', 'displayName'];
  const update  = {};
  for (const k of allowed) {
    if (data[k] !== undefined) update[k] = String(data[k]).slice(0, 500).trim();
  }
  if (!Object.keys(update).length) return await getCustomerByTiktokId(tiktokUserId);
  return await Customer.findOneAndUpdate(
    { tiktokUserId }, { $set: update }, { new: true }
  ).lean();
}

// FIX: escape RegEx trong searchCustomers
async function searchCustomers(q) {
  if (!q || q.trim().length < 1) return [];
  const safe = escapeRegex(q.trim());
  return await Customer.find({
    $or: [
      { username:    { $regex: safe, $options: 'i' } },
      { displayName: { $regex: safe, $options: 'i' } },
      { phone:       { $regex: safe, $options: 'i' } },
      { email:       { $regex: safe, $options: 'i' } },
    ],
  }).sort({ totalOrders: -1 }).limit(50).lean();
}

// ── Dashboard ─────────────────────────────────────────────
async function getDashboardStats() {
  const [totalCustomers, totalOrders, revenueAgg, totalSessions, recentOrders, topCustomers] = await Promise.all([
    Customer.countDocuments(),
    Order.countDocuments({ status: { $ne: 'cancelled' } }),
    // FIX: chỉ tính doanh thu từ đơn đã hoàn thành (completed)
    Order.aggregate([
      { $match: { status: 'completed' } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
    Session.countDocuments(),
    Order.find({ status: { $ne: 'cancelled' } }).sort({ createdAt: -1 }).limit(10).lean(),
    Customer.find().sort({ totalOrders: -1 }).limit(5).lean(),
  ]);

  return {
    totalCustomers:  totalCustomers  || 0,
    totalOrders:     totalOrders     || 0,
    totalRevenue:    revenueAgg[0]?.total || 0,
    totalSessions:   totalSessions   || 0,
    recentOrders:    recentOrders    || [],
    topCustomers:    topCustomers    || [],
  };
}

async function getChartData(period = 'day', count = 7) {
  const now  = new Date();
  const from = new Date(now);
  count = Math.min(Math.max(1, count), 365);  // Giới hạn để tránh quá tải

  if (period === 'month')     from.setMonth(now.getMonth() - count);
  else if (period === 'week') from.setDate(now.getDate() - count * 7);
  else                        from.setDate(now.getDate() - count);

  from.setHours(0, 0, 0, 0);

  const groupId =
    period === 'month' ? { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } }
    : period === 'week' ? { year: { $isoWeekYear: '$createdAt' }, week: { $isoWeek: '$createdAt' } }
    : { year: { $year: '$createdAt' }, month: { $month: '$createdAt' }, day: { $dayOfMonth: '$createdAt' } };

  const sortKey = period === 'week'
    ? { '_id.year': 1, '_id.week': 1 }
    : { '_id.year': 1, '_id.month': 1, '_id.day': 1 };

  const [orderChart, revenueChart] = await Promise.all([
    Order.aggregate([
      { $match: { createdAt: { $gte: from }, status: { $ne: 'cancelled' } } },
      { $group: { _id: groupId, count: { $sum: 1 } } },
      { $sort: sortKey },
    ]),
    // FIX: chỉ tính doanh thu từ đơn completed
    Order.aggregate([
      { $match: { createdAt: { $gte: from }, status: 'completed' } },
      { $group: { _id: groupId, total: { $sum: '$amount' } } },
      { $sort: sortKey },
    ]),
  ]);

  return { orderChart, revenueChart, from: from.toISOString(), period, count };
}

// ── Session Stats ──────────────────────────────────────────
async function getSessionStats(sessionId) {
  const [stats] = await Comment.aggregate([
    { $match: { sessionId } },
    {
      $group: {
        _id: null,
        total_comments:   { $sum: 1 },
        total_printed:    { $sum: { $cond: ['$printed', 1, 0] } },
        unique_customers: { $addToSet: '$tiktokUserId' },
      },
    },
    {
      $project: {
        total_comments: 1,
        total_printed: 1,
        unique_customers: { $size: '$unique_customers' },
      },
    },
  ]);
  return stats || { total_comments: 0, total_printed: 0, unique_customers: 0 };
}

module.exports = {
  connectDB,
  createSession, endSession,
  saveComment, markPrinted, getCommentById, getRecentComments, getLatestSessionId,
  getAllCustomers, getCustomerByTiktokId, getCustomerComments, getCustomerOrders,
  updateCustomer, searchCustomers,
  createOrder, getOrderByCommentId, getOrders, getOrderById, updateOrderStatus, updateOrderAmount,
  getOrderSummary,
  Order, Customer, Comment,
  getDashboardStats, getChartData,
  saveLocalStatus, getLocalStatus,
  getSessionStats,
};
