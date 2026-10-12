import { useCallback, useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppProvider } from './context/AppContext';
import { authApi } from './api/auth';
import { isAgent } from './agent';
import AgentRunner from './components/AgentRunner';
import AuthPage  from './components/AuthPage';
import HomePage  from './components/HomePage';
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

  // Chưa đăng nhập: trang chủ ở "/", trang đăng nhập ở "/dang-nhap".
  // Trong app desktop thì vào thẳng đăng nhập (đã cài app rồi, không cần nút tải).
  const [showAuth, setShowAuth] = useState(() => isAgent || window.location.pathname !== '/');
  useEffect(() => {
    const onPop = () => setShowAuth(isAgent || window.location.pathname !== '/');
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const goLogin = useCallback(() => {
    window.history.pushState(null, '', '/dang-nhap');
    setShowAuth(true);
  }, []);
  const goHome = useCallback(() => {
    window.history.pushState(null, '', '/');
    setShowAuth(false);
  }, []);

  const handleLogout = useCallback(async () => {
    try { await authApi.logout(); } catch { /* vẫn đăng xuất ở giao diện */ }
    setUser(null);
  }, []);

  if (user === undefined) return <div className="auth-loading">Đang tải...</div>;
  if (!user) {
    return showAuth
      ? <AuthPage onAuthenticated={(u) => { setUser(u); window.history.replaceState(null, '', '/livestream'); }} onBack={isAgent ? null : goHome} />
      : <HomePage onLogin={goLogin} />;
  }

  return (
    <BrowserRouter>
      <AppProvider user={user}>
        {/* Trong app desktop ở shop: chạy ngầm TikTok Live + máy in */}
        {isAgent && <AgentRunner />}
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
              <Route path="/dang-nhap"  element={<Navigate to="/livestream" replace />} />
              <Route path="*"           element={<Navigate to="/livestream" replace />} />
            </Routes>
          </div>
        </div>
        <Toast />
      </AppProvider>
    </BrowserRouter>
  );
}
