async function request(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export const api = {
  // Dashboard
  getDashboard: ()                       => request('/api/dashboard'),
  getChart: (period, count)              => request(`/api/stats/chart?period=${period}&count=${count}`),

  // Orders
  getOrders: (params)                    => request(`/api/orders?${new URLSearchParams(params)}`),
  createOrder: (body)                    => request('/api/orders', { method: 'POST', body: JSON.stringify(body) }),
  updateOrderStatus: (id, status)        => request(`/api/orders/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) }),
  updateOrderAmount: (id, body)          => request(`/api/orders/${id}/amount`, { method: 'PUT', body: JSON.stringify(body) }),

  // Customers
  getCustomers: ()                       => request('/api/customers'),
  searchCustomers: (q)                   => request(`/api/customers/search?q=${encodeURIComponent(q)}`),
  getCustomer: (id)                      => request(`/api/customers/${id}`),
  getCustomerOrders: (id)                => request(`/api/customers/${id}/orders`),
  updateCustomer: (id, body)             => request(`/api/customers/${id}`, { method: 'PUT', body: JSON.stringify(body) }),

  // Printer
  checkPrinter: ()                       => request('/api/printer/check'),
  testPrinterIP: (ip, port)              => request('/api/printer/test-ip', { method: 'POST', body: JSON.stringify({ ip, port }) }),

  // Settings
  getSettings: ()                        => request('/api/settings'),
  saveSettings: (body)                   => request('/api/settings', { method: 'PUT', body: JSON.stringify(body) }),
};
