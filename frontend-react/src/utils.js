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

/**
 * Chữ hiển thị trạng thái máy in từ kết quả /api/printer/check.
 * remote = true: bản web (Vercel) đọc trạng thái mà máy tính chạy app gửi lên.
 */
export function describePrinter(d) {
  const st   = d?.status || '';
  const name = d?.printerName || 'Máy in';
  const ago  = d?.remote && d.lastSeenSec != null ? ` (cập nhật ${d.lastSeenSec}s trước)` : '';
  if (st === 'PC_OFFLINE') {
    return { ok: false, text: 'Máy tính chưa mở app — không biết trạng thái máy in' };
  }
  if (d?.ok) return { ok: true, text: `${name} · Sẵn sàng${ago}` };
  if (st === 'NOT_LOCAL') return { ok: false, text: 'Máy in: chỉ trên máy tính' };
  if (st === 'NOT_FOUND') return { ok: false, text: `Không tìm thấy máy in ${name}${ago}` };
  if (st.startsWith('OFFLINE')) return { ok: false, text: `${name} · Chưa kết nối${ago}` };
  return { ok: false, text: `${name} · Lỗi${ago}` };
}

const MAX_VND = 1_000_000_000;

/**
 * Đọc số tiền gõ nhanh kiểu người bán hàng, trả về số nguyên VND hoặc null nếu không hiểu.
 *   "189000" | "189.000" | "189,000" → 189000
 *   "189k" | "189 nghìn"             → 189000
 *   "189"  (số < 1000)               → 189000   (bán live hay gõ tắt nghìn đồng)
 *   "1tr2" → 1200000 · "1.5tr" → 1500000 · "2tr" → 2000000
 */
export function parseVnd(input) {
  let s = normalizeVi(input).replace(/\s+/g, '').replace(/(vnd|dong|d)$/, '');
  if (!s) return null;
  let v = null;
  let m;
  if ((m = s.match(/^(\d+(?:[.,]\d+)?)(tr|trieu|m)(\d{1,3})?$/))) {
    const base = parseFloat(m[1].replace(',', '.'));
    const tail = m[3] ? Number(m[3].padEnd(3, '0')) * 1000 : 0;   // 1tr2 → 200.000
    v = base * 1_000_000 + tail;
  } else if ((m = s.match(/^(\d+(?:[.,]\d+)?)(k|nghin|ngan|n)$/))) {
    v = parseFloat(m[1].replace(',', '.')) * 1000;
  } else if (/^\d{1,3}([.,]\d{3})+$/.test(s)) {
    v = Number(s.replace(/[.,]/g, ''));
  } else if (/^\d+$/.test(s)) {
    v = Number(s);
    if (v > 0 && v < 1000) v *= 1000;
  }
  if (v === null || !Number.isFinite(v)) return null;
  v = Math.round(v);
  return v >= 0 && v <= MAX_VND ? v : null;
}

// Số tiền gọn cho chỗ hẹp: 950.000đ → "950k", 1.250.000đ → "1,25tr"
export function formatVndShort(amount) {
  const n = Number(amount) || 0;
  if (n >= 1_000_000) return `${(Math.round(n / 10_000) / 100).toLocaleString('vi-VN')}tr`;
  if (n >= 1000) return `${(Math.round(n / 100) / 10).toLocaleString('vi-VN')}k`;
  return `${n.toLocaleString('vi-VN')}đ`;
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
