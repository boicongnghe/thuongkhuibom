import { useEffect, useState } from 'react';
import { api } from '../api';
import './HomePage.css';

const FEATURES = [
  { icon: '💬', title: 'Đọc bình luận Live', text: 'Nhận bình luận TikTok Live theo thời gian thực, không sót khách nào.' },
  { icon: '🖨️', title: 'In phiếu 1 chạm', text: 'Bấm "In đơn" là máy in nhiệt in phiếu. Tự in khi khách bình luận "chốt", mã sản phẩm, số điện thoại.' },
  { icon: '📱', title: 'Dùng trên điện thoại', text: 'Nhân viên chốt đơn trên điện thoại, phiếu vẫn in ra máy in ở shop.' },
  { icon: '📊', title: 'Thống kê ngay', text: 'Tổng đơn, tổng tiền, còn phải thu, khách mua nhiều — cập nhật ngay khi chốt.' },
];

const STEPS = [
  { title: 'Tải app cho máy tính', text: 'Cài trên máy tính Windows có cắm máy in nhiệt.' },
  { title: 'Chọn máy in', text: 'Mở app, chọn máy in trong danh sách, bấm Lưu.' },
  { title: 'Đăng ký bằng mã mời', text: 'Nhập mã mời được gửi cho bạn, đặt tên đăng nhập và mật khẩu.' },
];

// Trang chủ (chưa đăng nhập): giới thiệu + nút tải app + đăng nhập
export default function HomePage({ onLogin }) {
  const [download, setDownload] = useState(null);
  const [isWindows] = useState(() => /Windows/i.test(navigator.userAgent));

  useEffect(() => {
    api.getDownload().then(setDownload).catch(() => setDownload({ url: '' }));
  }, []);

  const hasUrl = !!download?.url;

  return (
    <div className="home">
      <header className="home-top">
        <div className="home-brand">
          <span className="home-logo" aria-hidden="true">✓</span>
          <span>Chốt Đơn Live</span>
        </div>
        <button type="button" className="home-btn home-btn-ghost" onClick={onLogin}>Đăng nhập</button>
      </header>

      <main>
        <section className="home-hero">
          <h1>Chốt đơn TikTok Live<br />nhanh, không sót đơn</h1>
          <p className="home-lead">
            Tự đọc bình luận, chốt đơn và in phiếu ra máy in nhiệt. Dùng trên máy tính và điện thoại.
          </p>
          <div className="home-cta">
            {hasUrl ? (
              <a className="home-btn home-btn-primary" href={download.url} target="_blank" rel="noopener noreferrer">
                ⬇ Tải app cho máy tính (Windows){download.version ? ` · ${download.version}` : ''}
              </a>
            ) : (
              <span className="home-btn home-btn-disabled" aria-disabled="true">
                ⬇ App cho máy tính: liên hệ người cung cấp để nhận file cài
              </span>
            )}
            <button type="button" className="home-btn home-btn-ghost" onClick={onLogin}>Đăng nhập / Đăng ký</button>
          </div>
          <p className="home-hint">
            {isWindows
              ? 'Windows có thể báo "Windows protected your PC": bấm More info → Run anyway.'
              : 'Đang dùng điện thoại? Bấm "Đăng nhập" để dùng ngay trên trình duyệt. App chỉ cần cài trên máy tính cắm máy in.'}
            {download?.note ? ` ${download.note}` : ''}
          </p>
        </section>

        <section className="home-section" aria-labelledby="home-features">
          <h2 id="home-features">Làm được gì</h2>
          <div className="home-grid">
            {FEATURES.map(f => (
              <article key={f.title} className="home-card">
                <div className="home-card-icon" aria-hidden="true">{f.icon}</div>
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="home-section" aria-labelledby="home-steps">
          <h2 id="home-steps">Bắt đầu trong 3 bước</h2>
          <ol className="home-steps">
            {STEPS.map((s, i) => (
              <li key={s.title}>
                <span className="home-step-num" aria-hidden="true">{i + 1}</span>
                <div>
                  <h3>{s.title}</h3>
                  <p>{s.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </main>

      <footer className="home-foot">Chốt Đơn Live · Hỗ trợ bán hàng TikTok Live</footer>
    </div>
  );
}
