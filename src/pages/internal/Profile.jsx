import { useState, useRef, useEffect, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { supabase, isSupabaseConfigured, getReachable } from '../../lib/supabase';
import { useSiteContent } from '../../contexts/SiteContentContext';
import { useWysiwyg } from '../../contexts/WysiwygContext';
import EditableText from '../../components/EditableText';
import { User, Camera, Save, Loader2 } from 'lucide-react';
import './Profile.css';

const MEMBER_PROFILES_KEY = 'riemer_member_profiles';

export default function Profile() {
  const { user, updateProfile, supabaseOk } = useAuth();
  const { internalConfig, updateInternalConfig } = useSiteContent();
  useWysiwyg();
  const pc = internalConfig.profile || {};
  const updatePC = useCallback((key, val) => updateInternalConfig({ profile: { [key]: val } }), [updateInternalConfig]);
  const fileInputRef = useRef(null);

  const [name, setName] = useState(user?.name || '');
  const [nickname, setNickname] = useState(user?.nickname || '');
  const [signature, setSignature] = useState(user?.signature || '');
  const [enrollmentYear, setEnrollmentYear] = useState('');
  const [enrollmentYearLoaded, setEnrollmentYearLoaded] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState(user?.avatar || null);
  const [avatarFile, setAvatarFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  // 标记是否已经从 user 对象恢复过数据（避免异步 user 更新反复覆盖用户正在编辑的内容）
  const restoredRef = useRef(false);

  // 当 user 对象更新时（如刷新后恢复登录态），同步表单字段
  useEffect(() => {
    if (!user) {
      restoredRef.current = false;
      return;
    }
    // 只在首次获取到 user 时回填（避免保存后 setUser 再次触发覆盖）
    if (restoredRef.current) return;

    setName(user.name || '');
    setNickname(user.nickname || '');
    setSignature(user.signature || '');
    setAvatarPreview(user.avatar || null);
    restoredRef.current = true;
  }, [user]);

  // 从本地 localStorage 加载入学年份
  const loadLocalEnrollmentYear = (userId) => {
    try {
      const stored = localStorage.getItem(MEMBER_PROFILES_KEY);
      const profiles = stored ? JSON.parse(stored) : [];
      const mp = profiles.find((p) => p.user_id === userId);
      if (mp?.enrollment_year) {
        setEnrollmentYear(mp.enrollment_year);
      }
    } catch {
      // ignore
    } finally {
      setEnrollmentYearLoaded(true);
    }
  };

  // 判断 Supabase 是否真正可用（已配置 + 可达 + AuthContext 确认 ok）
  const canUseSupabase = isSupabaseConfigured && supabase && supabaseOk === true && getReachable() !== false;

  // 加载入学年份（Supabase 优先，本地兜底）
  useEffect(() => {
    if (!user) return;
    const loadEnrollmentYear = async () => {
      if (canUseSupabase) {
        try {
          const { data, error } = await supabase
            .from('member_profiles')
            .select('enrollment_year')
            .eq('user_id', user.id)
            .maybeSingle();
          if (error) {
            // 表不存在或列缺失时静默回退本地，不打扰用户
            console.warn('[Profile] Supabase 加载入学年份失败:', error.message);
          } else if (data?.enrollment_year) {
            setEnrollmentYear(data.enrollment_year);
            setEnrollmentYearLoaded(true);
            return;
          }
        } catch (err) {
          console.warn('[Profile] Supabase 加载入学年份异常，回退本地:', err);
        }
      }

      // 本地模式 / Supabase 查不到数据 → 从 localStorage 读
      loadLocalEnrollmentYear(user.id);
    };
    loadEnrollmentYear();
  }, [user, canUseSupabase]);

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

    const warnings = []; // 收集非致命警告

    try {
      const updates = {
        name: name.trim(),
        nickname: nickname.trim(),
        signature: signature.trim(),
      };

      // 如果选择了新头像，将 base64 存储
      if (avatarFile) {
        updates.avatar = avatarPreview;
      }

      console.log('[Profile] 开始保存，canUseSupabase:', canUseSupabase, 'supabaseOk:', supabaseOk);

      // updateProfile 会同时更新本地 + Supabase（如果可用）
      const result = await updateProfile(updates);
      console.log('[Profile] updateProfile 结果:', result);

      if (!result.success) {
        setMessage({ type: 'error', text: result.message || '保存失败' });
        return;
      }

      // 如果 updateProfile 返回了云端同步警告，收集起来
      if (result.message) {
        warnings.push(result.message);
      }

      // ---- 入学年份：始终先保存到本地，再尝试同步 Supabase ----
      const yearVal = enrollmentYear.trim();

      // 1. 本地 localStorage 保存（保证刷新后不丢失）
      try {
        const stored = localStorage.getItem(MEMBER_PROFILES_KEY);
        const profiles = stored ? JSON.parse(stored) : [];
        const idx = profiles.findIndex((p) => p.user_id === user.id);
        if (idx >= 0) {
          profiles[idx].enrollment_year = yearVal;
        } else {
          profiles.push({ user_id: user.id, enrollment_year: yearVal, joined_at: new Date().toISOString() });
        }
        localStorage.setItem(MEMBER_PROFILES_KEY, JSON.stringify(profiles));
      } catch (err) {
        console.warn('[Profile] 本地入学年份保存失败:', err);
      }

      // 2. Supabase 同步入学年份（如果可用）
      if (canUseSupabase) {
        try {
          // 先检查是否已有记录
          const { data: existingRecord, error: selectError } = await supabase
            .from('member_profiles')
            .select('user_id')
            .eq('user_id', user.id)
            .maybeSingle();

          if (selectError) {
            // 表不存在时直接跳过，不展示技术性错误
            const isTableMissing = selectError.message?.includes('member_profiles') ||
              selectError.message?.includes('schema cache') ||
              selectError.code === '42P01';
            if (isTableMissing) {
              console.warn('[Profile] member_profiles 表不存在，跳过云端同步');
              warnings.push('入学年份仅保存在本地（请联系管理员执行数据库修复脚本）');
            } else {
              console.warn('[Profile] 查询 member_profiles 失败:', selectError.message);
              warnings.push('入学年份云端同步失败');
            }
          } else {
            let upsertError;
            if (existingRecord) {
              // 已有记录 → 只更新 enrollment_year（不覆盖 joined_at 和其他字段）
              const { error } = await supabase
                .from('member_profiles')
                .update({ enrollment_year: yearVal, updated_at: new Date().toISOString() })
                .eq('user_id', user.id);
              upsertError = error;
            } else {
              // 无记录 → 插入新记录
              const { error } = await supabase
                .from('member_profiles')
                .insert({
                  user_id: user.id,
                  enrollment_year: yearVal,
                  joined_at: user.created_at || new Date().toISOString(),
                });
              upsertError = error;
            }

            if (upsertError) {
              console.warn('[Profile] Supabase member_profiles 同步失败:', upsertError.message, upsertError.code, upsertError.details);
              warnings.push('入学年份云端同步失败');
            } else {
              console.log('[Profile] Supabase member_profiles 同步成功');
            }
          }
        } catch (err) {
          console.warn('[Profile] Supabase 入学年份同步异常:', err);
          warnings.push('入学年份云端同步失败');
        }
      }

      // 设置成功消息
      setAvatarFile(null);
      if (warnings.length > 0) {
        setMessage({ type: 'success', text: '个人资料已保存！（部分信息仅保存在本地，如需云端同步请联系管理员执行数据库修复脚本 supabase-fix.sql）' });
      } else {
        setMessage({ type: 'success', text: '个人资料保存成功！' });
      }
    } catch (err) {
      console.error('[Profile] handleSave 异常:', err);
      setMessage({ type: 'error', text: '保存失败，请重试：' + (err.message || '未知错误') });
    } finally {
      setSaving(false);
    }
  };

  const displayName = nickname || user?.nickname || '未设置昵称';

  return (
    <div className="profile-page">
      <div className="container">
        <div className="profile-page__header">
          <EditableText as="h1" value={pc.pageTitle || '个人主页'} configKey="profile.pageTitle" onChange={v => updatePC('pageTitle', v)} />
          <EditableText as="p" value={pc.pageDesc || '设置你的昵称、头像和个性签名'} configKey="profile.pageDesc" onChange={v => updatePC('pageDesc', v)} />
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
                  <span className="profile-page__label-hint">（同步注册时的真名）</span>
                </label>
                <input
                  type="text"
                  className="profile-page__input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="请输入真实姓名"
                  maxLength={30}
                />
              </div>

              <div className="profile-page__field">
                <label className="profile-page__label">
                  入学年份
                  <span className="profile-page__label-hint">（将在成员通讯录中展示）</span>
                </label>
                <input
                  type="text"
                  className={`profile-page__input${!enrollmentYearLoaded ? ' profile-page__input--disabled' : ''}`}
                  value={enrollmentYear}
                  onChange={(e) => setEnrollmentYear(e.target.value)}
                  placeholder={enrollmentYearLoaded ? '如 2023' : '加载中...'}
                  maxLength={10}
                  disabled={!enrollmentYearLoaded}
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
