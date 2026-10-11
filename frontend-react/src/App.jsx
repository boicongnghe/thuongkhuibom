import { useCallback, useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppProvider } from './context/AppContext';
import { authApi } from './api/auth';
import socket, { realtimeEnabled } from './socket';
import AuthPage  from './components/AuthPage';
import Sidebar   from './components/Sidebar';
import Toast     from './components/Toast';
import Dashboard  from './pages/Dashboard';
import Livestream from './pages/Livestream';
import Orders     from './pages/Orders';
import Customers  from './pages/Customers';
import Stats      from './pages/Stats';
import Printer    from './pages/Printer';
import Settings   from './pages/Settings';

export default function App() {
  // undefined = đang kiểm tra, null = chưa đăng nhập, object = đã đăng nhập
  const [user, setUser] = useState(undefined);

  // Mở app: hỏi backend xem cookie còn hiệu lực không
  useEffect(() => {
    authApi.me().then(setUser).catch(() => setUser(null));
  }, []);

  // API nào trả 401 (hết phiên) → quay về trang đăng nhập
  useEffect(() => {
    const onExpired = () => setUser(null);
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, []);

  // Chỉ mở Socket.io khi đã đăng nhập (và có backend realtime — trên Vercel thì không)
  useEffect(() => {
    if (user && realtimeEnabled) socket.connect();
    else socket.disconnect();
  }, [user]);

  const handleLogout = useCallback(async () => {
    try { await authApi.logout(); } catch { /* vẫn đăng xuất ở giao diện */ }
    setUser(null);
  }, []);

  if (user === undefined) return <div className="auth-loading">Đang tải...</div>;
  if (!user) return <AuthPage onAuthenticated={setUser} />;

  return (
    <BrowserRouter>
      <AppProvider>
        <div className="app-layout">
          <Sidebar user={user} onLogout={handleLogout} />
          <div className="content-wrapper">
            <Routes>
              <Route path="/"           element={<Navigate to="/livestream" replace />} />
              <Route path="/dashboard"  element={<Dashboard />} />
              <Route path="/livestream" element={<Livestream />} />
              <Route path="/orders"     element={<Orders />} />
              <Route path="/customers"  element={<Customers />} />
              <Route path="/stats"      element={<Stats />} />
              <Route path="/printer"    element={<Printer />} />
              <Route path="/settings"   element={<Settings />} />
              <Route path="*"           element={<Navigate to="/livestream" replace />} />
            </Routes>
          </div>
        </div>
        <Toast />
      </AppProvider>
    </BrowserRouter>
  );
}
