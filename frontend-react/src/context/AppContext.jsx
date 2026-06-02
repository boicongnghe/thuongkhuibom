import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { api } from '../api';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [settings, setSettings]               = useState(null);
  const [isConnected, setIsConnected]         = useState(false);
  const [tiktokUsername, setTiktokUsername]   = useState('');
  const [toast, setToast]                     = useState({ show: false, msg: '', type: 'info' });
  const [toastTimer, setToastTimer]           = useState(null);

  // Load settings on mount
  useEffect(() => {
    api.getSettings().then(s => setSettings(s)).catch(console.error);
  }, []);

  const showToast = useCallback((msg, type = 'info', duration = 2800) => {
    if (toastTimer) clearTimeout(toastTimer);
    setToast({ show: true, msg, type });
    const t = setTimeout(() => setToast(prev => ({ ...prev, show: false })), duration);
    setToastTimer(t);
  }, [toastTimer]);

  const saveSettings = useCallback(async (patch) => {
    const updated = await api.saveSettings(patch);
    setSettings(updated);
    return updated;
  }, []);

  return (
    <AppContext.Provider value={{
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
