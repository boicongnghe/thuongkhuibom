import { useEffect, useState, useRef } from 'react';
import { api } from '../api';
import { formatCurrency, formatDateTime, getInitials } from '../utils';
import { STATUS_LABELS, STATUS_NEXT } from '../constants';
import StatusBadge from '../components/StatusBadge';
import Pagination from '../components/Pagination';
import Modal from '../components/Modal';
import { useApp } from '../context/AppContext';
import { isAgent, liveBus } from '../agent';

const STATUS_FILTERS = ['all', 'pending', 'deposit', 'confirmed', 'shipping', 'completed', 'cancelled'];
// Giống backend: đơn Hoàn thành / Đã huỷ không sửa được số tiền
const AMOUNT_LOCKED = ['completed', 'cancelled'];
const STATUS_FILTER_LABELS = {
  all: 'Tất cả', pending: 'Chờ xử lý', deposit: 'Đặt cọc',
  confirmed: 'Xác nhận', shipping: 'Đang giao', completed: 'Hoàn thành', cancelled: 'Đã hủy',
};

export default function Orders() {
  const { showToast } = useApp();
  const [data, setData]           = useState({ orders: [], total: 0, totalPages: 1 });
  const [page, setPage]           = useState(1);
  const [status, setStatus]       = useState('all');
  const [search, setSearch]       = useState('');
  const [searchInput, setSearchInput] = useState('');
  const searchTimer = useRef(null);

  // Amount modal
  const [amountModal, setAmountModal]     = useState(null); // { orderId, amount, depositAmount }
  const [amountVal, setAmountVal]         = useState(0);
  const [depositVal, setDepositVal]       = useState(0);
  const depositError = amountVal > 0 && depositVal > amountVal;

  // Create modal
  const [createModal, setCreateModal]     = useState(false);
  const [createForm, setCreateForm]       = useState({ username: '', displayName: '', tiktokUserId: '', note: '' });
  const [creating, setCreating]           = useState(false);
  const [savingAmount, setSavingAmount]   = useState(false);
  const [busyOrderId, setBusyOrderId]     = useState(null);

  async function load(p = page, s = status, q = search) {
    try {
      const res = await api.getOrders({ page: p, limit: 20, status: s, search: q });
      setData(res);
    } catch (err) {
      showToast(`Lỗi tải đơn hàng: ${err.message}`, 'error');
    }
  }

  useEffect(() => { load(); }, [page, status, search]);

  // Cập nhật thay đổi từ thiết bị khác: tự tải lại mỗi 10 giây và khi quay lại cửa sổ
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 10000);
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVisible); };
  }, [page, status, search]);

  // In / in lại phiếu: vào hàng đợi in, app desktop ở shop in ra
  async function printOrder(o) {
    if (busyOrderId) return;
    setBusyOrderId(o._id);
    try {
      await api.reprintOrder(o._id);
      if (isAgent) liveBus.emit('print-now');
      showToast(`Đã gửi lệnh in ${o.orderNumber}`, 'info');
      load();
    } catch (err) {
      showToast(`Lỗi: ${err.message}`, 'error');
    } finally {
      setBusyOrderId(null);
    }
  }

  function handleSearch(val) {
    setSearchInput(val);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setSearch(val.trim());
      setPage(1);
    }, 350);
  }

  async function changeStatus(orderId, newStatus) {
    if (busyOrderId) return;               // chặn bấm liên tục
    setBusyOrderId(orderId);
    try {
      await api.updateOrderStatus(orderId, newStatus);
      showToast(`Đã cập nhật: ${STATUS_LABELS[newStatus]?.label}`, 'success');
    } catch (err) {
      showToast(`Lỗi: ${err.message}`, 'error');
    } finally {
      setBusyOrderId(null);
      load();                              // luôn tải lại để thấy trạng thái thật
    }
  }

  function openAmount(o) {
    if (AMOUNT_LOCKED.includes(o.status)) {
      showToast('Đơn đã hoàn thành hoặc đã huỷ, không thể sửa số tiền', 'info');
      return;
    }
    setAmountModal({ orderId: o._id });
    setAmountVal(o.amount || 0);
    setDepositVal(o.depositAmount || 0);
  }

  async function saveAmount() {
    if (depositError) { showToast('Đặt cọc vượt quá tổng tiền', 'error'); return; }
    if (savingAmount) return;
    setSavingAmount(true);
    try {
      await api.updateOrderAmount(amountModal.orderId, { amount: amountVal, depositAmount: depositVal });
      showToast('Đã cập nhật số tiền', 'success');
      setAmountModal(null);
      load();
    } catch (err) {
      showToast(`Lỗi: ${err.message}`, 'error');
    } finally {
      setSavingAmount(false);
    }
  }

  async function submitCreate() {
    const u = createForm.username.trim().replace('@', '');
    if (!u) { showToast('Vui lòng nhập username', 'error'); return; }
    if (creating) return;                  // chặn bấm 2 lần → 2 đơn
    setCreating(true);
    try {
      const order = await api.createOrder({
        tiktokUserId: createForm.tiktokUserId.trim() || u,
        username: u,
        displayName: createForm.displayName.trim(),
        note: createForm.note.trim(),
      });
      showToast(`Đã tạo đơn ${order.orderNumber}`, 'success');
      setCreateModal(false);
      setCreateForm({ username: '', displayName: '', tiktokUserId: '', note: '' });
      load(1);
    } catch (err) {
      showToast(`Lỗi: ${err.message}`, 'error');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>

      {/* Header */}
      <div className="page-header">
        <h1 className="page-title">Đơn hàng</h1>
        <button className="btn btn-connect" style={{ fontSize: 13, padding: '8px 16px' }} onClick={() => setCreateModal(true)}>
          + Tạo đơn
        </button>
      </div>

      {/* Filter bar */}
      <div className="filter-bar">
        <input
          type="text"
          className="search-input"
          placeholder="Tìm theo tên, mã đơn, ghi chú..."
          value={searchInput}
          onChange={e => handleSearch(e.target.value)}
        />
        <div className="status-tabs">
          {STATUS_FILTERS.map(s => (
            <button
              key={s}
              className={`status-tab${status === s ? ' active' : ''}`}
              onClick={() => { setStatus(s); setPage(1); }}
            >
              {STATUS_FILTER_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      {/* Tổng của bộ lọc đang chọn */}
      {data.summary && (
        <div className="orders-sum" aria-live="polite">
          <span><strong>{data.summary.count}</strong> đơn{status === 'all' ? ' (không tính huỷ)' : ''}</span>
          <span>Tổng tiền <strong>{formatCurrency(data.summary.amount)}</strong></span>
          <span>Đã cọc <strong>{formatCurrency(data.summary.deposit)}</strong></span>
          {data.summary.noAmount > 0 && <span className="orders-sum-alert">{data.summary.noAmount} đơn chưa nhập tiền</span>}
        </div>
      )}

      {/* Table */}
      <div className="table-scroll" style={{ flex: 1 }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Mã đơn</th><th>Khách hàng</th><th>Ghi chú</th>
              <th>Số tiền</th><th>Đặt cọc</th><th>Trạng thái</th>
              <th>Thời gian</th><th>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {!data.orders.length
              ? <tr><td colSpan={8} className="table-empty">Không có đơn hàng nào</td></tr>
              : data.orders.map(o => {
                  const nexts = STATUS_NEXT[o.status] || [];
                  return (
                    <tr key={o._id}>
                      <td><span className="order-number-cell">{o.orderNumber || '—'}</span></td>
                      <td>
                        <div className="table-user-cell">
                          <div className="table-avatar">{getInitials(o.username)}</div>
                          <div>
                            <div className="table-name">@{o.username}</div>
                            <div className="table-sub">{o.displayName || ''}</div>
                          </div>
                        </div>
                      </td>
                      <td className="note-cell">{(o.note || '').slice(0, 50)}{(o.note || '').length > 50 ? '...' : ''}</td>
                      <td>
                        <button className="amount-btn" onClick={() => openAmount(o)}
                          title={AMOUNT_LOCKED.includes(o.status) ? 'Đã khoá số tiền' : 'Sửa số tiền'}>
                          {o.amount ? formatCurrency(o.amount) : <span style={{ color: 'var(--text-dim)' }}>—</span>}
                        </button>
                      </td>
                      <td>{o.depositAmount ? formatCurrency(o.depositAmount) : <span style={{ color: 'var(--text-dim)' }}>—</span>}</td>
                      <td><StatusBadge status={o.status} /></td>
                      <td className="time-cell">{formatDateTime(o.createdAt)}</td>
                      <td className="actions-cell">
                        {nexts.length
                          ? nexts.map(s => (
                              <button key={s} className="btn-status-change" disabled={busyOrderId === o._id}
                                onClick={() => changeStatus(o._id, s)}>
                                {STATUS_LABELS[s]?.label}
                              </button>
                            ))
                          : null
                        }
                        <button className="btn-status-change" disabled={busyOrderId === o._id || o.printPending}
                          onClick={() => printOrder(o)}
                          title={o.printError ? `In lỗi: ${o.printError}` : o.printedAt ? 'Đã in — bấm để in lại' : 'In phiếu'}>
                          {o.printPending ? '⏳ Chờ in' : o.printError ? '⚠ In lại' : o.printedAt ? '🖨 In lại' : '🖨 In'}
                        </button>
                      </td>
                    </tr>
                  );
                })
            }
          </tbody>
        </table>
      </div>
      <Pagination current={page} total={data.totalPages} onPage={p => setPage(p)} />

      {/* Amount modal */}
      <Modal open={!!amountModal} title="Cập nhật số tiền" onClose={() => setAmountModal(null)}>
        <div className="modal-form">
          <div className="form-group">
            <label className="form-label">Số tiền đơn hàng (đ)</label>
            <input type="number" className="form-input" value={amountVal} min="0" step="1000" inputMode="numeric"
              onChange={e => setAmountVal(Math.max(0, Math.round(Number(e.target.value) || 0)))} />
          </div>
          <div className="form-group">
            <label className="form-label">Số tiền đặt cọc (đ)</label>
            <input type="number" className="form-input" value={depositVal} min="0" step="1000" inputMode="numeric"
              onChange={e => setDepositVal(Math.max(0, Math.round(Number(e.target.value) || 0)))} />
            {depositError && <span className="form-hint" style={{ color: 'var(--accent)' }}>
              ⚠️ Đặt cọc vượt quá tổng tiền ({amountVal.toLocaleString('vi-VN')}đ)
            </span>}
          </div>
          <div className="modal-actions">
            <button className="btn-cancel" onClick={() => setAmountModal(null)}>Hủy</button>
            <button className="btn-save-store" onClick={saveAmount} disabled={depositError || savingAmount}>
              {savingAmount ? 'Đang lưu...' : 'Lưu'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Create modal */}
      <Modal open={createModal} title="Tạo đơn hàng mới" onClose={() => setCreateModal(false)}>
        <div className="modal-form">
          {[
            { key: 'username',    label: 'TikTok Username *', placeholder: '@username' },
            { key: 'displayName', label: 'Tên hiển thị',       placeholder: 'Tên khách hàng' },
            { key: 'tiktokUserId',label: 'TikTok User ID',     placeholder: 'ID người dùng' },
          ].map(f => (
            <div key={f.key} className="form-group">
              <label className="form-label">{f.label}</label>
              <input type="text" className="form-input" placeholder={f.placeholder}
                value={createForm[f.key]}
                onChange={e => setCreateForm(p => ({ ...p, [f.key]: e.target.value }))} />
            </div>
          ))}
          <div className="form-group">
            <label className="form-label">Ghi chú</label>
            <textarea className="form-input" rows={3} placeholder="Mô tả đơn hàng..."
              value={createForm.note}
              onChange={e => setCreateForm(p => ({ ...p, note: e.target.value }))} />
          </div>
          <div className="modal-actions">
            <button className="btn-cancel" onClick={() => setCreateModal(false)}>Hủy</button>
            <button className="btn-save-store" onClick={submitCreate} disabled={creating}>
              {creating ? 'Đang tạo...' : 'Tạo đơn'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
