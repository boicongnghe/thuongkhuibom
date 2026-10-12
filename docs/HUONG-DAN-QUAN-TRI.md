# Hướng dẫn quản trị dịch vụ Chốt Đơn Live (dành cho người vận hành)

## Kiến trúc

```
Dịch vụ trung tâm (Vercel + MongoDB Atlas của bạn)
  ├─ Giao diện web + API (api/index.js → backend/app.js)
  └─ Mỗi shop 1 tài khoản, mọi dữ liệu lọc theo shopId

App desktop ở mỗi shop (desktop/, Electron)
  ├─ Mở trang dịch vụ, đăng nhập bằng tài khoản shop
  ├─ Kết nối TikTok Live, gửi bình luận lên API
  ├─ Nhận việc in từ hàng đợi của shop → in ra máy in USB
  └─ KHÔNG chứa chuỗi database hay khoá bí mật nào
```

## 1. Cấu hình Vercel (1 lần)

1. **Settings → Environment Variables:** đặt `MONGODB_URI` và `JWT_SECRET`, lấy giá trị từ file `.env`. **Không** dùng tiền tố `VITE_`.
2. **MongoDB Atlas → Network Access:** thêm `0.0.0.0/0`, vì Vercel không có IP cố định. Dùng **mật khẩu database mạnh**.
3. Redeploy. Ở lần chạy đầu tiên, dịch vụ **tự chuyển dữ liệu cũ** sang dạng nhiều shop: tài khoản cũ thành **quản trị**, toàn bộ đơn, khách và cài đặt cũ được gán cho shop của bạn.
4. ⚠️ Gói Vercel **Hobby (miễn phí) chỉ dành cho mục đích phi thương mại**. Nếu thu phí các shop, bạn cần gói **Pro**. Hãy xem điều khoản hiện hành của Vercel.

## 2. Build app desktop có sẵn địa chỉ dịch vụ

1. Mở `desktop/defaults.json`, điền địa chỉ Vercel:
   ```json
   { "centralUrl": "https://ten-du-an.vercel.app" }
   ```
2. Tăng `"version"` trong `package.json` mỗi khi ra bản mới.
3. Build:
   ```powershell
   npx electron-builder --win --x64
   ```
   File cài nằm ở `release\ChotDonLive-Setup-<version>.exe`.

Nếu để `centralUrl` trống, shop sẽ phải tự gõ địa chỉ ở lần mở app đầu tiên.

## 3. Thêm shop mới (duyệt đăng ký)

1. Gửi cho shop link trang của bạn. Trong **Cài đặt → 👑 Quản trị dịch vụ** có sẵn **tin nhắn mời** để copy.
2. Shop tự bấm **Đăng ký**, nhập tên shop, số điện thoại, tên đăng nhập và mật khẩu. Tài khoản ở trạng thái **Chờ duyệt**, chưa đăng nhập được.
3. Vào **Cài đặt → 👑 Quản trị dịch vụ**. Tên tab hiện số yêu cầu đang chờ. Gọi số điện thoại để xác nhận nếu cần, rồi bấm **✓ Duyệt** hoặc **Từ chối**.
4. Ở mục **Các shop**: bấm **Khoá** để chặn ngay một shop (shop bị đăng xuất khỏi mọi thiết bị), bấm **Mở khoá** để cho dùng lại.

Danh sách shop cho biết số đơn của từng shop và lần đăng nhập gần nhất.

## 4. Vận hành

- **Kiểm tra dữ liệu:** chạy `node scripts/check-orders.js` (chỉ đọc). Có lỗi thì chạy thêm `--fix`.
- **Chạy thử ở máy:** `npm run dev` (API + giao diện ở http://localhost:5173).
  Muốn thử app desktop trỏ vào máy: `$env:CHOTDON_CENTRAL_URL="http://localhost:5173"; npm run desktop`.
- **Dung lượng:** Atlas M0 có 512 MB cho mọi shop cộng lại. Khi gần đầy thì nâng gói.
- **Lưu lượng:** trong lúc live, mỗi thiết bị hỏi dịch vụ khoảng 2–3 giây một lần. Nhiều shop live cùng lúc thì theo dõi giới hạn của Vercel và Atlas.
