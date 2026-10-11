import { useEffect, useState } from 'react';
import { api } from '../api';
import { useApp } from '../context/AppContext';
import { looksLikeOrder } from '../utils';

export default function Printer() {
  const { settings, saveSettings, showToast } = useApp();

  const [connType, setConnType]       = useState('ip');
  const [autoPrint, setAutoPrint]     = useState(false);
  const [keywords, setKeywords]       = useState('');
  const [matchCode, setMatchCode]     = useState(true);
  const [matchPhone, setMatchPhone]   = useState(true);
  const [savingRules, setSavingRules] = useState(false);
  const [testText, setTestText]       = useState('');
  const [ip, setIp]                   = useState('');
  const [port, setPort]               = useState(9100);
  const [btDevice, setBtDevice]       = useState(null);
  const [btStatus, setBtStatus]       = useState({ connected: false, name: '' });
  const [testing, setTesting]         = useState(false);
  const [printerInfo, setPrinterInfo] = useState({ text: 'Kiểm tra...', ok: null });

  useEffect(() => {
    if (!settings) return;
    setConnType(settings.printer?.connectionType || 'ip');
    setAutoPrint(!!settings.printer?.autoPrint);
    setKeywords(settings.printer?.orderKeywords ?? 'chốt, lấy, mua, đặt');
    setMatchCode(settings.printer?.autoPrintMatchCode !== false);
    setMatchPhone(settings.printer?.autoPrintMatchPhone !== false);
    setIp(settings.printer?.ip || '');
    setPort(settings.printer?.port || 9100);
    if (settings.printer?.bluetoothDeviceId) {
      setBtStatus({ connected: true, name: settings.printer.bluetoothDeviceName || '' });
    }
  }, [settings]);

  useEffect(() => {
    api.checkPrinter().then(d => {
      setPrinterInfo(d.ok
        ? { text: `${d.printerName} · Sẵn sàng`, ok: true }
        : { text: d.status === 'NOT_LOCAL' ? 'Máy in chỉ dùng được trên máy tính'
              : d.status === 'NOT_FOUND' ? 'Không tìm thấy máy in' : `${d.printerName} · Chưa kết nối`, ok: false }
      );
    }).catch(() => setPrinterInfo({ text: 'Lỗi kiểm tra', ok: false }));
  }, []);

  async function handleConnTypeChange(t) {
    setConnType(t);
    await saveSettings({ printer: { connectionType: t } }).catch(() => {});
  }

  async function handleAutoPrint(v) {
    setAutoPrint(v);
    try {
      await saveSettings({ printer: { autoPrint: v } });
      showToast(v ? 'Đã bật tự động in' : 'Đã tắt tự động in', 'info');
    } catch (err) {
      setAutoPrint(!v);
      showToast(`Lỗi: ${err.message}`, 'error');
    }
  }

  async function saveAutoPrintRules() {
    if (savingRules) return;
    const cleaned = keywords.split(',').map(k => k.trim()).filter(Boolean).join(', ');
    if (!cleaned && !matchCode && !matchPhone) {
      showToast('Cần ít nhất 1 từ khoá hoặc bật nhận diện mã SP / SĐT', 'error');
      return;
    }
    setSavingRules(true);
    try {
      await saveSettings({ printer: { orderKeywords: cleaned, autoPrintMatchCode: matchCode, autoPrintMatchPhone: matchPhone } });
      setKeywords(cleaned);
      showToast('Đã lưu quy tắc tự động in', 'success');
    } catch (err) {
      showToast(`Lỗi: ${err.message}`, 'error');
    } finally {
      setSavingRules(false);
    }
  }

  const testResult = testText.trim()
    ? looksLikeOrder(testText, { keywords, matchCode, matchPhone })
    : null;

  async function saveIPConfig() {
    const ipRe = /^((25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(25[0-5]|2[0-4]\d|[01]?\d\d?)$/;
    if (!ipRe.test(ip)) { showToast('Địa chỉ IP không hợp lệ', 'error'); return; }
    if (!port || port < 1 || port > 65535) { showToast('Port không hợp lệ (1–65535)', 'error'); return; }
    try {
      await saveSettings({ printer: { ip, port: Number(port) } });
      showToast('Đã lưu cấu hình IP + Port', 'success');
    } catch (err) {
      showToast(`Lỗi: ${err.message}`, 'error');
    }
  }

  async function connectBluetooth() {
    if (!navigator.bluetooth) { showToast('Trình duyệt không hỗ trợ Web Bluetooth (dùng Chrome/Edge)', 'error', 4000); return; }
    try {
      const device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: ['000018f0-0000-1000-8000-00805f9b34fb', '49535343-fe7d-4ae5-8fa9-9fafd205e455'],
      });
      setBtDevice(device);
      setBtStatus({ connected: true, name: device.name || device.id });
      showToast(`Đã kết nối: ${device.name || device.id}`, 'success');
      await saveSettings({ printer: { bluetoothDeviceId: device.id, bluetoothDeviceName: device.name || device.id } });
      device.addEventListener('gattserverdisconnected', () => {
        setBtDevice(null);
        setBtStatus({ connected: false, name: '' });
        showToast('Đã ngắt kết nối Bluetooth', 'info');
        saveSettings({ printer: { bluetoothDeviceId: '', bluetoothDeviceName: '' } }).catch(() => {});
      });
    } catch (err) {
      if (err.name !== 'NotFoundError') showToast(`Bluetooth: ${err.message}`, 'error');
    }
  }

  function disconnectBluetooth() {
    if (btDevice?.gatt?.connected) btDevice.gatt.disconnect();
    setBtDevice(null);
    setBtStatus({ connected: false, name: '' });
    saveSettings({ printer: { bluetoothDeviceId: '', bluetoothDeviceName: '' } }).catch(() => {});
    showToast('Đã ngắt kết nối Bluetooth', 'info');
  }

  async function testPrint() {
    setTesting(true);
    try {
      if (connType === 'bluetooth') {
        if (!btDevice) throw new Error('Chưa kết nối Bluetooth');
        const srv  = await btDevice.gatt.connect();
        const svcs = ['000018f0-0000-1000-8000-00805f9b34fb', '49535343-fe7d-4ae5-8fa9-9fafd205e455'];
        const chars = ['00002af1-0000-1000-8000-00805f9b34fb', '49535343-8841-43f4-a818-9347d352f8fa'];
        let ch = null;
        for (const s of svcs) {
          try { const sv = await srv.getPrimaryService(s); for (const c of chars) { try { ch = await sv.getCharacteristic(c); break; } catch {} } if (ch) break; } catch {}
        }
        if (!ch) throw new Error('Không tìm thấy characteristic máy in BLE');
        const data = buildTestEscPos();
        for (let i = 0; i < data.length; i += 128) await ch.writeValueWithoutResponse(data.slice(i, i + 128));
      } else {
        await api.testPrinterIP(ip, port);
      }
      showToast('In thử thành công!', 'success');
    } catch (err) {
      showToast(`In thử thất bại: ${err.message}`, 'error', 4000);
    } finally {
      setTesting(false);
    }
  }

  function buildTestEscPos() {
    const ESC = 0x1B, GS = 0x1D;
    const b = [ESC, 0x40, ESC, 0x61, 1];
    const addLine = s => {
      const ascii = s.normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/đ/g,'d').replace(/Đ/g,'D');
      for (const ch of ascii) b.push(ch.charCodeAt(0) < 128 ? ch.charCodeAt(0) : 0x3F);
      b.push(0x0A);
    };
    addLine('================================');
    addLine('  TIKTOK ORDER SYSTEM');
    addLine('       TEST PRINT');
    addLine('   Connection Success');
    addLine(new Date().toLocaleString('vi-VN'));
    addLine('================================');
    b.push(ESC, 0x64, 4, GS, 0x56, 0x41, 0x03);
    return new Uint8Array(b);
  }

  return (
    <div className="page-scroll">
      <div className="page-header">
        <h1 className="page-title">Máy In</h1>
        <div className={`printer-status${printerInfo.ok === true ? ' ok' : printerInfo.ok === false ? ' error' : ''}`} style={{ fontSize: 12 }}>
          <span>🖨️</span><span>{printerInfo.text}</span>
        </div>
      </div>

      <div className="settings-scroll">
        <div className="settings-card">
          <div className="settings-card-head">
            <div className="settings-card-title-group">
              <span className="settings-card-icon">🖨️</span>
              <h2 className="settings-card-title">Kết nối máy in</h2>
            </div>
          </div>
          <div className="settings-card-body">

            {/* Auto print */}
            <div className="setting-section-label">Tùy chọn in</div>
            <div className="setting-row">
              <div className="setting-info">
                <span className="setting-label">Tự động in khi có đơn mới</span>
                <span className="setting-desc">Tự chốt và in bình luận khớp quy tắc bên dưới (bình luận thường không bị in)</span>
              </div>
              <label className="toggle-switch">
                <input type="checkbox" checked={autoPrint} onChange={e => handleAutoPrint(e.target.checked)} />
                <span className="toggle-slider" />
              </label>
            </div>

            <div className="form-group" style={{ marginTop: 12 }}>
              <label className="form-label" htmlFor="order-keywords">Từ khoá chốt đơn (cách nhau bằng dấu phẩy)</label>
              <input id="order-keywords" type="text" className="form-input" maxLength={500}
                placeholder="chốt, lấy, mua, đặt"
                value={keywords} onChange={e => setKeywords(e.target.value)} />
              <p className="form-hint">Không phân biệt hoa thường và dấu: "chốt" khớp cả "Chốt", "chot", "CHOT".</p>
            </div>
            <div className="setting-row">
              <div className="setting-info">
                <span className="setting-label">Nhận diện mã sản phẩm</span>
                <span className="setting-desc">Bình luận có mã kiểu A12, B05, SP123</span>
              </div>
              <label className="toggle-switch">
                <input type="checkbox" checked={matchCode} onChange={e => setMatchCode(e.target.checked)} />
                <span className="toggle-slider" />
              </label>
            </div>
            <div className="setting-row">
              <div className="setting-info">
                <span className="setting-label">Nhận diện số điện thoại</span>
                <span className="setting-desc">Bình luận có SĐT Việt Nam (0912 345 678, +84912345678…)</span>
              </div>
              <label className="toggle-switch">
                <input type="checkbox" checked={matchPhone} onChange={e => setMatchPhone(e.target.checked)} />
                <span className="toggle-slider" />
              </label>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="rule-test">Thử một bình luận</label>
              <input id="rule-test" type="text" className="form-input" placeholder='vd: "Đặt A12 size M nha shop"'
                value={testText} onChange={e => setTestText(e.target.value)} />
              {testResult !== null && (
                <p className="form-hint" style={{ color: testResult ? 'var(--green)' : 'var(--text-muted)', fontWeight: 600 }}>
                  {testResult ? '✓ Sẽ tự động in' : '✗ Không tự in (bình luận thường)'}
                </p>
              )}
            </div>
            <button className="btn-save-config" onClick={saveAutoPrintRules} disabled={savingRules}>
              {savingRules ? 'Đang lưu...' : 'Lưu quy tắc tự động in'}
            </button>

            <div className="settings-divider" />

            {/* Connection type */}
            <div className="setting-section-label">Phương thức kết nối</div>
            <div className="conn-tabs">
              {['bluetooth', 'ip'].map(t => (
                <button key={t} className={`conn-tab${connType === t ? ' active' : ''}`} onClick={() => handleConnTypeChange(t)}>
                  {t === 'bluetooth' ? 'Bluetooth' : 'IP + Port'}
                </button>
              ))}
            </div>

            {/* Bluetooth panel */}
            {connType === 'bluetooth' && (
              <div className="conn-panel">
                <div className="bt-status-row">
                  <div className="bt-status-info">
                    <span className={`status-dot ${btStatus.connected ? 'status-on' : 'status-off'}`} />
                    <div>
                      <div className="bt-status-label">{btStatus.connected ? 'Đã kết nối' : 'Chưa kết nối'}</div>
                      {btStatus.name && <div className="bt-device-name">{btStatus.name}</div>}
                    </div>
                  </div>
                  <button className="btn-bt-connect"
                    onClick={btStatus.connected ? disconnectBluetooth : connectBluetooth}>
                    {btStatus.connected ? 'Ngắt kết nối' : 'Kết nối Bluetooth'}
                  </button>
                </div>
                <p className="form-hint">Yêu cầu Chrome / Edge để sử dụng Web Bluetooth API</p>
              </div>
            )}

            {/* IP panel */}
            {connType === 'ip' && (
              <div className="conn-panel">
                <div className="form-grid-2">
                  <div className="form-group">
                    <label className="form-label">Địa chỉ IP</label>
                    <input type="text" className="form-input" placeholder="192.168.1.100" value={ip} onChange={e => setIp(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Port</label>
                    <input type="number" className="form-input" placeholder="9100" min="1" max="65535" value={port} onChange={e => setPort(e.target.value)} />
                  </div>
                </div>
                <p className="form-hint">Ví dụ: IP 192.168.1.100 · Port 9100</p>
                <button className="btn-save-config" onClick={saveIPConfig}>Lưu cấu hình</button>
              </div>
            )}

            <div className="settings-divider" />

            {/* Test print */}
            <div className="setting-section-label">Kiểm tra</div>
            <div className="setting-row">
              <div className="setting-info">
                <span className="setting-label">In thử</span>
                <span className="setting-desc">In trang kiểm tra để xác nhận máy in hoạt động đúng</span>
              </div>
              <button className="btn-test-print" onClick={testPrint} disabled={testing}>
                {testing ? 'Đang in...' : 'In thử'}
              </button>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
