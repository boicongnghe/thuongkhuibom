import { useEffect, useRef } from 'react';
import { api } from '../api';
import { agent, agentError, liveBus } from '../agent';
import { looksLikeOrder } from '../utils';
import { useApp } from '../context/AppContext';

const HEARTBEAT_MS = 10000;   // báo trạng thái máy in / TikTok lên dịch vụ
const RECONCILE_MS = 3000;    // kiểm tra lệnh Live (từ điện thoại...) và làm theo
const PRINT_POLL_MS = 2000;   // hỏi hàng đợi in
const RETRY_AFTER_FAIL_MS = 30000;
// App desktop cũ (1.0.1) chỉ in được phiếu đơn; bản mới khai báo thêm 'report' (phiếu tổng, đi đơn...)
const PRINT_KINDS = agent?.features || ['order'];

/**
 * Chạy ngầm khi trang mở trong app desktop ở shop (không hiện gì ra màn hình):
 *  - Kết nối / ngắt TikTok Live theo lệnh trên dịch vụ (bấm ở máy này hay điện thoại đều được)
 *  - Gửi bình luận nhận được lên dịch vụ; tự chốt + in bình luận khớp quy tắc "Tự động in"
 *  - Nhận việc in từ hàng đợi của shop và in ra máy in USB
 *  - Báo trạng thái máy in / TikTok để thiết bị khác thấy
 * Đặt ở mức App nên vẫn chạy khi đang xem trang khác.
 */
export default function AgentRunner() {
  const { showToast } = useApp();
  // showToast được tạo lại sau mỗi thông báo → giữ qua ref, KHÔNG để effect chạy lại (sẽ ngắt Live)
  const toastRef = useRef(showToast);
  toastRef.current = showToast;

  useEffect(() => {
    if (!agent) return undefined;
    let alive = true;
    let sessionId = null;
    let lastError = '';
    let lastFail = null;          // { username, at } — tránh thử lại liên tục khi TikTok báo lỗi
    let reconciling = false;
    let printing = false;
    let settings = null;
    let appVersion = '';
    agent.info?.().then(i => { appVersion = i?.version || ''; }).catch(() => {});
    const pending = [];           // bình luận chưa gửi được (mất mạng) → gửi lại
    const timers = [];

    const toast = (msg, type = 'info', ms) => { if (alive) toastRef.current(msg, type, ms); };

    async function loadSettings() {
      try { settings = await api.getSettings(); } catch {}
    }

    async function report() {
      try {
        const st = await agent.status();
        await api.reportAgentStatus({
          appVersion,
          printer: st.printer,
          tiktok: { ...st.tiktok, sessionId: st.tiktok.connected || st.tiktok.connecting ? sessionId : null, error: st.tiktok.error || lastError },
        });
        liveBus.emit('agent', st);
      } catch {}
    }

    async function stopLive() {
      try { await agent.disconnect(); } catch {}
      if (sessionId) { const id = sessionId; sessionId = null; await api.endSession(id).catch(() => {}); }
      report();
    }

    // ── Lệnh Live: làm cho trạng thái thật khớp với trạng thái mong muốn trên dịch vụ ──
    async function reconcile() {
      if (reconciling || !alive) return;
      reconciling = true;
      try {
        const { desired } = await api.getLiveState();
        const st = (await agent.status()).tiktok;
        const active = st.connected || st.connecting;

        if (desired?.on && desired.username) {
          const want = desired.username;
          if (active && st.username === want) return;
          if (active) await stopLive();
          if (lastFail && lastFail.username === want && Date.now() - lastFail.at < RETRY_AFTER_FAIL_MS) return;

          const { sessionId: sid } = await api.createSession(want);
          sessionId = sid;
          lastError = '';
          report();
          try {
            await agent.connect({ username: want, sessionId: sid });
            lastFail = null;
            toast(`Đã kết nối TikTok Live @${want}`, 'success');
          } catch (err) {
            const msg = agentError(err);
            lastFail = { username: want, at: Date.now() };
            lastError = msg;
            sessionId = null;
            await api.endSession(sid).catch(() => {});
            // Tắt lệnh để không thử mãi; người dùng bấm Kết nối lại khi đã lên live
            await api.setDesiredLive(false, want).catch(() => {});
            toast(`Không kết nối được TikTok @${want}: ${msg}`, 'error', 6000);
          }
          report();
        } else if (active) {
          await stopLive();
          toast('Đã ngắt kết nối TikTok Live', 'info');
        }
      } catch {
        // mất mạng tạm thời: lần sau thử lại
      } finally {
        reconciling = false;
      }
    }

    // ── Bình luận từ TikTok → dịch vụ ──
    async function sendComments(sid, list) {
      const clean = list.map(({ clientId, ...c }) => c);
      const { ids } = await api.postComments(sid, clean);
      const saved = list.map((c, i) => ({ ...c, id: ids[i], printed: false, order: null })).filter(c => c.id);
      liveBus.emit('comments', { sessionId: sid, comments: saved });

      const p = settings?.printer;
      if (p?.autoPrint) {
        for (const c of saved) {
          if (looksLikeOrder(c.comment, { keywords: p.orderKeywords, matchCode: p.autoPrintMatchCode !== false, matchPhone: p.autoPrintMatchPhone !== false })) {
            api.orderFromComment(c.id, true).then(() => printNow()).catch(() => {});
          }
        }
      }
    }

    async function flushPending() {
      while (pending.length && alive) {
        const item = pending[0];
        try {
          await sendComments(item.sessionId, item.comments);
          pending.shift();
        } catch {
          return;   // vẫn mất mạng — thử lại lần sau
        }
      }
    }

    const offComments = agent.onComments(({ sessionId: sid, comments }) => {
      const target = sid || sessionId;
      if (!target || !comments?.length) return;
      pending.push({ sessionId: target, comments });
      flushPending();
    });

    const offStatus = agent.onStatus(() => report());

    // TikTok tự ngắt (live kết thúc) → đóng phiên + tắt lệnh Live
    const offEnded = agent.onEnded(async ({ sessionId: sid }) => {
      if (sid && sid === sessionId) { sessionId = null; await api.endSession(sid).catch(() => {}); }
      await api.setDesiredLive(false).catch(() => {});
      toast('TikTok Live đã kết thúc / mất kết nối', 'info', 5000);
      report();
    });

    // ── Hàng đợi in ──
    async function printNow() {
      if (printing || !alive) return;
      printing = true;
      try {
        for (let i = 0; i < 20 && alive; i++) {      // in tối đa 20 phiếu mỗi lượt, lượt sau in tiếp
          const { job } = await api.claimPrintJob(PRINT_KINDS);
          if (!job) break;
          const isReport = job.kind === 'report';
          const id = isReport ? job.jobId : job.orderId;
          const label = isReport ? job.title : job.orderNumber;
          try {
            await agent.print(job);
            await api.finishPrintJob(id, true, '', job.kind);
            liveBus.emit('printed', { orderId: id, ok: true, kind: job.kind });
            toast(`Đã in ${label}`, 'success');
          } catch (err) {
            const msg = agentError(err);
            await api.finishPrintJob(id, false, msg, job.kind).catch(() => {});
            liveBus.emit('printed', { orderId: id, ok: false, error: msg, kind: job.kind });
            toast(`In lỗi ${label}: ${msg}. Bấm in lại khi máy in sẵn sàng.`, 'error', 6000);
            report();
            break;   // máy in đang lỗi: dừng lượt này, lần sau thử tiếp
          }
        }
      } catch {
        // mất mạng
      } finally {
        printing = false;
      }
    }
    const offPrintNow = liveBus.on('print-now', printNow);
    const offSettings = liveBus.on('settings-changed', loadSettings);

    loadSettings();
    report();
    reconcile();
    printNow();
    timers.push(setInterval(report, HEARTBEAT_MS));
    timers.push(setInterval(reconcile, RECONCILE_MS));
    timers.push(setInterval(() => { printNow(); flushPending(); }, PRINT_POLL_MS));
    timers.push(setInterval(loadSettings, 60000));

    return () => {
      alive = false;
      timers.forEach(clearInterval);
      offComments(); offStatus(); offEnded(); offPrintNow(); offSettings();
      // Đăng xuất / đóng trang: ngắt Live để không nhận bình luận mà không ai gửi lên
      stopLive();
    };
  }, []);

  return null;
}
