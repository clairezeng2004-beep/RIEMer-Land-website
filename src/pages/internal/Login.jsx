import { useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { Mail, Lock, User, LogIn, UserPlus, Eye, EyeOff, AlertCircle, CheckCircle } from 'lucide-react';
import './Login.css';

export default function Login() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const { login, register, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  if (isAuthenticated) {
    return <Navigate to="/internal/documents" replace />;
  }

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!email || !password) {
      setError('请填写所有必填字段');
      return;
    }

    if (isLogin) {
      const result = login(email, password);
      if (result.success) {
        navigate('/internal/documents');
      } else {
        setError(result.message);
      }
    } else {
      if (!name) {
        setError('请填写姓名');
        return;
      }
      if (password.length < 6) {
        setError('密码至少需要 6 个字符');
        return;
      }
      const result = register(email, password, name);
      if (result.success) {
        setSuccess(result.message);
        setEmail('');
        setPassword('');
        setName('');
      } else {
        setError(result.message);
      }
    }
  };

  return (
    <div className="login-page">
      <div className="login-page__bg">
        <div className="login-page__gradient" />
      </div>

      <div className="login-card">
        <div className="login-card__header">
          <img src="/logo.png" alt="RIEMer Land" className="login-card__logo" />
          <h2>{isLogin ? '欢迎回来' : '加入我们'}</h2>
          <p>{isLogin ? '登录以访问内部空间' : '注册成为 RIEMer Land 成员'}</p>
        </div>

        <div className="login-card__tabs">
          <button
            className={`login-card__tab ${isLogin ? 'login-card__tab--active' : ''}`}
            onClick={() => { setIsLogin(true); setError(''); setSuccess(''); }}
          >
            <LogIn size={16} /> 登录
          </button>
          <button
            className={`login-card__tab ${!isLogin ? 'login-card__tab--active' : ''}`}
            onClick={() => { setIsLogin(false); setError(''); setSuccess(''); }}
          >
            <UserPlus size={16} /> 注册
          </button>
        </div>

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

        <form onSubmit={handleSubmit} className="login-card__form">
          {!isLogin && (
            <div className="login-card__field">
              <label className="login-card__label">
                <User size={16} /> 姓名
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="请输入您的姓名"
                className="login-card__input"
              />
            </div>
          )}

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
                placeholder={isLogin ? '请输入密码' : '请设置密码（至少6位）'}
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
            {isLogin ? (
              <>
                <LogIn size={18} /> 登录
              </>
            ) : (
              <>
                <UserPlus size={18} /> 注册
              </>
            )}
          </button>
        </form>

        {isLogin && (
          <div className="login-card__hint">
            <p>演示账号：admin@riemerland.org / admin123</p>
          </div>
        )}

        {!isLogin && (
          <div className="login-card__hint">
            <p>注册后需要管理员授权才能访问内部空间</p>
          </div>
        )}
      </div>
    </div>
  );
}
