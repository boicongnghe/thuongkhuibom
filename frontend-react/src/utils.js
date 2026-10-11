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

// Bỏ dấu tiếng Việt để so khớp: "Chốt" → "chot", "Đặt" → "dat".
// NFD không tách được "đ/Đ" (là chữ riêng, không phải d + dấu) nên phải thay tay.
export function normalizeVi(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase();
}

const escapeRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Bình luận có dấu hiệu chốt đơn không — dùng cho "Tự động in".
 * @param {string} text  nội dung bình luận
 * @param {object} opts  { keywords: 'chốt, lấy, mua', matchCode: true, matchPhone: true }
 */
export function looksLikeOrder(text, { keywords = 'chốt, lấy, mua, đặt', matchCode = true, matchPhone = true } = {}) {
  const t = normalizeVi(text);
  if (!t.trim()) return false;

  // Từ khoá đứng riêng thành 1 từ: "chot" khớp "chốt ạ", không khớp "chotdon"
  const words = String(keywords).split(',').map(k => normalizeVi(k).trim()).filter(Boolean);
  if (words.some(w => new RegExp(`(^|[^a-z0-9])${escapeRegex(w)}($|[^a-z0-9])`).test(t))) return true;

  // Mã SP: 1–3 chữ cái + 1–4 chữ số, vd A12, B05, SP123
  if (matchCode && /(^|[^a-z0-9])[a-z]{1,3}\d{1,4}($|[^a-z0-9])/.test(t)) return true;

  // SĐT VN: 0xxxxxxxxx hoặc 84/+84, cho phép cách bằng dấu cách / chấm / gạch
  if (matchPhone && /(^|\D)(0|\+?84)[35789]\d{8}(\D|$)/.test(t.replace(/[\s.-]/g, ''))) return true;

  return false;
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
