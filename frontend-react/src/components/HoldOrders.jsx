import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { formatCurrency, formatDateTime, formatDuration, parseVnd, vnToday } from '../utils';
import { isAgent, liveBus } from '../agent';
import { useApp } from '../context/AppContext';
import StatusBadge from './StatusBadge';
import QuickAmount from './QuickAmount';
import Modal from './Modal';

const FILTERS = [
  { key: 'all',     label: 'Tất cả' },
  { key: 'overdue', label: '⚠ Quá hạn cọc' },
  { key: 'waiting', label: 'Chờ cọc' },
  { key: 'covered', label: 'Đã cọc (đang dồn)' },
];

// Dồn đơn · xả hàng · đi đơn (tab trong trang Khách hàng)
export default function HoldOrders() {
  const { showToast } = useApp();
  const [data, setData]         = useState(null);
  const [search, setSearch]     = useState('');
  const [filter, setFilter]     = useState('all');
  const [selected, setSelected] = useState({});        // { [tiktokUserId]: Set(orderId) }
  const [busy, setBusy]         = useState(null);
  const [depositInput, setDepositInput] = useState({});
  const [shipModal, setShipModal] = useState(null);    // { customer, orders, holdUse }
  const [shipments, setShipments] = useState([]);
  const [, tick]                = useState(0);
  const searchTimer = useRef(null);
  const searchRef = useRef('');

  async function load(q = searchRef.current) {
    try {
      const [h, sh] = await Promise.all([api.getHolds(q), api.getShipments(vnToday())]);
      setData(h);
      setShipments(sh);
    } catch (err) {
      showToast(`Lỗi tải dồn đơn: ${err.message}`, 'error');
    }
  }

  useEffect(() => {
    load();
    const t1 = setInterval(() => load(), 30000);
    const t2 = setInterval(() => tick(x => x + 1), 60000);   // cập nhật đồng hồ đếm ngược
    return () => { clearInterval(t1); clearInterval(t2); };
  }, []);

  function onSearch(v) {
    setSearch(v);
    searchRef.current = v;
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => load(v), 350);
  }

  const list = useMemo(() => (data?.customers || []).filter(c => filter === 'all' || c.state === filter), [data, filter]);

  const selOf = (c) => selected[c.tiktokUserId] || new Set();
  function toggle(c, id) {
    setSelected(prev => {
      const s = new Set(prev[c.tiktokUserId] || []);
      if (s.has(id)) s.delete(id); else s.add(id);
      return { ...prev, [c.tiktokUserId]: s };
    });
  }
  function toggleAll(c) {
    setSelected(prev => {
      const s = prev[c.tiktokUserId] || new Set();
      return { ...prev, [c.tiktokUserId]: s.size === c.orders.length ? new Set() : new Set(c.orders.map(o => o._id)) };
    });
  }

  const printed = (msg) => {
    if (isAgent) liveBus.emit('print-now');
    showToast(msg, 'success');
  };

  async function run(key, fn) {
    if (busy) return;
    setBusy(key);
    try { await fn(); } catch (err) { showToast(`Lỗi: ${err.message}`, 'error', 5000); } finally { setBusy(null); }
  }

  function saveDeposit(c) {
    const text = depositInput[c.tiktokUserId] ?? '';
    const amount = text.trim() === '' ? 0 : parseVnd(text);
    if (amount === null) { showToast('Không hiểu số tiền cọc (vd: 50k, 100000)', 'error'); return; }
    run(`dep-${c.tiktokUserId}`, async () => {
      await api.setHoldDeposit(c.tiktokUserId, amount);
      showToast(amount ? `Đã ghi cọc ${formatCurrency(amount)} cho @${c.username}` : `Đã xoá cọc của @${c.username}`, 'success');
      setDepositInput(p => ({ ...p, [c.tiktokUserId]: '' }));
      load();
    });
  }

  function printSummary(c) {
    const ids = [...selOf(c)];
    run(`print-${c.tiktokUserId}`, async () => {
      await api.printHoldSummary(c.tiktokUserId, ids.length ? ids : undefined);
      printed(`Đã gửi lệnh in phiếu tổng @${c.username}${ids.length ? ` (${ids.length} đơn)` : ''}`);
    });
  }

  function release(c) {
    const ids = [...selOf(c)];
    const all = !ids.length || ids.length === c.orders.length;
    const n = all ? c.orderCount : ids.length;
    const lose = all ? c.deposit : c.orders.filter(o => ids.includes(o._id)).reduce((t, o) => t + o.depositAmount, 0);
    const msg = `Xả hàng ${n} đơn của @${c.username}? Các đơn sẽ bị huỷ (lý do: xả hàng).`
      + (lose > 0 ? `\nKhách MẤT CỌC ${formatCurrency(lose)}.` : '')
      + (!all && c.holdDeposit > 0 ? '\n(Cọc dồn đơn vẫn giữ vì còn đơn khác chưa xả.)' : '');
    if (!window.confirm(msg)) return;
    run(`rel-${c.tiktokUserId}`, async () => {
      const r = await api.releaseHold(c.tiktokUserId, all ? undefined : ids);
      showToast(`Đã xả ${r.released} đơn${r.forfeited ? ` · mất cọc ${formatCurrency(r.forfeited)}` : ''}`, 'success');
      setSelected(p => ({ ...p, [c.tiktokUserId]: new Set() }));
      load();
    });
  }

  function releaseAllOverdue() {
    const t = data?.totals;
    if (!t?.overdue) return;
    if (!window.confirm(`Xả hàng ${t.overdueOrders} đơn của ${t.overdue} khách quá hạn cọc (${formatCurrency(t.overdueAmount)})?`)) return;
    run('rel-all', async () => {
      const r = await api.releaseOverdue();
      showToast(`Đã xả ${r.released} đơn của ${r.customers} khách`, 'success');
      load();
    });
  }

  function openShip(c) {
    const ids = selOf(c);
    if (!ids.size) { showToast('Tích chọn các đơn muốn đi trước', 'info'); return; }
    const orders = c.orders.filter(o => ids.has(o._id));
    setShipModal({ customer: c, orders, holdUse: String(c.holdDeposit || 0) });
  }

  function confirmShip() {
    const { customer: c, orders, holdUse } = shipModal;
    const use = holdUse.trim() === '' ? 0 : parseVnd(holdUse);
    if (use === null || use > c.holdDeposit) { showToast(`Tiền cọc trừ phải từ 0 đến ${formatCurrency(c.holdDeposit)}`, 'error'); return; }
    run(`ship-${c.tiktokUserId}`, async () => {
      const { shipment } = await api.createShipment({ tiktokUserId: c.tiktokUserId, orderIds: orders.map(o => o._id), useHoldDeposit: use, print: true });
      printed(`Đã đi đơn ${shipment.code} · ${shipment.orderCount} đơn · thu ${formatCurrency(shipment.cod)}`);
      setShipModal(null);
      setSelected(p => ({ ...p, [c.tiktokUserId]: new Set() }));
      load();
    });
  }

  const t = data?.totals;
  const shipCalc = shipModal && (() => {
    const amount = shipModal.orders.reduce((s, o) => s + o.amount, 0);
    const orderDep = shipModal.orders.reduce((s, o) => s + o.depositAmount, 0);
    const use = parseVnd(shipModal.holdUse || '0') || 0;
    return { amount, orderDep, use, cod: Math.max(0, amount - orderDep - use) };
  })();

  return (
    <div className="page-scroll hold-page">
      {/* Tổng quan */}
      <div className="hold-kpis">
        <div className="sum-kpi"><div className="sum-kpi-label">Khách đang dồn</div><div className="sum-kpi-value">{t?.customers ?? '—'}</div><div className="sum-kpi-sub">{t?.orders ?? 0} đơn chưa đi</div></div>
        <div className="sum-kpi"><div className="sum-kpi-label">Tổng tiền dồn</div><div className="sum-kpi-value">{formatCurrency(t?.amount || 0)}</div><div className="sum-kpi-sub">còn thu {formatCurrency(t?.remaining || 0)}</div></div>
        <div className="sum-kpi tone-good"><div className="sum-kpi-label">Đã cọc</div><div className="sum-kpi-value">{formatCurrency(t?.deposit || 0)}</div><div className="sum-kpi-sub">{t?.covered ?? 0} khách đã cọc</div></div>
        <div className="sum-kpi tone-warn"><div className="sum-kpi-label">Chờ cọc</div><div className="sum-kpi-value">{t?.waiting ?? 0} khách</div><div className="sum-kpi-sub">hạn {data?.deadlineHours ?? 24} giờ</div></div>
        <div className={`sum-kpi${t?.overdue ? ' tone-alert' : ''}`}>
          <div className="sum-kpi-label">Quá hạn cọc</div>
          <div className="sum-kpi-value">{t?.overdue ?? 0} khách</div>
          <div className="sum-kpi-sub">{t?.overdueOrders ?? 0} đơn · {formatCurrency(t?.overdueAmount || 0)}</div>
          {t?.overdue > 0 && (
            <button type="button" className="hold-release-all" disabled={busy === 'rel-all'} onClick={releaseAllOverdue}>
              {busy === 'rel-all' ? 'Đang xả...' : 'Xả hàng tất cả'}
            </button>
          )}
        </div>
      </div>

      {/* Tìm + lọc */}
      <div className="filter-bar">
        <label htmlFor="hold-search" className="sr-only">Tìm khách</label>
        <input id="hold-search" type="text" className="search-input" placeholder="Tìm tên, @tiktok, SĐT, mã đơn..."
          value={search} onChange={e => onSearch(e.target.value)} />
        <div className="status-tabs" role="tablist" aria-label="Lọc khách dồn đơn">
          {FILTERS.map(f => (
            <button key={f.key} type="button" role="tab" aria-selected={filter === f.key}
              className={`status-tab${filter === f.key ? ' active' : ''}`} onClick={() => setFilter(f.key)}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Khách */}
      <div className="hold-list">
        {data && !list.length && (
          <div className="empty-state"><div className="empty-icon">📦</div><p>Không có khách nào đang dồn đơn</p></div>
        )}
        {list.map(c => {
          const sel = selOf(c);
          const selOrders = c.orders.filter(o => sel.has(o._id));
          const selAmount = selOrders.reduce((s, o) => s + o.amount, 0);
          const k = c.tiktokUserId;
          return (
            <section key={k} className={`hold-card state-${c.state}`} aria-label={`Khách @${c.username}`}>
              <header className="hold-head">
                <div className="hold-who">
                  <div className="hold-name">{c.displayName && c.displayName !== c.username ? c.displayName : `@${c.username}`}</div>
                  <div className="hold-sub">
                    @{c.username}{c.phone ? <> · <a href={`tel:${c.phone}`}>{c.phone}</a></> : ''} · từ {formatDateTime(c.oldestAt)}
                  </div>
                </div>
                <div className={`hold-state hold-state-${c.state}`}>
                  {c.state === 'covered' && `✓ Đã cọc ${formatCurrency(c.deposit)} · đang dồn`}
                  {c.state === 'waiting' && `⏳ Chờ cọc · còn ${formatDuration(c.msLeft)}`}
                  {c.state === 'overdue' && `⚠ Quá hạn cọc ${formatDuration(Date.now() - new Date(c.deadlineAt).getTime())} · cần xả hàng`}
                </div>
              </header>

              <div className="hold-totals">
                <span><b>{c.orderCount}</b> đơn</span>
                <span>Tổng <b>{formatCurrency(c.amount)}</b></span>
                <span>Cọc <b>{formatCurrency(c.deposit)}</b></span>
                <span>Còn thu <b>{formatCurrency(c.remaining)}</b></span>
                {c.noAmount > 0 && <span className="orders-sum-alert">{c.noAmount} đơn chưa nhập tiền</span>}
              </div>

              <div className="hold-orders">
                <label className="hold-order hold-order-all">
                  <input type="checkbox" checked={sel.size === c.orders.length && c.orders.length > 0}
                    onChange={() => toggleAll(c)} aria-label={`Chọn tất cả đơn của @${c.username}`} />
                  <span>Chọn tất cả ({c.orders.length})</span>
                </label>
                {c.orders.map(o => (
                  <div key={o._id} className={`hold-order${sel.has(o._id) ? ' is-selected' : ''}`}>
                    <input type="checkbox" checked={sel.has(o._id)} onChange={() => toggle(c, o._id)}
                      aria-label={`Chọn đơn ${o.orderNumber}`} />
                    <div className="hold-order-main">
                      <div className="hold-order-top">
                        <span className="order-number-cell">{o.orderNumber}</span>
                        <StatusBadge status={o.status} />
                        <span className="hold-order-time">{formatDateTime(o.createdAt)}</span>
                      </div>
                      <div className="hold-order-note">{o.note}</div>
                    </div>
                    <QuickAmount key={`${o._id}-${o.amount}`} order={o}
                      onSaved={() => { showToast(`Đã lưu tiền ${o.orderNumber}`, 'success'); load(); }}
                      onError={(m) => showToast(`Lỗi: ${m}`, 'error')} />
                  </div>
                ))}
              </div>

              <div className="hold-actions">
                <form className="hold-deposit" onSubmit={e => { e.preventDefault(); saveDeposit(c); }}>
                  <label htmlFor={`dep-${k}`} className="sr-only">Cọc dồn đơn của @{c.username}</label>
                  <input id={`dep-${k}`} className="qa-input" inputMode="decimal"
                    placeholder={c.holdDeposit ? `Cọc: ${formatCurrency(c.holdDeposit)}` : 'Ghi cọc: 50k'}
                    value={depositInput[k] ?? ''} onChange={e => setDepositInput(p => ({ ...p, [k]: e.target.value }))} />
                  <button type="submit" className="btn-status-change" disabled={busy === `dep-${k}`}>Lưu cọc</button>
                </form>
                <div className="hold-buttons">
                  <button type="button" className="btn-status-change" disabled={!!busy} onClick={() => printSummary(c)}>
                    🖨 In phiếu tổng{sel.size ? ` (${sel.size})` : ''}
                  </button>
                  <button type="button" className="btn-cancel hold-btn-danger" disabled={!!busy} onClick={() => release(c)}>
                    Xả hàng{sel.size ? ` (${sel.size})` : ''}
                  </button>
                  <button type="button" className="btn-save-store" disabled={!!busy || !sel.size} onClick={() => openShip(c)}>
                    🚚 Đi đơn {sel.size ? `${sel.size} đơn · ${formatCurrency(selAmount)}` : '(chọn đơn)'}
                  </button>
                </div>
              </div>
            </section>
          );
        })}
      </div>

      {/* Phiếu đi đơn hôm nay */}
      <div className="stats-table-card">
        <div className="stats-table-title">Phiếu đi đơn hôm nay ({shipments.length})</div>
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th>Mã phiếu</th><th>Khách</th><th>Số đơn</th><th>Tiền hàng</th><th>Trừ cọc</th><th>Thu khi giao</th><th>Giờ</th><th></th></tr></thead>
            <tbody>
              {!shipments.length
                ? <tr><td colSpan={8} className="table-empty">Chưa đi đơn nào hôm nay</td></tr>
                : shipments.map(s => (
                  <tr key={s._id}>
                    <td><span className="order-number-cell">{s.code}</span></td>
                    <td>@{s.username}</td>
                    <td>{s.orderCount}</td>
                    <td>{formatCurrency(s.amount)}</td>
                    <td>{formatCurrency(s.depositApplied)}</td>
                    <td><b>{formatCurrency(s.cod)}</b></td>
                    <td>{formatDateTime(s.createdAt)}</td>
                    <td><button type="button" className="btn-status-change" disabled={!!busy}
                      onClick={() => run(`rp-${s._id}`, async () => { await api.reprintShipment(s._id); printed(`Đã gửi lệnh in lại ${s.code}`); })}>🖨 In lại</button></td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Xác nhận đi đơn */}
      <Modal open={!!shipModal} title="Xác nhận đi đơn" onClose={() => setShipModal(null)}>
        {shipModal && (
          <div className="modal-form">
            <p style={{ margin: 0 }}>
              Đi <b>{shipModal.orders.length} đơn</b> của <b>@{shipModal.customer.username}</b>. Các đơn chuyển sang
              "Đã đi đơn" và in phiếu đi đơn.
            </p>
            <div className="hold-ship-lines">
              {shipModal.orders.map(o => (
                <div key={o._id}><span>{o.orderNumber}</span><span>{formatCurrency(o.amount)}</span></div>
              ))}
            </div>
            {shipModal.orders.some(o => !(o.amount > 0)) && (
              <p className="orders-sum-alert" style={{ margin: 0 }}>⚠ Có đơn chưa nhập tiền — tổng tiền sẽ thiếu.</p>
            )}
            {shipModal.customer.holdDeposit > 0 && (
              <div className="form-group">
                <label className="form-label" htmlFor="ship-hold">Trừ cọc dồn đơn (khách đã cọc {formatCurrency(shipModal.customer.holdDeposit)})</label>
                <input id="ship-hold" className="form-input" inputMode="decimal" value={shipModal.holdUse}
                  onChange={e => setShipModal(p => ({ ...p, holdUse: e.target.value }))} />
              </div>
            )}
            <div className="hold-ship-total">
              <div><span>Tiền hàng</span><b>{formatCurrency(shipCalc.amount)}</b></div>
              <div><span>Trừ cọc</span><b>− {formatCurrency(shipCalc.orderDep + shipCalc.use)}</b></div>
              <div className="hold-ship-cod"><span>Thu khi giao (COD)</span><b>{formatCurrency(shipCalc.cod)}</b></div>
            </div>
            <div className="modal-actions">
              <button className="btn-cancel" onClick={() => setShipModal(null)}>Huỷ</button>
              <button className="btn-save-store" disabled={!!busy} onClick={confirmShip}>
                {busy ? 'Đang xử lý...' : '🚚 Đi đơn + in phiếu'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
