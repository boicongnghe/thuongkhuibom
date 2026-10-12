// Chạy DỊCH VỤ TRUNG TÂM ở máy để phát triển / thử (npm run dev, npm start).
// Bản thật chạy trên Vercel (api/index.js) — dùng cùng backend/app.js.
// TikTok Live và máy in KHÔNG chạy ở đây nữa: chúng chạy trong app desktop ở shop (desktop/).
require('dotenv').config();
const { createServer } = require('http');
const path    = require('path');
const fs      = require('fs');
const express = require('express');

const db = require('./src/database');
const { createApp } = require('./app');

const PORT = process.env.PORT || 3001;

let app;
try {
  app = createApp();
} catch (err) {
  // Thiếu JWT_SECRET → dừng ngay, tránh chạy với cấu hình không an toàn
  console.error('[Auth]', err.message);
  if (require.main === module) process.exit(1);
  throw err;
}

// Phục vụ bản build React (npm run build) nếu có — dev thường dùng Vite ở cổng 5173
const reactDist = path.join(__dirname, '../frontend-react-dist');
if (fs.existsSync(reactDist)) {
  app.use(express.static(reactDist));
  app.get('/*path', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(reactDist, 'index.html'));
  });
}

const httpServer = createServer(app);

let started = null;
function start(port = PORT) {
  if (started) return started;
  started = (async () => {
    await db.connectDB();
    await new Promise((resolve, reject) => {
      const onError = (err) => { httpServer.off('listening', onListening); reject(err); };
      const onListening = () => { httpServer.off('error', onError); resolve(); };
      httpServer.once('error', onError);
      httpServer.once('listening', onListening);
      httpServer.listen(port);
    });
    console.log(`\n🚀 Dịch vụ Chốt Đơn (API) đang chạy tại: http://localhost:${port}\n`);
    return { port };
  })();
  started.catch(() => { started = null; });
  return started;
}

module.exports = { start, httpServer };

if (require.main === module) {
  start().catch((err) => {
    console.error(err.code === 'EADDRINUSE'
      ? `[Server] Cổng ${PORT} đang bị chương trình khác dùng`
      : `[MongoDB] Kết nối thất bại: ${err.message}`);
    process.exit(1);
  });
}
