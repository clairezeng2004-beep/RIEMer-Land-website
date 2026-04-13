import { useState, useEffect } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
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

  // 忘记密码相关
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // 修改密码相关
  const [currentPassword, setCurrentPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);

  const { login, register, resetPassword, changePassword, isAuthenticated } = useAuth();
  const navigate = useNavigate();

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

  if (isAuthenticated && view !== 'changePassword') {
    return <Navigate to="/internal/documents" replace />;
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

    const result = await login(email, password);
    if (result.success) {
      if (rememberPassword) {
        localStorage.setItem(
          SAVED_CREDENTIALS_KEY,
          JSON.stringify({ email, password })
        );
      } else {
        localStorage.removeItem(SAVED_CREDENTIALS_KEY);
      }
      navigate('/internal/documents');
    } else {
      setError(result.message);
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

  // ---- 忘记密码提交 ----
  const handleResetPassword = async (e) => {
    e.preventDefault();
    clearMessages();

    if (!email) {
      setError('请输入注册时使用的邮箱地址');
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

    const result = await resetPassword(email, newPassword);
    if (result.success) {
      setSuccess(result.message);
      setNewPassword('');
      setConfirmPassword('');
      // 本地模式下 3 秒后自动跳回登录
      setTimeout(() => switchView('login'), 3000);
    } else {
      setError(result.message);
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
        return { title: '加入我们', desc: '注册成为 RIEMer Land 成员' };
      case 'forgot':
        return { title: '忘记密码', desc: '输入邮箱和新密码来重置您的密码' };
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
          <form onSubmit={handleLogin} className="login-card__form">
            <div className="login-card__field">
              <label className="login-card__label">
                <Mail size={16} /> 邮箱
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="请输入邮箱地址"
                className="login-card__input"
              />
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

            <button type="submit" className="btn btn-primary btn-lg login-card__submit">
              <LogIn size={18} /> 登录
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
          <form onSubmit={handleRegister} className="login-card__form">
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
              />
            </div>

            <div className="login-card__field">
              <label className="login-card__label">
                <Mail size={16} /> 邮箱
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="请输入邮箱地址"
                className="login-card__input"
              />
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

        {/* ==================== 忘记密码表单 ==================== */}
        {view === 'forgot' && (
          <form onSubmit={handleResetPassword} className="login-card__form">
            <div className="login-card__field">
              <label className="login-card__label">
                <Mail size={16} /> 注册邮箱
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="请输入注册时使用的邮箱地址"
                className="login-card__input"
              />
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
              <KeyRound size={18} /> 重置密码
            </button>
          </form>
        )}

        {/* ==================== 修改密码表单 ==================== */}
        {view === 'changePassword' && (
          <form onSubmit={handleChangePassword} className="login-card__form">
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
            <p>演示账号：admin@riemerland.org / admin123</p>
          </div>
        )}

        {view === 'register' && (
          <div className="login-card__hint">
            <p>注册后需要管理员授权才能访问内部空间</p>
          </div>
        )}

        {view === 'forgot' && (
          <div className="login-card__hint">
            <p>输入注册邮箱和新密码即可重置</p>
          </div>
        )}
      </div>
    </div>
  );
}
