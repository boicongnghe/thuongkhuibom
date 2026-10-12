// Cấu hình riêng của từng máy, lưu ở %APPDATA%\Chot Don Live\config.json.
// KHÔNG có chuỗi database hay khoá bí mật nào: app chỉ cần biết địa chỉ dịch vụ trung tâm
// và máy in nào cắm ở máy này. Đăng nhập do trang web của dịch vụ lo (cookie trong app).
const { app } = require('electron');
const fs   = require('fs');
const path = require('path');

const defaults = require('./defaults.json');

const file = () => path.join(app.getPath('userData'), 'config.json');

// Địa chỉ dịch vụ mặc định: biến môi trường (dev/test) > defaults.json (đặt trước khi build)
function defaultCentralUrl() {
  return normalizeUrl(process.env.CHOTDON_CENTRAL_URL || defaults.centralUrl || '');
}

// "chotdon.vercel.app" → "https://chotdon.vercel.app"; bỏ dấu "/" cuối
function normalizeUrl(input) {
  let s = String(input || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    // Chỉ cho http khi chạy thử ở máy (localhost); dịch vụ thật bắt buộc https
    if (u.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(u.hostname)) return '';
    return u.origin;
  } catch {
    return '';
  }
}

/** @returns {{ centralUrl: string, printerName: string }} */
function load() {
  let saved = {};
  try {
    if (fs.existsSync(file())) saved = JSON.parse(fs.readFileSync(file(), 'utf8'));
  } catch (err) {
    console.error('[Config] Không đọc được cấu hình:', err.message);
  }
  return {
    centralUrl:  normalizeUrl(saved.centralUrl) || defaultCentralUrl(),
    printerName: saved.printerName || '',
    configured:  !!saved.configured,
  };
}

function save({ centralUrl, printerName }) {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify({
    centralUrl:  normalizeUrl(centralUrl),
    printerName: printerName || '',
    configured:  true,
  }, null, 2), 'utf8');
}

module.exports = { load, save, file, normalizeUrl, defaultCentralUrl };
