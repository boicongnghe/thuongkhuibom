require('dotenv').config();
const mongoose = require('mongoose');

// ══════════════════════════════════════════════════════════
// DỊCH VỤ TRUNG TÂM NHIỀU SHOP
// Mọi dữ liệu đều có `shopId`; mọi hàm truy vấn nhận shopId làm tham số đầu tiên
// và LUÔN lọc theo nó → shop này không bao giờ đọc / sửa được dữ liệu shop khác.
// ══════════════════════════════════════════════════════════

// ── Helper ────────────────────────────────────────────────
function escapeRegex(str) {
  return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function requireShop(shopId) {
  if (!shopId || typeof shopId !== 'string') throw new Error('Thiếu shopId');
  return shopId;
}

// ── Lỗi nghiệp vụ: được phép hiện nguyên thông báo cho người dùng ──
function businessError(message, status = 400) {
  const err = new Error(message);
  err.expose = true;
  err.status = status;
  return err;
}

// ── Schemas ───────────────────────────────────────────────
const commentSchema = new mongoose.Schema({
  shopId:       { type: String, required: true },
  tiktokUserId: { type: String, required: true },
  username:     { type: String, required: true },
  displayName:  { type: String, default: '' },
  comment:      { type: String, required: true, maxlength: 500 },
  printed:      { type: Boolean, default: false },
  sessionId:    { type: String, default: null },
  timestamp:    { type: Date, default: Date.now },
});
commentSchema.index({ shopId: 1, sessionId: 1, _id: -1 });
commentSchema.index({ shopId: 1, tiktokUserId: 1, timestamp: -1 });
const Comment = mongoose.model('Comment', commentSchema);

const customerSchema = new mongoose.Schema({
  shopId:        { type: String, required: true },
  tiktokUserId:  { type: String, required: true },
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
// Cùng 1 người TikTok có thể là khách của nhiều shop → unique theo (shop, tiktokUserId)
customerSchema.index({ shopId: 1, tiktokUserId: 1 }, { unique: true });
customerSchema.index({ shopId: 1, totalOrders: -1, lastSeen: -1 });
const Customer = mongoose.model('Customer', customerSchema);

const sessionSchema = new mongoose.Schema({
  shopId:         { type: String, required: true },
  tiktokUsername: { type: String, required: true },
  startedAt:      { type: Date, default: Date.now },
  endedAt:        { type: Date, default: null },
});
sessionSchema.index({ shopId: 1, startedAt: -1 });
const Session = mongoose.model('Session', sessionSchema);

const orderSchema = new mongoose.Schema({
  shopId:        { type: String, required: true },
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
  // Hàng đợi in: thiết bị nào cũng yêu cầu in được, app desktop ở shop nhận việc và in
  printPending:     { type: Boolean, default: false },
  printRequestedAt: { type: Date, default: null },
  printClaimAt:     { type: Date, default: null },
  printedAt:        { type: Date, default: null },
  printError:       { type: String, default: null },
  printCount:       { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});
orderSchema.index({ shopId: 1, status: 1, createdAt: -1 });
orderSchema.index({ shopId: 1, tiktokUserId: 1, createdAt: -1 });
orderSchema.index({ shopId: 1, sessionId: 1, createdAt: -1 });
orderSchema.index({ shopId: 1, createdAt: -1 });
orderSchema.index({ shopId: 1, printPending: 1, printRequestedAt: 1 });
// Mỗi bình luận chỉ tạo được 1 đơn (commentId là ObjectId duy nhất toàn hệ thống)
orderSchema.index(
  { commentId: 1 },
  { unique: true, partialFilterExpression: { commentId: { $type: 'objectId' } } },
);
// Mã đơn không trùng trong cùng 1 shop
orderSchema.index(
  { shopId: 1, orderNumber: 1 },
  { unique: true, partialFilterExpression: { orderNumber: { $type: 'string' } } },
);
const Order = mongoose.model('Order', orderSchema);

// Bộ đếm số thứ tự đơn theo shop + ngày — tăng nguyên tử trong MongoDB
const counterSchema = new mongoose.Schema({ _id: String, seq: { type: Number, default: 0 } });
const Counter = mongoose.model('Counter', counterSchema);

// Trạng thái app desktop ở shop (máy in, TikTok) + lệnh Live mong muốn (từ điện thoại...)
const pcStatusSchema = new mongoose.Schema({
  _id:       String,             // = shopId
  printer:   { type: Object, default: {} },
  tiktok:    { type: Object, default: {} },
  updatedAt: { type: Date, default: null },
  desired:   { type: Object, default: { on: false, username: '' } },
}, { minimize: false });
const PcStatus = mongoose.model('PcStatus', pcStatusSchema);

// ── Order number sequence ─────────────────────────────────
function _todayYmd() {
  // sv-SE cho định dạng YYYY-MM-DD; cố định múi giờ VN để không lệch ngày khi server ở nơi khác
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).replaceAll('-', '');
}

// Lần đầu dùng bộ đếm của 1 shop/ngày: bắt đầu sau số lớn nhất đã có
async function _seedCounter(shopId, ymd) {
  const latest = await Order.find({ shopId, orderNumber: { $regex: `-${ymd}-\\d+$` } })
    .select('orderNumber').lean();
  const maxSeq = latest.reduce((m, o) => Math.max(m, parseInt(o.orderNumber.split('-').pop(), 10) || 0), 0);
  await Counter.updateOne({ _id: `${shopId}:order-${ymd}` }, { $max: { seq: maxSeq } }, { upsert: true });
}

const _seeded = new Set();
async function _nextOrderNumber(shopId, prefix) {
  const ymd = _todayYmd();
  const key = `${shopId}:order-${ymd}`;
  if (!_seeded.has(key)) {
    await _seedCounter(shopId, ymd);
    _seeded.add(key);
  }
  const { seq } = await Counter.findByIdAndUpdate(key, { $inc: { seq: 1 } }, { upsert: true, new: true }).lean();
  return `${prefix || 'ORD'}-${ymd}-${String(seq).padStart(3, '0')}`;
}

// ── Connect + chuyển dữ liệu cũ (1 shop) sang dạng nhiều shop ─
let _connecting = null;
async function connectDB() {
  if (mongoose.connection.readyState === 1 && !_connecting) return;
  if (_connecting) return _connecting;

  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI chưa được cấu hình (.env trên máy hoặc Environment Variables trên Vercel)');

  _connecting = (async () => {
    if (mongoose.connection.readyState !== 1) {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
    }
    await migrateToMultiShop();
    try {
      await Promise.all([Order.createIndexes(), Customer.createIndexes(), Comment.createIndexes(), Session.createIndexes()]);
    } catch (err) {
      console.error('[MongoDB] ⚠️ Không tạo được index — dữ liệu cũ đang bị trùng.', err.message);
      console.error('           Chạy: node scripts/check-orders.js để kiểm tra và dọn.');
    }
    console.log('[MongoDB] Đã kết nối Atlas ✓');
  })();

  try {
    await _connecting;
  } finally {
    _connecting = null;
  }
}

/**
 * Chạy 1 lần (có dấu đánh dấu): gán mọi dữ liệu chưa có shopId cho shop của tài khoản đầu tiên,
 * bỏ các index "1 shop" cũ (unique tiktokUserId, unique orderNumber, unique owner của User).
 * An toàn khi chạy lại: chỉ đụng tới document thiếu shopId.
 */
const MIGRATION_ID = '__migration_multishop_v1';
async function migrateToMultiShop() {
  const Meta = mongoose.connection.collection('settings');
  if (await Meta.findOne({ _id: MIGRATION_ID })) return;

  const users = mongoose.connection.collection('users');
  const dropIndex = async (coll, name) => {
    try { await mongoose.connection.collection(coll).dropIndex(name); console.log(`[Migrate] Bỏ index cũ ${coll}.${name}`); }
    catch (e) { if (!/index not found|ns not found|NamespaceNotFound|IndexNotFound/i.test(e.message)) throw e; }
  };
  await dropIndex('users', 'owner_1');
  await dropIndex('customers', 'tiktokUserId_1');
  await dropIndex('orders', 'orderNumber_1');

  const first = await users.find().sort({ _id: 1 }).limit(1).next();
  if (!first) {
    // Chưa có tài khoản nào: chưa có dữ liệu cũ cần gán, chỉ đánh dấu xong
    await Meta.updateOne({ _id: MIGRATION_ID }, { $set: { at: new Date() } }, { upsert: true });
    return;
  }

  // Mỗi tài khoản cũ là chủ 1 shop; tài khoản đầu tiên là quản trị dịch vụ (tạo mã mời)
  await users.updateMany({ shopId: { $exists: false } }, [{ $set: { shopId: { $toString: '$_id' }, role: 'owner' } }]);
  await users.updateOne({ _id: first._id }, { $set: { isAdmin: true }, $unset: { owner: '' } });
  await users.updateMany({}, { $unset: { owner: '' } });

  const ownerShop = String(first._id);
  for (const coll of ['comments', 'customers', 'sessions', 'orders']) {
    const r = await mongoose.connection.collection(coll).updateMany({ shopId: { $exists: false } }, { $set: { shopId: ownerShop } });
    if (r.modifiedCount) console.log(`[Migrate] Gán ${r.modifiedCount} ${coll} cũ cho shop ${ownerShop}`);
  }

  // Bộ đếm mã đơn cũ "order-YYYYMMDD" → của shop chủ
  const counters = mongoose.connection.collection('counters');
  for await (const c of counters.find({ _id: { $regex: '^order-' } })) {
    await counters.updateOne({ _id: `${ownerShop}:${c._id}` }, { $max: { seq: c.seq } }, { upsert: true });
    await counters.deleteOne({ _id: c._id });
  }

  // Cài đặt cũ (_id 'app') → cài đặt của shop chủ
  const oldSettings = await Meta.findOne({ _id: 'app' });
  if (oldSettings && !(await Meta.findOne({ _id: ownerShop }))) {
    const { _id, ...rest } = oldSettings;
    await Meta.insertOne({ _id: ownerShop, ...rest });
  }
  await Meta.deleteOne({ _id: 'app' });
  await mongoose.connection.collection('pcstatuses').deleteOne({ _id: 'local' });

  await Meta.updateOne({ _id: MIGRATION_ID }, { $set: { at: new Date(), ownerShop } }, { upsert: true });
  console.log('[Migrate] Đã chuyển dữ liệu sang dạng nhiều shop ✓');
}

// ══════════════════════════════════════════════════════════
// Sessions (phiên live)
// ══════════════════════════════════════════════════════════
async function createSession(shopId, tiktokUsername) {
  requireShop(shopId);
  // Mỗi shop chỉ 1 phiên đang mở: đóng các phiên cũ còn treo
  await Session.updateMany({ shopId, endedAt: null }, { endedAt: new Date() });
  const s = await Session.create({ shopId, tiktokUsername });
  return String(s._id);
}

async function endSession(shopId, sessionId) {
  await Session.updateOne({ _id: sessionId, shopId: requireShop(shopId) }, { endedAt: new Date() });
}

async function getLatestSessionId(shopId) {
  const s = await Session.findOne({ shopId: requireShop(shopId) }).sort({ startedAt: -1 }).select('_id').lean();
  return s ? String(s._id) : null;
}

async function getSession(shopId, sessionId) {
  return await Session.findOne({ _id: sessionId, shopId: requireShop(shopId) }).lean();
}

// ══════════════════════════════════════════════════════════
// Comments
// ══════════════════════════════════════════════════════════
/**
 * Lưu 1 loạt bình luận từ app desktop. Trả về id ĐÚNG VỊ TRÍ từng bình luận gửi lên
 * (bình luận không hợp lệ bị bỏ qua → vị trí đó là null).
 * Khách hàng được upsert 1 lần cho mỗi người (cộng số bình luận).
 */
async function saveComments(shopId, sessionId, list) {
  requireShop(shopId);
  const input = Array.isArray(list) ? list : [];
  const mapped = input
    .map(c => ({
      shopId,
      sessionId: sessionId || null,
      tiktokUserId: String(c.tiktokUserId || '').slice(0, 100),
      username:     String(c.username || '').slice(0, 100),
      displayName:  String(c.displayName || c.username || '').slice(0, 200),
      comment:      String(c.comment || '').trim().slice(0, 500),
      timestamp:    c.timestamp ? new Date(c.timestamp) : new Date(),
    }));
  const valid = (c) => c.tiktokUserId && c.username && c.comment && !Number.isNaN(c.timestamp.getTime());
  const clean = mapped.filter(valid);
  if (!clean.length) return input.map(() => null);

  const docs = await Comment.insertMany(clean, { ordered: true });

  const perUser = new Map();
  for (const c of clean) {
    const u = perUser.get(c.tiktokUserId) || { n: 0, username: c.username, displayName: c.displayName };
    u.n++; u.username = c.username;
    perUser.set(c.tiktokUserId, u);
  }
  const now = new Date();
  await Customer.bulkWrite([...perUser].map(([tiktokUserId, u]) => ({
    updateOne: {
      filter: { shopId, tiktokUserId },
      update: {
        $set:         { username: u.username, lastSeen: now },
        $inc:         { totalComments: u.n },
        // displayName chỉ đặt khi tạo mới — không ghi đè tên đã chỉnh tay
        $setOnInsert: { displayName: u.displayName, firstSeen: now },
      },
      upsert: true,
    },
  })), { ordered: false });

  // Ghép id trả về đúng vị trí của từng bình luận gửi lên
  let k = 0;
  return mapped.map(c => (valid(c) ? String(docs[k++]._id) : null));
}

async function getCommentById(shopId, id) {
  return await Comment.findOne({ _id: id, shopId: requireShop(shopId) }).lean();
}

/**
 * Bình luận của 1 phiên, kèm đơn (nếu đã chốt).
 *   afterId: chỉ lấy bình luận MỚI hơn id này (thiết bị khác hỏi định kỳ)
 *   không có afterId: lấy `limit` bình luận mới nhất
 * Trả về theo thứ tự mới nhất trước.
 */
async function getRecentComments(shopId, sessionId, { afterId, limit = 200 } = {}) {
  requireShop(shopId);
  const query = { shopId };
  if (sessionId) query.sessionId = sessionId;
  let comments;
  if (afterId) {
    query._id = { $gt: new mongoose.Types.ObjectId(afterId) };
    comments = (await Comment.find(query).sort({ _id: 1 }).limit(limit).lean()).reverse();
  } else {
    comments = await Comment.find(query).sort({ _id: -1 }).limit(limit).lean();
  }
  const orders = await Order.find({ shopId, commentId: { $in: comments.map(c => c._id) } })
    .select('commentId orderNumber printPending printedAt printError').lean();
  const byComment = new Map(orders.map(o => [String(o.commentId), o]));
  return comments.map(c => {
    const o = byComment.get(String(c._id));
    return {
      id:           String(c._id),
      tiktokUserId: c.tiktokUserId,
      username:     c.username,
      displayName:  c.displayName,
      comment:      c.comment,
      timestamp:    c.timestamp,
      printed:      !!o,
      order: o ? {
        id: String(o._id), orderNumber: o.orderNumber,
        printPending: !!o.printPending, printedAt: o.printedAt, printError: o.printError,
      } : null,
    };
  });
}

// ══════════════════════════════════════════════════════════
// Orders
// ══════════════════════════════════════════════════════════
async function createOrder(shopId, { commentId, tiktokUserId, username, displayName, note, sessionId, prefix, requestPrint } = {}) {
  requireShop(shopId);
  const orderNumber = await _nextOrderNumber(shopId, prefix);
  const now = new Date();
  const order = await Order.create({
    shopId,
    orderNumber,
    commentId: commentId || null,
    tiktokUserId,
    username,
    displayName: displayName || username,
    note:        (note || '').slice(0, 1000),
    sessionId:   sessionId || null,
    printPending:     !!requestPrint,
    printRequestedAt: requestPrint ? now : null,
  });

  // Mọi đơn (từ bình luận hay tạo tay) đều được tính vào số đơn của khách
  await Customer.updateOne(
    { shopId, tiktokUserId },
    {
      $inc:         { totalOrders: 1 },
      $set:         { username, lastSeen: now },
      $setOnInsert: { displayName: displayName || username, firstSeen: now },
    },
    { upsert: true },
  );

  return order.toObject();
}

/**
 * Chốt đơn từ bình luận. Unique index commentId đảm bảo 2 thiết bị bấm cùng lúc chỉ ra 1 đơn.
 * @returns {{ order, created: boolean }}
 */
async function createOrderFromComment(shopId, commentId, { prefix, requestPrint = true } = {}) {
  const comment = await getCommentById(shopId, commentId);
  if (!comment) throw businessError('Không tìm thấy bình luận', 404);

  const existing = await Order.findOne({ shopId, commentId }).lean();
  if (existing) return { order: existing, created: false };

  try {
    const order = await createOrder(shopId, {
      commentId,
      tiktokUserId: comment.tiktokUserId,
      username:     comment.username,
      displayName:  comment.displayName,
      note:         comment.comment,
      sessionId:    comment.sessionId,
      prefix,
      requestPrint,
    });
    await Comment.updateOne({ _id: commentId, shopId }, { printed: true });
    return { order, created: true };
  } catch (err) {
    if (err.code === 11000 && err.keyPattern?.commentId) {
      return { order: await Order.findOne({ shopId, commentId }).lean(), created: false };
    }
    throw err;
  }
}

async function getOrderByCommentId(shopId, commentId) {
  return await Order.findOne({ shopId: requireShop(shopId), commentId }).lean();
}

async function getOrderById(shopId, id) {
  return await Order.findOne({ _id: id, shopId: requireShop(shopId) }).lean();
}

// ── Hàng đợi in ───────────────────────────────────────────
const PRINT_CLAIM_TIMEOUT_MS = 60 * 1000;     // app nhận việc mà không báo xong sau 60s → cho nhận lại
const PRINT_QUEUE_MAX_AGE_MS = 6 * 3600 * 1000; // yêu cầu in quá 6 tiếng thì bỏ (tránh in đơn cũ khi bật máy)

async function requestPrint(shopId, orderId) {
  const order = await Order.findOneAndUpdate(
    { _id: orderId, shopId: requireShop(shopId) },
    { $set: { printPending: true, printRequestedAt: new Date(), printClaimAt: null, printError: null } },
    { new: true },
  ).lean();
  if (!order) throw businessError('Không tìm thấy đơn hàng', 404);
  return order;
}

/** App desktop nhận 1 việc in (nguyên tử: 2 app cùng shop không in trùng). */
async function claimPrintJob(shopId) {
  requireShop(shopId);
  const now = Date.now();
  const order = await Order.findOneAndUpdate(
    {
      shopId,
      printPending: true,
      printRequestedAt: { $gte: new Date(now - PRINT_QUEUE_MAX_AGE_MS) },
      $or: [{ printClaimAt: null }, { printClaimAt: { $lt: new Date(now - PRINT_CLAIM_TIMEOUT_MS) } }],
    },
    { $set: { printClaimAt: new Date(now) } },
    { sort: { printRequestedAt: 1 }, new: true },
  ).lean();
  return order;
}

async function finishPrintJob(shopId, orderId, { ok, error } = {}) {
  const update = ok
    ? { $set: { printPending: false, printClaimAt: null, printedAt: new Date(), printError: null }, $inc: { printCount: 1 } }
    : { $set: { printPending: false, printClaimAt: null, printError: String(error || 'Lỗi in').slice(0, 300) } };
  const order = await Order.findOneAndUpdate({ _id: orderId, shopId: requireShop(shopId) }, update, { new: true }).lean();
  if (!order) throw businessError('Không tìm thấy đơn hàng', 404);
  return order;
}

// ── Thống kê đơn hàng ─────────────────────────────────────
const ORDER_STATUSES = ['pending', 'deposit', 'confirmed', 'shipping', 'completed', 'cancelled'];

/**
 * Tổng kết đơn theo khoảng thời gian và/hoặc phiên live.
 * Quy ước: đơn Đã huỷ không tính vào tổng.
 *   Đã thu       = tiền đơn Hoàn thành + tiền cọc của đơn chưa hoàn thành
 *   Còn phải thu = Σ max(0, tiền − cọc) của đơn chưa hoàn thành
 */
async function getOrderSummary(shopId, { from, to, sessionId } = {}) {
  requireShop(shopId);
  const match = { shopId };
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
    sessionId ? Comment.countDocuments({ shopId, sessionId }) : null,
    sessionId ? Comment.distinct('tiktokUserId', { shopId, sessionId }) : null,
    sessionId ? Session.findOne({ _id: sessionId, shopId }).lean().catch(() => null) : null,
  ]);

  const empty = { count: 0, amount: 0, deposit: 0, remaining: 0, noAmount: 0 };
  const byKey = Object.fromEntries(byStatusRaw.map(r => [r._id, r]));
  const byStatus = ORDER_STATUSES.map(s => {
    const { _id, ...vals } = byKey[s] || {};
    return { status: s, ...empty, ...vals };
  });

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
      collected:       completed.amount + sum(notDone, 'deposit'),
      deposit:         sum(notDone, 'deposit'),
      completed:       completed.amount,
      remaining:       sum(notDone, 'remaining'),
      noAmount,
      avgOrderValue:   pricedOrds > 0 ? Math.round(amount / pricedOrds) : 0,
      cancelledCount:  cancelled.count,
      cancelledAmount: cancelled.amount,
      comments,
      commenters:      commenters ? commenters.length : null,
      // Tỉ lệ chốt = số khách đặt / số người bình luận (chỉ tính được theo phiên live)
      conversionRate:  commenters && commenters.length ? Math.round((customers / commenters.length) * 1000) / 10 : null,
    },
    byStatus,
    topCustomers: topCustomers.map(c => ({
      tiktokUserId: c._id, username: c.username, displayName: c.displayName, orders: c.orders, amount: c.amount,
    })),
  };
}

async function getOrders(shopId, { status, search, sessionId, page = 1, limit = 20 } = {}) {
  requireShop(shopId);
  const query = { shopId };
  if (status && status !== 'all') query.status = status;
  if (sessionId) query.sessionId = sessionId;
  if (search) {
    // escape RegEx để tránh ReDoS injection
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
        count:    { $sum: 1 },
        amount:   { $sum: '$amount' },
        deposit:  { $sum: '$depositAmount' },
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

// Chỉ đổi trạng thái nếu đơn VẪN đang ở fromStatus (không bị thiết bị khác đổi trước).
// Trả về null nếu đã bị đổi → server báo 409 cho người dùng tải lại.
async function updateOrderStatus(shopId, id, fromStatus, toStatus) {
  requireShop(shopId);
  const updated = await Order.findOneAndUpdate(
    { _id: id, shopId, status: fromStatus },
    { status: toStatus, updatedAt: new Date() },
    { new: true },
  ).lean();
  if (!updated) return null;

  // Chỉ 1 request đổi được trạng thái → totalSpent / totalOrders không bị cộng/trừ 2 lần
  if (toStatus === 'completed' && updated.amount > 0) {
    await Customer.updateOne({ shopId, tiktokUserId: updated.tiktokUserId }, { $inc: { totalSpent: updated.amount } });
  }
  if (toStatus === 'cancelled') {
    await Customer.updateOne(
      { shopId, tiktokUserId: updated.tiktokUserId, totalOrders: { $gt: 0 } },
      { $inc: { totalOrders: -1 } },
    );
  }
  return updated;
}

// Đơn đã Hoàn thành / Đã huỷ thì khoá số tiền để doanh thu cũ không bị thay đổi
const AMOUNT_LOCKED_STATUSES = ['completed', 'cancelled'];

async function updateOrderAmount(shopId, id, { amount, depositAmount } = {}) {
  requireShop(shopId);
  const current = await Order.findOne({ _id: id, shopId }).lean();
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
    { _id: id, shopId, status: { $nin: AMOUNT_LOCKED_STATUSES } },
    { $set: upd },
    { new: true },
  ).lean();
  if (!order) throw businessError('Đơn vừa được cập nhật ở thiết bị khác, hãy tải lại', 409);
  return order;
}

// ══════════════════════════════════════════════════════════
// Customers
// ══════════════════════════════════════════════════════════
async function getAllCustomers(shopId) {
  return await Customer.find({ shopId: requireShop(shopId) }).sort({ totalOrders: -1, lastSeen: -1 }).limit(2000).lean();
}

async function getCustomerByTiktokId(shopId, tiktokUserId) {
  return await Customer.findOne({ shopId: requireShop(shopId), tiktokUserId }).lean();
}

async function getCustomerComments(shopId, tiktokUserId) {
  return await Comment.find({ shopId: requireShop(shopId), tiktokUserId }).sort({ timestamp: -1 }).limit(100).lean();
}

async function getCustomerOrders(shopId, tiktokUserId) {
  return await Order.find({ shopId: requireShop(shopId), tiktokUserId }).sort({ createdAt: -1 }).limit(100).lean();
}

async function updateCustomer(shopId, tiktokUserId, data) {
  requireShop(shopId);
  const allowed = ['phone', 'email', 'notes', 'displayName'];
  const update  = {};
  for (const k of allowed) {
    if (data[k] !== undefined) update[k] = String(data[k]).slice(0, 500).trim();
  }
  if (!Object.keys(update).length) return await getCustomerByTiktokId(shopId, tiktokUserId);
  return await Customer.findOneAndUpdate({ shopId, tiktokUserId }, { $set: update }, { new: true }).lean();
}

async function searchCustomers(shopId, q) {
  requireShop(shopId);
  if (!q || q.trim().length < 1) return [];
  const safe = escapeRegex(q.trim());
  return await Customer.find({
    shopId,
    $or: [
      { username:    { $regex: safe, $options: 'i' } },
      { displayName: { $regex: safe, $options: 'i' } },
      { phone:       { $regex: safe, $options: 'i' } },
      { email:       { $regex: safe, $options: 'i' } },
    ],
  }).sort({ totalOrders: -1 }).limit(50).lean();
}

// ══════════════════════════════════════════════════════════
// Dashboard / biểu đồ
// ══════════════════════════════════════════════════════════
async function getDashboardStats(shopId) {
  requireShop(shopId);
  const [totalCustomers, totalOrders, revenueAgg, totalSessions, recentOrders, topCustomers] = await Promise.all([
    Customer.countDocuments({ shopId }),
    Order.countDocuments({ shopId, status: { $ne: 'cancelled' } }),
    // chỉ tính doanh thu từ đơn đã hoàn thành (completed)
    Order.aggregate([
      { $match: { shopId, status: 'completed' } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
    Session.countDocuments({ shopId }),
    Order.find({ shopId, status: { $ne: 'cancelled' } }).sort({ createdAt: -1 }).limit(10).lean(),
    Customer.find({ shopId }).sort({ totalOrders: -1 }).limit(5).lean(),
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

async function getChartData(shopId, period = 'day', count = 7) {
  requireShop(shopId);
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
      { $match: { shopId, createdAt: { $gte: from }, status: { $ne: 'cancelled' } } },
      { $group: { _id: groupId, count: { $sum: 1 } } },
      { $sort: sortKey },
    ]),
    Order.aggregate([
      { $match: { shopId, createdAt: { $gte: from }, status: 'completed' } },
      { $group: { _id: groupId, total: { $sum: '$amount' } } },
      { $sort: sortKey },
    ]),
  ]);

  return { orderChart, revenueChart, from: from.toISOString(), period, count };
}

// ══════════════════════════════════════════════════════════
// Trạng thái app desktop + lệnh Live
// ══════════════════════════════════════════════════════════
async function saveAgentStatus(shopId, { printer, tiktok }) {
  await PcStatus.updateOne(
    { _id: requireShop(shopId) },
    { $set: { printer: printer || {}, tiktok: tiktok || {}, updatedAt: new Date() } },
    { upsert: true },
  );
}

async function getLiveState(shopId) {
  const doc = await PcStatus.findById(requireShop(shopId)).lean();
  return doc || { _id: shopId, printer: {}, tiktok: {}, updatedAt: null, desired: { on: false, username: '' } };
}

async function setDesiredLive(shopId, { on, username }) {
  const desired = { on: !!on, username: String(username || '').replace('@', '').trim().slice(0, 100), at: new Date() };
  await PcStatus.updateOne({ _id: requireShop(shopId) }, { $set: { desired } }, { upsert: true });
  return desired;
}

module.exports = {
  connectDB, businessError,
  createSession, endSession, getLatestSessionId, getSession,
  saveComments, getCommentById, getRecentComments,
  createOrder, createOrderFromComment, getOrderByCommentId, getOrderById,
  requestPrint, claimPrintJob, finishPrintJob,
  getOrders, updateOrderStatus, updateOrderAmount, getOrderSummary,
  getAllCustomers, getCustomerByTiktokId, getCustomerComments, getCustomerOrders,
  updateCustomer, searchCustomers,
  getDashboardStats, getChartData,
  saveAgentStatus, getLiveState, setDesiredLive,
  Order, Customer, Comment, Session, PcStatus,
};
