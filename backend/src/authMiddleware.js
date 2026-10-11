const jwt          = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const User         = require('../models/User');

const COOKIE_NAME   = 'cd_session';
const REMEMBER_DAYS = 30;
const SESSION_TTL   = '1d';   // Không "ghi nhớ": cookie phiên, token tự hết hạn sau 1 ngày
const SOCKET_TTL    = '2m';   // Token ngắn hạn chỉ dùng để mở kết nối Socket.io

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET chưa cấu hình trong .env hoặc quá ngắn (cần ≥ 32 ký tự)');
  }
  return secret;
}

function cookieOptions() {
  const sameSite = (process.env.COOKIE_SAMESITE || 'lax').toLowerCase();
  const secure = process.env.COOKIE_SECURE
    ? process.env.COOKIE_SECURE === 'true'
    : process.env.NODE_ENV === 'production';
  // sameSite=none bắt buộc phải secure
  return { httpOnly: true, secure: sameSite === 'none' ? true : secure, sameSite, path: '/' };
}

function setSessionCookie(res, user, remember) {
  const token = jwt.sign({ sub: String(user._id), typ: 'session', tv: user.tokenVersion || 0 }, getSecret(), {
    algorithm: 'HS256',
    expiresIn: remember ? `${REMEMBER_DAYS}d` : SESSION_TTL,
  });
  const opts = cookieOptions();
  if (remember) opts.maxAge = REMEMBER_DAYS * 24 * 60 * 60 * 1000;
  res.cookie(COOKIE_NAME, token, opts);
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, cookieOptions());
}

function verifyToken(token, typ) {
  const payload = jwt.verify(token, getSecret(), { algorithms: ['HS256'] });
  if (payload.typ !== typ) throw new Error('Wrong token type');
  return payload;
}

// Token còn hạn nhưng tài khoản đã bị xoá khỏi DB thì cũng coi như hết phiên
async function userFromToken(token, typ) {
  const payload = verifyToken(token, typ);
  const user = await User.findById(payload.sub);
  if (!user) throw new Error('User not found');
  // Token tạo trước lần "Đăng xuất mọi thiết bị" gần nhất → hết hiệu lực
  if ((payload.tv || 0) !== (user.tokenVersion || 0)) throw new Error('Token revoked');
  return user;
}

// ── Express: chặn mọi API dữ liệu khi chưa đăng nhập ──────
async function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: 'Bạn chưa đăng nhập' });
  try {
    req.user = await userFromToken(token, 'session');
    next();
  } catch {
    clearSessionCookie(res);
    res.status(401).json({ error: 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại' });
  }
}

// ── Chống CSRF: request thay đổi dữ liệu phải có header riêng ──
// Trang web lạ không thể tự gắn header này nếu không qua CORS (đã giới hạn domain)
function requireAppHeader(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('X-Requested-With') !== 'chotdon') {
    return res.status(403).json({ error: 'Yêu cầu không hợp lệ' });
  }
  next();
}

function signSocketToken(user) {
  return jwt.sign({ sub: String(user._id), typ: 'socket', tv: user.tokenVersion || 0 }, getSecret(), {
    algorithm: 'HS256',
    expiresIn: SOCKET_TTL,
  });
}

// ── Socket.io: chỉ cho kết nối khi đã đăng nhập ───────────
// Nhận token ngắn hạn (handshake.auth.token) hoặc cookie phiên (cùng domain)
const parseCookies = cookieParser();
function socketAuth(socket, next) {
  parseCookies(socket.request, {}, async () => {
    try {
      const authToken = socket.handshake.auth?.token;
      socket.data.user = authToken
        ? await userFromToken(authToken, 'socket')
        : await userFromToken(socket.request.cookies?.[COOKIE_NAME], 'session');
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });
}

module.exports = {
  getSecret,
  setSessionCookie,
  clearSessionCookie,
  requireAuth,
  requireAppHeader,
  signSocketToken,
  socketAuth,
};
