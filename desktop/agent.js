// "Trạm" chạy trong app desktop ở shop: kết nối TikTok Live + in phiếu ra máy in USB.
// Không gọi API / database: chỉ báo sự kiện cho trang web của dịch vụ (đang mở trong app),
// trang web mới là bên gửi dữ liệu lên dịch vụ trung tâm (bằng đăng nhập của shop).
const { EventEmitter } = require('events');

const events = new EventEmitter();

let tiktok  = null;   // nạp chậm: cần PRINTER_NAME được đặt trước khi nạp printer.js
let printer = null;
function mods() {
  tiktok  ||= require('../backend/src/tiktok');
  printer ||= require('../backend/src/printer');
  return { tiktok, printer };
}

const state = { connected: false, connecting: false, username: '', sessionId: null, error: '' };
let connectSeq = 0;   // bỏ qua kết quả của lần kết nối cũ nếu đã bấm kết nối/ngắt lần mới

function setState(patch) {
  Object.assign(state, patch);
  events.emit('status', { ...state });
}

// ── Bình luận: chống trùng + gom lô gửi cho trang web mỗi 300ms ──
const recent = new Map();     // khoá chống trùng → hết hạn
let batch = [];
let flushTimer = null;

function onComment(c) {
  const key = `${c.tiktokUserId}_${c.comment}`;
  const now = Date.now();
  if (recent.has(key) && recent.get(key) > now) return;     // TikTok đôi khi gửi lặp trong 3 giây
  recent.set(key, now + 3000);
  if (recent.size > 2000) for (const [k, exp] of recent) if (exp < now) recent.delete(k);

  batch.push({ ...c, clientId: `${now}-${Math.random().toString(36).slice(2, 8)}` });
  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      const list = batch; batch = []; flushTimer = null;
      events.emit('comments', { sessionId: state.sessionId, comments: list });
    }, 300);
  }
}

async function connect({ username, sessionId }) {
  const clean = String(username || '').replace('@', '').trim();
  if (!clean) throw new Error('Username TikTok không hợp lệ');
  const seq = ++connectSeq;
  setState({ connecting: true, connected: false, username: clean, sessionId, error: '' });
  try {
    await mods().tiktok.connect(clean, {
      onConnected: () => { if (seq === connectSeq) setState({ connected: true, connecting: false, error: '' }); },
      onComment,
      onDisconnected: () => {
        if (seq !== connectSeq) return;
        setState({ connected: false, connecting: false, error: 'TikTok đã ngắt kết nối (live kết thúc?)' });
        events.emit('ended', { sessionId });
      },
      onError: (msg) => { if (seq === connectSeq) setState({ error: String(msg || '') }); },
    });
    if (seq === connectSeq) setState({ connected: true, connecting: false });
    return { ...state };
  } catch (err) {
    if (seq === connectSeq) setState({ connected: false, connecting: false, error: err.message || 'Không kết nối được TikTok Live' });
    throw err;
  }
}

async function disconnect() {
  connectSeq++;
  await mods().tiktok.disconnect();
  setState({ connected: false, connecting: false, error: '' });
  return { ...state };
}

// ── Máy in ────────────────────────────────────────────────
let printerCache = { at: 0, value: null };
async function printerStatus(force = false) {
  if (!force && printerCache.value && Date.now() - printerCache.at < 8000) return printerCache.value;
  const r = await mods().printer.checkPrinter();
  printerCache = { at: Date.now(), value: { ok: !!r.ok, printerName: r.printerName || '', status: r.status || r.error || '' } };
  return printerCache.value;
}

// In tuần tự: 2 việc in tới cùng lúc không bị chen dòng vào nhau
let printChain = Promise.resolve();
function print(job) {
  const run = () => mods().printer.printComment({
    username:    job.username,
    displayName: job.displayName,
    comment:     job.comment,
    timestamp:   job.timestamp,
    orderNum:    job.orderNumber,
    shopName:    job.shopName,
    reprint:     !!job.reprint,
  });
  const p = printChain.then(run, run);
  printChain = p.catch(() => {});
  return p;
}

function printTest() {
  const run = () => mods().printer.printTest();
  const p = printChain.then(run, run);
  printChain = p.catch(() => {});
  return p;
}

async function status() {
  return { tiktok: { ...state }, printer: await printerStatus() };
}

module.exports = { events, connect, disconnect, print, printTest, status, printerStatus, state };
