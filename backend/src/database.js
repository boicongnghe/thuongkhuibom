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
const Order = mongoose.model('Order', orderSchema);

// ── Order number sequence ─────────────────────────────────
let _orderSeq = 0;
let _orderSeqDate = '';  // Track ngày hiện tại để reset sequence theo ngày

async function _nextOrderNumber(prefix) {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

  // Reset sequence khi sang ngày mới
  if (ymd !== _orderSeqDate) {
    _orderSeqDate = ymd;
    _orderSeq = await Order.countDocuments({
      createdAt: { $gte: new Date(d.getFullYear(), d.getMonth(), d.getDate()) },
    });
  }

  _orderSeq++;
  return `${prefix || 'ORD'}-${ymd}-${String(_orderSeq).padStart(3, '0')}`;
}

// ── Connect ────────────────────────────────────────────────
async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI chưa được cấu hình trong .env');
  await mongoose.connect(uri);

  // Khởi tạo sequence cho ngày hôm nay
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  _orderSeq = await Order.countDocuments({ createdAt: { $gte: today } });
  _orderSeqDate = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
  console.log('[MongoDB] Đã kết nối Atlas ✓');
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

// FIX: markPrinted — kiểm tra điều kiện printed: false để tránh double-increment
async function markPrinted(commentId) {
  // Atomic: chỉ update nếu comment CHƯA được print
  const comment = await Comment.findOneAndUpdate(
    { _id: commentId, printed: false },
    { printed: true },
    { new: true }
  );

  if (comment) {
    // Chỉ tăng totalOrders khi thực sự thay đổi trạng thái
    await Customer.findOneAndUpdate(
      { tiktokUserId: comment.tiktokUserId },
      { $inc: { totalOrders: 1 } }
    );
  }
  return comment;
}

async function getCommentById(id) {
  return await Comment.findById(id).lean();
}

// ── Orders ────────────────────────────────────────────────
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
  return order.toObject();
}

async function getOrders({ status, search, page = 1, limit = 20 } = {}) {
  const query = {};
  if (status && status !== 'all') query.status = status;
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
  const [orders, total] = await Promise.all([
    Order.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Order.countDocuments(query),
  ]);
  return { orders, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) };
}

async function getOrderById(id) {
  return await Order.findById(id).lean();
}

// FIX: updateOrderStatus — cập nhật totalSpent khi chuyển sang completed
async function updateOrderStatus(id, status) {
  const oldOrder = await Order.findById(id).lean();
  if (!oldOrder) return null;

  const updated = await Order.findByIdAndUpdate(
    id, { status, updatedAt: new Date() }, { new: true }
  ).lean();
  if (!updated) return null;

  // Cập nhật totalSpent khi order hoàn thành lần đầu
  if (status === 'completed' && oldOrder.status !== 'completed' && updated.amount > 0) {
    await Customer.findOneAndUpdate(
      { tiktokUserId: updated.tiktokUserId },
      { $inc: { totalSpent: updated.amount } }
    );
  }

  return updated;
}

// FIX: updateOrderAmount — validate deposit không vượt quá amount
async function updateOrderAmount(id, { amount, depositAmount } = {}) {
  const upd = { updatedAt: new Date() };

  if (amount !== undefined)        upd.amount        = Math.max(0, Number(amount) || 0);
  if (depositAmount !== undefined) upd.depositAmount = Math.max(0, Number(depositAmount) || 0);

  // Validate: đặt cọc không được vượt quá tổng tiền
  const current = await Order.findById(id).lean();
  if (!current) return null;

  const finalAmount        = upd.amount        ?? current.amount;
  const finalDepositAmount = upd.depositAmount ?? current.depositAmount;

  if (finalAmount > 0 && finalDepositAmount > finalAmount) {
    throw new Error(`Đặt cọc (${finalDepositAmount.toLocaleString('vi-VN')}đ) không thể vượt quá tổng tiền (${finalAmount.toLocaleString('vi-VN')}đ)`);
  }

  const order = await Order.findByIdAndUpdate(id, { $set: upd }, { new: true }).lean();

  // Nếu order đã completed, cập nhật totalSpent khi amount thay đổi
  if (order && order.status === 'completed' && amount !== undefined) {
    const delta = upd.amount - (current.amount || 0);
    if (delta !== 0) {
      await Customer.findOneAndUpdate(
        { tiktokUserId: order.tiktokUserId },
        { $inc: { totalSpent: delta } }
      );
    }
  }

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
  saveComment, markPrinted, getCommentById,
  getAllCustomers, getCustomerByTiktokId, getCustomerComments, getCustomerOrders,
  updateCustomer, searchCustomers,
  createOrder, getOrders, getOrderById, updateOrderStatus, updateOrderAmount,
  getDashboardStats, getChartData,
  getSessionStats,
};
