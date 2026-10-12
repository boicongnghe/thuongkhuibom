import { useEffect, useState } from 'react';
import { api } from '../api';
import { formatCurrency, vnToday, shiftDate } from '../utils';
import { isAgent, liveBus } from '../agent';
import { useApp } from '../context/AppContext';

// Thống kê theo ngày: đơn chốt, tiền, cọc, đi đơn, xả hàng, mất cọc + chi tiết từng khách
export default function CustomerDaily() {
  const { showToast } = useApp();
  const [date, setDate]       = useState(vnToday());
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(false);
  const [printing, setPrinting] = useState(false);

  async function load(d = date) {
    setLoading(true);
    try {
      setData(await api.getDaily(d));
    } catch (err) {
      showToast(`Lỗi tải thống kê ngày: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(date); }, [date]);

  async function print() {
    if (printing) return;
    setPrinting(true);
    try {
      await api.printDaily(date);
      if (isAgent) liveBus.emit('print-now');
      showToast('Đã gửi lệnh in tổng kết ngày', 'success');
    } catch (err) {
      showToast(`Lỗi: ${err.message}`, 'error');
    } finally {
      setPrinting(false);
    }
  }

  const t = data?.totals;
  const isToday = date === vnToday();
  const [y, m, d] = date.split('-');

  return (
    <div className="page-scroll hold-page">
      <div className="daily-bar">
        <button type="button" className="btn-status-change" onClick={() => setDate(shiftDate(date, -1))} aria-label="Ngày trước">‹ Hôm trước</button>
        <label htmlFor="daily-date" className="sr-only">Chọn ngày</label>
        <input id="daily-date" type="date" className="form-input daily-date" value={date} max={vnToday()}
          onChange={e => e.target.value && setDate(e.target.value)} />
        <button type="button" className="btn-status-change" onClick={() => setDate(shiftDate(date, 1))} disabled={isToday} aria-label="Ngày sau">Hôm sau ›</button>
        {!isToday && <button type="button" className="btn-status-change" onClick={() => setDate(vnToday())}>Hôm nay</button>}
        <button type="button" className="btn-save-store daily-print" onClick={print} disabled={printing || !t}>
          {printing ? 'Đang gửi...' : '🖨 In tổng kết ngày'}
        </button>
      </div>

      <h2 className="daily-title">Ngày {d}/{m}/{y}{isToday ? ' (hôm nay)' : ''}{loading ? ' · đang tải...' : ''}</h2>

      <div className="hold-kpis">
        <div className="sum-kpi"><div className="sum-kpi-label">Đơn đã chốt</div><div className="sum-kpi-value">{t?.orders ?? '—'}</div><div className="sum-kpi-sub">{t?.customers ?? 0} khách{t?.cancelled ? ` · ${t.cancelled} huỷ` : ''}</div></div>
        <div className="sum-kpi"><div className="sum-kpi-label">Tổng tiền</div><div className="sum-kpi-value">{formatCurrency(t?.amount || 0)}</div><div className="sum-kpi-sub">{t?.noAmount ? `${t.noAmount} đơn chưa nhập tiền` : 'đủ tiền các đơn'}</div></div>
        <div className="sum-kpi tone-good"><div className="sum-kpi-label">Đã cọc (ở đơn)</div><div className="sum-kpi-value">{formatCurrency(t?.deposit || 0)}</div><div className="sum-kpi-sub">cọc dồn đơn xem ở tab Dồn đơn</div></div>
        <div className="sum-kpi"><div className="sum-kpi-label">Đã đi đơn</div><div className="sum-kpi-value">{t?.shipments ?? 0} phiếu</div><div className="sum-kpi-sub">{t?.shippedOrders ?? 0} đơn · thu {formatCurrency(t?.shippedCod || 0)}</div></div>
        <div className={`sum-kpi${t?.releasedOrders ? ' tone-warn' : ''}`}><div className="sum-kpi-label">Xả hàng</div><div className="sum-kpi-value">{t?.releasedOrders ?? 0} đơn</div><div className="sum-kpi-sub">{formatCurrency(t?.releasedAmount || 0)}</div></div>
        <div className={`sum-kpi${t?.forfeited ? ' tone-alert' : ''}`}><div className="sum-kpi-label">Mất cọc</div><div className="sum-kpi-value">{formatCurrency(t?.forfeited || 0)}</div><div className="sum-kpi-sub">khách bị xả khi đã cọc</div></div>
      </div>

      <div className="stats-table-card">
        <div className="stats-table-title">Chi tiết từng khách ({data?.customers?.length ?? 0})</div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr><th>Khách</th><th>SĐT</th><th>Số đơn</th><th>Tổng tiền</th><th>Cọc</th><th>Đã đi</th><th>Còn dồn</th><th>Mã đơn</th></tr>
            </thead>
            <tbody>
              {!data?.customers?.length
                ? <tr><td colSpan={8} className="table-empty">Không có đơn nào trong ngày này</td></tr>
                : data.customers.map(r => (
                  <tr key={r.tiktokUserId}>
                    <td>
                      <div className="table-name">@{r.username}</div>
                      {r.displayName && r.displayName !== r.username && <div className="table-sub">{r.displayName}</div>}
                    </td>
                    <td>{r.phone ? <a href={`tel:${r.phone}`}>{r.phone}</a> : '—'}</td>
                    <td><b>{r.orders}</b>{r.cancelled ? <span className="table-sub"> (+{r.cancelled} huỷ)</span> : ''}</td>
                    <td><b>{formatCurrency(r.amount)}</b></td>
                    <td>{formatCurrency(r.deposit + (r.holdDeposit || 0))}</td>
                    <td>{r.shipped}</td>
                    <td>{r.held}</td>
                    <td className="note-cell">{r.orderNumbers.join(', ')}</td>
                  </tr>
                ))}
            </tbody>
            {!!data?.customers?.length && (
              <tfoot>
                <tr className="daily-total-row">
                  <td colSpan={2}>Tổng</td>
                  <td>{t.orders}</td>
                  <td>{formatCurrency(t.amount)}</td>
                  <td>{formatCurrency(t.deposit)}</td>
                  <td>{data.customers.reduce((s, r) => s + r.shipped, 0)}</td>
                  <td>{data.customers.reduce((s, r) => s + r.held, 0)}</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
