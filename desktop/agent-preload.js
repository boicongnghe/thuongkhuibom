// Cho trang web của dịch vụ (mở trong app desktop) dùng "trạm": TikTok Live + máy in.
// Chỉ lộ ra khi trang đúng là địa chỉ dịch vụ đã cấu hình; app còn kiểm tra lại ở phía main.
const { contextBridge, ipcRenderer } = require('electron');

const originArg = process.argv.find(a => a.startsWith('--chotdon-origin='));
const allowedOrigin = originArg ? originArg.slice('--chotdon-origin='.length) : '';

if (allowedOrigin && location.origin === allowedOrigin) {
  const on = (channel) => (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  };

  contextBridge.exposeInMainWorld('desktopAgent', {
    // Loại phiếu app này in được — web dựa vào đây để không giao phiếu mới cho app cũ
    features:     ['order', 'report'],
    status:       ()     => ipcRenderer.invoke('agent:status'),
    connect:      (opts) => ipcRenderer.invoke('agent:connect', opts),
    disconnect:   ()     => ipcRenderer.invoke('agent:disconnect'),
    print:        (job)  => ipcRenderer.invoke('agent:print', job),
    testPrint:    ()     => ipcRenderer.invoke('agent:testPrint'),
    printer:      ()     => ipcRenderer.invoke('agent:printer'),
    openSettings: ()     => ipcRenderer.invoke('agent:openSettings'),
    info:         ()     => ipcRenderer.invoke('agent:info'),
    onComments:   on('agent:comments'),
    onStatus:     on('agent:status'),
    onEnded:      on('agent:ended'),
  });
}
