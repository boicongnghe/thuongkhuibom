import { NavLink } from 'react-router-dom';

const Icon = {
  live: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>,
  orders: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="12" y2="16"/></svg>,
  customers: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  stats: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
  printer: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>,
  settings: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
  logout: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>,
};

// Livestream lên đầu (dùng nhiều nhất); Dashboard đã gộp vào Thống kê.
// desktopOnly: trên điện thoại ẩn khỏi thanh dưới đáy (vào qua trang Cài đặt) để còn 5 nút dễ bấm.
const NAV_SECTIONS = [
  {
    label: 'BÁN HÀNG',
    items: [
      { to: '/livestream', label: 'Livestream', icon: Icon.live },
      { to: '/orders',     label: 'Đơn hàng',   icon: Icon.orders },
      { to: '/customers',  label: 'Khách hàng', icon: Icon.customers },
    ],
  },
  {
    label: 'BÁO CÁO',
    items: [
      { to: '/stats', label: 'Thống kê', icon: Icon.stats },
    ],
  },
  {
    label: 'HỆ THỐNG',
    items: [
      { to: '/printer',  label: 'Máy in',  icon: Icon.printer, desktopOnly: true },
      { to: '/settings', label: 'Cài đặt', icon: Icon.settings },
    ],
  },
];

export default function Sidebar({ user, onLogout }) {
  return (
    <nav className="sidebar" aria-label="Điều hướng chính">
      <div className="sidebar-brand">
        <div className="sidebar-brand-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        </div>
        <div>
          <div className="sidebar-brand-text">Chốt Đơn Live</div>
          <div className="sidebar-brand-sub">{user?.shopName || 'TikTok Commerce'}</div>
        </div>
      </div>

      <div className="sidebar-nav">
        {NAV_SECTIONS.map(section => (
          <div key={section.label} className="sidebar-section">
            <div className="sidebar-section-label">{section.label}</div>
            <div className="sidebar-section-items">
              {section.items.map(item => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) => `nav-item${isActive ? ' active' : ''}${item.desktopOnly ? ' nav-desktop-only' : ''}`}
                >
                  <span className="nav-icon" aria-hidden="true">{item.icon}</span>
                  <span className="nav-label">{item.label}</span>
                </NavLink>
              ))}
            </div>
          </div>
        ))}
        <div className="sidebar-section nav-desktop-only">
          <div className="sidebar-section-items">
            <button type="button" className="nav-item nav-logout" onClick={onLogout} title={user ? `Đăng xuất @${user.username}` : 'Đăng xuất'}>
              <span className="nav-icon">{Icon.logout}</span>
              <span className="nav-label">Đăng xuất</span>
            </button>
          </div>
        </div>
      </div>

      <div className="sidebar-footer">
        <span>{user ? `@${user.username}` : 'Chốt Đơn Live'}</span>
        <span>v1.0</span>
      </div>
    </nav>
  );
}
