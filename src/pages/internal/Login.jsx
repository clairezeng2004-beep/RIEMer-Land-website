import { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { isSupabaseConfigured } from '../../lib/supabase';
import { trackEvent } from '../../lib/analytics';
import {
  Mail, Lock, User, LogIn, UserPlus, Eye, EyeOff,
  AlertCircle, CheckCircle, KeyRound, ArrowLeft,
} from 'lucide-react';
import './Login.css';

const SAVED_CREDENTIALS_KEY = 'riemer_saved_credentials';

// 视图模式：login | register | forgot | changePassword
export default function Login() {
  const [view, setView] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberPassword, setRememberPassword] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // 忘记密码相关
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // 修改密码相关
  const [currentPassword, setCurrentPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);

  // 验证码重置密码相关
  const [resetStep, setResetStep] = useState('email'); // email → code → password
  const [resetCode, setResetCode] = useState('');
  const [countdown, setCountdown] = useState(0);

  const { login, register, resetPassword, changePassword, sendResetCode, verifyResetCode, isAuthenticated, supabaseOk } = useAuth();

  // 邮箱后缀自动提示
  const EMAIL_SUFFIXES = [
    'qq.com', '163.com', '126.com', 'gmail.com', 'outlook.com',
    'foxmail.com', 'hotmail.com', 'yeah.net', 'sina.com', 'sohu.com',
    'icloud.com', '139.com', '188.com', 'yahoo.com',
  ];
  const [showEmailSuggestions, setShowEmailSuggestions] = useState(false);
  const [activeEmailIdx, setActiveEmailIdx] = useState(-1);

  const emailSuggestions = (() => {
    const atIdx = email.indexOf('@');
    if (atIdx < 1) return [];
    const typed = email.slice(atIdx + 1).toLowerCase();
    return EMAIL_SUFFIXES
      .filter((s) => s.startsWith(typed) && s !== typed)
      .map((s) => email.slice(0, atIdx + 1) + s);
  })();

  const handleEmailChange = (e) => {
    const val = e.target.value;
    setEmail(val);
    setShowEmailSuggestions(val.includes('@'));
    setActiveEmailIdx(-1);
  };

  const handleEmailSuggestionClick = (suggestion) => {
    setEmail(suggestion);
    setShowEmailSuggestions(false);
    setActiveEmailIdx(-1);
  };

  const handleEmailKeyDown = (e) => {
    if (!showEmailSuggestions || emailSuggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveEmailIdx((i) => (i + 1) % emailSuggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveEmailIdx((i) => (i <= 0 ? emailSuggestions.length - 1 : i - 1));
    } else if (e.key === 'Enter' && activeEmailIdx >= 0) {
      e.preventDefault();
      handleEmailSuggestionClick(emailSuggestions[activeEmailIdx]);
    } else if (e.key === 'Escape') {
      setShowEmailSuggestions(false);
    }
  };

  const handleEmailBlur = () => {
    setTimeout(() => setShowEmailSuggestions(false), 150);
  };

  const handleEmailFocus = () => {
    if (email.includes('@')) setShowEmailSuggestions(true);
  };

  // 页面加载时恢复已保存的凭据
  useEffect(() => {
    try {
      const saved = localStorage.getItem(SAVED_CREDENTIALS_KEY);
      if (saved) {
        const { email: savedEmail, password: savedPassword } = JSON.parse(saved);
        if (savedEmail && savedPassword) {
          setEmail(savedEmail);
          setPassword(savedPassword);
          setRememberPassword(true);
        }
      }
    } catch {
      localStorage.removeItem(SAVED_CREDENTIALS_KEY);
    }
  }, []);

  // 发送验证码倒计时
  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  if (isAuthenticated && view !== 'changePassword') {
    return <Navigate to="/internal/notifications" replace />;
  }

  const clearMessages = () => {
    setError('');
    setSuccess('');
  };

  const switchView = (newView) => {
    setView(newView);
    clearMessages();
    setShowPassword(false);
    setShowNewPassword(false);
    setShowConfirmPassword(false);
    setShowCurrentPassword(false);
    if (newView === 'forgot') {
      setNewPassword('');
      setConfirmPassword('');
      setResetStep('email');
      setResetCode('');
    }
    if (newView === 'changePassword') {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    }
  };

  // ---- 登录提交 ----
  const handleLogin = async (e) => {
    e.preventDefault();
    clearMessages();

    if (!email || !password) {
      setError('请填写所有必填字段');
      return;
    }

    setSubmitting(true);
    try {
      console.log('[Login] 开始登录...', { email });
      const result = await login(email, password);
      console.log('[Login] 登录结果:', result);
      if (result.success) {
        trackEvent('login', { method: 'email' });
        if (rememberPassword) {
          localStorage.setItem(
            SAVED_CREDENTIALS_KEY,
            JSON.stringify({ email, password })
          );
        } else {
          localStorage.removeItem(SAVED_CREDENTIALS_KEY);
        }
        // 不在这里主动 navigate —— 而是依赖顶部 `if (isAuthenticated) <Navigate/>`
        // 在 user 状态真正就绪后接管跳转，避免 user 还没 commit 就跳到受保护页
        // 被 ProtectedRoute 踢回来的"假死"现象。
      } else {
        setError(result.message);
      }
    } catch (err) {
      console.error('[Login] 登录异常:', err);
      setError(`登录出错：${err.message || '未知错误，请检查网络连接'}`);
    } finally {
      setSubmitting(false);
    }
  };

  // ---- 注册提交 ----
  const handleRegister = async (e) => {
    e.preventDefault();
    clearMessages();

    if (!email || !password || !name) {
      setError('请填写所有必填字段');
      return;
    }
    if (password.length < 6) {
      setError('密码至少需要 6 个字符');
      return;
    }

    const result = await register(email, password, name);
    if (result.success) {
      setSuccess(result.message);
      setEmail('');
      setPassword('');
      setName('');
    } else {
      setError(result.message);
    }
  };

  // ---- 忘记密码：发送验证码 ----
  const handleSendCode = async (e) => {
    e?.preventDefault();
    clearMessages();

    if (!email) {
      setError('请输入注册时使用的邮箱地址');
      return;
    }

    setSubmitting(true);
    try {
      const result = await sendResetCode(email);
      if (result.success) {
        setSuccess(result.message);
        setResetStep('code');
        setCountdown(60);
      } else {
        setError(result.message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  // ---- 忘记密码：验证验证码 ----
  const handleVerifyCode = async (e) => {
    e?.preventDefault();
    clearMessages();

    if (!resetCode || resetCode.length !== 6) {
      setError('请输入 6 位验证码');
      return;
    }

    setSubmitting(true);
    try {
      const result = await verifyResetCode(email, resetCode);
      if (result.success) {
        setSuccess('验证码正确！请设置新密码');
        setResetStep('password');
      } else {
        setError(result.message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  // ---- 忘记密码：设置新密码 ----
  const handleResetPassword = async (e) => {
    e.preventDefault();
    clearMessages();

    if (!newPassword || newPassword.length < 6) {
      setError('新密码至少需要 6 个字符');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }

    setSubmitting(true);
    try {
      const result = await resetPassword(email, newPassword);
      if (result.success) {
        setSuccess(result.message);
        setNewPassword('');
        setConfirmPassword('');
        // 3 秒后自动跳回登录
        setTimeout(() => switchView('login'), 3000);
      } else {
        setError(result.message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  // ---- 修改密码提交 ----
  const handleChangePassword = async (e) => {
    e.preventDefault();
    clearMessages();

    if (!currentPassword) {
      setError('请输入当前密码');
      return;
    }
    if (!newPassword || newPassword.length < 6) {
      setError('新密码至少需要 6 个字符');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }

    const result = await changePassword(currentPassword, newPassword);
    if (result.success) {
      setSuccess(result.message);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      // 清除已保存的凭据（密码已变更）
      localStorage.removeItem(SAVED_CREDENTIALS_KEY);
    } else {
      setError(result.message);
    }
  };

  // ---- 获取当前视图的标题和描述 ----
  const getHeaderInfo = () => {
    switch (view) {
      case 'login':
        return { title: '欢迎回来', desc: '登录以访问内部空间' };
      case 'register':
        return { title: '加入我们', desc: '仅 RIEMer Land 主理团队成员注册后可授权访问' };
      case 'forgot': {
        const stepDesc = {
          email: '输入邮箱地址，我们会发送验证码',
          code: '请查看邮箱，输入收到的 6 位验证码',
          password: '验证通过！请设置新密码',
        };
        return { title: '忘记密码', desc: stepDesc[resetStep] || '' };
      }
      case 'changePassword':
        return { title: '修改密码', desc: '请输入当前密码和新密码' };
      default:
        return { title: '', desc: '' };
    }
  };

  const { title, desc } = getHeaderInfo();

  return (
    <div className="login-page">
      <div className="login-page__bg">
        <div className="login-page__gradient" />
      </div>

      <div className="login-card">
        <div className="login-card__header">
          <img src="/logo.png" alt="RIEMer Land" className="login-card__logo" />
          <h2>{title}</h2>
          <p>{desc}</p>
        </div>

        {/* 登录 / 注册 Tab 切换（仅在 login 和 register 视图显示） */}
        {(view === 'login' || view === 'register') && (
          <div className="login-card__tabs">
            <button
              className={`login-card__tab ${view === 'login' ? 'login-card__tab--active' : ''}`}
              onClick={() => switchView('login')}
            >
              <LogIn size={16} /> 登录
            </button>
            <button
              className={`login-card__tab ${view === 'register' ? 'login-card__tab--active' : ''}`}
              onClick={() => switchView('register')}
            >
              <UserPlus size={16} /> 注册
            </button>
          </div>
        )}

        {/* 返回登录按钮（忘记密码 / 修改密码视图） */}
        {(view === 'forgot' || view === 'changePassword') && (
          <button
            className="login-card__back-btn"
            onClick={() => switchView('login')}
          >
            <ArrowLeft size={16} /> 返回登录
          </button>
        )}

        {/* 连接状态提示 */}
        {isSupabaseConfigured && supabaseOk === false && (
          <div className="login-card__message login-card__message--warning" style={{
            background: 'rgba(245, 158, 11, 0.08)',
            border: '1px solid rgba(245, 158, 11, 0.3)',
            color: '#92400e',
          }}>
            <AlertCircle size={16} /> 云端服务暂时不可用，已自动切换到离线模式
          </div>
        )}

        {error && (
          <div className="login-card__message login-card__message--error">
            <AlertCircle size={16} /> {error}
          </div>
        )}

        {success && (
          <div className="login-card__message login-card__message--success">
            <CheckCircle size={16} /> {success}
          </div>
        )}

        {/* ==================== 登录表单 ==================== */}
        {view === 'login' && (
          <form onSubmit={handleLogin} className="login-card__form" autoComplete="off" data-lpignore="true">
            {/* 隐藏的陷阱输入框，防止 macOS 密码自动填充悬浮提示 */}
            <input type="text" name="trap-user" autoComplete="username" style={{ position: 'absolute', opacity: 0, height: 0, width: 0, padding: 0, border: 'none', pointerEvents: 'none' }} tabIndex={-1} aria-hidden="true" />
            <input type="password" name="trap-pass" autoComplete="current-password" style={{ position: 'absolute', opacity: 0, height: 0, width: 0, padding: 0, border: 'none', pointerEvents: 'none' }} tabIndex={-1} aria-hidden="true" />
            <div className="login-card__field">
              <label className="login-card__label">
                <Mail size={16} /> 邮箱
              </label>
              <div className="login-card__email-wrap">
                <input
                  type="text"
                  inputMode="email"
                  value={email}
                  onChange={handleEmailChange}
                  onKeyDown={handleEmailKeyDown}
                  onBlur={handleEmailBlur}
                  onFocus={handleEmailFocus}
                  placeholder="请输入邮箱地址"
                  className="login-card__input"
                  autoComplete="off"
                  name="login-email-nonauto"
                  data-1p-ignore="true"
                  data-lpignore="true"
                />
                {showEmailSuggestions && emailSuggestions.length > 0 && (
                  <ul className="login-card__email-suggestions">
                    {emailSuggestions.map((s, idx) => (
                      <li
                        key={s}
                        className={`login-card__email-suggestion-item${idx === activeEmailIdx ? ' login-card__email-suggestion-item--active' : ''}`}
                        onMouseDown={() => handleEmailSuggestionClick(s)}
                      >
                        <Mail size={13} />
                        <span><strong>{s.split('@')[0]}@</strong>{s.split('@')[1]}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="login-card__field">
              <label className="login-card__label">
                <Lock size={16} /> 密码
              </label>
              <div className="login-card__password-wrapper">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="请输入密码"
                  className="login-card__input"
                  autoComplete="off"
                  name="login-pwd-nonauto"
                  data-1p-ignore="true"
                  data-lpignore="true"
                />
                <button
                  type="button"
                  className="login-card__password-toggle"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <div className="login-card__options">
              <label className="login-card__remember">
                <input
                  type="checkbox"
                  checked={rememberPassword}
                  onChange={(e) => setRememberPassword(e.target.checked)}
                  className="login-card__remember-checkbox"
                />
                <span className="login-card__remember-text">记住密码</span>
              </label>
              <button
                type="button"
                className="login-card__forgot-link"
                onClick={() => switchView('forgot')}
              >
                忘记密码？
              </button>
            </div>

            <button type="submit" className="btn btn-primary btn-lg login-card__submit" disabled={submitting}>
              <LogIn size={18} /> {submitting ? '登录中...' : '登录'}
            </button>

            <button
              type="button"
              className="login-card__change-pwd-link"
              onClick={() => switchView('changePassword')}
            >
              <KeyRound size={14} /> 修改密码
            </button>
          </form>
        )}

        {/* ==================== 注册表单 ==================== */}
        {view === 'register' && (
          <form onSubmit={handleRegister} className="login-card__form" autoComplete="off" data-lpignore="true">
            {/* 隐藏的陷阱输入框，防止 macOS 密码自动填充悬浮提示 */}
            <input type="text" name="trap-user-reg" autoComplete="username" style={{ position: 'absolute', opacity: 0, height: 0, width: 0, padding: 0, border: 'none', pointerEvents: 'none' }} tabIndex={-1} aria-hidden="true" />
            <input type="password" name="trap-pass-reg" autoComplete="current-password" style={{ position: 'absolute', opacity: 0, height: 0, width: 0, padding: 0, border: 'none', pointerEvents: 'none' }} tabIndex={-1} aria-hidden="true" />
            <div className="login-card__field">
              <label className="login-card__label">
                <User size={16} /> 真名 <span className="login-card__required">*必填</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="请输入您的真实姓名"
                className="login-card__input"
                autoComplete="name"
              />
            </div>

            <div className="login-card__field">
              <label className="login-card__label">
                <Mail size={16} /> 邮箱
              </label>
              <div className="login-card__email-wrap">
                <input
                  type="text"
                  inputMode="email"
                  value={email}
                  onChange={handleEmailChange}
                  onKeyDown={handleEmailKeyDown}
                  onBlur={handleEmailBlur}
                  onFocus={handleEmailFocus}
                  placeholder="请输入邮箱地址"
                  className="login-card__input"
                  autoComplete="off"
                  name="register-email-nonauto"
                  data-1p-ignore="true"
                  data-lpignore="true"
                />
                {showEmailSuggestions && emailSuggestions.length > 0 && (
                  <ul className="login-card__email-suggestions">
                    {emailSuggestions.map((s, idx) => (
                      <li
                        key={s}
                        className={`login-card__email-suggestion-item${idx === activeEmailIdx ? ' login-card__email-suggestion-item--active' : ''}`}
                        onMouseDown={() => handleEmailSuggestionClick(s)}
                      >
                        <Mail size={13} />
                        <span><strong>{s.split('@')[0]}@</strong>{s.split('@')[1]}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="login-card__field">
              <label className="login-card__label">
                <Lock size={16} /> 密码
              </label>
              <div className="login-card__password-wrapper">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="请设置密码（至少6位）"
                  className="login-card__input"
                  autoComplete="off"
                  name="register-pwd-nonauto"
                  data-1p-ignore="true"
                  data-lpignore="true"
                />
                <button
                  type="button"
                  className="login-card__password-toggle"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <button type="submit" className="btn btn-primary btn-lg login-card__submit">
              <UserPlus size={18} /> 注册
            </button>
          </form>
        )}

        {/* ==================== 忘记密码表单（分步验证码） ==================== */}
        {view === 'forgot' && (
          <>
            {/* 步骤 1：输入邮箱，发送验证码 */}
            {resetStep === 'email' && (
              <form onSubmit={handleSendCode} className="login-card__form" autoComplete="off" data-lpignore="true">
                <div className="login-card__field">
                  <label className="login-card__label">
                    <Mail size={16} /> 注册邮箱
                  </label>
                  <div className="login-card__email-wrap">
                    <input
                      type="text"
                      inputMode="email"
                      value={email}
                      onChange={handleEmailChange}
                      onKeyDown={handleEmailKeyDown}
                      onBlur={handleEmailBlur}
                      onFocus={handleEmailFocus}
                      placeholder="请输入注册时使用的邮箱地址"
                      className="login-card__input"
                      autoComplete="off"
                      name="reset-email-nonauto"
                      data-1p-ignore="true"
                      data-lpignore="true"
                    />
                    {showEmailSuggestions && emailSuggestions.length > 0 && (
                      <ul className="login-card__email-suggestions">
                        {emailSuggestions.map((s, idx) => (
                          <li
                            key={s}
                            className={`login-card__email-suggestion-item${idx === activeEmailIdx ? ' login-card__email-suggestion-item--active' : ''}`}
                            onMouseDown={() => handleEmailSuggestionClick(s)}
                          >
                            <Mail size={13} />
                            <span><strong>{s.split('@')[0]}@</strong>{s.split('@')[1]}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>

                <button type="submit" className="btn btn-primary btn-lg login-card__submit" disabled={submitting}>
                  <Mail size={18} /> {submitting ? '发送中...' : '发送验证码'}
                </button>
              </form>
            )}

            {/* 步骤 2：输入验证码 */}
            {resetStep === 'code' && (
              <form onSubmit={handleVerifyCode} className="login-card__form" autoComplete="off">
                <div className="login-card__field">
                  <label className="login-card__label">
                    <Mail size={16} /> 邮箱
                  </label>
                  <input
                    type="text"
                    value={email}
                    className="login-card__input"
                    disabled
                  />
                </div>

                <div className="login-card__field">
                  <label className="login-card__label">
                    <KeyRound size={16} /> 验证码
                  </label>
                  <input
                    type="text"
                    value={resetCode}
                    onChange={(e) => setResetCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="请输入 6 位数字验证码"
                    className="login-card__input login-card__input--code"
                    maxLength={6}
                    autoComplete="one-time-code"
                  />
                </div>

                <div style={{ display: 'flex', gap: '8px' }}>
                  <button type="submit" className="btn btn-primary btn-lg login-card__submit" disabled={submitting} style={{ flex: 1 }}>
                    <KeyRound size={18} /> {submitting ? '验证中...' : '验证'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-lg login-card__submit"
                    style={{ flex: 'none', width: 'auto', background: 'var(--color-bg-hover)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border-light)' }}
                    disabled={countdown > 0 || submitting}
                    onClick={handleSendCode}
                  >
                    {countdown > 0 ? `${countdown}s` : '重发'}
                  </button>
                </div>
              </form>
            )}

            {/* 步骤 3：设置新密码 */}
            {resetStep === 'password' && (
              <form onSubmit={handleResetPassword} className="login-card__form" autoComplete="off" data-lpignore="true">
                {/* 隐藏的陷阱输入框 */}
                <input type="text" name="trap-user-reset" autoComplete="username" style={{ position: 'absolute', opacity: 0, height: 0, width: 0, padding: 0, border: 'none', pointerEvents: 'none' }} tabIndex={-1} aria-hidden="true" />
                <input type="password" name="trap-pass-reset" autoComplete="current-password" style={{ position: 'absolute', opacity: 0, height: 0, width: 0, padding: 0, border: 'none', pointerEvents: 'none' }} tabIndex={-1} aria-hidden="true" />
                <div className="login-card__field">
                  <label className="login-card__label">
                    <Lock size={16} /> 新密码
                  </label>
                  <div className="login-card__password-wrapper">
                    <input
                      type={showNewPassword ? 'text' : 'password'}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="请设置新密码（至少6位）"
                      className="login-card__input"
                      autoComplete="off"
                      name="reset-newpwd-nonauto"
                      data-1p-ignore="true"
                      data-lpignore="true"
                    />
                    <button
                      type="button"
                      className="login-card__password-toggle"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                    >
                      {showNewPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                <div className="login-card__field">
                  <label className="login-card__label">
                    <Lock size={16} /> 确认新密码
                  </label>
                  <div className="login-card__password-wrapper">
                    <input
                      type={showConfirmPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="请再次输入新密码"
                      className="login-card__input"
                      autoComplete="off"
                      name="reset-confirmpwd-nonauto"
                      data-1p-ignore="true"
                      data-lpignore="true"
                    />
                    <button
                      type="button"
                      className="login-card__password-toggle"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    >
                      {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                <button type="submit" className="btn btn-primary btn-lg login-card__submit" disabled={submitting}>
                  <KeyRound size={18} /> {submitting ? '重置中...' : '确认重置'}
                </button>
              </form>
            )}
          </>
        )}

        {/* ==================== 修改密码表单 ==================== */}
        {view === 'changePassword' && (
          <form onSubmit={handleChangePassword} className="login-card__form" autoComplete="off" data-lpignore="true">
            {/* 隐藏的陷阱输入框 */}
            <input type="text" name="trap-user-chg" autoComplete="username" style={{ position: 'absolute', opacity: 0, height: 0, width: 0, padding: 0, border: 'none', pointerEvents: 'none' }} tabIndex={-1} aria-hidden="true" />
            <input type="password" name="trap-pass-chg" autoComplete="current-password" style={{ position: 'absolute', opacity: 0, height: 0, width: 0, padding: 0, border: 'none', pointerEvents: 'none' }} tabIndex={-1} aria-hidden="true" />
            <div className="login-card__field">
              <label className="login-card__label">
                <Lock size={16} /> 当前密码
              </label>
              <div className="login-card__password-wrapper">
                <input
                  type={showCurrentPassword ? 'text' : 'password'}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="请输入当前密码"
                  className="login-card__input"
                  autoComplete="off"
                  name="chg-curpwd-nonauto"
                  data-1p-ignore="true"
                  data-lpignore="true"
                />
                <button
                  type="button"
                  className="login-card__password-toggle"
                  onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                >
                  {showCurrentPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <div className="login-card__field">
              <label className="login-card__label">
                <Lock size={16} /> 新密码
              </label>
              <div className="login-card__password-wrapper">
                <input
                  type={showNewPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="请设置新密码（至少6位）"
                  className="login-card__input"
                  autoComplete="off"
                  name="chg-newpwd-nonauto"
                  data-1p-ignore="true"
                  data-lpignore="true"
                />
                <button
                  type="button"
                  className="login-card__password-toggle"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                >
                  {showNewPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <div className="login-card__field">
              <label className="login-card__label">
                <Lock size={16} /> 确认新密码
              </label>
              <div className="login-card__password-wrapper">
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="请再次输入新密码"
                  className="login-card__input"
                  autoComplete="off"
                  name="chg-confirmpwd-nonauto"
                  data-1p-ignore="true"
                  data-lpignore="true"
                />
                <button
                  type="button"
                  className="login-card__password-toggle"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                >
                  {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <button type="submit" className="btn btn-primary btn-lg login-card__submit">
              <KeyRound size={18} /> 确认修改
            </button>
          </form>
        )}

        {/* 底部提示 */}
        {view === 'login' && (
          <div className="login-card__hint">
            <p>{supabaseOk === false ? '离线模式 · 请先注册账号' : '请使用已注册的账号登录'}</p>
          </div>
        )}

        {view === 'register' && (
          <div className="login-card__hint">
            <p>注册后需要管理员授权才能访问内部空间</p>
          </div>
        )}

        {view === 'forgot' && (
          <div className="login-card__hint">
            <p>{resetStep === 'email' ? '我们会向你的邮箱发送一个 6 位验证码' : resetStep === 'code' ? '验证码 5 分钟内有效' : '设置新密码后即可登录'}</p>
          </div>
        )}
      </div>
    </div>
  );
}
