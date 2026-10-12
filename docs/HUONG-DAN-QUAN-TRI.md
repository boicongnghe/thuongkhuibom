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

## 2. Ra bản app desktop mới

Phần lớn thay đổi (giao diện, thống kê, dồn đơn...) nằm trên web: **push code là mọi shop có ngay**, không cần app mới.
Chỉ khi sửa phần chạy trong máy (`desktop/`, `backend/src/tiktok.js`, `backend/src/printer.js`) mới cần ra bản app mới:

1. Tăng `"version"` trong `package.json`.
2. Build: `npx electron-builder --win --x64` → file `releaseChotDonLive-Setup-<version>.exe`.
3. Tải file lên Google Drive, rồi thay link ở **Quản trị dịch vụ → Link tải app**. Báo các shop tải về và cài đè lên bản cũ; cấu hình và đăng nhập vẫn giữ nguyên.
4. Cột **App ở shop** trong danh sách shop cho biết shop nào đã lên bản mới.

Địa chỉ dịch vụ mặc định của app nằm ở `desktop/defaults.json` (hiện là `https://chotgo.vercel.app`).

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
