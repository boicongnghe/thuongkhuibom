const path = require('path');
const fs   = require('fs');

const FILE = path.join(__dirname, '../../data/settings.json');

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

function load() {
  try {
    if (fs.existsSync(FILE)) {
      const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      return {
        storeInfo: { ...DEFAULTS.storeInfo, ...parsed.storeInfo },
        printer:   { ...DEFAULTS.printer,   ...parsed.printer   },
        system:    { ...DEFAULTS.system,    ...parsed.system    },
      };
    }
  } catch (e) {
    console.error('[Settings] Lỗi đọc file:', e.message);
  }
  return JSON.parse(JSON.stringify(DEFAULTS));
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

function save(patch) {
  const current = load();
  const merged  = {
    storeInfo: { ...current.storeInfo, ...pickValid('storeInfo', patch?.storeInfo) },
    printer:   { ...current.printer,   ...pickValid('printer',   patch?.printer)   },
    system:    { ...current.system,    ...pickValid('system',    patch?.system)    },
  };
  const dir = path.dirname(FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}

module.exports = { load, save };
