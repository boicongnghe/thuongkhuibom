const { WebcastPushConnection } = require('tiktok-live-connector');

let connection = null;

/**
 * Kết nối vào TikTok Live của username
 * @param {string} username - TikTok username (có hoặc không có @)
 * @param {object} handlers - { onComment, onConnected, onDisconnected, onError }
 */
async function connect(username, handlers) {
  // Ngắt kết nối cũ nếu có
  if (connection) await disconnect();

  const cleanUsername = username.replace('@', '').trim();
  connection = new WebcastPushConnection(cleanUsername, {
    processInitialData: false,
    enableExtendedGiftInfo: false,
    enableWebsocketUpgrade: true,
    requestPollingIntervalMs: 2000,
  });

  // Sự kiện kết nối thành công
  connection.on('connected', (state) => {
    console.log(`[TikTok] Đã kết nối live: @${cleanUsername}`, state.roomId);
    handlers.onConnected?.({ username: cleanUsername, roomId: state.roomId });
  });

  // Nhận bình luận
  connection.on('chat', (data) => {
    // FIX: bỏ qua comment rỗng hoặc chỉ có khoảng trắng
    const rawComment = (data.comment || '').trim();
    if (!rawComment) return;

    const comment = {
      tiktokUserId: data.userId?.toString() || data.uniqueId || 'unknown',
      username:     data.uniqueId || data.nickname || 'unknown',
      displayName:  data.nickname || data.uniqueId || 'unknown',
      comment:      rawComment.slice(0, 500),  // Giới hạn độ dài
      timestamp:    new Date().toISOString(),
    };
    handlers.onComment?.(comment);
  });

  // Mất kết nối
  connection.on('disconnected', () => {
    console.log('[TikTok] Mất kết nối');
    handlers.onDisconnected?.();
  });

  // Lỗi
  connection.on('error', (err) => {
    console.error('[TikTok] Lỗi:', err);
    handlers.onError?.(err.message || 'Lỗi không xác định');
  });

  try {
    const state = await connection.connect();
    return { success: true, roomId: state.roomId };
  } catch (err) {
    connection = null;
    throw new Error(err.message || 'Không thể kết nối TikTok Live');
  }
}

async function disconnect() {
  if (connection) {
    try { connection.disconnect(); } catch (_) {}
    connection = null;
  }
}

function isConnected() {
  return connection !== null;
}

module.exports = { connect, disconnect, isConnected };
