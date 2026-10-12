import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { api } from '../api';
import { liveBus } from '../agent';

const AppContext = createContext(null);

export function AppProvider({ user, children }) {
  const [settings, setSettings]               = useState(null);
  const [isConnected, setIsConnected]         = useState(false);
  const [tiktokUsername, setTiktokUsername]   = useState('');
  const [toast, setToast]                     = useState({ show: false, msg: '', type: 'info' });
  const [toastTimer, setToastTimer]           = useState(null);

  const loadSettings = useCallback(() => {
    api.getSettings().then(s => setSettings(s)).catch(console.error);
  }, []);

  // Tải cài đặt khi mở app, và khi quay lại cửa sổ (có thể đã đổi ở thiết bị khác)
  useEffect(() => {
    loadSettings();
    const onFocus = () => { if (document.visibilityState === 'visible') loadSettings(); };
    document.addEventListener('visibilitychange', onFocus);
    return () => document.removeEventListener('visibilitychange', onFocus);
  }, [loadSettings]);

  const showToast = useCallback((msg, type = 'info', duration = 2800) => {
    if (toastTimer) clearTimeout(toastTimer);
    setToast({ show: true, msg, type });
    const t = setTimeout(() => setToast(prev => ({ ...prev, show: false })), duration);
    setToastTimer(t);
  }, [toastTimer]);

  const saveSettings = useCallback(async (patch) => {
    const updated = await api.saveSettings(patch);
    setSettings(updated);
    liveBus.emit('settings-changed', updated);   // app desktop dùng ngay quy tắc tự động in mới
    return updated;
  }, []);

  return (
    <AppContext.Provider value={{
      user,
      settings, setSettings, saveSettings,
      isConnected, setIsConnected,
      tiktokUsername, setTiktokUsername,
      toast, showToast,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be inside AppProvider');
  return ctx;
}
