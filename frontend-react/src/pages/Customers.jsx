import { useEffect, useState, useRef } from 'react';
import { api } from '../api';
import socket from '../socket';
import { formatCurrency, formatDate, formatDateTime, getInitials } from '../utils';
import StatusBadge from '../components/StatusBadge';
import Pagination from '../components/Pagination';
import { useApp } from '../context/AppContext';

const PER_PAGE = 12;

export default function Customers() {
  const { showToast } = useApp();
  const [all, setAll]           = useState([]);
  const [displayed, setDisplayed] = useState([]);
  const [page, setPage]         = useState(1);
  const [sort, setSort]         = useState('orders');
  const [searchInput, setSearchInput] = useState('');
  const searchTimer = useRef(null);

  const [drawer, setDrawer]     = useState(null); // { customer, orders }
  const [drawerEdit, setDrawerEdit] = useState({ phone: '', email: '', displayName: '', notes: '' });
  const [drawerLoading, setDrawerLoading] = useState(false);

  async function loadAll() {
    try {
      const list = await api.getCustomers();
      setAll(list);
      applySort(list, sort);
    } catch (err) {
      showToast('Lỗi tải khách hàng', 'error');
    }
  }

  function applySort(list, s) {
    const sorted = [...list].sort((a, b) => {
      if (s === 'orders') return (b.totalOrders || 0) - (a.totalOrders || 0);
      if (s === 'spent')  return (b.totalSpent  || 0) - (a.totalSpent  || 0);
      return new Date(b.lastSeen) - new Date(a.lastSeen);
    });
    setDisplayed(sorted);
    setPage(1);
  }

  useEffect(() => { loadAll(); }, []);

  // Sửa khách / chốt đơn ở thiết bị khác → tải lại danh sách
  useEffect(() => {
    const reload = () => loadAll();
    socket.on('customer:updated', reload);
    socket.on('order:saved', reload);
    return () => {
      socket.off('customer:updated', reload);
      socket.off('order:saved', reload);
    };
  }, [sort]);
  useEffect(() => { applySort(all, sort); }, [sort]);

  async function handleSearch(val) {
    setSearchInput(val);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      if (val.trim().length >= 2) {
        try {
          const res = await api.searchCustomers(val.trim());
          setDisplayed(res);
          setPage(1);
        } catch {}
      } else if (!val.trim()) {
        applySort(all, sort);
      }
    }, 350);
  }

  async function openDrawer(tiktokUserId) {
    setDrawerLoading(true);
    setDrawer({ customer: null, orders: [] });
    try {
      const [customer, orders] = await Promise.all([
        api.getCustomer(tiktokUserId),
        api.getCustomerOrders(tiktokUserId),
      ]);
      setDrawer({ customer, orders });
      setDrawerEdit({
        phone:       customer.phone       || '',
        email:       customer.email       || '',
        displayName: customer.displayName || customer.username || '',
        notes:       customer.notes       || '',
      });
    } catch {
      setDrawer(null);
      showToast('Lỗi tải thông tin khách hàng', 'error');
    } finally {
      setDrawerLoading(false);
    }
  }

  async function saveEdit() {
    if (!drawer?.customer) return;
    try {
      await api.updateCustomer(drawer.customer.tiktokUserId, drawerEdit);
      showToast('Đã lưu thông tin khách hàng', 'success');
      loadAll();
    } catch (err) {
      showToast(`Lỗi: ${err.message}`, 'error');
    }
  }

  const totalPages = Math.ceil(displayed.length / PER_PAGE);
  const slice      = displayed.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', position: 'relative' }}>

      {/* Header */}
      <div className="page-header">
        <h1 className="page-title">Khách hàng</h1>
        <span className="page-subtitle">{all.length} khách hàng</span>
      </div>

      {/* Filter bar */}
      <div className="filter-bar">
        <input type="text" className="search-input" placeholder="Tìm theo tên, email, SĐT..."
          value={searchInput} onChange={e => handleSearch(e.target.value)} />
        <select className="select-input" value={sort} onChange={e => setSort(e.target.value)}>
          <option value="orders">Theo số đơn</option>
          <option value="spent">Theo chi tiêu</option>
          <option value="recent">Mới nhất</option>
        </select>
      </div>

      {/* Grid */}
      <div className="customers-body">
        <div className="customers-grid">
          {!slice.length
            ? <div className="empty-state" style={{ gridColumn: '1/-1' }}>
                <div className="empty-icon">👥</div>
                <p>Không có khách hàng nào</p>
              </div>
            : slice.map(c => (
              <div key={c.tiktokUserId} className="customer-card-full" onClick={() => openDrawer(c.tiktokUserId)}>
                <div className="cf-avatar">{getInitials(c.username)}</div>
                <div className="cf-name">@{c.username}</div>
                {c.displayName && c.displayName !== c.username && <div className="cf-display">{c.displayName}</div>}
                {c.phone  && <div className="cf-info">📞 {c.phone}</div>}
                {c.email  && <div className="cf-info">✉️ {c.email}</div>}
                <div className="cf-stats">
                  <div className="cf-stat"><span className="cf-stat-val">{c.totalOrders || 0}</span><span className="cf-stat-lbl">đơn</span></div>
                  <div className="cf-stat"><span className="cf-stat-val">{c.totalComments || 0}</span><span className="cf-stat-lbl">bình luận</span></div>
                  <div className="cf-stat"><span className="cf-stat-val">{formatCurrency(c.totalSpent)}</span><span className="cf-stat-lbl">chi tiêu</span></div>
                </div>
                <div className="cf-last-seen">Lần cuối: {formatDate(c.lastSeen)}</div>
              </div>
            ))
          }
        </div>
        <Pagination current={page} total={totalPages} onPage={setPage} />
      </div>

      {/* Detail drawer */}
      {drawer !== null && (
        <>
          <div className="drawer-overlay visible" onClick={() => setDrawer(null)} />
          <div className="detail-drawer open">
            <div className="drawer-header">
              <h2 className="drawer-title">
                {drawer.customer ? `@${drawer.customer.username}` : 'Chi tiết khách hàng'}
              </h2>
              <button className="drawer-close" onClick={() => setDrawer(null)}>✕</button>
            </div>
            <div className="drawer-body">
              {drawerLoading
                ? <p style={{ color: 'var(--text-muted)', padding: 20 }}>Đang tải...</p>
                : drawer.customer && <>
                    {/* Edit form */}
                    <div className="drawer-section">
                      <div className="drawer-section-title">Thông tin</div>
                      <div className="form-grid" style={{ marginTop: 10 }}>
                        {[
                          { key: 'phone',       label: 'Số điện thoại', type: 'tel',   ph: 'SĐT' },
                          { key: 'email',       label: 'Email',         type: 'email', ph: 'Email' },
                          { key: 'displayName', label: 'Tên hiển thị',  type: 'text',  ph: 'Tên hiển thị', full: true },
                        ].map(f => (
                          <div key={f.key} className={`form-group${f.full ? ' form-group-full' : ''}`}>
                            <label className="form-label">{f.label}</label>
                            <input type={f.type} className="form-input" placeholder={f.ph}
                              value={drawerEdit[f.key]}
                              onChange={e => setDrawerEdit(p => ({ ...p, [f.key]: e.target.value }))} />
                          </div>
                        ))}
                        <div className="form-group form-group-full">
                          <label className="form-label">Ghi chú nội bộ</label>
                          <textarea className="form-input" rows={3} placeholder="Ghi chú..."
                            value={drawerEdit.notes}
                            onChange={e => setDrawerEdit(p => ({ ...p, notes: e.target.value }))} />
                        </div>
                      </div>
                      <button className="btn-save-store" style={{ marginTop: 12, width: '100%' }} onClick={saveEdit}>
                        Lưu thông tin
                      </button>
                    </div>

                    {/* Stats */}
                    <div className="drawer-section">
                      <div className="drawer-section-title">Tổng quan</div>
                      <div className="drawer-stats-row">
                        <div className="drawer-stat"><span className="drawer-stat-val">{drawer.customer.totalOrders || 0}</span><span className="drawer-stat-lbl">Đơn hàng</span></div>
                        <div className="drawer-stat"><span className="drawer-stat-val">{drawer.customer.totalComments || 0}</span><span className="drawer-stat-lbl">Bình luận</span></div>
                        <div className="drawer-stat"><span className="drawer-stat-val">{formatCurrency(drawer.customer.totalSpent)}</span><span className="drawer-stat-lbl">Chi tiêu</span></div>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 8 }}>
                        Lần đầu: {formatDate(drawer.customer.firstSeen)} · Lần cuối: {formatDate(drawer.customer.lastSeen)}
                      </div>
                    </div>

                    {/* Order history */}
                    <div className="drawer-section">
                      <div className="drawer-section-title">Lịch sử đơn hàng ({drawer.orders.length})</div>
                      {!drawer.orders.length
                        ? <p style={{ color: 'var(--text-dim)', fontSize: 13, marginTop: 8 }}>Chưa có đơn hàng</p>
                        : drawer.orders.slice(0, 20).map(o => (
                          <div key={o._id} className="drawer-order-row">
                            <div className="drawer-order-left">
                              <div className="drawer-order-num">{o.orderNumber || '—'}</div>
                              <div className="drawer-order-note">{(o.note || '').slice(0, 50)}</div>
                            </div>
                            <div className="drawer-order-right">
                              <StatusBadge status={o.status} />
                              <div className="drawer-order-amount">{formatCurrency(o.amount)}</div>
                              <div className="drawer-order-time">{formatDateTime(o.createdAt)}</div>
                            </div>
                          </div>
                        ))
                      }
                    </div>
                  </>
              }
            </div>
          </div>
        </>
      )}
    </div>
  );
}
