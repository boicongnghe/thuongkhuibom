// App desktop "Chốt Đơn Live" (Electron): chạy backend ngay trong app (thay cho npm run dev),
// mở giao diện web trong cửa sổ, chạy ngầm ở khay đồng hồ để vẫn nhận bình luận khi đóng cửa sổ.
const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, shell, clipboard, nativeImage } = require('electron');
const os     = require('os');
const path   = require('path');
const config = require('./config');

// Thư mục dữ liệu riêng (dùng khi test hoặc chạy bản portable) — mặc định %APPDATA%\Chot Don Live
if (process.env.CHOTDON_USER_DATA) app.setPath('userData', process.env.CHOTDON_USER_DATA);

const APP_TITLE = 'Chốt Đơn Live';
const ICON      = path.join(__dirname, 'icon.png');
const startHidden = process.argv.includes('--hidden');   // tự chạy khi bật máy → chỉ hiện ở khay

let mainWin  = null;
let setupWin = null;
let tray     = null;
let port     = null;
let quitting = false;

// Chỉ cho chạy 1 bản: mở lần 2 thì đưa cửa sổ đang có lên trước
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => (port ? showMain() : setupWin?.focus()));
  app.whenReady().then(() => {
    app.setAppUserModelId('vn.chotdon.live');
    const cfg = config.load();
    if (cfg) boot(cfg);
    else openSetup();
  });
}

// Đóng hết cửa sổ: vẫn chạy ngầm nếu server đã chạy (để không rớt Live); chưa cài đặt xong thì thoát
app.on('window-all-closed', () => { if (!port) app.quit(); });
app.on('before-quit', () => { quitting = true; });

// ── Khởi động backend với cấu hình của máy này ───────────
function applyEnv(cfg) {
  process.env.MONGODB_URI   = cfg.mongodbUri;
  process.env.JWT_SECRET    = cfg.jwtSecret;
  process.env.PRINTER_NAME  = cfg.printerName || 'POS-58';
  process.env.SHOP_NAME     = cfg.shopName || 'SHOP CUA BAN';
  process.env.PORT          = String(cfg.port || 3001);
  process.env.NODE_ENV      = 'production';
  // App chạy bằng http trên máy/mạng Wi-Fi nội bộ → cookie không đặt Secure
  process.env.COOKIE_SECURE = 'false';
}

async function boot(cfg) {
  applyEnv(cfg);
  try {
    const server = require('../backend/server');
    ({ port } = await server.start(cfg.port || 3001));
    createTray();
    if (!startHidden) showMain();
  } catch (err) {
    const detail = err.code === 'EADDRINUSE'
      ? `Cổng ${cfg.port} đang bị chương trình khác dùng (có thể bạn đang chạy "npm run dev"). Tắt chương trình đó rồi mở lại app, hoặc đổi cổng trong Cài đặt.`
      : `Không kết nối được MongoDB.\n\n${friendlyMongoError(err)}`;
    const { response } = await dialog.showMessageBox({
      type: 'error', title: APP_TITLE, message: 'Không khởi động được app', detail,
      buttons: ['Mở cài đặt', 'Thoát'], defaultId: 0, cancelId: 1,
    });
    if (response === 0) openSetup(cfg);
    else app.quit();
  }
}

// ── Cửa sổ chính: giao diện web chạy từ backend trong app ─
function showMain() {
  if (mainWin) {
    if (mainWin.isMinimized()) mainWin.restore();
    mainWin.show();
    mainWin.focus();
    return;
  }
  mainWin = new BrowserWindow({
    width: 1280, height: 820, minWidth: 380, minHeight: 600,
    title: APP_TITLE, icon: ICON, autoHideMenuBar: true, show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  mainWin.loadURL(`http://localhost:${port}`);
  mainWin.once('ready-to-show', () => mainWin.show());

  // Link ra ngoài (TikTok, hướng dẫn...) mở bằng trình duyệt, không mở trong app
  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // Bấm X: ẩn xuống khay chứ không tắt, để vẫn nhận bình luận / in đơn
  let toldTray = false;
  mainWin.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    mainWin.hide();
    if (!toldTray && tray) {
      tray.displayBalloon?.({ title: APP_TITLE, content: 'App vẫn chạy ở khay đồng hồ để nhận bình luận. Chuột phải biểu tượng → Thoát để tắt hẳn.' });
      toldTray = true;
    }
  });
  mainWin.on('closed', () => { mainWin = null; });
}

// ── Khay đồng hồ ─────────────────────────────────────────
function lanUrls() {
  const urls = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal) urls.push(`http://${ni.address}:${port}`);
    }
  }
  return urls;
}

function createTray() {
  if (tray) return;
  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
  tray.setToolTip(APP_TITLE);
  tray.on('click', showMain);
  refreshTrayMenu();
}

function refreshTrayMenu() {
  const lan = lanUrls();
  const autoStart = app.getLoginItemSettings().openAtLogin;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `Mở ${APP_TITLE}`, click: showMain },
    { type: 'separator' },
    { label: 'Điện thoại cùng Wi-Fi mở địa chỉ (bấm để copy):', enabled: false },
    ...(lan.length
      ? lan.map(u => ({ label: `   ${u}`, click: () => clipboard.writeText(u) }))
      : [{ label: '   (chưa có mạng)', enabled: false }]),
    { type: 'separator' },
    {
      label: 'Tự chạy khi bật máy', type: 'checkbox', checked: autoStart,
      click: (item) => {
        app.setLoginItemSettings({ openAtLogin: item.checked, args: ['--hidden'] });
        refreshTrayMenu();
      },
    },
    { label: 'Cài đặt kết nối / máy in…', click: () => openSetup(config.load()) },
    { type: 'separator' },
    { label: 'Thoát', click: () => { quitting = true; app.quit(); } },
  ]));
}

// ── Cửa sổ cài đặt (lần đầu hoặc khi đổi MongoDB / máy in) ─
function openSetup(existing = null) {
  if (setupWin) { setupWin.focus(); return; }
  setupWin = new BrowserWindow({
    width: 620, height: 760, resizable: true, title: `${APP_TITLE} — Cài đặt`, icon: ICON,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  });
  setupWin.loadFile(path.join(__dirname, 'setup.html'), { query: { mode: existing ? 'edit' : 'first' } });
  setupWin.on('closed', () => { setupWin = null; });
}

function friendlyMongoError(err) {
  const m = String(err?.message || err);
  if (/bad auth|authentication failed/i.test(m)) return 'Sai tên đăng nhập hoặc mật khẩu database trong chuỗi kết nối.';
  if (/ENOTFOUND|querySrv|getaddrinfo/i.test(m)) return 'Không tìm thấy máy chủ MongoDB — kiểm tra lại chuỗi kết nối và mạng internet.';
  if (/timed out|Server selection|ECONNREFUSED|whitelist|IP/i.test(m)) {
    return 'Không kết nối được tới MongoDB Atlas. Vào Atlas → Network Access → thêm IP của máy này (hoặc 0.0.0.0/0).';
  }
  if (/Invalid scheme|URI/i.test(m)) return 'Chuỗi kết nối không đúng định dạng (phải bắt đầu bằng mongodb+srv:// hoặc mongodb://).';
  return m;
}

// ── IPC cho cửa sổ cài đặt ───────────────────────────────
ipcMain.handle('setup:get', () => {
  const cfg = config.load();
  return cfg
    ? { mongodbUri: cfg.mongodbUri, printerName: cfg.printerName, shopName: cfg.shopName, port: cfg.port }
    : { mongodbUri: '', printerName: '', shopName: '', port: 3001 };
});

ipcMain.handle('setup:printers', async (e) => {
  const list = await e.sender.getPrintersAsync();
  return list.map(p => ({ name: p.name, isDefault: !!p.isDefault }));
});

ipcMain.handle('setup:testMongo', async (_e, uri) => {
  if (!/^mongodb(\+srv)?:\/\//.test(String(uri || '').trim())) {
    return { ok: false, message: 'Chuỗi kết nối phải bắt đầu bằng mongodb+srv:// hoặc mongodb://' };
  }
  const mongoose = require('mongoose');
  let conn;
  try {
    conn = await mongoose.createConnection(uri.trim(), { serverSelectionTimeoutMS: 10000 }).asPromise();
    await conn.db.admin().ping();
    return { ok: true, message: `Kết nối thành công (database: ${conn.name})` };
  } catch (err) {
    return { ok: false, message: friendlyMongoError(err) };
  } finally {
    await conn?.close().catch(() => {});
  }
});

ipcMain.handle('setup:save', async (_e, data) => {
  const mongodbUri = String(data?.mongodbUri || '').trim();
  const port = Number(data?.port) || 3001;
  if (!/^mongodb(\+srv)?:\/\//.test(mongodbUri)) return { ok: false, message: 'Chuỗi kết nối MongoDB không hợp lệ' };
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return { ok: false, message: 'Cổng phải từ 1024 đến 65535' };
  config.save({
    mongodbUri,
    printerName: String(data?.printerName || '').slice(0, 200),
    shopName:    String(data?.shopName || '').slice(0, 100),
    port,
  });
  // Khởi động lại để backend nạp cấu hình mới (máy in, MongoDB) sạch sẽ
  setTimeout(() => { quitting = true; app.relaunch(); app.exit(0); }, 300);
  return { ok: true };
});

ipcMain.handle('setup:openExternal', (_e, url) => {
  if (/^https:\/\/(www\.)?(mongodb\.com|cloud\.mongodb\.com)\//.test(url)) shell.openExternal(url);
});
