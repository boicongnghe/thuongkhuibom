import { io } from 'socket.io-client';

// In dev: connect to Express backend on :3001 (Vite proxies /api and /socket.io)
// In prod: same origin (Express serves the React build)
const URL = import.meta.env.DEV ? 'http://localhost:3001' : '';

const socket = io(URL, {
  autoConnect: true,
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 1000,
  transports: ['websocket', 'polling'],
});

export default socket;
