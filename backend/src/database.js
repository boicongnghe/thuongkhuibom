require('dotenv').config();
const mongoose = require('mongoose');

// ── Inline Schemas (no separate models/ dir) ──────────────
const Comment = mongoose.model('Comment', new mongoose.Schema({
  tiktokUserId: { type: String, required: true },
  username:     { type: String, required: true },
  displayName:  { type: String, default: '' },
  comment:      { type: String, required: true },
  printed:      { type: Boolean, default: false },
  sessionId:    { type: String, default: null },
  timestamp:    { type: Date, default: Date.now },
}));

const Customer = mongoose.model('Customer', new mongoose.Schema({
  tiktokUserId:  { type: String, required: true, unique: true },
  username:      { type: String, required: true },
  totalComments: { type: Number, default: 0 },
  totalOrders:   { type: Number, default: 0 },
  firstSeen:     { type: Date, default: Date.now },
  lastSeen:      { type: Date, default: Date.now },
}));

const Session = mongoose.model('Session', new mongoose.Schema({
  tiktokUsername: { type: String, required: true },
  startedAt:      { type: Date, default: Date.now },
  endedAt:        { type: Date, default: null },
}));

// ── Connect ───────────────────────────────────────────────
async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI chưa được cấu hình trong .env');

  await mongoose.connect(uri);
  console.log('[MongoDB] Đã kết nối Atlas ✓');
}

// ── Sessions ─────────────────────────────────────────────
async function createSession(tiktokUsername) {
  const session = await Session.create({ tiktokUsername });
  return session._id.toString();
}

async function endSession(sessionId) {
  await Session.findByIdAndUpdate(sessionId, { endedAt: new Date() });
}

// ── Comments ─────────────────────────────────────────────
async function saveComment({ tiktokUserId, username, displayName, comment, sessionId }) {
  // Lưu bình luận
  const doc = await Comment.create({
    tiktokUserId,
    username,
    displayName: displayName || username,
    comment,
    sessionId,
  });

  // Upsert khách hàng
  await Customer.findOneAndUpdate(
    { tiktokUserId },
    {
      $set:  { username, lastSeen: new Date() },
      $inc:  { totalComments: 1 },
      $setOnInsert: { firstSeen: new Date() },
    },
    { upsert: true, new: true }
  );

  return doc._id.toString();
}

async function markPrinted(commentId) {
  const comment = await Comment.findByIdAndUpdate(
    commentId,
    { printed: true },
    { new: true }
  );

  if (comment) {
    // Tăng totalOrders cho khách hàng
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

// ── Customers ────────────────────────────────────────────
async function getAllCustomers() {
  return await Customer.find().sort({ totalOrders: -1, lastSeen: -1 }).lean();
}

async function getCustomerComments(tiktokUserId) {
  return await Comment.find({ tiktokUserId }).sort({ timestamp: -1 }).lean();
}

// ── Stats ────────────────────────────────────────────────
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
  getAllCustomers, getCustomerComments,
  getSessionStats,
};
