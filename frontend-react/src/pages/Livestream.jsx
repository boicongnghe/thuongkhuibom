import { useEffect, useRef, useState, useCallback } from 'react';
import { api } from '../api';
import { isAgent, liveBus } from '../agent';
import { formatTime, getInitials, describePrinter, formatCurrency, formatVndShort } from '../utils';
import { useApp } from '../context/AppContext';
import OrderSummary from '../components/OrderSummary';
import QuickAmount from '../components/QuickAmount';
import StatusBadge from '../components/StatusBadge';

const COMMENTS_POLL_MS = 2000;   // thiết bị khác hỏi bình luận mới
const STATE_POLL_MS    = 3000;   // trạng thái app ở shop / lệnh Live
const SESSION_POLL_MS  = 5000;   // tổng kết + danh sách đơn của phiên
const MAX_COMMENTS     = 300;

// Trang Livestream dùng chung cho mọi thiết bị:
//  - Trong app desktop ở shop: bình luận tới ngay từ TikTok (AgentRunner gửi lên dịch vụ)
//  - Điện thoại / máy khác: hỏi dịch vụ mỗi 2 giây
// Bấm "Kết nối Live" / "In đơn" ở đâu cũng được — app ở shop làm việc thật.
export default function Livestream() {
  const { showToast } = useApp();

  const [inputUsername, setInputUsername] = useState('');
  const [live, setLive]                   = useState({ agent: { online: false, printer: {}, tiktok: {} }, desired: { on: false, username: '' } });
  const [sending, setSending]             = useState(false);

  const [sessionId, setSessionId]         = useState(null);
  const [comments, setComments]           = useState([]);
  const [busyIds, setBusyIds]             = useState(new Set());   // đang gửi lệnh chốt / in lại

  const [summary, setSummary]             = useState(null);
  const [sessionOrders, setSessionOrders] = useState([]);
  const [customers, setCustomers]         = useState([]);
  const [activeTab, setActiveTab]         = useState('orders');

  const newestIdRef  = useRef(null);
  const sessionRef   = useRef(null);
  const loadingRef   = useRef(false);
  const busyRef      = useRef(new Set());

  // ── Trạng thái app ở shop + lệnh Live ──
  const loadLive = useCallback(async () => {
    try {
      const s = await api.getLiveState();
      setLive(s);
      if (s.desired?.username) setInputUsername(prev => prev || `@${s.desired.username}`);
    } catch {}
  }, []);

  // ── Tổng kết + đơn của phiên ──
  const loadSession = useCallback(async () => {
    try {
      const sum = await api.getSummary('session');
      setSummary(sum);
      if (sum.session?.id) {
        const res = await api.getOrders({ sessionId: sum.session.id, limit: 100, status: 'all' });
        setSessionOrders(res.orders);
      } else {
        setSessionOrders([]);
      }
    } catch {}
  }, []);

  const loadCustomers = useCallback(async () => {
    try { setCustomers(await api.getCustomers()); } catch {}
  }, []);

  // Gộp bình luận mới / cập nhật trạng thái chốt-in của bình luận đã có
  const mergeComments = useCallback((list, { replace = false } = {}) => {
    setComments(prev => {
      const base = replace ? [] : prev;
      const map = new Map(base.map(c => [c.id, c]));
      for (const c of list) map.set(c.id, { ...map.get(c.id), ...c });
      const merged = [...map.values()].sort((a, b) => (a.id < b.id ? 1 : -1)).slice(0, MAX_COMMENTS);
      newestIdRef.current = merged[0]?.id || null;
      return merged;
    });
  }, []);

  // ── Bình luận: tải đầu + hỏi bình luận mới ──
  const loadComments = useCallback(async ({ full = false } = {}) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const afterId = full ? undefined : newestIdRef.current || undefined;
      const res = await api.getRecentComments({ limit: 200, afterId });
      if (res.sessionId !== sessionRef.current) {
        // Phiên live mới → làm mới danh sách
        sessionRef.current = res.sessionId;
        setSessionId(res.sessionId);
        newestIdRef.current = null;
        const fresh = afterId ? await api.getRecentComments({ limit: 200 }) : res;
        mergeComments(fresh.comments, { replace: true });
        loadSession();
      } else if (res.comments.length) {
        mergeComments(res.comments);
      }
    } catch {
    } finally {
      loadingRef.current = false;
    }
  }, [mergeComments, loadSession]);

  // Trạng thái chốt / in của các bình luận đang hiện (thay đổi do thiết bị khác, máy in...)
  const refreshVisibleOrders = useCallback(async () => {
    try {
      const res = await api.getRecentComments({ limit: 200 });
      if (res.sessionId === sessionRef.current) mergeComments(res.comments);
    } catch {}
  }, [mergeComments]);

  useEffect(() => {
    loadLive();
    loadComments({ full: true });
    loadSession();
    loadCustomers();
    const t1 = setInterval(loadLive, STATE_POLL_MS);
    const t2 = setInterval(() => loadComments(), COMMENTS_POLL_MS);
    const t3 = setInterval(() => { loadSession(); refreshVisibleOrders(); }, SESSION_POLL_MS);

    // Trong app desktop: bình luận / kết quả in tới ngay, không phải đợi lần hỏi sau
    const offComments = liveBus.on('comments', ({ sessionId: sid, comments: list }) => {
      if (sid !== sessionRef.current) { loadComments({ full: true }); return; }
      mergeComments(list);
    });
    const offPrinted = liveBus.on('printed', () => { refreshVisibleOrders(); loadSession(); });
    const offAgent   = liveBus.on('agent', () => loadLive());

    return () => { clearInterval(t1); clearInterval(t2); clearInterval(t3); offComments(); offPrinted(); offAgent(); };
  }, [loadLive, loadComments, loadSession, loadCustomers, mergeComments, refreshVisibleOrders]);

  // ── Kết nối / ngắt Live (gửi lệnh lên dịch vụ, app ở shop làm theo) ──
  async function connect() {
    const u = inputUsername.trim().replace('@', '');
    if (!u) { showToast('Vui lòng nhập username TikTok', 'error'); return; }
    if (sending) return;
    setSending(true);
    try {
      await api.setDesiredLive(true, u);
      showToast(live.agent.online
        ? `Đang kết nối @${u}...`
        : 'Đã gửi lệnh. App ở shop sẽ kết nối khi được mở.', 'info', 4000);
      loadLive();
    } catch (err) {
      showToast(`Lỗi: ${err.message}`, 'error');
    } finally {
      setSending(false);
    }
  }

  async function disconnect() {
    if (sending) return;
    setSending(true);
    try {
      await api.setDesiredLive(false, live.desired?.username || '');
      loadLive();
    } catch (err) {
      showToast(`Lỗi: ${err.message}`, 'error');
    } finally {
      setSending(false);
    }
  }

  function setBusy(id, on) {
    const next = new Set(busyRef.current);
    if (on) next.add(id); else next.delete(id);
    busyRef.current = next;
    setBusyIds(next);
  }

  // ── Chốt đơn (vào hàng đợi in của shop) ──
  async function printComment(c) {
    if (busyRef.current.has(c.id)) return;   // chặn bấm 2 lần
    setBusy(c.id, true);
    try {
      const { order, created } = await api.orderFromComment(c.id, true);
      mergeComments([{ id: c.id, printed: true, order: { id: order._id, orderNumber: order.orderNumber, printPending: order.printPending, printedAt: order.printedAt, printError: order.printError } }]);
      showToast(created
        ? `Đã chốt ${order.orderNumber}${live.agent.online ? ' · đang in...' : ' · sẽ in khi app ở shop mở'}`
        : `Bình luận này đã chốt thành ${order.orderNumber}`, created ? 'success' : 'info');
      if (isAgent) liveBus.emit('print-now');
      loadSession();
    } catch (err) {
      showToast(`Lỗi: ${err.message}`, 'error');
    } finally {
      setBusy(c.id, false);
    }
  }

  async function reprint(c) {
    if (!c.order || busyRef.current.has(c.id)) return;
    setBusy(c.id, true);
    try {
      const o = await api.reprintOrder(c.order.id);
      mergeComments([{ id: c.id, order: { ...c.order, printPending: o.printPending, printError: null } }]);
      if (isAgent) liveBus.emit('print-now');
      showToast(`Đã gửi lệnh in lại ${o.orderNumber}`, 'info');
    } catch (err) {
      showToast(`Lỗi: ${err.message}`, 'error');
    } finally {
      setBusy(c.id, false);
    }
  }

  // ── Hiển thị trạng thái ──
  const agentInfo   = live.agent || {};
  const tiktok      = agentInfo.tiktok || {};
  const isConnected = !!(agentInfo.online && tiktok.connected);
  const waiting     = !!live.desired?.on && !isConnected;
  const printerInfo = describePrinter(agentInfo.online
    ? { ...agentInfo.printer, remote: !isAgent, lastSeenSec: agentInfo.lastSeenSec }
    : { status: 'PC_OFFLINE' });

  const badgeText = isConnected ? `TikTok: @${tiktok.username}`
    : waiting ? (agentInfo.online ? `TikTok: đang kết nối @${live.desired.username}...` : 'TikTok: chờ app ở shop mở')
    : 'TikTok: chưa kết nối';

  function printState(c) {
    const o = c.order;
    if (!o) return null;
    if (o.printPending) return { text: '⏳ Đang chờ in', cls: 'pending' };
    if (o.printError)   return { text: `⚠ In lỗi: ${o.printError}`, cls: 'error' };
    if (o.printedAt)    return { text: '✓ Đã in', cls: 'done' };
    return { text: '✓ Đã chốt', cls: 'done' };
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>

      {/* Header */}
      <header className="header">
        <div className="header-left">
          <div className={`tiktok-badge${isConnected ? ' connected' : ''}`}>
            <span className="badge-dot" />
            <span className="badge-text">{badgeText}</span>
          </div>
        </div>
        <div className="header-right">
          <div className="connect-form">
            <label htmlFor="tt-username" className="sr-only">Tài khoản TikTok</label>
            <input
              id="tt-username"
              type="text"
              className="username-input"
              placeholder="@tiktok_username"
              value={inputUsername}
              onChange={e => setInputUsername(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !live.desired?.on && connect()}
              disabled={!!live.desired?.on || sending}
            />
            {!live.desired?.on
              ? <button className="btn btn-connect" onClick={connect} disabled={sending}>
                  {sending ? 'Đang gửi...' : 'Kết nối Live'}
                </button>
              : <button className="btn btn-disconnect" onClick={disconnect} disabled={sending}>Ngắt kết nối</button>
            }
          </div>
          <div className={`printer-status${printerInfo.ok ? ' ok' : ' error'}`}>
            <span aria-hidden="true">🖨️</span>
            <span>{printerInfo.text}</span>
          </div>
        </div>
      </header>

      {!agentInfo.online && (
        <div className="web-only-notice" role="status">
          App Chốt Đơn Live trên máy cắm máy in ở shop <b>chưa mở</b> — chưa nhận được bình luận và chưa in được.
          Mở app trên máy đó (hoặc bật "Tự chạy khi bật máy") là dùng được từ mọi thiết bị.
        </div>
      )}
      {tiktok.error && !isConnected && (
        <div className="web-only-notice" role="alert">TikTok: {tiktok.error}</div>
      )}

      {/* Stats bar — tổng kết phiên live, cập nhật ngay khi chốt đơn */}
      <div className="stats-bar" aria-live="polite">
        <div className="stat-item">
          <span className="stat-number">{summary?.totals?.comments ?? comments.length}</span>
          <span className="stat-label">Bình luận</span>
        </div>
        <div className="stat-divider" />
        <div className="stat-item">
          <span className="stat-number">{summary?.totals?.orders ?? 0}</span>
          <span className="stat-label">Đơn</span>
        </div>
        <div className="stat-divider" />
        <div className="stat-item" title={formatCurrency(summary?.totals?.amount || 0)}>
          <span className="stat-number">{formatVndShort(summary?.totals?.amount || 0)}</span>
          <span className="stat-label">Tổng tiền</span>
        </div>
        <div className="stat-divider" />
        <div className="stat-item" title={formatCurrency(summary?.totals?.remaining || 0)}>
          <span className="stat-number stat-warn">{formatVndShort(summary?.totals?.remaining || 0)}</span>
          <span className="stat-label">Còn thu</span>
        </div>
        {summary?.totals?.noAmount > 0 && (
          <>
            <div className="stat-divider" />
            <div className="stat-item">
              <span className="stat-number stat-alert">{summary.totals.noAmount}</span>
              <span className="stat-label">Chưa nhập tiền</span>
            </div>
          </>
        )}
      </div>

      {/* Main */}
      <main className="main">
        {/* Comment feed */}
        <section className="panel panel-feed">
          <div className="panel-header">
            <h2 className="panel-title">💬 Bình luận Live</h2>
            <div className={`live-indicator${isConnected ? ' active' : ''}`}>
              <span className="live-dot" />
              <span>LIVE</span>
            </div>
          </div>
          <div className="comment-feed">
            {!comments.length
              ? <div className="empty-state">
                  <div className="empty-icon">📡</div>
                  <p>{sessionId ? 'Chưa có bình luận nào trong phiên này' : 'Kết nối TikTok Live để nhận bình luận'}</p>
                </div>
              : comments.map(c => {
                  const busy = busyIds.has(c.id);
                  const ps = printState(c);
                  return (
                    <div key={c.id} className={`comment-card${c.order ? ' printed' : ''}`}>
                      <div className="comment-meta">
                        <div className="comment-user">
                          <div className="user-avatar">{getInitials(c.username)}</div>
                          <div className="user-info">
                            <span className="username">@{c.username}</span>
                            <span className="user-id">{c.displayName && c.displayName !== c.username ? c.displayName : `ID: ${c.tiktokUserId}`}</span>
                          </div>
                        </div>
                        <span className="comment-time">{formatTime(c.timestamp)}</span>
                      </div>
                      <div className="comment-text">{c.comment}</div>
                      <div className="comment-actions">
                        {c.order
                          ? <>
                              <span className={`printed-badge print-${ps.cls}`}>{ps.text} · {c.order.orderNumber}</span>
                              <button className="btn-reprint" disabled={busy || c.order.printPending} onClick={() => reprint(c)}>
                                {busy ? 'Đang gửi...' : 'In lại'}
                              </button>
                            </>
                          : <button className={`btn-print${busy ? ' printing' : ''}`} disabled={busy} onClick={() => printComment(c)}>
                              {busy ? 'Đang chốt...' : 'In đơn'}
                            </button>
                        }
                      </div>
                    </div>
                  );
                })
            }
          </div>
        </section>

        {/* Right panel */}
        <section className="panel panel-orders">
          <div className="tabs">
            <button className={`tab${activeTab === 'orders' ? ' active' : ''}`} onClick={() => setActiveTab('orders')}>
              📋 Đã chốt ({summary?.totals?.orders ?? 0})
            </button>
            <button className={`tab${activeTab === 'summary' ? ' active' : ''}`} onClick={() => setActiveTab('summary')}>
              📊 Tổng kết
            </button>
            <button className={`tab${activeTab === 'customers' ? ' active' : ''}`} onClick={() => { setActiveTab('customers'); loadCustomers(); }}>
              👥 Khách hàng ({customers.length})
            </button>
          </div>

          <div className={`tab-content${activeTab === 'orders' ? ' active' : ''}`}>
            <div className="order-list">
              {!sessionOrders.length
                ? <div className="empty-state"><div className="empty-icon">🛒</div><p>Chưa có đơn nào được chốt</p></div>
                : sessionOrders.map(o => (
                  <div key={o._id} className={`order-card${o.status === 'cancelled' ? ' is-cancelled' : ''}`}>
                    <div className="order-header">
                      <span className="order-username">@{o.username}</span>
                      <StatusBadge status={o.status} />
                    </div>
                    <div className="order-comment">{o.note}</div>
                    <div className="order-foot">
                      <span className="order-time">
                        {formatTime(o.createdAt)} · {o.orderNumber}
                        {o.printPending ? ' · ⏳ chờ in' : o.printError ? ' · ⚠ in lỗi' : o.printedAt ? ' · 🖨 đã in' : ''}
                      </span>
                      <QuickAmount
                        key={`${o._id}-${o.amount}-${o.status}`}
                        order={o}
                        onSaved={() => { showToast(`Đã lưu tiền ${o.orderNumber}`, 'success'); loadSession(); }}
                        onError={(msg) => showToast(`Lỗi: ${msg}`, 'error')}
                      />
                    </div>
                  </div>
                ))
              }
            </div>
          </div>

          <div className={`tab-content${activeTab === 'summary' ? ' active' : ''}`}>
            <div className="summary-scroll">
              <OrderSummary data={summary} compact />
            </div>
          </div>

          <div className={`tab-content${activeTab === 'customers' ? ' active' : ''}`}>
            <div className="customer-list">
              {!customers.length
                ? <div className="empty-state"><div className="empty-icon">👥</div><p>Chưa có khách hàng nào</p></div>
                : customers.map(c => (
                  <div key={c.tiktokUserId} className="customer-card">
                    <div className="customer-avatar">{getInitials(c.username)}</div>
                    <div className="customer-info">
                      <div className="customer-name">@{c.username}</div>
                      <div className="customer-stats">{c.totalComments || 0} bình luận · {c.totalOrders || 0} đơn</div>
                    </div>
                    <div className="customer-orders">{c.totalOrders || 0}</div>
                  </div>
                ))
              }
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
