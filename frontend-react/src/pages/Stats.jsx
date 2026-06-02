import { useEffect, useState } from 'react';
import { Line, Bar } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, BarElement, Filler, Tooltip } from 'chart.js';
import { api } from '../api';
import { formatCurrency, formatDate, getInitials, buildDayLabels, mapChartDataToLabels, buildStatsLabels } from '../utils';
import { useApp } from '../context/AppContext';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Filler, Tooltip);

const PERIODS = [
  { label: '7 ngày',    period: 'day',   count: 7  },
  { label: '30 ngày',   period: 'day',   count: 30 },
  { label: '8 tuần',    period: 'week',  count: 8  },
  { label: '12 tháng',  period: 'month', count: 12 },
];

const SCALES = {
  x: { ticks: { color: '#94A3B8', font: { size: 11 } }, grid: { color: 'rgba(226,232,240,0.8)' } },
  y: { ticks: { color: '#94A3B8', font: { size: 11 } }, grid: { color: 'rgba(226,232,240,0.8)' }, beginAtZero: true },
};

export default function Stats() {
  const { showToast } = useApp();
  const [periodIdx, setPeriodIdx]     = useState(0);
  const [chartData, setChartData]     = useState(null);
  const [customers, setCustomers]     = useState([]);

  const { period, count } = PERIODS[periodIdx];

  async function load() {
    try {
      const [c, custs] = await Promise.all([
        api.getChart(period, count),
        api.getCustomers(),
      ]);
      setChartData(c);
      setCustomers(custs);
    } catch (err) {
      showToast('Lỗi tải thống kê', 'error');
    }
  }

  useEffect(() => { load(); }, [periodIdx]);

  const totalOrders  = (chartData?.orderChart   || []).reduce((s, d) => s + (d.count || 0), 0);
  const totalRevenue = (chartData?.revenueChart  || []).reduce((s, d) => s + (d.total || 0), 0);
  const avgOrders    = count > 0 ? (totalOrders / count).toFixed(1) : 0;

  const oLabels   = chartData ? buildStatsLabels(chartData.orderChart   || [], period) : buildDayLabels(7);
  const rLabels   = chartData ? buildStatsLabels(chartData.revenueChart || [], period) : buildDayLabels(7);
  const oValues   = period === 'day'
    ? mapChartDataToLabels(chartData?.orderChart   || [], oLabels, 'count')
    : (chartData?.orderChart   || []).map(d => d.count || 0);
  const rValues   = period === 'day'
    ? mapChartDataToLabels(chartData?.revenueChart || [], rLabels, 'total')
    : (chartData?.revenueChart || []).map(d => d.total || 0);

  const topCustomers = [...customers].sort((a, b) => (b.totalOrders || 0) - (a.totalOrders || 0)).slice(0, 10);

  function exportCSV() {
    const rows = [
      ['#', 'Username', 'Tên', 'SĐT', 'Số đơn', 'Chi tiêu (đ)', 'Lần đầu', 'Lần cuối'],
      ...customers.map((c, i) => [
        i + 1, `@${c.username}`, c.displayName || '', c.phone || '',
        c.totalOrders || 0, c.totalSpent || 0, formatDate(c.firstSeen), formatDate(c.lastSeen),
      ]),
    ];
    const csv  = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a    = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `thong-ke-${new Date().toISOString().slice(0,10)}.csv` });
    a.click();
    URL.revokeObjectURL(a.href);
    showToast('Đã xuất file CSV', 'success');
  }

  function exportPDF() {
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
body{font-family:Arial,sans-serif;font-size:12px;padding:20px}
h1{font-size:18px}table{width:100%;border-collapse:collapse}
th,td{border:1px solid #ddd;padding:6px 10px;text-align:left}
th{background:#f0f0f0}tr:nth-child(even)td{background:#fafafa}
@media print{body{padding:0}}
</style></head><body>
<h1>Báo cáo thống kê</h1>
<p>Xuất lúc: ${new Date().toLocaleString('vi-VN')} | Kỳ: ${count} ${period === 'day' ? 'ngày' : period === 'week' ? 'tuần' : 'tháng'}</p>
<p>Tổng đơn: ${totalOrders} | Doanh thu: ${formatCurrency(totalRevenue)}</p>
<table><thead><tr><th>#</th><th>Username</th><th>Tên</th><th>SĐT</th><th>Số đơn</th><th>Chi tiêu</th><th>Lần cuối</th></tr></thead>
<tbody>${customers.slice(0,50).map((c,i)=>`<tr><td>${i+1}</td><td>@${c.username}</td><td>${c.displayName||''}</td><td>${c.phone||''}</td><td>${c.totalOrders||0}</td><td>${formatCurrency(c.totalSpent)}</td><td>${formatDate(c.lastSeen)}</td></tr>`).join('')}</tbody>
</table><script>window.onload=()=>window.print()<\/script></body></html>`;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), target: '_blank' }).click();
    showToast('Đã mở trang in PDF', 'success');
  }

  return (
    <div className="page-scroll">
      {/* Header */}
      <div className="page-header">
        <h1 className="page-title">Thống kê</h1>
        <div className="page-header-actions">
          <button className="btn-outline" onClick={exportCSV}>📊 Xuất Excel</button>
          <button className="btn-outline" onClick={exportPDF}>📄 Xuất PDF</button>
        </div>
      </div>

      {/* Period */}
      <div className="period-bar">
        {PERIODS.map((p, i) => (
          <button key={i} className={`period-btn${periodIdx === i ? ' active' : ''}`} onClick={() => setPeriodIdx(i)}>
            {p.label}
          </button>
        ))}
      </div>

      {/* Summary */}
      <div className="stats-summary">
        <div className="stats-sum-card"><div className="stats-sum-label">Tổng đơn hàng</div><div className="stats-sum-value">{totalOrders.toLocaleString('vi-VN')}</div></div>
        <div className="stats-sum-card"><div className="stats-sum-label">Tổng doanh thu</div><div className="stats-sum-value">{formatCurrency(totalRevenue)}</div></div>
        <div className="stats-sum-card"><div className="stats-sum-label">TB đơn / kỳ</div><div className="stats-sum-value">{avgOrders}</div></div>
      </div>

      {/* Charts */}
      <div className="stats-charts">
        <div className="chart-card">
          <div className="chart-card-header"><h3 className="chart-title">Doanh thu</h3></div>
          <div className="chart-wrap">
            {chartData && <Line data={{
              labels: rLabels,
              datasets: [{ data: rValues, borderColor: '#6366F1', backgroundColor: 'rgba(99,102,241,0.08)', fill: true, tension: 0.4, pointRadius: 3, pointBackgroundColor: '#6366F1' }],
            }} options={{ ...{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: SCALES }, scales: { ...SCALES, y: { ...SCALES.y, ticks: { ...SCALES.y.ticks, callback: v => formatCurrency(v) } } } }} />}
          </div>
        </div>
        <div className="chart-card">
          <div className="chart-card-header"><h3 className="chart-title">Số đơn hàng</h3></div>
          <div className="chart-wrap">
            {chartData && <Bar data={{
              labels: oLabels,
              datasets: [{ data: oValues, backgroundColor: 'rgba(59,130,246,0.6)', borderColor: '#3B82F6', borderWidth: 1, borderRadius: 6 }],
            }} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: SCALES }} />}
          </div>
        </div>
      </div>

      {/* Top customers */}
      <div className="stats-table-card">
        <div className="stats-table-title">Top Khách hàng</div>
        <table className="data-table">
          <thead><tr><th>#</th><th>Khách hàng</th><th>Tổng đơn</th><th>Chi tiêu</th><th>Lần cuối mua</th></tr></thead>
          <tbody>
            {!topCustomers.length
              ? <tr><td colSpan={5} className="table-empty">Không có dữ liệu</td></tr>
              : topCustomers.map((c, i) => (
                <tr key={c.tiktokUserId}>
                  <td style={{ color: 'var(--text-muted)' }}>{i + 1}</td>
                  <td>
                    <div className="table-user-cell">
                      <div className="table-avatar" style={{ width: 28, height: 28, fontSize: 11 }}>{getInitials(c.username)}</div>
                      <div>
                        <div className="table-name">@{c.username}</div>
                        {c.phone && <div className="table-sub">{c.phone}</div>}
                      </div>
                    </div>
                  </td>
                  <td><strong style={{ color: 'var(--accent)' }}>{c.totalOrders || 0}</strong></td>
                  <td>{formatCurrency(c.totalSpent)}</td>
                  <td>{formatDate(c.lastSeen)}</td>
                </tr>
              ))
            }
          </tbody>
        </table>
      </div>
    </div>
  );
}
