import { useEffect, useRef, useState, useCallback } from 'react';
import socket from '../socket';
import { api } from '../api';
import { formatTime, getInitials, looksLikeOrder } from '../utils';
import { useApp } from '../context/AppContext';

export default function Livestream() {
  const { settings, isConnected, setIsConnected, tiktokUsername, setTiktokUsername, showToast } = useApp();

  const [inputUsername, setInputUsername]   = useState('');
  const [connecting, setConnecting]         = useState(false);
  const [roomId, setRoomId]                 = useState('');

  const [comments, setComments]             = useState([]);
  const [printedIds, setPrintedIds]         = useState(new Set());

  const [commentCount, setCommentCount]     = useState(0);
  const [orderCount, setOrderCount]         = useState(0);
  const [customerCount, setCustomerCount]   = useState(0);

  const [orders, setOrders]                 = useState([]);
  const [customers, setCustomers]           = useState([]);
  const [activeTab, setActiveTab]           = useState('orders');

  const [printerInfo, setPrinterInfo]       = useState({ text: 'Kiểm tra...', ok: false });
  const [printingIds, setPrintingIds]       = useState(new Set());
  // Bản sao dạng ref: handler socket (đăng ký 1 lần) luôn đọc được giá trị mới nhất
  const printingRef = useRef(new Set());

  const feedRef = useRef(null);

  // ── Load initial data ──
  useEffect(() => {
    loadCustomers();
    loadRecentComments();
    checkPrinter();
    const t = setInterval(checkPrinter, 30000);
    return () => clearInterval(t);
  }, []);

  async function loadCustomers() {
    try {
      const list = await api.getCustomers();
      setCustomers(list);
      setCustomerCount(list.length);
    } catch {}
  }

  // Tải lại trang / mở thêm thiết bị giữa buổi live: lấy lại bình luận đã lưu trong DB
  async function loadRecentComments() {
    try {
      const { comments: list } = await api.getRecentComments(200);
      setComments(prev => {
        const known = new Set(prev.map(c => c.id));
        return [...prev, ...list.filter(c => !known.has(c.id))].slice(0, 200);
      });
      setPrintedIds(prev => new Set([...prev, ...list.filter(c => c.printed).map(c => c.id)]));
      setCommentCount(c => Math.max(c, list.length));
      setOrderCount(c => Math.max(c, list.filter(c2 => c2.printed).length));
    } catch {}
  }

  function setPrinting(commentId, on) {
    const next = new Set(printingRef.current);
    if (on) next.add(commentId); else next.delete(commentId);
    printingRef.current = next;
    setPrintingIds(next);
  }

  async function checkPrinter() {
    try {
      const d = await api.checkPrinter();
      if (d.ok) {
        setPrinterInfo({ text: `${d.printerName} · Sẵn sàng`, ok: true });
      } else {
        const st = d.status || '';
        const msg = st === 'NOT_FOUND' ? 'Không tìm thấy máy in'
          : st.startsWith('OFFLINE') ? `${d.printerName} · Chưa kết nối`
          : `${d.printerName} · Lỗi`;
        setPrinterInfo({ text: msg, ok: false });
      }
    } catch {
      setPrinterInfo({ text: 'Lỗi kiểm tra máy in', ok: false });
    }
  }

  // ── Socket events ──
  useEffect(() => {
    function onStatus({ connected, username: u, loading, roomId: r }) {
      if (loading) { setConnecting(true); return; }
      setConnecting(false);
      setIsConnected(connected);
      if (connected) {
        setTiktokUsername(u);
        setRoomId(r || '');
        showToast(`Đã kết nối @${u}`, 'success');
      } else {
        setTiktokUsername('');
        setRoomId('');
      }
    }

    function onError({ message }) {
      setConnecting(false);
      showToast(`Lỗi: ${message}`, 'error', 4000);
    }

    function onComment(data) {
      setCommentCount(c => c + 1);
      setComments(prev => {
        const next = [data, ...prev].slice(0, 200);
        return next;
      });
      // Tự động in: CHỈ bình luận có dấu hiệu chốt (từ khoá / mã SP / SĐT trong Cài đặt máy in)
      const p = settings?.printer;
      if (p?.autoPrint && looksLikeOrder(data.comment, {
        keywords:   p.orderKeywords,
        matchCode:  p.autoPrintMatchCode !== false,
        matchPhone: p.autoPrintMatchPhone !== false,
      })) {
        setTimeout(() => printComment(data.id), 400);
      }
    }

    function onOrderSaved(data) {
      setOrderCount(c => c + 1);
      setPrintedIds(prev => new Set([...prev, data.commentId]));
      setOrders(prev => [data, ...prev].slice(0, 100));
      loadCustomers();
    }

    function onPrinterStatus({ status, message, commentId }) {
      if (commentId) setPrinting(commentId, false);
      else { printingRef.current = new Set(); setPrintingIds(new Set()); }
      if (status === 'ok') showToast(message, 'success');
      else showToast(message, 'error', 5000);
    }

    // Bình luận đã có đơn từ trước (vd chốt ở thiết bị khác) → hiện nút "In lại"
    function onOrderExists({ commentId }) {
      setPrintedIds(prev => new Set([...prev, commentId]));
    }

    socket.on('tiktok:status',  onStatus);
    socket.on('tiktok:error',   onError);
    socket.on('comment:new',    onComment);
    socket.on('order:saved',    onOrderSaved);
    socket.on('printer:status', onPrinterStatus);
    socket.on('order:exists',   onOrderExists);

    return () => {
      socket.off('tiktok:status',  onStatus);
      socket.off('tiktok:error',   onError);
      socket.off('comment:new',    onComment);
      socket.off('order:saved',    onOrderSaved);
      socket.off('printer:status', onPrinterStatus);
      socket.off('order:exists',   onOrderExists);
    };
  }, [settings]);

  function connect() {
    const u = inputUsername.trim();
    if (!u) { showToast('Vui lòng nhập username TikTok', 'error'); return; }
    setConnecting(true);
    socket.emit('tiktok:connect', { username: u });
  }

  function disconnect() {
    socket.emit('tiktok:disconnect');
  }

  // reprint = true: chỉ in lại phiếu của đơn đã có, không tạo đơn mới
  function printComment(commentId, reprint = false) {
    if (printingRef.current.has(commentId)) return;   // chặn bấm 2 lần
    if (!socket.connected) {
      showToast('Mất kết nối máy chủ, đang thử kết nối lại...', 'error');
      return;
    }
    setPrinting(commentId, true);
    socket.emit('print:comment', { commentId, reprint });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>

      {/* Header */}
      <header className="header">
        <div className="header-left">
          <div className={`tiktok-badge${isConnected ? ' connected' : ''}`}>
            <span className="badge-dot" />
            <span className="badge-text">
              {connecting ? 'Đang kết nối...' : isConnected ? `@${tiktokUsername}` : 'Chưa kết nối'}
            </span>
          </div>
        </div>
        <div className="header-right">
          <div className="connect-form">
            <input
              type="text"
              className="username-input"
              placeholder="@tiktok_username"
              value={inputUsername}
              onChange={e => setInputUsername(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !isConnected && connect()}
              disabled={isConnected || connecting}
            />
            {!isConnected
              ? <button className="btn btn-connect" onClick={connect} disabled={connecting}>
                  {connecting ? 'Đang kết nối...' : 'Kết nối Live'}
                </button>
              : <button className="btn btn-disconnect" onClick={disconnect}>Ngắt kết nối</button>
            }
          </div>
          <div className={`printer-status${printerInfo.ok ? ' ok' : ' error'}`}>
            <span>🖨️</span>
            <span>{printerInfo.text}</span>
          </div>
        </div>
      </header>

      {/* Stats bar */}
      <div className="stats-bar">
        <div className="stat-item">
          <span className="stat-number">{commentCount}</span>
          <span className="stat-label">Bình luận</span>
        </div>
        <div className="stat-divider" />
        <div className="stat-item">
          <span className="stat-number">{orderCount}</span>
          <span className="stat-label">Đã chốt</span>
        </div>
        <div className="stat-divider" />
        <div className="stat-item">
          <span className="stat-number">{customerCount}</span>
          <span className="stat-label">Khách hàng</span>
        </div>
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
          <div className="comment-feed" ref={feedRef}>
            {!comments.length
              ? <div className="empty-state" id="feedEmpty">
                  <div className="empty-icon">📡</div>
                  <p>Kết nối TikTok Live để nhận bình luận realtime</p>
                </div>
              : comments.map(c => {
                  const isPrinted   = printedIds.has(c.id);
                  const isPrinting  = printingIds.has(c.id);
                  return (
                    <div key={c.id} className={`comment-card${isPrinted ? ' printed' : ''}`}>
                      <div className="comment-meta">
                        <div className="comment-user">
                          <div className="user-avatar">{getInitials(c.username)}</div>
                          <div className="user-info">
                            <span className="username">@{c.username}</span>
                            <span className="user-id">ID: {c.tiktokUserId}</span>
                          </div>
                        </div>
                        <span className="comment-time">{formatTime(c.timestamp)}</span>
                      </div>
                      <div className="comment-text">{c.comment}</div>
                      <div className="comment-actions">
                        {isPrinted
                          ? <>
                              <span className="printed-badge">✓ Đã chốt đơn</span>
                              <button
                                className="btn-reprint"
                                disabled={isPrinting}
                                onClick={() => printComment(c.id, true)}
                              >
                                {isPrinting ? 'Đang in...' : 'In lại'}
                              </button>
                            </>
                          : <button
                              className={`btn-print${isPrinting ? ' printing' : ''}`}
                              disabled={isPrinting}
                              onClick={() => printComment(c.id)}
                            >
                              {isPrinting ? 'Đang in...' : 'In đơn'}
                            </button>
                        }
                      </div>
                    </div>
                  );
                })
            }
          </div>
        </section>

        {/* Right panel: orders + customers */}
        <section className="panel panel-orders">
          <div className="tabs">
            <button className={`tab${activeTab === 'orders' ? ' active' : ''}`} onClick={() => setActiveTab('orders')}>
              📋 Đã chốt ({orderCount})
            </button>
            <button className={`tab${activeTab === 'customers' ? ' active' : ''}`} onClick={() => setActiveTab('customers')}>
              👥 Khách hàng ({customerCount})
            </button>
          </div>

          {/* Orders tab */}
          <div className={`tab-content${activeTab === 'orders' ? ' active' : ''}`}>
            <div className="order-list">
              {!orders.length
                ? <div className="empty-state"><div className="empty-icon">🛒</div><p>Chưa có đơn nào được chốt</p></div>
                : orders.map((o, i) => (
                  <div key={`${o.commentId}-${i}`} className="order-card">
                    <div className="order-header">
                      <span className="order-username">@{o.username}</span>
                      <span className="order-badge">{o.totalOrders} đơn</span>
                    </div>
                    <div className="order-comment">{o.comment}</div>
                    <div className="order-time">{formatTime(o.timestamp)} · {o.orderNumber || o.tiktokUserId}</div>
                  </div>
                ))
              }
            </div>
          </div>

          {/* Customers tab */}
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
