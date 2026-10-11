import { useEffect, useRef, useState } from 'react';
import {
  authApi, validateUsername, validatePassword,
  getRememberedUsername, setRememberedUsername,
} from '../api/auth';
import './AuthPage.css';

function EyeIcon({ open }) {
  return open ? (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ) : (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.6 5.1A10.8 10.8 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.2M6.6 6.6C3.7 8.5 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <path d="M2 2l20 20" />
    </svg>
  );
}

function PasswordField({ id, label, value, onChange, autoComplete, describedBy, invalid }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="auth-field">
      <label htmlFor={id}>{label}</label>
      <div className="auth-input-wrap">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={e => onChange(e.target.value)}
          autoComplete={autoComplete}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          maxLength={64}
          required
        />
        <button
          type="button"
          className="auth-eye"
          onClick={() => setVisible(v => !v)}
          aria-label={visible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
          aria-pressed={visible}
          aria-controls={id}
        >
          <EyeIcon open={!visible} />
        </button>
      </div>
    </div>
  );
}

export default function AuthPage({ onAuthenticated }) {
  const remembered = getRememberedUsername();

  const [registrationOpen, setRegistrationOpen] = useState(false);
  const [tab, setTab]           = useState('login');
  const [username, setUsername] = useState(remembered);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm]   = useState('');
  const [remember, setRemember] = useState(Boolean(remembered));
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [notice, setNotice]     = useState('');
  const [serverDown, setServerDown] = useState(false);
  const [checking, setChecking] = useState(true);
  const submitting = useRef(false);

  // Chưa có tài khoản nào → mở sẵn tab Đăng ký; đã có → ẩn hẳn tab Đăng ký
  async function checkStatus() {
    setChecking(true);
    try {
      const res = await authApi.status();
      if (typeof res?.registrationOpen !== 'boolean') throw new Error('bad response');
      setServerDown(false);
      setRegistrationOpen(res.registrationOpen);
      if (res.registrationOpen) {
        setTab('register');
        setNotice('Chưa có tài khoản. Hãy tạo tài khoản đầu tiên — sau đó chức năng đăng ký sẽ tự khoá.');
      } else {
        setTab('login');
        setNotice('');
      }
    } catch {
      // Không phân biệt được "đã có tài khoản" hay "chưa" → báo rõ thay vì lặng lẽ ẩn tab Đăng ký
      setServerDown(true);
      setRegistrationOpen(false);
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => { checkStatus(); }, []);

  const isRegister = tab === 'register' && registrationOpen;

  function switchTab(next) {
    setTab(next);
    setError('');
    setNotice('');
    setPassword('');
    setConfirm('');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting.current) return;   // chặn bấm 2 lần
    setError('');

    const name = username.trim().toLowerCase();
    if (isRegister) {
      const invalid = validateUsername(name) || validatePassword(password)
        || (password !== confirm ? 'Mật khẩu nhập lại không khớp' : null);
      if (invalid) { setError(invalid); return; }
    } else if (!name || !password) {
      setError('Vui lòng nhập tên đăng nhập và mật khẩu');
      return;
    }

    submitting.current = true;
    setLoading(true);
    try {
      const body = { username: name, password, remember };
      const user = isRegister ? await authApi.register(body) : await authApi.login(body);
      setRememberedUsername(remember ? name : '');
      setPassword('');
      setConfirm('');
      onAuthenticated(user);
    } catch (err) {
      setError(err.message);
      // Đăng ký thất bại vì đã có tài khoản → chuyển về đăng nhập
      if (err.status === 403 && isRegister) {
        setRegistrationOpen(false);
        setTab('login');
      }
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="auth-logo" aria-hidden="true">C</div>
          <div>
            <h1>Chốt Đơn Live</h1>
            <p>{isRegister ? 'Tạo tài khoản quản lý shop' : 'Đăng nhập để tiếp tục'}</p>
          </div>
        </div>

        {registrationOpen && (
          <div className="auth-tabs" role="tablist" aria-label="Chọn chức năng">
            <button
              type="button" role="tab" id="tab-login"
              aria-selected={!isRegister} aria-controls="auth-form"
              className={!isRegister ? 'active' : ''}
              onClick={() => switchTab('login')}
            >Đăng nhập</button>
            <button
              type="button" role="tab" id="tab-register"
              aria-selected={isRegister} aria-controls="auth-form"
              className={isRegister ? 'active' : ''}
              onClick={() => switchTab('register')}
            >Đăng ký</button>
          </div>
        )}

        <form
          id="auth-form"
          className="auth-form"
          onSubmit={handleSubmit}
          noValidate
          role={registrationOpen ? 'tabpanel' : undefined}
          aria-labelledby={registrationOpen ? (isRegister ? 'tab-register' : 'tab-login') : undefined}
        >
          {serverDown && (
            <div className="auth-msg auth-msg-error" role="alert">
              Không kết nối được máy chủ (backend). Kiểm tra backend đang chạy bản mới nhất rồi thử lại.
              <button type="button" className="auth-retry" onClick={checkStatus} disabled={checking}>
                {checking ? 'Đang kiểm tra...' : 'Thử lại'}
              </button>
            </div>
          )}
          {notice && !error && <div className="auth-msg auth-msg-info" role="status">{notice}</div>}
          {error && <div className="auth-msg auth-msg-error" role="alert">{error}</div>}

          <div className="auth-field">
            <label htmlFor="auth-username">Tên đăng nhập</label>
            <input
              id="auth-username"
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value.toLowerCase())}
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              maxLength={30}
              aria-describedby={isRegister ? 'hint-username' : undefined}
              required
            />
            {isRegister && (
              <small id="hint-username">3–30 ký tự: chữ thường, số, dấu _ và dấu .</small>
            )}
          </div>

          <PasswordField
            id="auth-password"
            label="Mật khẩu"
            value={password}
            onChange={setPassword}
            autoComplete={isRegister ? 'new-password' : 'current-password'}
            describedBy={isRegister ? 'hint-password' : undefined}
          />
          {isRegister && (
            <small id="hint-password" className="auth-hint">Tối thiểu 8 ký tự, có cả chữ và số.</small>
          )}

          {isRegister && (
            <PasswordField
              id="auth-confirm"
              label="Nhập lại mật khẩu"
              value={confirm}
              onChange={setConfirm}
              autoComplete="new-password"
              invalid={confirm.length > 0 && confirm !== password}
            />
          )}

          <label className="auth-check">
            <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />
            <span>Ghi nhớ đăng nhập (30 ngày)</span>
          </label>

          <button type="submit" className="auth-submit" disabled={loading} aria-busy={loading}>
            {loading ? 'Đang xử lý...' : isRegister ? 'Tạo tài khoản' : 'Đăng nhập'}
          </button>
        </form>
      </div>
    </main>
  );
}
