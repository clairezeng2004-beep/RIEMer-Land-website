import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { Lock, Eye, EyeOff, AlertCircle, CheckCircle, KeyRound } from 'lucide-react';
import './Login.css';

export default function ResetPassword() {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const { updatePasswordFromReset } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!newPassword || newPassword.length < 6) {
      setError('新密码至少需要 6 个字符');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }

    const result = await updatePasswordFromReset(newPassword);
    if (result.success) {
      setSuccess(result.message);
      setTimeout(() => navigate('/login'), 3000);
    } else {
      setError(result.message);
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
          <h2>重置密码</h2>
          <p>请设置您的新密码</p>
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
            <KeyRound size={18} /> 确认重置
          </button>
        </form>

        <div className="login-card__hint">
          <p>重置成功后将自动跳转到登录页面</p>
        </div>
      </div>
    </div>
  );
}
