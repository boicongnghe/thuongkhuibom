const express   = require('express');
const bcrypt    = require('bcryptjs');
const mongoose  = require('mongoose');
const rateLimit = require('express-rate-limit');
const User      = require('../models/User');
const { setSessionCookie, clearSessionCookie, requireAuth } = require('./authMiddleware');

const router = express.Router();

const BCRYPT_ROUNDS = 12;
const MAX_FAILED    = 5;
const LOCK_MINUTES  = 15;
const LOGIN_FAILED_MSG = 'Sai tên đăng nhập hoặc mật khẩu';

// Hash giả để so sánh khi không tìm thấy user — thời gian phản hồi giống nhau,
// kẻ gian không đoán được tên đăng nhập có tồn tại hay không
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', BCRYPT_ROUNDS);

// ── Kiểm tra dữ liệu (giống quy tắc ở frontend) ───────────
const USERNAME_RE = /^[a-z0-9_.]{3,30}$/;

function validateUsername(username) {
  if (!USERNAME_RE.test(username)) {
    return 'Tên đăng nhập 3–30 ký tự, chỉ gồm chữ thường, số, dấu _ và dấu .';
  }
  return null;
}

function validatePassword(password) {
  if (password.length < 8)  return 'Mật khẩu tối thiểu 8 ký tự';
  if (password.length > 64 || Buffer.byteLength(password, 'utf8') > 72) {
    return 'Mật khẩu quá dài (tối đa 64 ký tự)';
  }
  if (!/[A-Za-zÀ-ỹ]/.test(password) || !/\d/.test(password)) {
    return 'Mật khẩu phải có cả chữ và số';
  }
  return null;
}

function readCredentials(body) {
  return {
    username:   typeof body?.username === 'string' ? body.username.trim().toLowerCase() : '',
    password:   typeof body?.password === 'string' ? body.password : '',
    remember:   body?.remember === true,
    shopName:   typeof body?.shopName === 'string' ? body.shopName.trim().slice(0, 100) : '',
    phone:      typeof body?.phone === 'string' ? body.phone.replace(/[^\d+]/g, '').slice(0, 20) : '',
  };
}

// Tài khoản đầu tiên của hệ thống = quản trị. Dùng 1 document đánh dấu có _id cố định:
// 2 người đăng ký cùng lúc thì chỉ 1 người chèn được → chỉ có 1 quản trị.
async function claimFirstAdmin() {
  try {
    await mongoose.connection.collection('settings').insertOne({ _id: '__first_admin', at: new Date() });
    return true;
  } catch (err) {
    if (err.code === 11000) return false;
    throw err;
  }
}

// ── Giới hạn theo IP (lớp bảo vệ thứ 2, ngoài khoá theo tài khoản) ──
const loginLimiter = rateLimit({
  windowMs: LOCK_MINUTES * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: `Bạn thử quá nhiều lần. Vui lòng đợi ${LOCK_MINUTES} phút rồi thử lại.` },
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Bạn thử quá nhiều lần. Vui lòng thử lại sau.' },
});

// Tối đa bấy nhiêu yêu cầu đang chờ duyệt (chống spam đăng ký)
const MAX_PENDING = 50;

// GET /api/auth/status — chưa có ai: người đầu tiên là quản trị; đã có: đăng ký xong chờ duyệt
router.get('/status', async (req, res) => {
  try {
    const count = await User.estimatedDocumentCount();
    res.json({ registrationOpen: true, firstUser: count === 0, requiresApproval: count > 0 });
  } catch (err) {
    console.error('[Auth] status:', err.message);
    res.status(500).json({ error: 'Lỗi máy chủ' });
  }
});

// POST /api/auth/register — mỗi tài khoản là 1 shop mới (dữ liệu riêng).
// Người đầu tiên = quản trị (dùng ngay). Người sau: tạo ở trạng thái CHỜ DUYỆT, chưa đăng nhập được.
router.post('/register', registerLimiter, async (req, res) => {
  const { username, password, remember, shopName, phone } = readCredentials(req.body);

  const invalid = validateUsername(username) || validatePassword(password);
  if (invalid) return res.status(400).json({ error: invalid });

  try {
    if (await User.exists({ username })) {
      return res.status(409).json({ error: 'Tên đăng nhập đã tồn tại' });
    }

    const isFirst = (await User.estimatedDocumentCount()) === 0 && await claimFirstAdmin();
    if (!isFirst && (await User.countDocuments({ status: 'pending' })) >= MAX_PENDING) {
      return res.status(429).json({ error: 'Đang có quá nhiều yêu cầu chờ duyệt. Vui lòng thử lại sau.' });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const _id = new mongoose.Types.ObjectId();
    const user = await User.create({
      _id, username, passwordHash,
      shopId: String(_id),
      shopName,
      phone,
      isAdmin: isFirst,
      status: isFirst ? 'active' : 'pending',
      lastLoginAt: isFirst ? new Date() : null,
    });

    if (isFirst) {
      setSessionCookie(res, user, remember);
      console.log(`[Auth] Đã tạo tài khoản quản trị ${username}`);
      return res.status(201).json({ user });
    }
    console.log(`[Auth] Yêu cầu đăng ký chờ duyệt: ${username}`);
    res.status(202).json({
      pending: true,
      message: 'Đã gửi yêu cầu đăng ký. Vui lòng chờ quản trị duyệt — sau khi được duyệt bạn đăng nhập bằng tài khoản vừa tạo.',
    });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'Tên đăng nhập đã tồn tại' });
    console.error('[Auth] register:', err.message);
    res.status(500).json({ error: 'Không tạo được tài khoản, thử lại sau' });
  }
});

// POST /api/auth/login
router.post('/login', loginLimiter, async (req, res) => {
  const { username, password, remember } = readCredentials(req.body);
  if (!username || !password || password.length > 128) {
    return res.status(401).json({ error: LOGIN_FAILED_MSG });
  }

  try {
    const user = await User.findOne({ username }).select('+passwordHash +failedLogins +lockUntil');
    const now = Date.now();

    if (user?.lockUntil && user.lockUntil.getTime() > now) {
      const minutes = Math.ceil((user.lockUntil.getTime() - now) / 60000);
      res.set('Retry-After', String(minutes * 60));
      return res.status(429).json({
        error: `Bạn đã nhập sai quá nhiều lần. Vui lòng thử lại sau ${minutes} phút.`,
      });
    }

    const ok = await bcrypt.compare(password, user ? user.passwordHash : DUMMY_HASH);

    if (!user || !ok) {
      if (user) {
        // $inc nguyên tử để đếm đúng kể cả khi có nhiều request cùng lúc
        const updated = await User.findByIdAndUpdate(
          user._id, { $inc: { failedLogins: 1 } }, { new: true },
        ).select('+failedLogins');
        if (updated.failedLogins >= MAX_FAILED) {
          await User.updateOne({ _id: user._id }, {
            failedLogins: 0,
            lockUntil: new Date(now + LOCK_MINUTES * 60 * 1000),
          });
          console.warn(`[Auth] Khoá đăng nhập ${LOCK_MINUTES} phút: ${username}`);
          return res.status(429).json({
            error: `Bạn đã nhập sai ${MAX_FAILED} lần. Đăng nhập bị khoá ${LOCK_MINUTES} phút.`,
          });
        }
      }
      return res.status(401).json({ error: LOGIN_FAILED_MSG });
    }

    // Mật khẩu đúng rồi mới báo trạng thái (người lạ không dò được tài khoản nào đang chờ)
    const status = user.getStatus();
    if (status !== 'active') {
      await User.updateOne({ _id: user._id }, { failedLogins: 0 });
      const msg = {
        pending:  'Tài khoản đang chờ quản trị duyệt. Vui lòng quay lại sau.',
        rejected: 'Yêu cầu đăng ký đã bị từ chối. Liên hệ quản trị để biết thêm.',
        disabled: 'Tài khoản đã bị khoá. Liên hệ quản trị để mở lại.',
      }[status] || 'Tài khoản chưa được kích hoạt';
      return res.status(403).json({ error: msg, status });
    }

    await User.updateOne({ _id: user._id }, { failedLogins: 0, lockUntil: null, lastLoginAt: new Date() });
    setSessionCookie(res, user, remember);
    res.json({ user });
  } catch (err) {
    console.error('[Auth] login:', err.message);
    res.status(500).json({ error: 'Lỗi máy chủ, thử lại sau' });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

// POST /api/auth/logout-all — vô hiệu hoá phiên trên MỌI thiết bị (khi nghi bị lộ)
router.post('/logout-all', requireAuth, async (req, res) => {
  try {
    await User.updateOne({ _id: req.user._id }, { $inc: { tokenVersion: 1 } });
    clearSessionCookie(res);
    console.log('[Auth] Đăng xuất mọi thiết bị:', req.user.username);
    res.json({ ok: true });
  } catch (err) {
    console.error('[Auth] logout-all:', err.message);
    res.status(500).json({ error: 'Lỗi máy chủ, thử lại sau' });
  }
});

// GET /api/auth/me — kiểm tra còn đăng nhập không khi mở app
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
