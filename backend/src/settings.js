// Cài đặt của từng shop, lưu trong MongoDB (document _id = shopId).
const mongoose = require('mongoose');

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
    depositDeadlineHours: 24,      // dồn đơn: chưa cọc quá bấy nhiêu giờ → quá hạn, cần xả hàng
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

function shopKey(shopId) {
  if (!shopId || typeof shopId !== 'string' || shopId.startsWith('__')) throw new Error('Thiếu shopId');
  return shopId;
}

async function load(shopId) {
  const doc = await Setting.findById(shopKey(shopId)).lean();
  return withDefaults(doc);
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

async function save(shopId, patch) {
  const id = shopKey(shopId);
  const update = {};
  for (const section of Object.keys(DEFAULTS)) {
    for (const [k, v] of Object.entries(pickValid(section, patch?.[section]))) {
      update[`${section}.${k}`] = v;   // chỉ ghi đè đúng trường được gửi lên
    }
  }
  if (Object.keys(update).length) await Setting.updateOne({ _id: id }, { $set: update }, { upsert: true });
  return withDefaults(await Setting.findById(id).lean());
}

module.exports = { load, save, DEFAULTS };
