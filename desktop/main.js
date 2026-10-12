// App desktop "Chốt Đơn Live" (Electron) — trạm ở shop của DỊCH VỤ TRUNG TÂM.
// - Mở trang web của dịch vụ (đăng nhập bằng tài khoản shop) trong cửa sổ app
// - Cho trang đó dùng "trạm": kết nối TikTok Live + in phiếu ra máy in USB của máy này
// - Không chứa chuỗi database / khoá bí mật nào; chạy ngầm ở khay để không rớt Live
const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, shell, clipboard, nativeImage, net } = require('electron');
const path   = require('path');

// Thư mục dữ liệu riêng (dùng khi test hoặc chạy bản portable) — mặc định %APPDATA%\Chot Don Live
if (process.env.CHOTDON_USER_DATA) app.setPath('userData', process.env.CHOTDON_USER_DATA);

const config  = require('./config');
const updater = require('./updater');

const APP_TITLE   = 'Chốt Đơn Live';
const ICON        = path.join(__dirname, 'icon.png');
const startHidden = process.argv.includes('--hidden');   // tự chạy khi bật máy → chỉ hiện ở khay

let cfg      = null;
let agent    = null;
let mainWin  = null;
let setupWin = null;
let tray     = null;
let quitting = false;

// Chỉ cho chạy 1 bản: mở lần 2 thì đưa cửa sổ đang có lên trước
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => (mainWin ? showMain() : setupWin?.focus()));
  app.whenReady().then(() => {
    app.setAppUserModelId('vn.chotdon.live');
    cfg = config.load();
    if (cfg.centralUrl && cfg.configured) boot();
    else openSetup();
  });
}

app.on('window-all-closed', () => { if (!mainWin) app.quit(); });
app.on('before-quit', () => { quitting = true; });

// ── Khởi động trạm + cửa sổ chính ────────────────────────
function boot() {
  process.env.PRINTER_NAME = cfg.printerName || 'POS-58';
  agent = require('./agent');
  agent.events.on('comments', (data) => send('agent:comments', data));
  agent.events.on('status',   (data) => send('agent:status', data));
  agent.events.on('ended',    (data) => send('agent:ended', data));
  createTray();
  createMain();
  if (!startHidden) showMain();

  // Tự cập nhật: tải ngầm, đang Live thì không làm phiền (cài khi tắt app)
  updater.setup({
    isLive: () => !!(agent.state.connected || agent.state.connecting),
    window: () => mainWin,
    beforeInstall: () => { quitting = true; },
    onChange: (st) => {
      refreshTrayMenu();
      if (st.status === 'ready' && agent.state.connected && tray) {
        tray.displayBalloon?.({ title: APP_TITLE, content: `Đã tải bản mới ${st.version}. App sẽ tự cập nhật khi bạn tắt app (không làm gián đoạn Live).` });
      }
    },
  });
}

function send(channel, data) {
  if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send(channel, data);
}

function createMain() {
  mainWin = new BrowserWindow({
    width: 1280, height: 820, minWidth: 380, minHeight: 600,
    title: APP_TITLE, icon: ICON, autoHideMenuBar: true, show: false,
    webPreferences: {
      preload: path.join(__dirname, 'agent-preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      // Cửa sổ ẩn xuống khay vẫn phải chạy hẹn giờ (gửi bình luận, nhận việc in)
      backgroundThrottling: false,
      additionalArguments: [`--chotdon-origin=${cfg.centralUrl}`],
    },
  });

  // Chỉ cho mở trang của dịch vụ trong app; link khác mở bằng trình duyệt
  mainWin.webContents.on('will-navigate', (e, url) => {
    if (new URL(url).origin !== cfg.centralUrl) { e.preventDefault(); shell.openExternal(url); }
  });
  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWin.webContents.on('did-fail-load', async (_e, code, desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return;   // -3: huỷ do điều hướng, bỏ qua
    const { response } = await dialog.showMessageBox(mainWin, {
      type: 'error', title: APP_TITLE, message: 'Không mở được trang dịch vụ',
      detail: `${cfg.centralUrl}\n\n${desc}. Kiểm tra kết nối internet hoặc địa chỉ dịch vụ trong Cài đặt.`,
      buttons: ['Thử lại', 'Mở cài đặt', 'Đóng'], defaultId: 0,
    });
    if (response === 0) mainWin.loadURL(cfg.centralUrl);
    else if (response === 1) openSetup();
  });

  // Bấm X: ẩn xuống khay chứ không tắt, để vẫn nhận bình luận / in đơn
  let toldTray = false;
  mainWin.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    mainWin.hide();
    if (!toldTray && tray) {
      tray.displayBalloon?.({ title: APP_TITLE, content: 'App vẫn chạy ở khay đồng hồ để nhận bình luận và in đơn. Chuột phải biểu tượng → Thoát để tắt hẳn.' });
      toldTray = true;
    }
  });
  mainWin.on('closed', () => { mainWin = null; });
  mainWin.once('ready-to-show', () => { if (!startHidden) mainWin.show(); });
  mainWin.loadURL(cfg.centralUrl);
}

function showMain() {
  if (!mainWin) return;
  if (mainWin.isMinimized()) mainWin.restore();
  mainWin.show();
  mainWin.focus();
}

// ── Khay đồng hồ ─────────────────────────────────────────
function createTray() {
  if (tray) return;
  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
  tray.setToolTip(APP_TITLE);
  tray.on('click', showMain);
  refreshTrayMenu();
}

function refreshTrayMenu() {
  if (!tray) return;
  const autoStart = app.getLoginItemSettings().openAtLogin;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `Mở ${APP_TITLE}`, click: showMain },
    { type: 'separator' },
    { label: 'Điện thoại / máy khác mở địa chỉ (bấm để copy):', enabled: false },
    { label: `   ${cfg.centralUrl}`, click: () => clipboard.writeText(cfg.centralUrl) },
    { type: 'separator' },
    {
      label: 'Tự chạy khi bật máy', type: 'checkbox', checked: autoStart,
      click: (item) => {
        app.setLoginItemSettings({ openAtLogin: item.checked, args: ['--hidden'] });
        refreshTrayMenu();
      },
    },
    { label: 'Đổi máy in / địa chỉ dịch vụ…', click: () => openSetup() },
    { type: 'separator' },
    ...updateMenuItems(),
    { type: 'separator' },
    { label: 'Thoát', click: () => { quitting = true; app.quit(); } },
  ]));
}

function updateMenuItems() {
  const st = updater.state;
  const v = app.getVersion();
  if (st.status === 'ready') return [{ label: `⬆ Cập nhật lên bản ${st.version} (khởi động lại)`, click: () => updater.installNow() }];
  if (st.status === 'downloading') return [{ label: `Đang tải bản mới ${st.version || ''}… ${st.percent}%`, enabled: false }];
  if (st.status === 'checking') return [{ label: `Phiên bản ${v} · đang kiểm tra cập nhật…`, enabled: false }];
  return [{ label: `Phiên bản ${v}${st.status === 'latest' ? ' (mới nhất)' : ''} · Kiểm tra cập nhật`, click: () => updater.check() }];
}

// ── Cửa sổ cài đặt (lần đầu hoặc khi đổi máy in / địa chỉ) ─
function openSetup() {
  if (setupWin) { setupWin.focus(); return; }
  setupWin = new BrowserWindow({
    width: 600, height: 640, title: `${APP_TITLE} — Cài đặt`, icon: ICON, autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  });
  setupWin.loadFile(path.join(__dirname, 'setup.html'), { query: { mode: mainWin ? 'edit' : 'first' } });
  setupWin.on('closed', () => { setupWin = null; });
}

// ══════════════════════════════════════════════════════════
// IPC cửa sổ cài đặt (chỉ từ file setup.html trong app)
// ══════════════════════════════════════════════════════════
const fromSetup = (e) => setupWin && e.sender === setupWin.webContents;

ipcMain.handle('setup:get', (e) => {
  if (!fromSetup(e)) return null;
  const c = config.load();
  return { centralUrl: c.centralUrl, printerName: c.printerName, defaultUrl: config.defaultCentralUrl() };
});

ipcMain.handle('setup:printers', async (e) => {
  if (!fromSetup(e)) return [];
  const list = await e.sender.getPrintersAsync();
  return list.map(p => ({ name: p.name, isDefault: !!p.isDefault }));
});

// Kiểm tra địa chỉ dịch vụ: gọi /api/auth/status, phải trả về JSON của Chốt Đơn
ipcMain.handle('setup:testUrl', async (e, input) => {
  if (!fromSetup(e)) return { ok: false };
  const url = config.normalizeUrl(input);
  if (!url) return { ok: false, message: 'Địa chỉ không hợp lệ (dịch vụ phải dùng https://)' };
  try {
    const res = await net.fetch(`${url}/api/auth/status`, { signal: AbortSignal.timeout(10000) });
    const data = await res.json().catch(() => null);
    // Dịch vụ Chốt Đơn luôn trả về registrationOpen (true/false) ở /api/auth/status
    if (res.ok && typeof data?.registrationOpen === 'boolean') return { ok: true, url, message: `Kết nối được dịch vụ ${url}` };
    if (data?.error) return { ok: false, message: data.error };
    return { ok: false, message: `Địa chỉ này không phải dịch vụ Chốt Đơn (HTTP ${res.status})` };
  } catch (err) {
    return { ok: false, message: `Không kết nối được ${url}: ${err.message}` };
  }
});

ipcMain.handle('setup:save', async (e, data) => {
  if (!fromSetup(e)) return { ok: false };
  const url = config.normalizeUrl(data?.centralUrl);
  if (!url) return { ok: false, message: 'Địa chỉ dịch vụ không hợp lệ' };
  config.save({ centralUrl: url, printerName: String(data?.printerName || '').slice(0, 200) });
  // Khởi động lại để nạp máy in / địa chỉ mới sạch sẽ (đăng nhập vẫn giữ)
  setTimeout(() => { quitting = true; app.relaunch(); app.exit(0); }, 300);
  return { ok: true };
});

// ══════════════════════════════════════════════════════════
// IPC "trạm" — CHỈ trang của dịch vụ đã cấu hình mới gọi được
// (một trang lạ có lọt vào cửa sổ cũng không điều khiển được máy in / TikTok)
// ══════════════════════════════════════════════════════════
function fromService(e) {
  try {
    return !!mainWin && e.sender === mainWin.webContents && new URL(e.senderFrame.url).origin === cfg.centralUrl;
  } catch {
    return false;
  }
}

function guarded(fn) {
  return async (e, ...args) => {
    if (!fromService(e)) throw new Error('Không được phép');
    return fn(...args);
  };
}

ipcMain.handle('agent:status',     guarded(() => agent.status()));
ipcMain.handle('agent:connect',    guarded((opts) => agent.connect(opts || {})));
ipcMain.handle('agent:disconnect', guarded(() => agent.disconnect()));
ipcMain.handle('agent:print',      guarded((job) => agent.print(job || {})));
ipcMain.handle('agent:testPrint',  guarded(() => agent.printTest()));
ipcMain.handle('agent:printer',    guarded(() => agent.printerStatus(true)));
ipcMain.handle('agent:openSettings', guarded(() => { openSetup(); return true; }));
ipcMain.handle('agent:info', guarded(() => ({ version: app.getVersion(), printerName: cfg.printerName, centralUrl: cfg.centralUrl })));
