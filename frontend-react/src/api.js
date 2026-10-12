import { API_BASE } from './api/auth';

async function request(url, options = {}) {
  let res;
  try {
    res = await fetch(API_BASE + url, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'chotdon' },
      ...options,
    });
  } catch {
    throw new Error('Mất kết nối mạng, đang thử lại...');
  }
  const data = await res.json().catch(() => ({}));
  // Hết phiên đăng nhập → báo cho App hiện lại trang đăng nhập
  if (res.status === 401) window.dispatchEvent(new Event('auth:expired'));
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

const post = (url, body) => request(url, { method: 'POST', body: JSON.stringify(body || {}) });
const put  = (url, body) => request(url, { method: 'PUT',  body: JSON.stringify(body || {}) });

export const api = {
  // Dashboard
  getDashboard: ()                       => request('/api/dashboard'),
  getChart: (period, count)              => request(`/api/stats/chart?period=${period}&count=${count}`),

  // Tổng kết đơn: scope = session | today | 7d | 30d | all
  getSummary: (scope = 'session')        => request(`/api/stats/summary?scope=${scope}`),

  // Live: trạng thái app desktop ở shop + lệnh kết nối/ngắt từ bất kỳ thiết bị nào
  getLiveState: ()                       => request('/api/live/state'),
  setDesiredLive: (on, username = '')    => put('/api/live/desired', { on, username }),
  createSession: (tiktokUsername)        => post('/api/live/sessions', { tiktokUsername }),
  endSession: (id)                       => post(`/api/live/sessions/${id}/end`),
  reportAgentStatus: (body)              => post('/api/agent/status', body),

  // Bình luận
  getRecentComments: ({ limit = 200, afterId, sessionId } = {}) => {
    const q = new URLSearchParams({ limit: String(limit) });
    if (afterId) q.set('afterId', afterId);
    if (sessionId) q.set('sessionId', sessionId);
    return request(`/api/comments/recent?${q}`);
  },
  postComments: (sessionId, comments)    => post('/api/comments/batch', { sessionId, comments }),

  // Orders
  getOrders: (params)                    => request(`/api/orders?${new URLSearchParams(params)}`),
  createOrder: (body)                    => post('/api/orders', body),
  orderFromComment: (commentId, print = true) => post('/api/orders/from-comment', { commentId, print }),
  reprintOrder: (id)                     => post(`/api/orders/${id}/print`),
  updateOrderStatus: (id, status)        => put(`/api/orders/${id}/status`, { status }),
  updateOrderAmount: (id, body)          => put(`/api/orders/${id}/amount`, body),

  // Hàng đợi in (chỉ app desktop dùng)
  claimPrintJob: ()                      => post('/api/print-queue/claim'),
  finishPrintJob: (id, ok, error = '')   => post(`/api/print-queue/${id}/done`, { ok, error }),

  // Customers
  getCustomers: ()                       => request('/api/customers'),
  searchCustomers: (q)                   => request(`/api/customers/search?q=${encodeURIComponent(q)}`),
  getCustomer: (id)                      => request(`/api/customers/${id}`),
  getCustomerOrders: (id)                => request(`/api/customers/${id}/orders`),
  updateCustomer: (id, body)             => put(`/api/customers/${id}`, body),

  // Settings
  getSettings: ()                        => request('/api/settings'),
  saveSettings: (body)                   => put('/api/settings', body),

  // Quản trị dịch vụ (tài khoản đầu tiên)
  getShops: ()                           => request('/api/admin/shops'),
  // action: approve | reject | disable | enable
  userAction: (username, action)         => post(`/api/admin/users/${encodeURIComponent(username)}/${action}`),
  setDownload: (body)                    => put('/api/admin/download', body),

  // Công khai: link tải app desktop (trang chủ)
  getDownload: ()                        => request('/api/public/download'),
};
