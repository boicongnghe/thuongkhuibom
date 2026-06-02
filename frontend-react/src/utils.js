export function formatTime(isoStr) {
  return new Date(isoStr).toLocaleTimeString('vi-VN', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

export function formatDate(isoStr) {
  return new Date(isoStr).toLocaleDateString('vi-VN', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

export function formatDateTime(isoStr) {
  return new Date(isoStr).toLocaleString('vi-VN', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

export function formatCurrency(amount) {
  if (!amount && amount !== 0) return '0đ';
  return Number(amount).toLocaleString('vi-VN') + 'đ';
}

export function getInitials(username) {
  return (username || '?').replace('@', '').slice(0, 2).toUpperCase();
}

export function buildDayLabels(count) {
  const labels = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    labels.push(
      `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
    );
  }
  return labels;
}

export function mapChartDataToLabels(rawData, labels, valueKey) {
  const map = {};
  rawData.forEach(item => {
    if (item._id?.day) {
      const key = `${String(item._id.day).padStart(2, '0')}/${String(item._id.month).padStart(2, '0')}`;
      map[key] = item[valueKey] || 0;
    }
  });
  return labels.map(l => map[l] || 0);
}

export function buildStatsLabels(chartData, period) {
  if (!chartData.length) return [];
  if (period === 'week') return chartData.map(d => `T${d._id.week}/${d._id.year}`);
  if (period === 'month') {
    const months = ['Th1','Th2','Th3','Th4','Th5','Th6','Th7','Th8','Th9','Th10','Th11','Th12'];
    return chartData.map(d => `${months[(d._id.month || 1) - 1]}/${d._id.year}`);
  }
  return chartData.map(d =>
    `${String(d._id.day).padStart(2,'0')}/${String(d._id.month).padStart(2,'0')}`
  );
}
