import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: {
    // true khi build trên Vercel: không có Socket.io / TikTok Live / máy in (trừ khi đặt VITE_SOCKET_URL)
    __ON_VERCEL__: JSON.stringify(!!process.env.VERCEL),
  },
  server: {
    port: 5173,
    host: true,   // cho điện thoại cùng Wi-Fi mở được http://<IP máy tính>:5173
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    // Vercel cần thư mục build nằm trong frontend-react; chạy ở máy thì build cho backend phục vụ
    outDir: process.env.VERCEL ? 'dist' : '../frontend-react-dist',
    emptyOutDir: true,
  },
});
