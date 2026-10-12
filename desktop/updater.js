// Tự động cập nhật app desktop (electron-updater).
// - Kiểm tra khi mở app (sau 20 giây) và mỗi 4 tiếng; tải bản mới ngầm.
// - Tải xong: nếu KHÔNG đang Live → hỏi khởi động lại; đang Live → để cài khi tắt app.
// - Nguồn bản mới: GitHub Releases (cấu hình build.publish trong package.json),
//   hoặc thư mục web bất kỳ qua biến môi trường CHOTDON_UPDATE_URL (dùng khi test).
const { app, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');

const CHECK_EVERY_MS = 4 * 3600 * 1000;
const FIRST_CHECK_MS = 20 * 1000;

const state = { status: 'idle', version: null, percent: 0, error: '' };
let hooks = { onChange: () => {}, isLive: () => false, beforeInstall: () => {}, window: () => null };

function set(patch) {
  Object.assign(state, patch);
  hooks.onChange({ ...state });
}

function logLine(msg) {
  console.log(`[Updater] ${msg}`);
}

function setup(opts) {
  hooks = { ...hooks, ...opts };
  // Chỉ chạy ở app đã cài (bản dev / thư mục win-unpacked không cập nhật được)
  if (!app.isPackaged && !process.env.CHOTDON_UPDATE_URL) return;

  if (process.env.CHOTDON_UPDATE_URL) {
    autoUpdater.setFeedURL({ provider: 'generic', url: process.env.CHOTDON_UPDATE_URL });
    autoUpdater.forceDevUpdateConfig = true;
  }
  autoUpdater.autoDownload = process.env.CHOTDON_UPDATE_NO_DOWNLOAD !== '1';
  autoUpdater.autoInstallOnAppQuit = true;      // không bấm gì cũng tự cài khi tắt app
  autoUpdater.logger = { info: logLine, warn: logLine, error: logLine, debug: () => {} };

  autoUpdater.on('checking-for-update', () => set({ status: 'checking', version: null, error: '' }));
  autoUpdater.on('update-not-available', () => set({ status: 'latest', version: null }));
  autoUpdater.on('update-available', (info) => set({ status: 'downloading', version: info.version, percent: 0 }));
  autoUpdater.on('download-progress', (p) => set({ status: 'downloading', percent: Math.round(p.percent || 0) }));
  autoUpdater.on('error', (err) => set({ status: 'error', error: String(err?.message || err).slice(0, 200) }));
  autoUpdater.on('update-downloaded', async (info) => {
    set({ status: 'ready', version: info.version, percent: 100 });
    if (hooks.isLive()) return;   // đang Live: không làm phiền, cài khi tắt app
    const win = hooks.window();
    const { response } = await dialog.showMessageBox(win || undefined, {
      type: 'info',
      title: 'Chốt Đơn Live',
      message: `Đã tải xong bản mới ${info.version}`,
      detail: 'Khởi động lại app để dùng bản mới (mất khoảng 10 giây). Hoặc để sau — app sẽ tự cập nhật khi bạn tắt app.',
      buttons: ['Khởi động lại ngay', 'Để sau'],
      defaultId: 0, cancelId: 1,
    });
    if (response === 0) installNow();
  });

  setTimeout(check, FIRST_CHECK_MS);
  setInterval(check, CHECK_EVERY_MS).unref();
}

function check() {
  if (state.status === 'downloading' || state.status === 'ready') return;
  autoUpdater.checkForUpdates().catch((err) => set({ status: 'error', error: String(err?.message || err).slice(0, 200) }));
}

function installNow() {
  if (state.status !== 'ready') return;
  hooks.beforeInstall();
  // isSilent=true: cài ngầm không hiện trình cài; isForceRunAfter=true: cài xong tự mở lại app
  setImmediate(() => autoUpdater.quitAndInstall(true, true));
}

module.exports = { setup, check, installNow, state };
