// Vercel Serverless Function: chạy toàn bộ REST API (/api/...) trên Vercel,
// kết nối thẳng MongoDB Atlas. Không có Socket.io / TikTok Live / máy in —
// các phần đó chỉ chạy trên máy tính (npm run dev / npm start).
//
// Cần khai báo trên Vercel → Settings → Environment Variables:
//   MONGODB_URI, JWT_SECRET
const { createApp } = require('../backend/app');
const db = require('../backend/src/database');

let app;

function fail(res, message) {
  res.statusCode = 500;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ error: message }));
}

module.exports = async (req, res) => {
  try {
    app ||= createApp();
  } catch (err) {
    console.error('[Vercel] Cấu hình:', err.message);
    return fail(res, 'Máy chủ chưa cấu hình JWT_SECRET trên Vercel (Settings → Environment Variables)');
  }

  try {
    await db.connectDB();   // dùng lại kết nối nếu function còn "ấm"
  } catch (err) {
    console.error('[Vercel] MongoDB:', err.message);
    return fail(res, process.env.MONGODB_URI
      ? 'Không kết nối được MongoDB Atlas. Kiểm tra Network Access đã cho phép 0.0.0.0/0'
      : 'Máy chủ chưa cấu hình MONGODB_URI trên Vercel (Settings → Environment Variables)');
  }

  return app(req, res);
};
