// Cài đặt lưu trong MongoDB (1 document duy nhất) để web trên Vercel và
// backend trên máy tính dùng chung. File data/settings.json cũ chỉ dùng để
// nhập vào DB một lần đầu tiên.
const path     = require('path');
const fs       = require('fs');
const mongoose = require('mongoose');

const LEGACY_FILE = path.join(__dirname, '../../data/settings.json');
const DOC_ID = 'app';

const DEFAULTS = {
  storeInfo: {
    storeName:      '',
    storeId:        '',
    owner:          '',
    phone:          '',
    email:          '',
    address:        '',
    tiktokUsername: '',
    logoUrl:        '',
  },
  printer: {
    autoPrint:           false,
    // Tự động in chỉ khi bình luận có 1 trong các dấu hiệu sau
    orderKeywords:       'chốt, lấy, mua, đặt',
    autoPrintMatchCode:  true,   // có mã SP kiểu A12, B05
    autoPrintMatchPhone: true,   // có số điện thoại
    connectionType:      'ip',
    bluetoothDeviceId:   '',
    bluetoothDeviceName: '',
    ip:                  '',
    port:                9100,
  },
  system: {
    autoConfirmDeposit: false,
    timezone:           'Asia/Ho_Chi_Minh',
    currency:           'VND',
    orderPrefix:        'ORD',
  },
};

const settingSchema = new mongoose.Schema({
  _id:       { type: String },
  storeInfo: { type: Object, default: {} },
  printer:   { type: Object, default: {} },
  system:    { type: Object, default: {} },
}, { minimize: false, timestamps: true });
const Setting = mongoose.models.Setting || mongoose.model('Setting', settingSchema);

function withDefaults(raw) {
  return {
    storeInfo: { ...DEFAULTS.storeInfo, ...(raw?.storeInfo || {}) },
    printer:   { ...DEFAULTS.printer,   ...(raw?.printer   || {}) },
    system:    { ...DEFAULTS.system,    ...(raw?.system    || {}) },
  };
}

function readLegacyFile() {
  try {
    if (fs.existsSync(LEGACY_FILE)) return JSON.parse(fs.readFileSync(LEGACY_FILE, 'utf8'));
  } catch (e) {
    console.error('[Settings] Lỗi đọc file cũ:', e.message);
  }
  return null;
}

async function load() {
  const doc = await Setting.findById(DOC_ID).lean();
  if (doc) return withDefaults(doc);

  // Lần đầu: nhập từ data/settings.json (nếu có) vào MongoDB
  const legacy = readLegacyFile();
  const initial = withDefaults(legacy);
  await Setting.updateOne({ _id: DOC_ID }, { $setOnInsert: initial }, { upsert: true });
  if (legacy) console.log('[Settings] Đã chuyển data/settings.json vào MongoDB');
  return withDefaults(await Setting.findById(DOC_ID).lean());
}

function invalid(message) {
  const err = new Error(message);
  err.expose = true;
  return err;
}

// Chỉ nhận các trường có trong DEFAULTS và đúng kiểu dữ liệu; trường lạ bị bỏ qua
function pickValid(section, input) {
  const out = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  for (const [key, def] of Object.entries(DEFAULTS[section])) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) continue;
    const val = input[key];
    if (typeof def === 'boolean') {
      if (typeof val !== 'boolean') throw invalid(`Cài đặt "${key}" phải là bật/tắt`);
      out[key] = val;
    } else if (typeof def === 'number') {
      const n = Number(val);
      if (!Number.isInteger(n) || n < 0 || n > 65535) throw invalid(`Cài đặt "${key}" không hợp lệ`);
      out[key] = n;
    } else {
      if (typeof val !== 'string') throw invalid(`Cài đặt "${key}" phải là chữ`);
      out[key] = val.trim().slice(0, 500);
    }
  }
  return out;
}

async function save(patch) {
  await load();  // đảm bảo document đã tồn tại
  const update = {};
  for (const section of Object.keys(DEFAULTS)) {
    for (const [k, v] of Object.entries(pickValid(section, patch?.[section]))) {
      update[`${section}.${k}`] = v;   // chỉ ghi đè đúng trường được gửi lên
    }
  }
  if (Object.keys(update).length) await Setting.updateOne({ _id: DOC_ID }, { $set: update });
  return withDefaults(await Setting.findById(DOC_ID).lean());
}

module.exports = { load, save, DEFAULTS };
