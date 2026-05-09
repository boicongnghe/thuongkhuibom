# CLAUDE.md — TikTok Chốt Đơn Live

## Mục đích dự án
Phần mềm web chạy local giúp người bán hàng live TikTok:
- Nhận bình luận realtime từ TikTok Live
- In bình luận ra máy in nhiệt (thermal printer) bằng 1 click
- Lưu danh sách khách đã chốt đơn, tổng hợp số đơn
- Chạy hoàn toàn trên máy tính cá nhân (localhost:3000)

## Tech Stack
- **Runtime**: Node.js v18+
- **Backend**: Express.js + Socket.io
- **TikTok**: tiktok-live-connector (WebcastPushConnection)
- **Database**: MongoDB Atlas với Mongoose (cloud, miễn phí tier)
- **Máy in**: node-thermal-printer (khổ 80mm mặc định)
- **Frontend**: Vanilla HTML/CSS/JS + Socket.io client (không dùng framework)

## Cấu trúc thư mục
```
tiktok-chot-don/
├── CLAUDE.md              ← File này (AI context)
├── README.md              ← Hướng dẫn cài đặt & sử dụng
├── .env.example           ← Biến môi trường mẫu
├── .gitignore
├── package.json
│
├── backend/
│   ├── server.js          ← Entry point, Express + Socket.io
│   ├── src/
│   │   ├── tiktok.js      ← Kết nối TikTok Live Connector
│   │   ├── printer.js     ← Xử lý in máy in nhiệt
│   │   └── database.js    ← MongoDB Atlas qua Mongoose
│   └── models/
│       ├── Comment.js     ← Mongoose model bình luận
│       ├── Customer.js    ← Mongoose model khách hàng
│       └── Session.js     ← Mongoose model phiên live
│
└── frontend/
    ├── index.html         ← Giao diện chính (single page)
    ├── style.css          ← CSS tách riêng
    └── app.js             ← JS client, socket.io, UI logic
```

## Quy tắc code

### Chung
- Dùng ES Modules (`import/export`) cho frontend, CommonJS (`require`) cho Node.js backend
- Async/await hoàn toàn, không dùng callback lồng nhau
- Tất cả lỗi phải được try/catch và log rõ ràng
- Comment tiếng Việt cho business logic, tiếng Anh cho code thuần kỹ thuật

### Backend (backend/)
- Mỗi file chỉ 1 trách nhiệm (Single Responsibility)
- Không hardcode config — dùng `.env` qua `process.env`
- Socket.io emit events phải đặt tên rõ: `comment:new`, `order:saved`, `printer:status`
- Database queries tách hẳn vào `backend/src/database.js`
- Tất cả hàm database là async/await (Mongoose trả về Promise)

### Frontend (frontend/)
- Không dùng React/Vue — Vanilla JS thuần
- Dùng `socket.on(event, handler)` để nhận realtime
- CSS dùng CSS Variables cho màu sắc và spacing
- Không dùng jQuery

## Socket.io Events

### Server → Client (emit)
| Event | Payload | Mô tả |
|-------|---------|-------|
| `comment:new` | `{id, tiktokUserId, username, displayName, comment, timestamp}` | Bình luận mới từ TikTok |
| `order:saved` | `{commentId, username, totalOrders}` | Đơn vừa lưu thành công |
| `printer:status` | `{status, message}` | Trạng thái máy in |
| `tiktok:status` | `{connected, username}` | Trạng thái kết nối TikTok |
| `tiktok:error` | `{message}` | Lỗi TikTok |

### Client → Server (on)
| Event | Payload | Mô tả |
|-------|---------|-------|
| `print:comment` | `{commentId}` | Yêu cầu in 1 bình luận |
| `tiktok:connect` | `{username}` | Kết nối vào live TikTok |
| `tiktok:disconnect` | - | Ngắt kết nối TikTok |

## Database Schema (MongoDB / Mongoose)

```js
// Comment
{ tiktokUserId, username, displayName, comment, printed, sessionId, timestamp }

// Customer
{ tiktokUserId, username, totalComments, totalOrders, firstSeen, lastSeen }

// Session
{ tiktokUsername, startedAt, endedAt }
```

## Biến môi trường (.env)
```
PORT=3000
MONGODB_URI=mongodb+srv://<user>:<password>@cluster.mongodb.net/tiktok-chot-don
PRINTER_NAME=POS-80          # Tên máy in trong Windows
PRINTER_WIDTH=80             # Khổ giấy mm (57 hoặc 80)
SHOP_NAME=SHOP CỦA BẠN      # Hiển thị trên phiếu in
```

## Luồng dữ liệu chính
```
1. User nhập @username TikTok → client emit tiktok:connect
2. backend/server.js → backend/src/tiktok.js → WebcastPushConnection.connect()
3. TikTok chat event → backend/src/database.js → lưu Comment + upsert Customer
4. server.js emit comment:new → tất cả client nhận
5. User bấm IN → client emit print:comment {commentId}
6. server.js → backend/src/printer.js → in ra máy in nhiệt
7. Cập nhật Comment.printed = true, Customer.totalOrders += 1
8. emit order:saved → cập nhật UI danh sách chốt đơn
```

## Lưu ý quan trọng
- TikTok Live Connector hoạt động dựa trên reverse-engineer, có thể bị rate limit
- Phải đang có phiên live thật trên TikTok thì mới kết nối được
- Máy in phải được cài driver và hiện trong danh sách máy in Windows
- MongoDB Atlas free tier (M0) đủ dùng cho shop nhỏ; cần whitelist IP trong Network Access
- Mongoose tự tạo collections, không cần tạo thủ công
