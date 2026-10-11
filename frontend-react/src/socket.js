import { io } from 'socket.io-client';
import { authApi } from './api/auth';

// Dev: cùng origin, Vite proxy /socket.io sang backend :3001 (dùng được cả trên điện thoại cùng Wi-Fi)
// Prod trên Vercel: VITE_SOCKET_URL = địa chỉ backend (Vercel không chuyển tiếp WebSocket)
const URL = import.meta.env.VITE_SOCKET_URL || '';

const socket = io(URL, {
  autoConnect: false,          // App gọi socket.connect() sau khi đăng nhập
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 1000,
  transports: ['websocket', 'polling'],
  withCredentials: true,
  // Mỗi lần (re)connect lấy token 2 phút mới; token chỉ nằm trong bộ nhớ
  auth: (cb) => {
    authApi.socketToken()
      .then(({ token }) => cb({ token }))
      .catch(() => cb({}));
  },
});

export default socket;
