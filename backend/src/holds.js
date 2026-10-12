// ══════════════════════════════════════════════════════════
// DỒN ĐƠN · XẢ HÀNG · ĐI ĐƠN · THỐNG KÊ THEO NGÀY
//
// Luật (chỉnh hạn cọc trong Cài đặt → Hệ thống):
//  - Đơn chưa đi (Chờ xử lý / Đặt cọc / Xác nhận) của 1 khách = nhóm đơn DỒN.
//  - Khách có cọc (cọc dồn đơn hoặc cọc ở đơn) → được dồn tiếp, không tính hạn.
//  - Khách chưa cọc: quá N giờ (mặc định 24) kể từ đơn cũ nhất → QUÁ HẠN CỌC, cần xả hàng.
//  - Xả hàng: huỷ đơn (lý do "xả hàng"); cọc của khách (nếu có) → MẤT CỌC.
//    Hệ thống KHÔNG tự xả — chỉ cảnh báo; chủ shop bấm xả.
//  - Đi đơn: chọn đơn của 1 khách → tạo phiếu đi đơn, đơn chuyển "Đã đi đơn",
//    trừ cọc vào tiền phải thu.
// ══════════════════════════════════════════════════════════
const db = require('./database');

const { Order, Customer, Shipment, requireShop, businessError } = db;

const HELD_STATUSES = ['pending', 'deposit', 'confirmed'];
const DEFAULT_DEADLINE_HOURS = 24;

function escapeRegex(str) {
  return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function deadlineHours(settings) {
  const h = Number(settings?.system?.depositDeadlineHours);
  return Number.isInteger(h) && h >= 1 && h <= 720 ? h : DEFAULT_DEADLINE_HOURS;
}

// Khoảng 1 ngày theo giờ Việt Nam (UTC+7) từ chuỗi "YYYY-MM-DD"
function vnDayRange(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''));
  if (!m) throw businessError('Ngày không hợp lệ (định dạng YYYY-MM-DD)');
  const VN = 7 * 3600 * 1000;
  const from = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]) - VN);
  if (Number.isNaN(from.getTime())) throw businessError('Ngày không hợp lệ');
  return { from, to: new Date(from.getTime() + 24 * 3600 * 1000) };
}

const money = (n) => `${Math.round(Number(n) || 0).toLocaleString('vi-VN')}d`;
const fmtTime = (d) => new Date(d).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

// ══════════════════════════════════════════════════════════
// Danh sách khách đang dồn đơn
// ══════════════════════════════════════════════════════════
/**
 * @returns {{ deadlineHours, customers: Array, totals }}
 *  mỗi khách: { tiktokUserId, username, displayName, phone, orders[], orderCount, amount,
 *               orderDeposit, holdDeposit, deposit, remaining, noAmount, oldestAt, deadlineAt,
 *               state: 'covered' | 'waiting' | 'overdue', msLeft }
 */
async function getHolds(shopId, { search, settings, now = Date.now() } = {}) {
  requireShop(shopId);
  const hours = deadlineHours(settings);
  const orders = await Order.find({ shopId, status: { $in: HELD_STATUSES }, shipmentId: null })
    .sort({ createdAt: 1 }).limit(5000).lean();

  const byUser = new Map();
  for (const o of orders) {
    if (!byUser.has(o.tiktokUserId)) byUser.set(o.tiktokUserId, []);
    byUser.get(o.tiktokUserId).push(o);
  }
  const customers = await Customer.find({ shopId, tiktokUserId: { $in: [...byUser.keys()] } }).lean();
  const custMap = new Map(customers.map(c => [c.tiktokUserId, c]));

  let list = [...byUser].map(([tiktokUserId, os]) => {
    const c = custMap.get(tiktokUserId) || {};
    const amount       = os.reduce((t, o) => t + (o.amount || 0), 0);
    const orderDeposit = os.reduce((t, o) => t + (o.depositAmount || 0), 0);
    const holdDeposit  = c.holdDeposit || 0;
    const deposit      = orderDeposit + holdDeposit;
    const oldestAt     = os[0].createdAt;
    const deadlineAt   = new Date(new Date(oldestAt).getTime() + hours * 3600 * 1000);
    const state = deposit > 0 ? 'covered' : now < deadlineAt.getTime() ? 'waiting' : 'overdue';
    return {
      tiktokUserId,
      username:    c.username || os[os.length - 1].username,
      displayName: c.displayName || os[os.length - 1].displayName || '',
      phone:       c.phone || '',
      orders: os.map(o => ({
        _id: String(o._id), orderNumber: o.orderNumber, note: o.note, amount: o.amount || 0,
        depositAmount: o.depositAmount || 0, status: o.status, createdAt: o.createdAt,
        printPending: !!o.printPending, printedAt: o.printedAt,
      })),
      orderCount: os.length,
      amount,
      orderDeposit,
      holdDeposit,
      deposit,
      remaining: Math.max(0, amount - deposit),
      noAmount:  os.filter(o => !(o.amount > 0)).length,
      oldestAt,
      deadlineAt,
      state,
      msLeft: state === 'waiting' ? deadlineAt.getTime() - now : 0,
    };
  });

  if (search) {
    const re = new RegExp(escapeRegex(search.trim()), 'i');
    list = list.filter(c => re.test(c.username) || re.test(c.displayName) || re.test(c.phone)
      || c.orders.some(o => re.test(o.orderNumber || '')));
  }

  // Quá hạn lên đầu (cần xử lý), rồi sắp hết hạn, rồi đã cọc
  const rank = { overdue: 0, waiting: 1, covered: 2 };
  list.sort((a, b) => rank[a.state] - rank[b.state] || new Date(a.deadlineAt) - new Date(b.deadlineAt));

  const sum = (arr, k) => arr.reduce((t, x) => t + (x[k] || 0), 0);
  const overdue = list.filter(c => c.state === 'overdue');
  return {
    deadlineHours: hours,
    customers: list,
    totals: {
      customers:      list.length,
      orders:         sum(list, 'orderCount'),
      amount:         sum(list, 'amount'),
      deposit:        sum(list, 'deposit'),
      remaining:      sum(list, 'remaining'),
      covered:        list.filter(c => c.state === 'covered').length,
      waiting:        list.filter(c => c.state === 'waiting').length,
      overdue:        overdue.length,
      overdueOrders:  sum(overdue, 'orderCount'),
      overdueAmount:  sum(overdue, 'amount'),
    },
  };
}

async function heldOrdersOf(shopId, tiktokUserId, orderIds) {
  const filter = { shopId, tiktokUserId, status: { $in: HELD_STATUSES }, shipmentId: null };
  if (orderIds) filter._id = { $in: orderIds };
  return Order.find(filter).sort({ createdAt: 1 }).lean();
}

// ── Cọc dồn đơn ───────────────────────────────────────────
async function setHoldDeposit(shopId, tiktokUserId, amount) {
  requireShop(shopId);
  const customer = await Customer.findOneAndUpdate(
    { shopId, tiktokUserId },
    { $set: { holdDeposit: amount, holdDepositAt: amount > 0 ? new Date() : null } },
    { new: true },
  ).lean();
  if (!customer) throw businessError('Không tìm thấy khách hàng', 404);
  // Đồng bộ trạng thái đơn để trang Đơn hàng thấy "Đặt cọc"
  if (amount > 0) {
    await Order.updateMany({ shopId, tiktokUserId, status: 'pending', shipmentId: null }, { $set: { status: 'deposit', updatedAt: new Date() } });
  } else {
    await Order.updateMany({ shopId, tiktokUserId, status: 'deposit', shipmentId: null, depositAmount: { $lte: 0 } }, { $set: { status: 'pending', updatedAt: new Date() } });
  }
  return { tiktokUserId, holdDeposit: customer.holdDeposit };
}

// ── Xả hàng ───────────────────────────────────────────────
/**
 * Huỷ các đơn dồn của khách (orderIds = null: tất cả). Xả hết đơn → cọc dồn đơn thành MẤT CỌC.
 * @returns {{ released, amount, forfeited }}
 */
async function releaseHold(shopId, tiktokUserId, { orderIds = null, by = '' } = {}) {
  requireShop(shopId);
  const targets = await heldOrdersOf(shopId, tiktokUserId, orderIds);
  if (!targets.length) throw businessError('Không còn đơn dồn nào để xả', 409);

  const customer = await Customer.findOne({ shopId, tiktokUserId }).lean();
  const allHeld = await heldOrdersOf(shopId, tiktokUserId);
  const releasingAll = allHeld.length === targets.length;
  const holdForfeit = releasingAll ? (customer?.holdDeposit || 0) : 0;

  const now = new Date();
  let released = 0, amount = 0, forfeited = 0;
  for (let i = 0; i < targets.length; i++) {
    const o = targets[i];
    // Cọc dồn đơn tính vào đơn đầu tiên bị xả (để thống kê theo ngày cộng đúng 1 lần)
    const f = (o.depositAmount || 0) + (i === 0 ? holdForfeit : 0);
    const r = await Order.updateOne(
      { _id: o._id, shopId, status: { $in: HELD_STATUSES }, shipmentId: null },
      { $set: { status: 'cancelled', cancelReason: 'xa_hang', releasedAt: now, forfeitedDeposit: f, updatedAt: now } },
    );
    if (r.modifiedCount) { released++; amount += o.amount || 0; forfeited += f; }
  }
  if (!released) throw businessError('Các đơn vừa được xử lý ở thiết bị khác, hãy tải lại', 409);

  const inc = { totalOrders: -released, forfeitedTotal: forfeited };
  const set = releasingAll ? { holdDeposit: 0, holdDepositAt: null } : {};
  await Customer.updateOne({ shopId, tiktokUserId }, { $inc: inc, $set: set });
  await Customer.updateOne({ shopId, tiktokUserId, totalOrders: { $lt: 0 } }, { $set: { totalOrders: 0 } });
  console.log(`[Holds] ${by} xả ${released} đơn của ${tiktokUserId}, mất cọc ${forfeited}`);
  return { released, amount, forfeited };
}

/** Xả tất cả khách quá hạn cọc. */
async function releaseOverdue(shopId, { settings, by } = {}) {
  const { customers } = await getHolds(shopId, { settings });
  const overdue = customers.filter(c => c.state === 'overdue');
  let released = 0, amount = 0, forfeited = 0, failed = 0;
  for (const c of overdue) {
    try {
      const r = await releaseHold(shopId, c.tiktokUserId, { by });
      released += r.released; amount += r.amount; forfeited += r.forfeited;
    } catch { failed++; }
  }
  return { customers: overdue.length - failed, released, amount, forfeited };
}

// ── Đi đơn ────────────────────────────────────────────────
/**
 * Gom các đơn đã chọn của 1 khách thành phiếu đi đơn.
 * useHoldDeposit: số tiền cọc dồn đơn trừ vào phiếu này (mặc định: toàn bộ).
 */
async function shipOrders(shopId, tiktokUserId, orderIds, { useHoldDeposit, by = '' } = {}) {
  requireShop(shopId);
  if (!Array.isArray(orderIds) || !orderIds.length) throw businessError('Chưa chọn đơn nào để đi');
  const unique = [...new Set(orderIds.map(String))];
  const orders = await heldOrdersOf(shopId, tiktokUserId, unique);
  if (orders.length !== unique.length) {
    throw businessError('Có đơn không còn chờ đi (đã đi, đã huỷ hoặc không thuộc khách này). Hãy tải lại.', 409);
  }

  const customer = await Customer.findOne({ shopId, tiktokUserId }).lean();
  const holdAvail = customer?.holdDeposit || 0;
  const holdUse = useHoldDeposit === undefined ? holdAvail : Math.max(0, Math.min(holdAvail, Math.round(Number(useHoldDeposit) || 0)));
  const amount = orders.reduce((t, o) => t + (o.amount || 0), 0);
  const orderDeposit = orders.reduce((t, o) => t + (o.depositAmount || 0), 0);
  const depositApplied = orderDeposit + holdUse;

  const code = await db.nextDailyCode(shopId, 'ship', 'DI');
  const shipment = await Shipment.create({
    shopId, code, tiktokUserId,
    username: customer?.username || orders[0].username,
    displayName: customer?.displayName || orders[0].displayName || '',
    phone: customer?.phone || '',
    orderIds: orders.map(o => String(o._id)),
    orderCount: orders.length,
    amount,
    depositApplied,
    cod: Math.max(0, amount - depositApplied),
    createdBy: by,
  });

  // Chuyển đơn sang "Đã đi đơn" — chỉ đơn vẫn còn chờ (chống 2 thiết bị đi cùng đơn)
  const now = new Date();
  const r = await Order.updateMany(
    { _id: { $in: orders.map(o => o._id) }, shopId, status: { $in: HELD_STATUSES }, shipmentId: null },
    { $set: { status: 'shipping', shipmentId: String(shipment._id), shippedAt: now, updatedAt: now } },
  );
  if (r.modifiedCount !== orders.length) {
    // Có đơn vừa bị đổi ở thiết bị khác → hoàn tác cho sạch
    await Order.updateMany({ shipmentId: String(shipment._id) }, { $set: { shipmentId: null, shippedAt: null } });
    for (const o of orders) await Order.updateOne({ _id: o._id, shipmentId: null, status: 'shipping' }, { $set: { status: o.status } });
    await Shipment.deleteOne({ _id: shipment._id });
    throw businessError('Có đơn vừa được xử lý ở thiết bị khác. Hãy tải lại rồi thử lại.', 409);
  }
  if (holdUse > 0) await Customer.updateOne({ shopId, tiktokUserId }, { $inc: { holdDeposit: -holdUse } });
  return { shipment: shipment.toObject(), orders };
}

async function getShipments(shopId, { date } = {}) {
  requireShop(shopId);
  const q = { shopId };
  if (date) { const { from, to } = vnDayRange(date); q.createdAt = { $gte: from, $lt: to }; }
  return Shipment.find(q).sort({ createdAt: -1 }).limit(200).lean();
}

// ══════════════════════════════════════════════════════════
// Thống kê theo ngày
// ══════════════════════════════════════════════════════════
async function getDaily(shopId, date) {
  requireShop(shopId);
  const { from, to } = vnDayRange(date);
  const [created, released, shipments] = await Promise.all([
    Order.find({ shopId, createdAt: { $gte: from, $lt: to } }).sort({ createdAt: 1 }).lean(),
    Order.find({ shopId, releasedAt: { $gte: from, $lt: to } }).lean(),
    Shipment.find({ shopId, createdAt: { $gte: from, $lt: to } }).lean(),
  ]);

  const rows = new Map();
  for (const o of created) {
    const r = rows.get(o.tiktokUserId) || {
      tiktokUserId: o.tiktokUserId, username: o.username, displayName: o.displayName || '',
      orders: 0, cancelled: 0, amount: 0, deposit: 0, shipped: 0, held: 0, orderNumbers: [],
    };
    if (o.status === 'cancelled') r.cancelled++;
    else {
      r.orders++;
      r.amount += o.amount || 0;
      r.deposit += o.depositAmount || 0;
      if (o.shipmentId || o.status === 'shipping' || o.status === 'completed') r.shipped++;
      else r.held++;
    }
    r.orderNumbers.push(o.orderNumber);
    rows.set(o.tiktokUserId, r);
  }
  const customers = await Customer.find({ shopId, tiktokUserId: { $in: [...rows.keys()] } }).select('tiktokUserId phone holdDeposit displayName').lean();
  for (const c of customers) {
    const r = rows.get(c.tiktokUserId);
    if (r) { r.phone = c.phone || ''; r.holdDeposit = c.holdDeposit || 0; if (c.displayName) r.displayName = c.displayName; }
  }
  const list = [...rows.values()].sort((a, b) => b.amount - a.amount || b.orders - a.orders);
  const sum = (arr, k) => arr.reduce((t, x) => t + (x[k] || 0), 0);

  return {
    date,
    totals: {
      orders:          sum(list, 'orders'),
      customers:       list.filter(r => r.orders > 0).length,
      amount:          sum(list, 'amount'),
      deposit:         sum(list, 'deposit'),
      cancelled:       sum(list, 'cancelled'),
      noAmount:        created.filter(o => o.status !== 'cancelled' && !(o.amount > 0)).length,
      shipments:       shipments.length,
      shippedOrders:   sum(shipments, 'orderCount'),
      shippedAmount:   sum(shipments, 'amount'),
      shippedCod:      sum(shipments, 'cod'),
      releasedOrders:  released.length,
      releasedAmount:  sum(released, 'amount'),
      forfeited:       sum(released, 'forfeitedDeposit'),
    },
    customers: list,
  };
}

// ══════════════════════════════════════════════════════════
// Nội dung phiếu in (khổ 58mm, app ở shop in ra)
// ══════════════════════════════════════════════════════════
function orderRows(orders) {
  return orders.map(o => ({ left: `${o.orderNumber} ${String(o.note || '').slice(0, 60)}`, right: money(o.amount) }));
}

function customerSummaryReport(customer, orders, holdDeposit) {
  const amount = orders.reduce((t, o) => t + (o.amount || 0), 0);
  const deposit = orders.reduce((t, o) => t + (o.depositAmount || 0), 0) + (holdDeposit || 0);
  return {
    title: 'PHIEU TONG DON',
    subtitle: `@${customer.username}${customer.displayName && customer.displayName !== customer.username ? ` (${customer.displayName})` : ''}${customer.phone ? ` - ${customer.phone}` : ''}`,
    rows: [
      ...orderRows(orders),
      { divider: true },
      { left: `Tong ${orders.length} don`, right: money(amount) },
      { left: 'Da coc', right: money(deposit) },
      { left: 'CON PHAI THU', right: money(Math.max(0, amount - deposit)) },
    ],
    footer: [`In luc ${fmtTime(new Date())}`],
  };
}

function shipmentReport(shipment, orders) {
  return {
    title: `PHIEU DI DON ${shipment.code}`,
    subtitle: `@${shipment.username}${shipment.displayName && shipment.displayName !== shipment.username ? ` (${shipment.displayName})` : ''}${shipment.phone ? ` - ${shipment.phone}` : ''}`,
    rows: [
      ...orderRows(orders),
      { divider: true },
      { left: `Tong ${shipment.orderCount} don`, right: money(shipment.amount) },
      { left: 'Tru coc', right: money(shipment.depositApplied) },
      { left: 'THU KHI GIAO (COD)', right: money(shipment.cod) },
    ],
    footer: [`Di don luc ${fmtTime(shipment.createdAt)}`],
  };
}

function dailyReport(daily) {
  const t = daily.totals;
  const [y, m, d] = daily.date.split('-');
  return {
    title: `TONG KET NGAY ${d}/${m}/${y}`,
    subtitle: `${t.customers} khach - ${t.orders} don`,
    rows: [
      { left: 'Tong tien', right: money(t.amount) },
      { left: 'Da coc', right: money(t.deposit) },
      { left: `Da di don (${t.shipments} phieu)`, right: money(t.shippedAmount) },
      { left: 'Thu khi giao (COD)', right: money(t.shippedCod) },
      { left: `Xa hang (${t.releasedOrders} don)`, right: money(t.releasedAmount) },
      { left: 'Mat coc', right: money(t.forfeited) },
      { divider: true },
      ...daily.customers.filter(r => r.orders > 0).slice(0, 80).map(r => ({ left: `@${r.username} x${r.orders}`, right: money(r.amount) })),
    ],
    footer: [`In luc ${fmtTime(new Date())}`],
  };
}

module.exports = {
  HELD_STATUSES, deadlineHours, vnDayRange,
  getHolds, setHoldDeposit, releaseHold, releaseOverdue, shipOrders, getShipments, getDaily,
  heldOrdersOf, customerSummaryReport, shipmentReport, dailyReport,
};
