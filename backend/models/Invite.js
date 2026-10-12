const mongoose = require('mongoose');

// Mã mời: quản trị tạo, gửi cho shop mới; mỗi mã dùng được 1 lần để đăng ký 1 shop.
const inviteSchema = new mongoose.Schema({
  code:      { type: String, required: true, unique: true },
  note:      { type: String, default: '', maxlength: 200 },   // vd "Shop chị Lan"
  createdBy: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
  usedBy:    { type: String, default: null },               // username đã dùng
  usedAt:    { type: Date, default: null },
  revokedAt: { type: Date, default: null },
});

module.exports = mongoose.models.Invite || mongoose.model('Invite', inviteSchema);
