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

## 2. Ra bản app desktop mới (các shop tự cập nhật)

Phần lớn thay đổi (giao diện, thống kê, dồn đơn...) nằm trên web: **push code là mọi shop có ngay**, không cần app mới.
Chỉ khi sửa phần chạy trong máy (`desktop/`, `backend/src/tiktok.js`, `backend/src/printer.js`) mới cần ra bản app mới.

**Chuẩn bị 1 lần:**
1. Trên GitHub, tạo repo **công khai** `boicongnghe/chotdon-releases`. Repo này để trống, chỉ dùng để chứa file cài. Code chính vẫn để riêng tư.
2. Tạo token: GitHub → Settings → Developer settings → **Fine-grained tokens** → chọn repo `chotdon-releases` → quyền **Contents: Read and write**. Lưu token ở chỗ an toàn, **không** đưa vào code.
3. Ở **Quản trị dịch vụ → Link tải app**, đặt link cố định (từ đó về sau không phải đổi nữa):
   `https://github.com/boicongnghe/chotdon-releases/releases/latest/download/ChotDonLive-Setup.exe`

**Mỗi lần ra bản mới:**
1. Tăng `"version"` trong `package.json` (ví dụ `1.0.3` → `1.0.4`).
2. Chạy:
   ```powershell
   $env:GH_TOKEN = "token_cua_ban"
   npm run release:win
   ```
   Lệnh này build file cài và **đăng lên GitHub Releases** (kèm `latest.yml` để app tự cập nhật).
3. Xong. App ở các shop tự kiểm tra cập nhật khi mở và cứ 4 tiếng một lần, rồi **tải ngầm**. Tải xong thì:
   - **Không** đang Live: hỏi "Khởi động lại để cập nhật?".
   - **Đang** Live: không làm phiền, tự cập nhật khi tắt app. Trên menu khay cũng có nút **⬆ Cập nhật lên bản …**.
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
