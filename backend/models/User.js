const mongoose = require('mongoose');

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
  // Chỉ cho phép đúng 1 tài khoản: unique index trên giá trị cố định,
  // nên dù 2 request đăng ký chạy song song thì cũng chỉ 1 cái thành công
  owner:        { type: String, default: 'owner', unique: true, immutable: true, select: false },
  failedLogins: { type: Number, default: 0, select: false },
  lockUntil:    { type: Date, default: null, select: false },
  // Tăng lên khi "Đăng xuất mọi thiết bị" → mọi JWT cũ mất hiệu lực ngay
  tokenVersion: { type: Number, default: 0 },
  lastLoginAt:  { type: Date, default: null },
}, { timestamps: true });

// Chỉ trả về các trường an toàn cho frontend
userSchema.set('toJSON', {
  transform: (doc, ret) => ({
    id:          String(ret._id),
    username:    ret.username,
    createdAt:   ret.createdAt,
    lastLoginAt: ret.lastLoginAt,
  }),
});

module.exports = mongoose.models.User || mongoose.model('User', userSchema);
