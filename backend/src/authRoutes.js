const express   = require('express');
const bcrypt    = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const User      = require('../models/User');
const {
  setSessionCookie, clearSessionCookie, requireAuth, signSocketToken,
} = require('./authMiddleware');

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
    username: typeof body?.username === 'string' ? body.username.trim().toLowerCase() : '',
    password: typeof body?.password === 'string' ? body.password : '',
    remember: body?.remember === true,
  };
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

// GET /api/auth/status — frontend dùng để ẩn tab Đăng ký khi đã có tài khoản
router.get('/status', async (req, res) => {
  try {
    const count = await User.countDocuments({});
    res.json({ registrationOpen: count === 0 });
  } catch (err) {
    console.error('[Auth] status:', err.message);
    res.status(500).json({ error: 'Lỗi máy chủ' });
  }
});

// POST /api/auth/register
router.post('/register', registerLimiter, async (req, res) => {
  const { username, password, remember } = readCredentials(req.body);

  const invalid = validateUsername(username) || validatePassword(password);
  if (invalid) return res.status(400).json({ error: invalid });

  try {
    if (await User.countDocuments({}) > 0) {
      return res.status(403).json({ error: 'Đã có tài khoản. Chức năng đăng ký đã bị khoá.' });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const user = await User.create({ username, passwordHash, lastLoginAt: new Date() });

    setSessionCookie(res, user, remember);
    console.log('[Auth] Đã tạo tài khoản:', username);
    res.status(201).json({ user });
  } catch (err) {
    if (err.code === 11000) {
      if (err.keyPattern?.owner) {
        return res.status(403).json({ error: 'Đã có tài khoản. Chức năng đăng ký đã bị khoá.' });
      }
      return res.status(409).json({ error: 'Tên đăng nhập đã tồn tại' });
    }
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
    // Cắt luôn các kết nối realtime đang mở (điện thoại, máy khác...)
    req.app.get('io')?.disconnectSockets(true);
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

// GET /api/auth/socket-token — token 2 phút để mở Socket.io (kể cả khác domain)
router.get('/socket-token', requireAuth, (req, res) => {
  res.json({ token: signSocketToken(req.user) });
});

module.exports = router;
