const mongoose = require('mongoose');

// Mỗi tài khoản là chủ 1 shop (shopId = _id của chính tài khoản).
// Tài khoản đầu tiên của hệ thống là quản trị dịch vụ (isAdmin): tạo mã mời cho shop mới.
const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    minlength: 3,
    maxlength: 30,
    match: /^[a-z0-9_.]+$/,
  },
  // Mật khẩu đã băm bằng bcrypt — select:false để không bao giờ vô tình trả về
  passwordHash: { type: String, required: true, select: false },
  shopId:       { type: String, index: true },
  shopName:     { type: String, default: '', maxlength: 100 },
  role:         { type: String, enum: ['owner'], default: 'owner' },
  isAdmin:      { type: Boolean, default: false },
  failedLogins: { type: Number, default: 0, select: false },
  lockUntil:    { type: Date, default: null, select: false },
  // Tăng lên khi "Đăng xuất mọi thiết bị" → mọi JWT cũ mất hiệu lực ngay
  tokenVersion: { type: Number, default: 0 },
  lastLoginAt:  { type: Date, default: null },
}, { timestamps: true });

// shopId luôn có: tài khoản cũ chưa có thì dùng chính _id
userSchema.methods.getShopId = function getShopId() {
  return this.shopId || String(this._id);
};

// Chỉ trả về các trường an toàn cho frontend
userSchema.set('toJSON', {
  transform: (doc, ret) => ({
    id:          String(ret._id),
    username:    ret.username,
    shopId:      ret.shopId || String(ret._id),
    shopName:    ret.shopName || '',
    isAdmin:     !!ret.isAdmin,
    createdAt:   ret.createdAt,
    lastLoginAt: ret.lastLoginAt,
  }),
});

module.exports = mongoose.models.User || mongoose.model('User', userSchema);
