// Cấu hình riêng của từng máy, lưu ở %APPDATA%\Chot Don Live\config.json.
// Chuỗi MongoDB và JWT_SECRET được mã hoá bằng Windows (DPAPI qua Electron safeStorage):
// copy file sang máy khác cũng không đọc được.
const { app, safeStorage } = require('electron');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const file = () => path.join(app.getPath('userData'), 'config.json');

function seal(value) {
  if (!value) return null;
  if (safeStorage.isEncryptionAvailable()) {
    return { enc: true, v: safeStorage.encryptString(value).toString('base64') };
  }
  return { enc: false, v: value };
}

function unseal(box) {
  if (!box) return '';
  return box.enc ? safeStorage.decryptString(Buffer.from(box.v, 'base64')) : box.v;
}

/** @returns {null | { mongodbUri, jwtSecret, printerName, shopName, port }} */
function load() {
  try {
    if (!fs.existsSync(file())) return null;
    const raw = JSON.parse(fs.readFileSync(file(), 'utf8'));
    const cfg = {
      mongodbUri:  unseal(raw.mongodbUri),
      jwtSecret:   unseal(raw.jwtSecret),
      printerName: raw.printerName || '',
      shopName:    raw.shopName || '',
      port:        Number(raw.port) || 3001,
    };
    return cfg.mongodbUri && cfg.jwtSecret ? cfg : null;
  } catch (err) {
    console.error('[Config] Không đọc được cấu hình:', err.message);
    return null;
  }
}

function save({ mongodbUri, printerName, shopName, port }) {
  const current = load();
  const jwtSecret = current?.jwtSecret || crypto.randomBytes(48).toString('hex');  // tạo 1 lần cho mỗi máy
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify({
    mongodbUri:  seal(mongodbUri),
    jwtSecret:   seal(jwtSecret),
    printerName: printerName || '',
    shopName:    shopName || '',
    port:        Number(port) || 3001,
  }, null, 2), 'utf8');
}

module.exports = { load, save, file };
