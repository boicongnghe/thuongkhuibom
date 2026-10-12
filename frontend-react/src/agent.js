// "Trạm" của app desktop (TikTok Live + máy in). Chỉ có khi trang đang mở bên trong
// app Chốt Đơn Live trên máy ở shop; mở bằng trình duyệt / điện thoại thì = null.
export const agent = typeof window !== 'undefined' ? window.desktopAgent || null : null;
export const isAgent = !!agent;

// Lỗi gọi qua app trả về dạng "Error invoking remote method 'agent:connect': Error: ..." → lấy phần sau
export function agentError(err) {
  return String(err?.message || err || 'Lỗi không xác định')
    .replace(/^Error invoking remote method '[^']+':\s*/, '')
    .replace(/^Error:\s*/, '');
}

// Kênh sự kiện nhỏ trong trang (AgentRunner ↔ trang Livestream)
const listeners = new Map();
export const liveBus = {
  on(event, fn) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
    return () => listeners.get(event)?.delete(fn);
  },
  emit(event, data) {
    listeners.get(event)?.forEach(fn => { try { fn(data); } catch (e) { console.error(e); } });
  },
};
