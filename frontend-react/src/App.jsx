import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppProvider } from './context/AppContext';
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
  return (
    <BrowserRouter>
      <AppProvider>
        <div className="app-layout">
          <Sidebar />
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
            </Routes>
          </div>
        </div>
        <Toast />
      </AppProvider>
    </BrowserRouter>
  );
}
