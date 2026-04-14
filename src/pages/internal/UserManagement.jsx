import { useState, useEffect, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useSiteContent } from '../../contexts/SiteContentContext';
import { useWysiwyg } from '../../contexts/WysiwygContext';
import EditableText from '../../components/EditableText';
import CustomSelect from '../../components/CustomSelect';
import {
  Users,
  Shield,
  ShieldOff,
  Check,
  X,
  Calendar,
  UserCheck,
  UserX,
  Eye,
  Mail,
  Plus,
  Trash2,
  CheckCircle,
  AlertCircle,
  Loader2,
  ChevronDown,
  Clock,
  User,
} from 'lucide-react';
import './UserManagement.css';

const ROLE_LABELS = { admin: '管理员', member: '成员' };
const ROLE_COLORS = {
  admin: '#4FBFC4',
  member: '#8A9A8C',
};

export default function UserManagement() {
  const {
    user: currentUser,
    isAuthenticated,
    isAdmin,
    getAllUsers,
    authorizeUser,
    revokeUser,
    changeUserRole,
    preAuthorizeByEmail,
    getPreAuthorizedEmails,
    removePreAuthorizedEmail,
  } = useAuth();
  const { internalConfig, updateInternalConfig } = useSiteContent();
  const { editing } = useWysiwyg();
  const uc = internalConfig.users;

  const updateUsers = useCallback(
    (key, val) => updateInternalConfig({ users: { [key]: val } }),
    [updateInternalConfig]
  );
  const [users, setUsers] = useState([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [showPendingPanel, setShowPendingPanel] = useState(false);

  // 已授权 / 待授权用户分组（兼容 boolean / string / truthy 值）
  const isAuthorized = (u) => u.authorized === true || u.authorized === 'true' || u.authorized === 'TRUE';
  const authorizedUsers = users.filter(isAuthorized);
  const pendingUsers = users.filter((u) => !isAuthorized(u));

  // 预授权相关状态
  const [preAuthEmail, setPreAuthEmail] = useState('');
  const [preAuthLoading, setPreAuthLoading] = useState(false);
  const [preAuthMessage, setPreAuthMessage] = useState({ type: '', text: '' });
  const [preAuthList, setPreAuthList] = useState([]);

  // 邮箱后缀自动提示
  const EMAIL_SUFFIXES = [
    'qq.com', '163.com', '126.com', 'gmail.com', 'outlook.com',
    'foxmail.com', 'hotmail.com', 'yeah.net', 'sina.com', 'sohu.com',
    'icloud.com', '139.com', '188.com', 'yahoo.com',
  ];
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeSuggestionIdx, setActiveSuggestionIdx] = useState(-1);

  const emailSuggestions = (() => {
    const atIdx = preAuthEmail.indexOf('@');
    if (atIdx < 1) return []; // 没输入 @ 或 @ 在开头，不提示
    const typed = preAuthEmail.slice(atIdx + 1).toLowerCase();
    return EMAIL_SUFFIXES
      .filter((s) => s.startsWith(typed) && s !== typed)
      .map((s) => preAuthEmail.slice(0, atIdx + 1) + s);
  })();

  const handleEmailChange = (e) => {
    const val = e.target.value;
    setPreAuthEmail(val);
    setShowSuggestions(val.includes('@'));
    setActiveSuggestionIdx(-1);
  };

  const handleSuggestionClick = (suggestion) => {
    setPreAuthEmail(suggestion);
    setShowSuggestions(false);
    setActiveSuggestionIdx(-1);
  };

  const handleEmailKeyDown = (e) => {
    if (!showSuggestions || emailSuggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveSuggestionIdx((i) => (i + 1) % emailSuggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveSuggestionIdx((i) => (i <= 0 ? emailSuggestions.length - 1 : i - 1));
    } else if (e.key === 'Enter' && activeSuggestionIdx >= 0) {
      e.preventDefault();
      handleSuggestionClick(emailSuggestions[activeSuggestionIdx]);
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
    }
  };

  const handleEmailBlur = () => {
    // 延迟关闭，让 click 事件有时间触发
    setTimeout(() => setShowSuggestions(false), 150);
  };

  useEffect(() => {
    if (isAuthenticated) {
      const loadUsers = async () => {
        const data = await getAllUsers();
        console.log('[UserManagement] getAllUsers 返回:', data?.length, '条',
          data?.map(u => ({ id: u.id?.slice(0,8), email: u.email, authorized: u.authorized, type: typeof u.authorized }))
        );
        setUsers(data || []);
      };
      loadUsers();
      if (isAdmin) {
        getPreAuthorizedEmails().then(setPreAuthList);
      }
    }
  }, [isAuthenticated, refreshKey, getAllUsers, isAdmin, getPreAuthorizedEmails]);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  const handleAuthorize = async (userId) => {
    await authorizeUser(userId);
    setRefreshKey((k) => k + 1);
  };

  const handleRevoke = async (userId) => {
    if (window.confirm('确定要撤销此用户的授权吗？')) {
      await revokeUser(userId);
      setRefreshKey((k) => k + 1);
    }
  };

  const handleRoleChange = async (userId, newRole) => {
    await changeUserRole(userId, newRole);
    setRefreshKey((k) => k + 1);
  };

  // 判断当前用户是否可以管理目标用户的角色
  const canManageRole = (targetUser) => {
    if (targetUser.id === currentUser?.id) return false; // 不能改自己
    return isAdmin; // 管理员可以管理其他用户的角色
  };

  // 当前用户可以设置的角色选项
  const getAvailableRoles = () => {
    return ['admin', 'member'];
  };

  // 判断是否可以授权/撤销
  const canManageAuth = (targetUser) => {
    if (targetUser.id === currentUser?.id) return false;
    return isAdmin;
  };

  // 预授权邮箱提交
  const handlePreAuthorize = async (e) => {
    e.preventDefault();
    if (!preAuthEmail.trim()) return;
    setPreAuthLoading(true);
    setPreAuthMessage({ type: '', text: '' });
    try {
      const result = await preAuthorizeByEmail(preAuthEmail.trim());
      if (result.success) {
        setPreAuthMessage({ type: 'success', text: result.message });
        setPreAuthEmail('');
        // 刷新用户列表和预授权列表
        setRefreshKey((k) => k + 1);
        getPreAuthorizedEmails().then(setPreAuthList);
      } else {
        setPreAuthMessage({ type: 'error', text: result.message });
      }
    } catch (err) {
      setPreAuthMessage({ type: 'error', text: '操作失败：' + err.message });
    } finally {
      setPreAuthLoading(false);
      // 3 秒后清除消息
      setTimeout(() => setPreAuthMessage({ type: '', text: '' }), 4000);
    }
  };

  // 移除预授权邮箱
  const handleRemovePreAuth = async (email) => {
    await removePreAuthorizedEmail(email);
    getPreAuthorizedEmails().then(setPreAuthList);
  };

  return (
    <div className="users-page">
      <div className="container">
        <div className="users-page__header">
          <h1>
            <Users size={28} /> <EditableText
              value={uc.pageTitle}
              onChange={(v) => updateUsers('pageTitle', v)}
              configKey="users.pageTitle"
              as="span"
            />
          </h1>
          <p><EditableText
            value={uc.pageDesc}
            onChange={(v) => updateUsers('pageDesc', v)}
            configKey="users.pageDesc"
            as="span"
          /></p>
        </div>

        {!isAdmin && (
          <div className="users-page__readonly-banner">
            <Eye size={16} />
            <span>当前为只读模式，仅管理员可管理用户</span>
          </div>
        )}

        {/* Stats */}
        <div className="users-stats">
          <div className="users-stat">
            <UserCheck size={20} />
            <div>
              <div className="users-stat__value">
                {authorizedUsers.length}
              </div>
              <div className="users-stat__label">已授权</div>
            </div>
          </div>
          <div
            className={`users-stat users-stat--pending users-stat--clickable${showPendingPanel ? ' users-stat--active' : ''}`}
            onClick={() => pendingUsers.length > 0 && setShowPendingPanel((v) => !v)}
            style={{ cursor: pendingUsers.length > 0 ? 'pointer' : 'default' }}
            title={pendingUsers.length > 0 ? '点击查看待授权用户' : '暂无待授权用户'}
          >
            <UserX size={20} />
            <div>
              <div className="users-stat__value">
                {pendingUsers.length}
              </div>
              <div className="users-stat__label">待授权</div>
            </div>
            {pendingUsers.length > 0 && (
              <ChevronDown
                size={16}
                className={`users-stat__chevron${showPendingPanel ? ' users-stat__chevron--open' : ''}`}
              />
            )}
          </div>
        </div>

        {/* 待授权用户面板 */}
        {showPendingPanel && pendingUsers.length > 0 && (
          <div className="users-pending-panel">
            <div className="users-pending-panel__header">
              <Clock size={15} />
              <span>等待授权的用户（{pendingUsers.length}）</span>
            </div>
            <div className="users-pending-panel__list">
              {pendingUsers.map((u) => (
                <div key={u.id} className="users-pending-panel__item">
                  <div className="users-pending-panel__user">
                    <div className="users-pending-panel__avatar">
                      <User size={16} />
                    </div>
                    <div className="users-pending-panel__info">
                      <span className="users-pending-panel__name">{u.name}</span>
                      <span className="users-pending-panel__email">{u.email}</span>
                    </div>
                    <span className="users-pending-panel__date">
                      {new Date(u.createdAt || u.created_at).toLocaleDateString('zh-CN')} 注册
                    </span>
                  </div>
                  {isAdmin && canManageAuth(u) && (
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => handleAuthorize(u.id)}
                    >
                      <Shield size={14} /> 授权
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 权限说明 */}
        <div className="users-roles-info">
          <h4>角色说明</h4>
          <div className="users-roles-info__grid">
            <div className="users-roles-info__item">
              <span className="users-roles-info__badge" style={{ color: ROLE_COLORS.admin, background: `${ROLE_COLORS.admin}15` }}>
                <Shield size={14} /> 管理员
              </span>
              <span>编辑网站组件内容、授权用户、管理成员角色</span>
            </div>
            <div className="users-roles-info__item">
              <span className="users-roles-info__badge" style={{ color: ROLE_COLORS.member, background: `${ROLE_COLORS.member}15` }}>
                <Users size={14} /> 成员
              </span>
              <span>访问内部文件资料、查看通知与任务</span>
            </div>
          </div>
        </div>

        {/* 邮箱预授权（仅管理员可见） */}
        {isAdmin && (
          <div className="users-preauth">
            <div className="users-preauth__header">
              <h4><Mail size={16} /> 邮箱授权</h4>
              <p>输入成员邮箱直接授权 — 已注册的用户将立即获得权限，未注册的邮箱将加入预授权列表，注册后自动拥有权限</p>
            </div>

            <form className="users-preauth__form" onSubmit={handlePreAuthorize}>
              <div className="users-preauth__input-wrap">
                <Mail size={16} className="users-preauth__input-icon" />
                <input
                  type="email"
                  value={preAuthEmail}
                  onChange={handleEmailChange}
                  onKeyDown={handleEmailKeyDown}
                  onBlur={handleEmailBlur}
                  onFocus={() => preAuthEmail.includes('@') && setShowSuggestions(true)}
                  placeholder="输入成员邮箱地址…"
                  className="users-preauth__input"
                  disabled={preAuthLoading}
                  autoComplete="off"
                />
                {showSuggestions && emailSuggestions.length > 0 && (
                  <ul className="users-preauth__suggestions">
                    {emailSuggestions.map((s, idx) => (
                      <li
                        key={s}
                        className={`users-preauth__suggestion-item${idx === activeSuggestionIdx ? ' users-preauth__suggestion-item--active' : ''}`}
                        onMouseDown={() => handleSuggestionClick(s)}
                      >
                        <Mail size={13} />
                        <span>
                          <strong>{s.split('@')[0]}@</strong>{s.split('@')[1]}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <button
                type="submit"
                className="btn btn-primary users-preauth__btn"
                disabled={!preAuthEmail.trim() || preAuthLoading}
              >
                {preAuthLoading ? (
                  <><Loader2 size={16} className="users-preauth__spinner" /> 处理中…</>
                ) : (
                  <><Plus size={16} /> 授权</>
                )}
              </button>
            </form>

            {preAuthMessage.text && (
              <div className={`users-preauth__message users-preauth__message--${preAuthMessage.type}`}>
                {preAuthMessage.type === 'success' ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
                <span>{preAuthMessage.text}</span>
              </div>
            )}

            {/* 预授权列表 */}
            {preAuthList.length > 0 && (
              <div className="users-preauth__list">
                <div className="users-preauth__list-title">待注册的预授权邮箱（{preAuthList.length}）</div>
                {preAuthList.map((item) => (
                  <div key={item.email} className="users-preauth__list-item">
                    <div className="users-preauth__list-email">
                      <Mail size={14} />
                      <span>{item.email}</span>
                      <span className="users-preauth__list-date">
                        {item.addedAt ? new Date(item.addedAt).toLocaleDateString('zh-CN') : ''}
                      </span>
                    </div>
                    <button
                      className="users-preauth__list-remove"
                      onClick={() => handleRemovePreAuth(item.email)}
                      title="移除"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* User List — 仅已授权用户 */}
        <div className="users-table-wrapper">
          <table className="users-table">
            <thead>
              <tr>
                <th>用户</th>
                <th>邮箱</th>
                <th>角色</th>
                <th>注册时间</th>
                {isAdmin && <th>操作</th>}
              </tr>
            </thead>
            <tbody>
              {authorizedUsers.length === 0 ? (
                <tr>
                  <td colSpan={isAdmin ? 5 : 4} style={{ textAlign: 'center', padding: '2rem', color: 'var(--color-text-muted)' }}>
                    暂无已授权用户
                  </td>
                </tr>
              ) : (
                authorizedUsers.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div className="users-table__user">
                        <div className="users-table__avatar">
                          <User size={16} />
                        </div>
                        <span>{u.name}</span>
                      </div>
                    </td>
                    <td>
                      <span className="users-table__email">{u.email}</span>
                    </td>
                    <td>
                      {canManageRole(u) ? (
                        <div className="users-table__role-select-wrapper">
                          <CustomSelect
                            value={u.role}
                            onChange={(val) => handleRoleChange(u.id, val)}
                            options={getAvailableRoles().map((role) => ({
                              value: role,
                              label: ROLE_LABELS[role],
                            }))}
                            size="sm"
                            style={{ color: ROLE_COLORS[u.role] }}
                          />
                        </div>
                      ) : (
                        <span
                          className={`users-table__role users-table__role--${u.role}`}
                          style={{ color: ROLE_COLORS[u.role] }}
                        >
                          {ROLE_LABELS[u.role]}
                        </span>
                      )}
                    </td>
                    <td>
                      <span className="users-table__date">
                        {new Date(u.createdAt || u.created_at).toLocaleDateString('zh-CN')}
                      </span>
                    </td>
                    {isAdmin && (
                      <td>
                        <div className="users-table__actions">
                          {canManageAuth(u) ? (
                            <button
                              className="btn btn-ghost btn-sm"
                              onClick={() => handleRevoke(u.id)}
                            >
                              <ShieldOff size={14} /> 撤销
                            </button>
                          ) : (
                            <span className="users-table__no-action">—</span>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
