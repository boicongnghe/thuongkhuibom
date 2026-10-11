import { formatCurrency } from '../utils';
import { STATUS_LABELS } from '../constants';

// Bảng tổng kết đơn hàng — dùng ở trang Livestream (phiên live) và trang Thống kê.
// `data` là kết quả của GET /api/stats/summary
export default function OrderSummary({ data, compact = false }) {
  const t = data?.totals;
  if (!t) {
    return <div className="sum-empty">Chưa có dữ liệu. Kết nối TikTok Live và chốt đơn để xem tổng kết.</div>;
  }

  const kpis = [
    { label: 'Tổng đơn',      value: t.orders.toLocaleString('vi-VN'), sub: `${t.customers} khách` },
    { label: 'Tổng tiền',     value: formatCurrency(t.amount),        sub: t.avgOrderValue ? `TB ${formatCurrency(t.avgOrderValue)}/đơn` : 'chưa có đơn có tiền' },
    { label: 'Đã thu',        value: formatCurrency(t.collected),     sub: `cọc ${formatCurrency(t.deposit)} · xong ${formatCurrency(t.completed)}`, tone: 'good' },
    { label: 'Còn phải thu',  value: formatCurrency(t.remaining),     sub: 'đơn chưa hoàn thành', tone: t.remaining > 0 ? 'warn' : '' },
  ];
  if (t.noAmount > 0) {
    kpis.push({ label: 'Chưa nhập tiền', value: `${t.noAmount} đơn`, sub: 'tổng tiền đang thiếu', tone: 'alert' });
  }
  if (t.conversionRate !== null && t.conversionRate !== undefined) {
    kpis.push({ label: 'Tỉ lệ chốt', value: `${t.conversionRate.toLocaleString('vi-VN')}%`, sub: `${t.customers}/${t.commenters} người bình luận` });
  }
  if (t.cancelledCount > 0) {
    kpis.push({ label: 'Đã huỷ', value: `${t.cancelledCount} đơn`, sub: formatCurrency(t.cancelledAmount), tone: 'muted' });
  }

  const rows = (data.byStatus || []).filter(s => s.count > 0);

  return (
    <div className={`sum${compact ? ' sum-compact' : ''}`}>
      {data.session && (
        <div className="sum-session">
          Phiên @{data.session.tiktokUsername} · bắt đầu {new Date(data.session.startedAt).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}
          {data.session.endedAt ? ' · đã kết thúc' : ' · đang mở'}
        </div>
      )}

      <div className="sum-kpis">
        {kpis.map(k => (
          <div key={k.label} className={`sum-kpi${k.tone ? ` tone-${k.tone}` : ''}`}>
            <div className="sum-kpi-label">{k.label}</div>
            <div className="sum-kpi-value">{k.value}</div>
            <div className="sum-kpi-sub">{k.sub}</div>
          </div>
        ))}
      </div>

      {rows.length > 0 && (
        <div className="sum-block">
          <div className="sum-block-title">Theo trạng thái</div>
          <table className="sum-table">
            <thead><tr><th>Trạng thái</th><th>Đơn</th><th>Tiền</th><th>Còn thu</th></tr></thead>
            <tbody>
              {rows.map(s => (
                <tr key={s.status}>
                  <td><span className={`status-badge ${STATUS_LABELS[s.status]?.cls || ''}`}>{STATUS_LABELS[s.status]?.label || s.status}</span></td>
                  <td>{s.count}</td>
                  <td>{formatCurrency(s.amount)}</td>
                  <td>{s.status === 'completed' || s.status === 'cancelled' ? '—' : formatCurrency(s.remaining)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.topCustomers?.length > 0 && (
        <div className="sum-block">
          <div className="sum-block-title">Khách mua nhiều</div>
          <ol className="sum-top">
            {data.topCustomers.map(c => (
              <li key={c.tiktokUserId}>
                <span className="sum-top-name">@{c.username}</span>
                <span className="sum-top-val">{c.orders} đơn · {formatCurrency(c.amount)}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
