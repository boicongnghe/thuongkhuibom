# 🛒 TikTok Chốt Đơn Live

Phần mềm chốt đơn realtime cho người bán hàng livestream TikTok.  
Chạy trên máy tính cá nhân, in bình luận ra máy in nhiệt, lưu danh sách khách hàng tự động.

---

## ✅ Yêu cầu hệ thống

| Phần mềm | Phiên bản | Kiểm tra |
|----------|-----------|----------|
| Node.js | v18 trở lên | `node -v` |
| npm | v8 trở lên | `npm -v` |
| Windows | 10/11 | — |
| Máy in nhiệt | Đã cài driver | Xem trong Printers |
| MongoDB Atlas | Free tier trở lên | atlas.mongodb.com |

---

## 🚀 Cài đặt lần đầu

```bash
# 1. Clone hoặc tải project về
cd tiktok-chot-don

# 2. Cài thư viện
npm install

# 3. Tạo file cấu hình
cp .env.example .env
```

Mở file `.env` và chỉnh sửa:
```
MONGODB_URI=mongodb+srv://<user>:<password>@cluster.mongodb.net/tiktok-chot-don
SHOP_NAME=TÊN SHOP CỦA BẠN
PRINTER_NAME=POS-80
PRINTER_WIDTH=80
```

> **Lấy MongoDB URI:** Vào MongoDB Atlas → Cluster → Connect → Drivers → Copy connection string

> **Tìm tên máy in:** Vào Control Panel → Devices and Printers → chuột phải máy in → xem tên hiển thị

---

## ▶️ Chạy phần mềm

```bash
# Production
npm start

# Development (auto-reload)
npm run dev
```

Mở trình duyệt vào: **http://localhost:3000**

---

## 📖 Hướng dẫn sử dụng

1. **Nhập username TikTok** của bạn vào ô kết nối (ví dụ: `@shopxyz`)
2. Bấm **"Kết nối Live"** — chờ thông báo kết nối thành công
3. Bình luận từ TikTok Live sẽ hiện realtime bên trái
4. Bấm nút **🖨️ In** trên bình luận bất kỳ để in ra máy in
5. Bình luận đã in sẽ tự động lưu vào **Danh sách chốt đơn** bên phải
6. Xem tổng hợp từng khách ở tab **Khách hàng**

---

## 🗂️ Cấu trúc thư mục

```
tiktok-chot-don/
├── CLAUDE.md              ← Context cho AI (Cursor/Windsurf)
├── README.md              ← File này
├── .env                   ← Cấu hình (tạo từ .env.example)
├── .env.example           ← Mẫu cấu hình
├── .gitignore
├── package.json
│
├── backend/
│   ├── server.js          ← Entry point Express + Socket.io
│   ├── src/
│   │   ├── tiktok.js      ← Kết nối TikTok Live Connector
│   │   ├── printer.js     ← Máy in nhiệt node-thermal-printer
│   │   └── database.js    ← MongoDB Atlas với Mongoose
│   └── models/
│       ├── Comment.js     ← Mongoose model bình luận
│       ├── Customer.js    ← Mongoose model khách hàng
│       └── Session.js     ← Mongoose model phiên live
│
└── frontend/
    ├── index.html         ← Giao diện web
    ├── style.css          ← CSS
    └── app.js             ← JavaScript client
```

---

## ❓ Xử lý lỗi thường gặp

**Không kết nối được TikTok Live:**
- Kiểm tra bạn đang live thật trên TikTok
- Kiểm tra username nhập đúng chưa (có thể bỏ dấu @)
- TikTok đôi khi rate limit — chờ vài phút rồi thử lại

**Máy in không in:**
- Kiểm tra tên máy in trong `.env` có đúng không
- Đảm bảo máy in đang bật và có giấy
- Thử in thử từ Notepad để kiểm tra driver

**Lỗi kết nối MongoDB:**
- Kiểm tra `MONGODB_URI` trong `.env` đúng chưa
- Kiểm tra IP của bạn đã được whitelist trong MongoDB Atlas Network Access
- Đảm bảo username/password trong URI đúng

**Lỗi port 3000 đã dùng:**
- Đổi `PORT=3001` trong `.env`
- Hoặc tắt ứng dụng đang dùng port 3000

---

## 📞 Phiếu in mẫu

```
================================
      SHOP CỦA BẠN
      CHỐT ĐƠN TIKTOK LIVE
================================
ID     : 123456789
User   : @khachhang_abc
Bình luận: mua 2 cái áo đỏ size M
Thời gian: 09/05/2026 20:35:12
================================
```
