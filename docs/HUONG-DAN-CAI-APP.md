# Hướng dẫn cài app Chốt Đơn Live

App giúp chốt đơn khi bán hàng TikTok Live: tự đọc bình luận, chốt đơn, in phiếu ra máy in nhiệt, thống kê đơn hàng. Cài trên **máy tính Windows có cắm máy in**.

## Cần chuẩn bị

- Máy tính **Windows 10/11 (64-bit)**, có mạng internet.
- **Máy in nhiệt** (khổ 58mm hoặc 80mm) đã cắm USB và **đã cài driver**: in thử được từ Windows là được.
- Một **database MongoDB Atlas miễn phí** của riêng shop bạn (làm theo mục 1 bên dưới, khoảng 5 phút).

## 1. Tạo database MongoDB Atlas (miễn phí)

1. Vào https://www.mongodb.com/cloud/atlas/register và đăng ký tài khoản.
2. Tạo cluster gói **M0 (Free)**, chọn vùng **Singapore**.
3. Mở **Database Access** → **Add New Database User** → đặt tên và **mật khẩu mạnh** (ít nhất 12 ký tự, có chữ và số). Ghi lại mật khẩu.
4. Mở **Network Access** → **Add IP Address** → **Allow access from anywhere** (`0.0.0.0/0`) → Confirm.
5. Quay lại trang cluster, bấm **Connect** → **Drivers** → copy chuỗi có dạng:
   `mongodb+srv://tenuser:<db_password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority`
6. Thay `<db_password>` bằng mật khẩu ở bước 3.

> ⚠️ Chuỗi này giống chìa khoá nhà: ai có nó là xem và xoá được toàn bộ đơn hàng của shop. **Không gửi cho người khác.**

## 2. Cài app

1. Chạy file **`ChotDonLive-Setup-1.0.0.exe`**.
2. Nếu Windows báo **"Windows protected your PC"**, bấm **More info** rồi **Run anyway**. Cảnh báo này hiện ra vì app chưa mua chữ ký số, app vẫn an toàn.
3. Chọn thư mục cài (để mặc định cũng được), bấm **Install**.

## 3. Cài đặt lần đầu

Mở app, màn hình cài đặt sẽ hiện ra:

1. Dán chuỗi MongoDB ở mục 1 vào ô **Chuỗi kết nối**, bấm **Kiểm tra kết nối**. Phải hiện **✓ Kết nối thành công**.
2. **Chọn máy in nhiệt** trong danh sách. Không thấy máy in thì cắm USB, bật máy in rồi bấm **Làm mới**.
3. Nhập **tên shop** (in trên phiếu), rồi bấm **Lưu và mở app**.
4. Ở tab **Đăng ký**, tạo tài khoản đăng nhập. Mỗi database chỉ tạo được **1 tài khoản**; sau đó chức năng đăng ký tự khoá.

## 4. Dùng hằng ngày

- **Livestream:** đang phát live thì nhập `@tên_tiktok` → **Kết nối Live**. Bình luận có mã sản phẩm hoặc số điện thoại sẽ hiện nút **In đơn**.
- **Nhập tiền nhanh:** ở cột "Đã chốt", gõ `189k`, `1tr2` hoặc `250.000` rồi bấm Enter.
- **Bấm X để đóng cửa sổ:** app vẫn **chạy ngầm ở khay đồng hồ** (góc phải dưới màn hình), vẫn nhận bình luận và in đơn. Muốn tắt hẳn thì chuột phải biểu tượng → **Thoát**.
- **Tự chạy khi bật máy:** chuột phải biểu tượng ở khay → tích **Tự chạy khi bật máy**.
- **Dùng trên điện thoại cùng Wi-Fi:** chuột phải biểu tượng ở khay, copy địa chỉ dạng `http://192.168.x.x:3001`, rồi mở địa chỉ đó trên điện thoại. Lần đầu Windows có thể hỏi quyền tường lửa (Firewall), bấm **Allow**.
- **Đổi máy in / database:** chuột phải biểu tượng ở khay → **Cài đặt kết nối / máy in…**

## Lỗi thường gặp

| Thông báo | Cách xử lý |
|---|---|
| Sai tên đăng nhập hoặc mật khẩu database | Kiểm tra lại mật khẩu trong chuỗi kết nối (bước 1.6) |
| Không kết nối được tới MongoDB Atlas | Atlas → Network Access → thêm `0.0.0.0/0` (bước 1.4) |
| Cổng 3001 đang bị chương trình khác dùng | Tắt chương trình đang dùng cổng 3001, hoặc vào Cài đặt → Nâng cao → đổi cổng (ví dụ 3005) |
| Máy in "Chưa kết nối" | Bật máy in, cắm lại USB (nên cắm thẳng vào máy, không qua hub), thử cáp khác |

**Lưu ý:** mỗi shop chỉ nên chạy app trên **1 máy tại một thời điểm** (máy cắm máy in). Hai máy cùng kết nối Live vào một database có thể bị nhận trùng bình luận.
