import { useEffect, useState, useRef } from 'react';
import { Line, Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement,
  LineElement, BarElement, Filler, Tooltip,
} from 'chart.js';
import { api } from '../api';
import { formatCurrency, formatDateTime, getInitials, buildDayLabels, mapChartDataToLabels } from '../utils';
import StatusBadge from '../components/StatusBadge';
import { useApp } from '../context/AppContext';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Filler, Tooltip);

const CHART_OPT = {
  responsive: true, maintainAspectRatio: false,
  plugins: { legend: { display: false } },
  scales: {
    x: { ticks: { color: '#94A3B8', font: { size: 11 } }, grid: { color: 'rgba(226,232,240,0.8)' } },
    y: { ticks: { color: '#94A3B8', font: { size: 11 } }, grid: { color: 'rgba(226,232,240,0.8)' }, beginAtZero: true },
  },
};

export default function Dashboard() {
  const { showToast } = useApp();
  const [stats, setStats]   = useState(null);
  const [chart, setChart]   = useState(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const [d, c] = await Promise.all([api.getDashboard(), api.getChart('day', 7)]);
      setStats(d);
      setChart(c);
    } catch (err) {
      showToast('Lỗi tải Dashboard', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const labels   = buildDayLabels(7);
  const revData  = chart ? mapChartDataToLabels(chart.revenueChart || [], labels, 'total') : [];
  const ordData  = chart ? mapChartDataToLabels(chart.orderChart   || [], labels, 'count') : [];

  return (
    <div className="page-scroll">
      {/* Header */}
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
        <button className="btn-icon" onClick={load} title="Làm mới">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
            <polyline points="23 4 23 10 17 10"/>
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
          </svg>
        </button>
      </div>

      {/* Stat cards */}
      <div className="dash-stats">
        {[
          { id: 'orders',    icon: '📦', value: stats?.totalOrders,    label: 'Tổng đơn hàng',  color: '#EEF2FF', textColor: '#6366F1' },
          { id: 'customers', icon: '👥', value: stats?.totalCustomers, label: 'Tổng khách hàng', color: '#EFF6FF', textColor: '#3B82F6' },
          { id: 'revenue',   icon: '💰', value: null,                  label: 'Tổng doanh thu',  color: '#ECFDF5', textColor: '#10B981' },
          { id: 'sessions',  icon: '📺', value: stats?.totalSessions,  label: 'Tổng Livestream', color: '#FFFBEB', textColor: '#F59E0B' },
        ].map(item => (
          <div key={item.id} className="dash-stat-card">
            <div className="dash-stat-icon" style={{ background: item.color, color: item.textColor }}>
              {item.icon}
            </div>
            <div className="dash-stat-body">
              <div className="dash-stat-value">
                {loading ? '—' : item.id === 'revenue'
                  ? formatCurrency(stats?.totalRevenue || 0)
                  : (item.value || 0).toLocaleString('vi-VN')}
              </div>
              <div className="dash-stat-label">{item.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="dash-charts">
        <div className="chart-card">
          <div className="chart-card-header"><h3 className="chart-title">Doanh thu (7 ngày)</h3></div>
          <div className="chart-wrap">
            {chart && <Line data={{
              labels,
              datasets: [{ data: revData, borderColor: '#6366F1', backgroundColor: 'rgba(99,102,241,0.08)', fill: true, tension: 0.4, pointRadius: 4, pointBackgroundColor: '#6366F1' }],
            }} options={{
              ...CHART_OPT,
              scales: { ...CHART_OPT.scales, y: { ...CHART_OPT.scales.y, ticks: { ...CHART_OPT.scales.y.ticks, callback: v => formatCurrency(v) } } },
            }} />}
          </div>
        </div>
        <div className="chart-card">
          <div className="chart-card-header"><h3 className="chart-title">Đơn hàng (7 ngày)</h3></div>
          <div className="chart-wrap">
            {chart && <Bar data={{
              labels,
              datasets: [{ data: ordData, backgroundColor: 'rgba(99,102,241,0.7)', borderColor: '#6366F1', borderWidth: 1, borderRadius: 6 }],
            }} options={CHART_OPT} />}
          </div>
        </div>
      </div>

      {/* Bottom */}
      <div className="dash-bottom">
        {/* Top customers */}
        <div className="dash-section-card">
          <div className="dash-section-header"><h3 className="dash-section-title">🏆 Top Khách hàng</h3></div>
          <div className="dash-top-list">
            {!stats?.topCustomers?.length
              ? <p style={{ color: 'var(--text-dim)', fontSize: 13, padding: '12px 0' }}>Chưa có dữ liệu</p>
              : stats.topCustomers.map((c, i) => (
                <div key={c.tiktokUserId} className="dash-rank-row">
                  <span className="rank-num">{i + 1}</span>
                  <div className="rank-avatar">{getInitials(c.username)}</div>
                  <div className="rank-info">
                    <div className="rank-name">@{c.username}</div>
                    <div className="rank-sub">{c.totalOrders || 0} đơn · {formatCurrency(c.totalSpent)}</div>
                  </div>
                  <div className="rank-value">{c.totalOrders || 0}</div>
                </div>
              ))
            }
          </div>
        </div>

        {/* Recent orders */}
        <div className="dash-section-card">
          <div className="dash-section-header"><h3 className="dash-section-title">🕐 Đơn mới nhất</h3></div>
          <div className="dash-recent-list">
            {!stats?.recentOrders?.length
              ? <p style={{ color: 'var(--text-dim)', fontSize: 13, padding: '12px 0' }}>Chưa có đơn hàng</p>
              : stats.recentOrders.map(o => (
                <div key={o._id} className="dash-recent-row">
                  <div className="recent-info">
                    <div className="recent-name">@{o.username}</div>
                    <div className="recent-note">{(o.note || '').slice(0, 40)}{(o.note || '').length > 40 ? '...' : ''}</div>
                  </div>
                  <div className="recent-right">
                    <StatusBadge status={o.status} />
                    <div className="recent-time">{formatDateTime(o.createdAt)}</div>
                  </div>
                </div>
              ))
            }
          </div>
        </div>
      </div>
    </div>
  );
}
