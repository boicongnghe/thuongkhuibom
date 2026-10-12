export const STATUS_LABELS = {
  pending:   { label: 'Chờ xử lý',  cls: 'status-pending'   },
  deposit:   { label: 'Đặt cọc',    cls: 'status-deposit'   },
  confirmed: { label: 'Xác nhận',   cls: 'status-confirmed' },
  shipping:  { label: 'Đã đi đơn',  cls: 'status-shipping'  },
  completed: { label: 'Hoàn thành', cls: 'status-completed' },
  cancelled: { label: 'Đã hủy',     cls: 'status-cancelled' },
};

export const STATUS_NEXT = {
  pending:   ['deposit', 'confirmed', 'cancelled'],
  deposit:   ['confirmed', 'cancelled'],
  confirmed: ['shipping', 'cancelled'],
  shipping:  ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

export const CHART_COLORS = {
  green:   { border: '#22c55e', bg: 'rgba(34,197,94,.12)'  },
  accent:  { border: '#fe2c55', bg: 'rgba(254,44,85,.5)'   },
  cyan:    { border: '#25f4ee', bg: 'rgba(37,244,238,.5)'  },
};

export const CHART_SCALES = {
  x: { ticks: { color: '#7c8499', font: { size: 11 } }, grid: { color: 'rgba(42,47,61,.5)' } },
  y: { ticks: { color: '#7c8499', font: { size: 11 } }, grid: { color: 'rgba(42,47,61,.5)' }, beginAtZero: true },
};
