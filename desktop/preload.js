// Cầu nối an toàn giữa cửa sổ cài đặt và app (chỉ mở đúng các hàm cần dùng)
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('setupApi', {
  get:          ()      => ipcRenderer.invoke('setup:get'),
  printers:     ()      => ipcRenderer.invoke('setup:printers'),
  testMongo:    (uri)   => ipcRenderer.invoke('setup:testMongo', uri),
  save:         (data)  => ipcRenderer.invoke('setup:save', data),
  openExternal: (url)   => ipcRenderer.invoke('setup:openExternal', url),
});
