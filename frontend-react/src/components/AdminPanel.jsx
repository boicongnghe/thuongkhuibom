import { useEffect, useState } from 'react';
import { api } from '../api';
import { formatDate, formatDateTime } from '../utils';
import { useApp } from '../context/AppContext';

const STATUS_TEXT = { active: 'Còn hiệu lực', used: 'Đã dùng', expired: 'Hết hạn', revoked: 'Đã thu hồi' };

// Quản trị dịch vụ (chỉ tài khoản đầu tiên): tạo mã mời cho shop mới, xem các shop
export default function AdminPanel() {
  const { showToast } = useApp();
  const [invites, setInvites]   = useState([]);
  const [shops, setShops]       = useState([]);
  const [note, setNote]         = useState('');
  const [days, setDays]         = useState(7);
  const [creating, setCreating] = useState(false);
  const [newCode, setNewCode]   = useState(null);
  const [dl, setDl]             = useState({ url: '', version: '', note: '' });
  const [savingDl, setSavingDl] = useState(false);

  async function load() {
    try {
      const [inv, sh] = await Promise.all([api.getInvites(), api.getShops()]);
      setInvites(inv);
      setShops(sh);
    } catch (err) {
      showToast(`Lỗi tải dữ liệu quản trị: ${err.message}`, 'error');
    }
  }

  useEffect(() => {
    load();
    api.getDownload().then(d => setDl({ url: d.url || '', version: d.version || '', note: d.note || '' })).catch(() => {});
  }, []);

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

  async function create(e) {
    e.preventDefault();
    if (creating) return;
    setCreating(true);
    try {
      const inv = await api.createInvite(note.trim(), Number(days));
      setNewCode(inv);
      setNote('');
      load();
    } catch (err) {
      showToast(`Lỗi: ${err.message}`, 'error');
    } finally {
      setCreating(false);
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

  async function revoke(code) {
    if (!window.confirm(`Thu hồi mã ${code}? Mã này sẽ không dùng được nữa.`)) return;
    try {
      await api.revokeInvite(code);
      showToast('Đã thu hồi mã', 'info');
      load();
    } catch (err) {
      showToast(`Lỗi: ${err.message}`, 'error');
    }
  }

  const shareText = newCode
    ? `Mời bạn dùng Chốt Đơn Live.\n1. Mở ${window.location.origin} → bấm "Tải app cho máy tính", cài trên máy cắm máy in.\n2. Mở app, chọn máy in → Lưu.\n3. Bấm "Đăng ký", nhập mã mời: ${newCode.code}\n(Mã dùng 1 lần, hết hạn ${formatDate(newCode.expiresAt)}. Điện thoại: đăng nhập tại ${window.location.origin})`
    : '';

  return (
    <div className="settings-scroll">
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

      <div className="settings-card">
        <div className="settings-card-head">
          <div className="settings-card-title-group">
            <span className="settings-card-icon">🎟️</span>
            <h2 className="settings-card-title">Mời shop mới</h2>
          </div>
        </div>
        <div className="settings-card-body">
          <form onSubmit={create} className="form-grid">
            <div className="form-group">
              <label className="form-label" htmlFor="inv-note">Ghi chú (tên shop)</label>
              <input id="inv-note" className="form-input" maxLength={200} placeholder="vd: Shop chị Lan"
                value={note} onChange={e => setNote(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="inv-days">Hết hạn sau</label>
              <select id="inv-days" className="form-input" value={days} onChange={e => setDays(e.target.value)}>
                <option value={1}>1 ngày</option>
                <option value={7}>7 ngày</option>
                <option value={30}>30 ngày</option>
              </select>
            </div>
            <div className="form-group form-group-full">
              <button type="submit" className="btn-save-store" disabled={creating}>
                {creating ? 'Đang tạo...' : '+ Tạo mã mời'}
              </button>
            </div>
          </form>

          {newCode && (
            <div className="invite-new" role="status">
              <div className="invite-code">{newCode.code}</div>
              <p className="form-hint">Gửi tin nhắn dưới đây cho shop (Zalo / Messenger). Mã dùng 1 lần.</p>
              <textarea className="form-input" readOnly rows={4} value={shareText} />
              <div className="form-actions">
                <button type="button" className="btn-cancel" onClick={() => copy(newCode.code)}>Copy mã</button>
                <button type="button" className="btn-save-store" onClick={() => copy(shareText)}>Copy tin nhắn</button>
              </div>
            </div>
          )}

          <div className="settings-divider" />
          <div className="setting-section-label">Mã đã tạo</div>
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr><th>Mã</th><th>Ghi chú</th><th>Trạng thái</th><th>Hết hạn</th><th></th></tr></thead>
              <tbody>
                {!invites.length
                  ? <tr><td colSpan={5} className="table-empty">Chưa có mã nào</td></tr>
                  : invites.map(i => (
                    <tr key={i.code}>
                      <td><code>{i.code}</code></td>
                      <td>{i.note || '—'}</td>
                      <td>{STATUS_TEXT[i.status]}{i.usedBy ? ` · @${i.usedBy}` : ''}</td>
                      <td>{formatDate(i.expiresAt)}</td>
                      <td>{i.status === 'active' && <button type="button" className="btn-status-change" onClick={() => revoke(i.code)}>Thu hồi</button>}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="settings-card">
        <div className="settings-card-head">
          <div className="settings-card-title-group">
            <span className="settings-card-icon">🏪</span>
            <h2 className="settings-card-title">Các shop đang dùng ({shops.length})</h2>
          </div>
        </div>
        <div className="settings-card-body">
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr><th>Tài khoản</th><th>Tên shop</th><th>Số đơn</th><th>Đăng ký</th><th>Đăng nhập gần nhất</th></tr></thead>
              <tbody>
                {shops.map(s => (
                  <tr key={s.username}>
                    <td>@{s.username}{s.isAdmin ? ' (quản trị)' : ''}</td>
                    <td>{s.shopName || '—'}</td>
                    <td>{s.orders}</td>
                    <td>{formatDate(s.createdAt)}</td>
                    <td>{s.lastLoginAt ? formatDateTime(s.lastLoginAt) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
