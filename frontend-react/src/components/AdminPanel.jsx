import { useEffect, useState } from 'react';
import { api } from '../api';
import { formatDateTime } from '../utils';
import { useApp } from '../context/AppContext';

const STATUS_TEXT = { pending: 'Chờ duyệt', active: 'Đang hoạt động', rejected: 'Đã từ chối', disabled: 'Đã khoá' };

const CONFIRM = {
  approve: (u) => `Duyệt tài khoản @${u}? Shop này sẽ đăng nhập và dùng được ngay.`,
  reject:  (u) => `Từ chối yêu cầu của @${u}?`,
  disable: (u) => `Khoá tài khoản @${u}? Shop sẽ bị đăng xuất khỏi mọi thiết bị và không đăng nhập được nữa.`,
  enable:  (u) => `Mở khoá tài khoản @${u}?`,
};
const DONE = { approve: 'Đã duyệt', reject: 'Đã từ chối', disable: 'Đã khoá', enable: 'Đã mở khoá' };

// Quản trị dịch vụ (chỉ tài khoản đầu tiên): duyệt đăng ký, khoá shop, đặt link tải app
export default function AdminPanel({ onPendingChange }) {
  const { showToast } = useApp();
  const [shops, setShops]       = useState([]);
  const [busy, setBusy]         = useState(null);
  const [dl, setDl]             = useState({ url: '', version: '', note: '' });
  const [savingDl, setSavingDl] = useState(false);

  async function load() {
    try {
      const list = await api.getShops();
      setShops(list);
      onPendingChange?.(list.filter(s => s.status === 'pending').length);
    } catch (err) {
      showToast(`Lỗi tải danh sách shop: ${err.message}`, 'error');
    }
  }

  useEffect(() => {
    load();
    api.getDownload().then(d => setDl({ url: d.url || '', version: d.version || '', note: d.note || '' })).catch(() => {});
    const t = setInterval(load, 30000);   // có người mới đăng ký → tự hiện
    return () => clearInterval(t);
  }, []);

  async function act(username, action) {
    if (busy || !window.confirm(CONFIRM[action](username))) return;
    setBusy(username);
    try {
      await api.userAction(username, action);
      showToast(`${DONE[action]} @${username}`, 'success');
      load();
    } catch (err) {
      showToast(`Lỗi: ${err.message}`, 'error');
    } finally {
      setBusy(null);
    }
  }

  async function saveDownload(e) {
    e.preventDefault();
    if (savingDl) return;
    setSavingDl(true);
    try {
      const d = await api.setDownload(dl);
      setDl({ url: d.url, version: d.version, note: d.note });
      showToast(d.url ? 'Đã lưu link tải — nút "Tải app" trên trang chủ dùng link này' : 'Đã xoá link tải', 'success');
    } catch (err) {
      showToast(`Lỗi: ${err.message}`, 'error');
    } finally {
      setSavingDl(false);
    }
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      showToast('Đã copy', 'success');
    } catch {
      showToast('Không copy được, hãy bôi đen và copy tay', 'error');
    }
  }

  const pending = shops.filter(s => s.status === 'pending');
  const others  = shops.filter(s => s.status !== 'pending');
  const shareText = `Mời bạn dùng Chốt Đơn Live: ${window.location.origin}\n1. Bấm "Tải app cho máy tính", cài trên máy cắm máy in.\n2. Mở app, chọn máy in → Lưu.\n3. Bấm "Đăng ký", nhập tên shop + mật khẩu, rồi báo mình duyệt.`;

  return (
    <div className="settings-scroll">
      {/* Chờ duyệt */}
      <div className="settings-card">
        <div className="settings-card-head">
          <div className="settings-card-title-group">
            <span className="settings-card-icon">🕐</span>
            <h2 className="settings-card-title">Yêu cầu đăng ký chờ duyệt ({pending.length})</h2>
          </div>
          <button type="button" className="btn-edit" onClick={load}>Làm mới</button>
        </div>
        <div className="settings-card-body">
          {!pending.length
            ? <p className="form-hint">Chưa có yêu cầu nào. Gửi link trang cho shop mới, họ tự bấm Đăng ký, yêu cầu sẽ hiện ở đây.</p>
            : (
              <div className="approve-list">
                {pending.map(s => (
                  <div key={s.username} className="approve-item">
                    <div className="approve-info">
                      <div className="approve-name">{s.shopName || '(chưa đặt tên shop)'}</div>
                      <div className="approve-sub">
                        @{s.username}
                        {s.phone ? <> · <a href={`tel:${s.phone}`}>{s.phone}</a></> : ' · không để SĐT'}
                        {' · '}đăng ký {formatDateTime(s.createdAt)}
                      </div>
                    </div>
                    <div className="approve-actions">
                      <button type="button" className="btn-cancel" disabled={busy === s.username} onClick={() => act(s.username, 'reject')}>Từ chối</button>
                      <button type="button" className="btn-save-store" disabled={busy === s.username} onClick={() => act(s.username, 'approve')}>
                        {busy === s.username ? 'Đang xử lý...' : '✓ Duyệt'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          <div className="settings-divider" />
          <div className="setting-section-label">Tin nhắn mời shop (gửi qua Zalo / Messenger)</div>
          <textarea className="form-input" readOnly rows={4} value={shareText} aria-label="Tin nhắn mời shop" />
          <div className="form-actions">
            <button type="button" className="btn-save-store" onClick={() => copy(shareText)}>Copy tin nhắn</button>
          </div>
        </div>
      </div>

      {/* Các shop */}
      <div className="settings-card">
        <div className="settings-card-head">
          <div className="settings-card-title-group">
            <span className="settings-card-icon">🏪</span>
            <h2 className="settings-card-title">Các shop ({others.length})</h2>
          </div>
        </div>
        <div className="settings-card-body">
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr><th>Shop</th><th>Trạng thái</th><th>Số đơn</th><th>App ở shop</th><th>Đăng nhập gần nhất</th><th></th></tr></thead>
              <tbody>
                {others.map(s => (
                  <tr key={s.username}>
                    <td>
                      <div className="table-name">{s.shopName || '—'}</div>
                      <div className="table-sub">@{s.username}{s.isAdmin ? ' (quản trị)' : ''}{s.phone ? ` · ${s.phone}` : ''}</div>
                    </td>
                    <td>{STATUS_TEXT[s.status] || s.status}</td>
                    <td>{s.orders}</td>
                    <td>{s.appVersion ? `v${s.appVersion}` : '—'}{s.appSeenAt ? <div className="table-sub">{formatDateTime(s.appSeenAt)}</div> : null}</td>
                    <td>{s.lastLoginAt ? formatDateTime(s.lastLoginAt) : '—'}</td>
                    <td className="actions-cell">
                      {!s.isAdmin && s.status === 'active'   && <button type="button" className="btn-status-change" disabled={busy === s.username} onClick={() => act(s.username, 'disable')}>Khoá</button>}
                      {!s.isAdmin && s.status === 'disabled' && <button type="button" className="btn-status-change" disabled={busy === s.username} onClick={() => act(s.username, 'enable')}>Mở khoá</button>}
                      {!s.isAdmin && s.status === 'rejected' && <button type="button" className="btn-status-change" disabled={busy === s.username} onClick={() => act(s.username, 'approve')}>Duyệt lại</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Link tải app */}
      <div className="settings-card">
        <div className="settings-card-head">
          <div className="settings-card-title-group">
            <span className="settings-card-icon">⬇️</span>
            <h2 className="settings-card-title">Link tải app cho máy tính</h2>
          </div>
        </div>
        <div className="settings-card-body">
          <p className="form-hint" style={{ marginBottom: 12 }}>
            Tải file <code>ChotDonLive-Setup-….exe</code> lên Google Drive (Chia sẻ → Bất kỳ ai có đường liên kết), rồi dán link vào đây.
            Nút "Tải app" trên trang chủ <b>{window.location.origin}</b> sẽ dẫn tới link này. Có bản mới thì chỉ cần dán link mới.
          </p>
          <form onSubmit={saveDownload} className="form-grid">
            <div className="form-group form-group-full">
              <label className="form-label" htmlFor="dl-url">Link tải (https://…)</label>
              <input id="dl-url" type="url" className="form-input" maxLength={1000} placeholder="https://drive.google.com/file/d/…/view"
                value={dl.url} onChange={e => setDl(p => ({ ...p, url: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="dl-ver">Phiên bản</label>
              <input id="dl-ver" className="form-input" maxLength={30} placeholder="1.0.0"
                value={dl.version} onChange={e => setDl(p => ({ ...p, version: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="dl-note">Ghi chú (hiện dưới nút tải)</label>
              <input id="dl-note" className="form-input" maxLength={300} placeholder="vd: Bản mới sửa lỗi in"
                value={dl.note} onChange={e => setDl(p => ({ ...p, note: e.target.value }))} />
            </div>
            <div className="form-group form-group-full">
              <button type="submit" className="btn-save-store" disabled={savingDl}>{savingDl ? 'Đang lưu...' : 'Lưu link tải'}</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
