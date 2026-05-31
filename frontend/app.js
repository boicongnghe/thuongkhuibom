// ── Socket.io ─────────────────────────────────────────────
const socket = io();

// ── State ─────────────────────────────────────────────────
let commentCount = 0;
let orderCount = 0;
let customerCount = 0;
let isConnected = false;

// ── DOM refs ──────────────────────────────────────────────
const usernameInput = document.getElementById('usernameInput');
const connectBtn    = document.getElementById('connectBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const commentFeed   = document.getElementById('commentFeed');
const feedEmpty     = document.getElementById('feedEmpty');
const orderList     = document.getElementById('orderList');
const customerList  = document.getElementById('customerList');
const tiktokBadge   = document.getElementById('tiktokBadge');
const liveIndicator = document.getElementById('liveIndicator');
const printerStatus = document.getElementById('printerStatus');
const printerText   = document.getElementById('printerText');
const statComments  = document.getElementById('statComments');
const statOrders    = document.getElementById('statOrders');
const statCustomers = document.getElementById('statCustomers');
const orderCountEl  = document.getElementById('orderCount');
const customerCountEl = document.getElementById('customerCount');

// ── Helpers ───────────────────────────────────────────────
function formatTime(isoStr) {
  const d = new Date(isoStr);
  return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function getInitials(username) {
  return (username || '?').replace('@','').slice(0,2).toUpperCase();
}

function showToast(msg, type = 'info', duration = 2800) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = `toast show ${type}`;
  setTimeout(() => { toast.className = 'toast'; }, duration);
}

// ── Tabs ──────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const target = tab.dataset.tab;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`tab-${target}`).classList.add('active');
  });
});

// ── Connect / Disconnect ──────────────────────────────────
connectBtn.addEventListener('click', () => {
  const username = usernameInput.value.trim();
  if (!username) { showToast('Vui lòng nhập username TikTok', 'error'); return; }
  connectBtn.disabled = true;
  connectBtn.textContent = 'Đang kết nối...';
  socket.emit('tiktok:connect', { username });
});

disconnectBtn.addEventListener('click', () => {
  socket.emit('tiktok:disconnect');
});

// ── TikTok Status ─────────────────────────────────────────
socket.on('tiktok:status', ({ connected, username, loading }) => {
  isConnected = connected;

  if (loading) {
    tiktokBadge.className = 'tiktok-badge';
    tiktokBadge.querySelector('.badge-text').textContent = 'Đang kết nối...';
    return;
  }

  if (connected) {
    tiktokBadge.className = 'tiktok-badge connected';
    tiktokBadge.querySelector('.badge-text').textContent = `@${username}`;
    liveIndicator.classList.add('active');
    connectBtn.classList.add('hidden');
    disconnectBtn.classList.remove('hidden');
    showToast(`✅ Đã kết nối @${username}`, 'success');
  } else {
    tiktokBadge.className = 'tiktok-badge';
    tiktokBadge.querySelector('.badge-text').textContent = 'Chưa kết nối';
    liveIndicator.classList.remove('active');
    connectBtn.classList.remove('hidden');
    connectBtn.disabled = false;
    connectBtn.textContent = 'Kết nối Live';
    disconnectBtn.classList.add('hidden');
  }
});

socket.on('tiktok:error', ({ message }) => {
  connectBtn.disabled = false;
  connectBtn.textContent = 'Kết nối Live';
  showToast(`❌ Lỗi: ${message}`, 'error', 4000);
});

// ── Nhận bình luận mới ────────────────────────────────────
socket.on('comment:new', (data) => {
  commentCount++;
  statComments.textContent = commentCount;

  // Xóa empty state
  if (feedEmpty) feedEmpty.style.display = 'none';

  // Tạo card
  const card = document.createElement('div');
  card.className = 'comment-card';
  card.dataset.id = data.id;
  card.innerHTML = `
    <div class="comment-meta">
      <div class="comment-user">
        <div class="user-avatar">${getInitials(data.username)}</div>
        <div class="user-info">
          <span class="username">@${data.username}</span>
          <span class="user-id">ID: ${data.tiktokUserId}</span>
        </div>
      </div>
      <span class="comment-time">${formatTime(data.timestamp)}</span>
    </div>
    <div class="comment-text">${escapeHtml(data.comment)}</div>
    <div class="comment-actions">
      <button class="btn-print" onclick="printComment('${data.id}', this)">
        🖨️ In đơn
      </button>
    </div>
  `;

  // Thêm vào đầu feed
  commentFeed.insertBefore(card, commentFeed.firstChild);

  // Giới hạn 200 cards để không lag
  const cards = commentFeed.querySelectorAll('.comment-card');
  if (cards.length > 200) cards[cards.length - 1].remove();
});

// ── In bình luận ──────────────────────────────────────────
function printComment(commentId, btn) {
  btn.disabled = true;
  btn.classList.add('printing');
  btn.textContent = '⏳ Đang in...';
  socket.emit('print:comment', { commentId });
}

socket.on('order:saved', (data) => {
  orderCount++;
  statOrders.textContent = orderCount;
  orderCountEl.textContent = orderCount;

  // Cập nhật card trong feed
  const card = document.querySelector(`.comment-card[data-id="${data.commentId}"]`);
  if (card) {
    card.classList.add('printed');
    const actions = card.querySelector('.comment-actions');
    actions.innerHTML = `<span class="printed-badge">✅ Đã chốt đơn</span>`;
  }

  // Thêm vào danh sách đã chốt
  addOrderCard(data);

  // Cập nhật danh sách khách
  loadCustomers();
});

socket.on('printer:status', ({ status, message }) => {
  if (status === 'ok') {
    showToast(`🖨️ ${message}`, 'success');
    return;
  }

  document.querySelectorAll('.btn-print.printing').forEach(btn => {
    btn.disabled = false;
    btn.classList.remove('printing');
    btn.textContent = '🖨️ In đơn';
  });
  showToast(`❌ ${message}`, 'error', 4000);
});

// ── Order Card ────────────────────────────────────────────
function addOrderCard(data) {
  const existingEmpty = orderList.querySelector('.empty-state');
  if (existingEmpty) existingEmpty.remove();

  const card = document.createElement('div');
  card.className = 'order-card';
  card.innerHTML = `
    <div class="order-header">
      <span class="order-username">@${data.username}</span>
      <span class="order-badge">${data.totalOrders} đơn</span>
    </div>
    <div class="order-comment">${escapeHtml(data.comment)}</div>
    <div class="order-time">${formatTime(data.timestamp)} · ID: ${data.tiktokUserId}</div>
  `;
  orderList.insertBefore(card, orderList.firstChild);
}

// ── Customers ─────────────────────────────────────────────
async function loadCustomers() {
  try {
    const res = await fetch('/api/customers');
    const customers = await res.json();
    customerCount = customers.length;
    statCustomers.textContent = customerCount;
    customerCountEl.textContent = customerCount;

    if (!customers.length) return;

    customerList.innerHTML = '';
    customers.forEach(c => {
      const card = document.createElement('div');
      card.className = 'customer-card';
      card.innerHTML = `
        <div class="customer-avatar">${getInitials(c.username)}</div>
        <div class="customer-info">
          <div class="customer-name">@${c.username}</div>
          <div class="customer-stats">ID: ${c.tiktok_user_id} · ${c.total_comments} bình luận</div>
        </div>
        <div class="customer-orders">${c.total_orders || 0}</div>
      `;
      customerList.appendChild(card);
    });
  } catch (err) {
    console.error('Load customers error:', err);
  }
}

// ── Printer Check ─────────────────────────────────────────
async function checkPrinter() {
  try {
    const res = await fetch('/api/printer/check');
    const data = await res.json();
    if (data.ok) {
      printerStatus.className = 'printer-status ok';
      printerText.textContent = `${data.printerName || 'Máy in'} · Sẵn sàng`;
    } else {
      printerStatus.className = 'printer-status error';
      printerText.textContent = data.printerName
        ? `${data.printerName} · Lỗi máy in`
        : 'Không tìm thấy máy in';
      if (data.error) console.error('[Printer Check Error]', data.error);
    }
  } catch {
    printerStatus.className = 'printer-status error';
    printerText.textContent = 'Lỗi kiểm tra máy in';
  }
}

// ── Utility ───────────────────────────────────────────────
function escapeHtml(str) {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Init ──────────────────────────────────────────────────
checkPrinter();
loadCustomers();
// Tự check máy in mỗi 30 giây
setInterval(checkPrinter, 30000);
