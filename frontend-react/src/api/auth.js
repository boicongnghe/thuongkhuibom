// Gọi API đăng nhập. Token nằm trong cookie httpOnly do backend đặt —
// JavaScript không đọc được, và KHÔNG lưu gì nhạy cảm ở localStorage.

export const API_BASE = import.meta.env.VITE_API_URL || '';

const REMEMBER_KEY = 'chotdon.username';

async function request(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(API_BASE + path, {
      method,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'chotdon' },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Lỗi máy chủ (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const authApi = {
  status:   ()     => request('/api/auth/status'),
  login:    (body) => request('/api/auth/login', { method: 'POST', body }).then(d => d.user),
  register: (body) => request('/api/auth/register', { method: 'POST', body }).then(d => d.user),
  logout:   ()     => request('/api/auth/logout', { method: 'POST' }),
  logoutAll: ()    => request('/api/auth/logout-all', { method: 'POST' }),
  // Trả về user nếu còn đăng nhập, null nếu chưa / hết phiên
  me: async () => {
    try {
      return (await request('/api/auth/me')).user;
    } catch (err) {
      if (err.status === 401) return null;
      throw err;
    }
  },
};

// ── Kiểm tra dữ liệu (giống hệt quy tắc ở backend) ────────
export function validateUsername(username) {
  if (!/^[a-z0-9_.]{3,30}$/.test(username)) {
    return 'Tên đăng nhập 3–30 ký tự, chỉ gồm chữ thường, số, dấu _ và dấu .';
  }
  return null;
}

export function validatePassword(password) {
  if (password.length < 8) return 'Mật khẩu tối thiểu 8 ký tự';
  if (password.length > 64) return 'Mật khẩu quá dài (tối đa 64 ký tự)';
  if (!/[A-Za-zÀ-ỹ]/.test(password) || !/\d/.test(password)) return 'Mật khẩu phải có cả chữ và số';
  return null;
}

// ── Ghi nhớ tên đăng nhập (chỉ tên, không bao giờ lưu mật khẩu) ──
export function getRememberedUsername() {
  try { return localStorage.getItem(REMEMBER_KEY) || ''; } catch { return ''; }
}

export function setRememberedUsername(username) {
  try {
    if (username) localStorage.setItem(REMEMBER_KEY, username);
    else localStorage.removeItem(REMEMBER_KEY);
  } catch { /* trình duyệt chặn localStorage: bỏ qua */ }
}
