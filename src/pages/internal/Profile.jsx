import { useState, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { User, Camera, Save, Loader2 } from 'lucide-react';
import './Profile.css';

export default function Profile() {
  const { user, updateProfile } = useAuth();
  const fileInputRef = useRef(null);

  const [nickname, setNickname] = useState(user?.nickname || '');
  const [signature, setSignature] = useState(user?.signature || '');
  const [avatarPreview, setAvatarPreview] = useState(user?.avatar || null);
  const [avatarFile, setAvatarFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  const handleAvatarClick = () => {
    fileInputRef.current?.click();
  };

  const handleAvatarChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 限制文件大小 2MB
    if (file.size > 2 * 1024 * 1024) {
      setMessage({ type: 'error', text: '图片大小不能超过 2MB' });
      return;
    }

    setAvatarFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => {
      setAvatarPreview(ev.target.result);
    };
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);

    try {
      const updates = {
        nickname: nickname.trim(),
        signature: signature.trim(),
      };

      // 如果选择了新头像，将 base64 存储（本地模式）
      if (avatarFile) {
        updates.avatar = avatarPreview;
      }

      const result = await updateProfile(updates);
      if (result.success) {
        setMessage({ type: 'success', text: '个人资料保存成功！' });
        setAvatarFile(null);
      } else {
        setMessage({ type: 'error', text: result.message || '保存失败' });
      }
    } catch {
      setMessage({ type: 'error', text: '保存失败，请重试' });
    } finally {
      setSaving(false);
    }
  };

  const displayName = user?.nickname || user?.name || user?.email?.split('@')[0] || '用户';

  return (
    <div className="profile-page">
      <div className="container">
        <div className="profile-page__header">
          <h1>个人主页</h1>
          <p>设置你的昵称、头像和个性签名</p>
        </div>

        <div className="profile-page__card card">
          {/* 头像区域 */}
          <div className="profile-page__avatar-section">
            <div className="profile-page__avatar" onClick={handleAvatarClick}>
              {avatarPreview ? (
                <img src={avatarPreview} alt="头像" className="profile-page__avatar-img" />
              ) : (
                <div className="profile-page__avatar-placeholder">
                  <User size={48} />
                </div>
              )}
              <div className="profile-page__avatar-overlay">
                <Camera size={20} />
                <span>更换头像</span>
              </div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleAvatarChange}
              className="profile-page__avatar-input"
            />
            <div className="profile-page__avatar-hint">
              点击头像更换，支持 JPG/PNG，不超过 2MB
            </div>
          </div>

          {/* 信息区域 */}
          <div className="profile-page__info-section">
            <div className="profile-page__preview">
              <h2 className="profile-page__display-name">{displayName}</h2>
              {signature && (
                <p className="profile-page__display-signature">{signature}</p>
              )}
            </div>

            <div className="profile-page__form">
              <div className="profile-page__field">
                <label className="profile-page__label">
                  注册姓名
                  <span className="profile-page__label-hint">（不可修改）</span>
                </label>
                <input
                  type="text"
                  className="profile-page__input profile-page__input--disabled"
                  value={user?.name || ''}
                  disabled
                />
              </div>

              <div className="profile-page__field">
                <label className="profile-page__label">邮箱</label>
                <input
                  type="text"
                  className="profile-page__input profile-page__input--disabled"
                  value={user?.email || ''}
                  disabled
                />
              </div>

              <div className="profile-page__field">
                <label className="profile-page__label">
                  昵称
                  <span className="profile-page__label-hint">（将在"关于我们"页展示）</span>
                </label>
                <input
                  type="text"
                  className="profile-page__input"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  placeholder="设置你的昵称"
                  maxLength={20}
                />
              </div>

              <div className="profile-page__field">
                <label className="profile-page__label">
                  个性签名
                  <span className="profile-page__label-hint">（将在"关于我们"页展示）</span>
                </label>
                <textarea
                  className="profile-page__textarea"
                  value={signature}
                  onChange={(e) => setSignature(e.target.value)}
                  placeholder="写一句个性签名..."
                  maxLength={100}
                  rows={2}
                />
                <div className="profile-page__char-count">
                  {signature.length}/100
                </div>
              </div>

              {message && (
                <div className={`profile-page__message profile-page__message--${message.type}`}>
                  {message.text}
                </div>
              )}

              <button
                className="profile-page__save-btn"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? (
                  <>
                    <Loader2 size={16} className="profile-page__spinner" />
                    保存中...
                  </>
                ) : (
                  <>
                    <Save size={16} />
                    保存修改
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
