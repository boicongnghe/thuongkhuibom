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

function save(patch) {
  const current = load();
  const merged  = {
    storeInfo: { ...current.storeInfo, ...(patch.storeInfo || {}) },
    printer:   { ...current.printer,   ...(patch.printer   || {}) },
    system:    { ...current.system,    ...(patch.system    || {}) },
  };
  const dir = path.dirname(FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}

module.exports = { load, save };
