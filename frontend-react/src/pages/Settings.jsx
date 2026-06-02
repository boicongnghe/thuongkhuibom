import { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';

const TABS = [
  { key: 'store',  label: '🏪 Thông tin cửa hàng' },
  { key: 'system', label: '⚙️ Cấu hình hệ thống'  },
];

const STORE_FIELDS = [
  { name: 'storeName',      label: 'Tên cửa hàng',       type: 'text',  ph: 'Nhập tên cửa hàng' },
  { name: 'storeId',        label: 'ID cửa hàng',         type: 'text',  ph: 'Nhập ID cửa hàng' },
  { name: 'owner',          label: 'Chủ sở hữu',          type: 'text',  ph: 'Nhập tên chủ sở hữu' },
  { name: 'phone',          label: 'Số điện thoại',       type: 'tel',   ph: 'Nhập số điện thoại' },
  { name: 'email',          label: 'Email',               type: 'email', ph: 'Nhập địa chỉ email' },
  { name: 'tiktokUsername', label: 'TikTok Username',     type: 'text',  ph: '@tiktok_username' },
  { name: 'address',        label: 'Địa chỉ',             type: 'text',  ph: 'Nhập địa chỉ cửa hàng', full: true },
];

export default function Settings() {
  const { settings, saveSettings, isConnected, showToast } = useApp();

  const [activeTab, setActiveTab]   = useState('store');
  const [editing, setEditing]       = useState(false);
  const [storeForm, setStoreForm]   = useState({});
  const [snapshot, setSnapshot]     = useState({});
  const [saving, setSaving]         = useState(false);

  // System config state
  const [autoDeposit, setAutoDeposit]     = useState(false);
  const [timezone, setTimezone]           = useState('Asia/Ho_Chi_Minh');
  const [currency, setCurrency]           = useState('VND');
  const [orderPrefix, setOrderPrefix]     = useState('ORD');
  const [savingSystem, setSavingSystem]   = useState(false);

  useEffect(() => {
    if (!settings) return;
    const si = settings.storeInfo || {};
    setStoreForm(si);
    setAutoDeposit(!!settings.system?.autoConfirmDeposit);
    setTimezone(settings.system?.timezone || 'Asia/Ho_Chi_Minh');
    setCurrency(settings.system?.currency || 'VND');
    setOrderPrefix(settings.system?.orderPrefix || 'ORD');
  }, [settings]);

  function startEdit() {
    setSnapshot({ ...storeForm });
    setEditing(true);
  }

  function cancelEdit() {
    setStoreForm({ ...snapshot });
    setEditing(false);
  }

  async function saveStore(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await saveSettings({ storeInfo: storeForm });
      showToast('Đã lưu thông tin cửa hàng', 'success');
      setEditing(false);
    } catch (err) {
      showToast(`Lỗi: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleAutoDeposit(v) {
    setAutoDeposit(v);
    try {
      await saveSettings({ system: { autoConfirmDeposit: v } });
      showToast(v ? 'Đã bật tự động xác nhận cọc' : 'Đã tắt tự động xác nhận cọc', 'info');
    } catch (err) {
      setAutoDeposit(!v);
      showToast(`Lỗi: ${err.message}`, 'error');
    }
  }

  async function saveSystem() {
    setSavingSystem(true);
    try {
      await saveSettings({ system: { autoConfirmDeposit: autoDeposit, timezone, currency, orderPrefix: orderPrefix.toUpperCase() || 'ORD' } });
      showToast('Đã lưu cài đặt hệ thống', 'success');
    } catch (err) {
      showToast(`Lỗi: ${err.message}`, 'error');
    } finally {
      setSavingSystem(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>

      {/* Header */}
      <div className="page-header">
        <h1 className="page-title">Cài đặt</h1>
      </div>

      {/* Tabs */}
      <div className="settings-tabs">
        {TABS.map(t => (
          <button key={t.key} className={`settings-tab${activeTab === t.key ? ' active' : ''}`} onClick={() => setActiveTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab: Store info */}
      {activeTab === 'store' && (
        <div className="settings-tab-content active">
          <div className="settings-scroll">
            <div className="settings-card">
              <div className="settings-card-head">
                <div className="settings-card-title-group">
                  <span className="settings-card-icon">🏪</span>
                  <h2 className="settings-card-title">Thông tin cửa hàng</h2>
                </div>
                {!editing
                  ? <button className="btn-edit" onClick={startEdit}>Chỉnh sửa</button>
                  : <button className="btn-edit editing">Đang chỉnh sửa</button>
                }
              </div>
              <div className="settings-card-body">
                <form onSubmit={saveStore}>
                  <div className="form-grid">
                    {STORE_FIELDS.map(f => (
                      <div key={f.name} className={`form-group${f.full ? ' form-group-full' : ''}`}>
                        <label className="form-label">{f.label}</label>
                        <input
                          type={f.type}
                          className="form-input"
                          placeholder={f.ph}
                          disabled={!editing}
                          value={storeForm[f.name] || ''}
                          onChange={e => setStoreForm(p => ({ ...p, [f.name]: e.target.value }))}
                        />
                      </div>
                    ))}
                    <div className="form-group form-group-full">
                      <label className="form-label">Trạng thái kết nối TikTok</label>
                      <div className="tiktok-shop-status">
                        <span className={`status-dot ${isConnected ? 'status-on' : 'status-off'}`} />
                        <span>{isConnected ? 'Đang kết nối' : 'Chưa kết nối'}</span>
                      </div>
                    </div>
                  </div>
                  {editing && (
                    <div className="form-actions">
                      <button type="button" className="btn-cancel" onClick={cancelEdit}>Hủy</button>
                      <button type="submit" className="btn-save-store" disabled={saving}>
                        {saving ? 'Đang lưu...' : 'Lưu thay đổi'}
                      </button>
                    </div>
                  )}
                </form>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab: System config */}
      {activeTab === 'system' && (
        <div className="settings-tab-content active">
          <div className="settings-scroll">
            <div className="settings-card">
              <div className="settings-card-head">
                <div className="settings-card-title-group">
                  <span className="settings-card-icon">⚙️</span>
                  <h2 className="settings-card-title">Cấu hình hệ thống</h2>
                </div>
              </div>
              <div className="settings-card-body">

                <div className="setting-section-label">Đơn hàng</div>
                <div className="setting-row">
                  <div className="setting-info">
                    <span className="setting-label">Tự động xác nhận đặt cọc</span>
                    <span className="setting-desc">Tự động chuyển trạng thái sang "Đặt cọc" khi tạo đơn</span>
                  </div>
                  <label className="toggle-switch">
                    <input type="checkbox" checked={autoDeposit} onChange={e => handleAutoDeposit(e.target.checked)} />
                    <span className="toggle-slider" />
                  </label>
                </div>

                <div className="settings-divider" />

                <div className="setting-section-label">Hiển thị</div>
                <div className="form-grid">
                  <div className="form-group">
                    <label className="form-label">Múi giờ</label>
                    <select className="form-input" value={timezone} onChange={e => setTimezone(e.target.value)}>
                      <option value="Asia/Ho_Chi_Minh">Asia/Ho_Chi_Minh (UTC+7)</option>
                      <option value="Asia/Bangkok">Asia/Bangkok (UTC+7)</option>
                      <option value="Asia/Singapore">Asia/Singapore (UTC+8)</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Tiền tệ</label>
                    <select className="form-input" value={currency} onChange={e => setCurrency(e.target.value)}>
                      <option value="VND">VND (₫)</option>
                      <option value="USD">USD ($)</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Tiền tố mã đơn</label>
                    <input type="text" className="form-input" placeholder="ORD" maxLength={10}
                      value={orderPrefix} onChange={e => setOrderPrefix(e.target.value)} />
                  </div>
                </div>

                <div className="form-actions" style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                  <button className="btn-save-store" onClick={saveSystem} disabled={savingSystem}>
                    {savingSystem ? 'Đang lưu...' : 'Lưu cài đặt hệ thống'}
                  </button>
                </div>

              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
