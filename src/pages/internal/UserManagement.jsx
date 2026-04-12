import { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import {
  Users,
  Shield,
  ShieldOff,
  Check,
  X,
  Mail,
  Calendar,
  UserCheck,
  UserX,
  Crown,
  ChevronDown,
} from 'lucide-react';
import './UserManagement.css';

const ROLE_LABELS = { owner: '超级管理员', admin: '管理员', member: '成员' };
const ROLE_COLORS = {
  owner: '#8B5CF6',
  admin: '#4FBFC4',
  member: '#8A9A8C',
};

export default function UserManagement() {
  const {
    user: currentUser,
    isAuthenticated,
    isAdmin,
    isOwner,
    getAllUsers,
    authorizeUser,
    revokeUser,
    changeUserRole,
  } = useAuth();
  const [users, setUsers] = useState([]);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (isAuthenticated && isAdmin) {
      const loadUsers = async () => {
        const data = await getAllUsers();
        setUsers(data);
      };
      loadUsers();
    }
  }, [isAuthenticated, isAdmin, refreshKey, getAllUsers]);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (!isAdmin) {
    return <Navigate to="/internal/documents" replace />;
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
    if (isOwner) return targetUser.role !== 'owner'; // owner 可以管理所有非 owner
    if (currentUser?.role === 'admin') return targetUser.role === 'member'; // admin 只能管理 member
    return false;
  };

  // 当前用户可以设置的角色选项
  const getAvailableRoles = (targetUser) => {
    if (isOwner) {
      // owner 可以设 admin 或 member（不能设 owner）
      return ['admin', 'member'];
    }
    // admin 只能将 member 保持为 member（实际不显示选择器）
    return ['member'];
  };

  // 判断是否可以授权/撤销
  const canManageAuth = (targetUser) => {
    if (targetUser.id === currentUser?.id) return false;
    if (targetUser.role === 'owner') return false;
    if (isOwner) return true;
    if (currentUser?.role === 'admin') return targetUser.role === 'member';
    return false;
  };

  return (
    <div className="users-page">
      <div className="container">
        <div className="users-page__header">
          <h1>
            <Users size={28} /> 用户管理
          </h1>
          <p>管理成员账户、访问权限和角色分配</p>
        </div>

        {/* Stats */}
        <div className="users-stats">
          <div className="users-stat">
            <UserCheck size={20} />
            <div>
              <div className="users-stat__value">
                {users.filter((u) => u.authorized).length}
              </div>
              <div className="users-stat__label">已授权</div>
            </div>
          </div>
          <div className="users-stat users-stat--pending">
            <UserX size={20} />
            <div>
              <div className="users-stat__value">
                {users.filter((u) => !u.authorized).length}
              </div>
              <div className="users-stat__label">待授权</div>
            </div>
          </div>
        </div>

        {/* 权限说明 */}
        <div className="users-roles-info">
          <h4>角色说明</h4>
          <div className="users-roles-info__grid">
            <div className="users-roles-info__item">
              <span className="users-roles-info__badge" style={{ color: ROLE_COLORS.owner, background: `${ROLE_COLORS.owner}15` }}>
                <Crown size={14} /> 超级管理员
              </span>
              <span>管理所有用户角色、授权与撤销</span>
            </div>
            <div className="users-roles-info__item">
              <span className="users-roles-info__badge" style={{ color: ROLE_COLORS.admin, background: `${ROLE_COLORS.admin}15` }}>
                <Shield size={14} /> 管理员
              </span>
              <span>编辑网站内容、管理普通成员授权</span>
            </div>
            <div className="users-roles-info__item">
              <span className="users-roles-info__badge" style={{ color: ROLE_COLORS.member, background: `${ROLE_COLORS.member}15` }}>
                <Users size={14} /> 成员
              </span>
              <span>访问内部文件资料、查看通知与任务</span>
            </div>
          </div>
        </div>

        {/* User List */}
        <div className="users-table-wrapper">
          <table className="users-table">
            <thead>
              <tr>
                <th>用户</th>
                <th>邮箱</th>
                <th>角色</th>
                <th>注册时间</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div className="users-table__user">
                      <div className="users-table__avatar">
                        {u.name.charAt(0).toUpperCase()}
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
                        <select
                          className="users-table__role-select"
                          value={u.role}
                          onChange={(e) => handleRoleChange(u.id, e.target.value)}
                          style={{ color: ROLE_COLORS[u.role] }}
                        >
                          {getAvailableRoles(u).map((role) => (
                            <option key={role} value={role}>
                              {ROLE_LABELS[role]}
                            </option>
                          ))}
                        </select>
                        <ChevronDown size={12} className="users-table__role-select-icon" />
                      </div>
                    ) : (
                      <span
                        className={`users-table__role users-table__role--${u.role}`}
                        style={{ color: ROLE_COLORS[u.role] }}
                      >
                        {u.role === 'owner' && <Crown size={12} />}
                        {ROLE_LABELS[u.role]}
                      </span>
                    )}
                  </td>
                  <td>
                    <span className="users-table__date">
                      {new Date(u.createdAt || u.created_at).toLocaleDateString('zh-CN')}
                    </span>
                  </td>
                  <td>
                    {u.authorized ? (
                      <span className="users-table__status users-table__status--authorized">
                        <Check size={14} /> 已授权
                      </span>
                    ) : (
                      <span className="users-table__status users-table__status--pending">
                        <X size={14} /> 待授权
                      </span>
                    )}
                  </td>
                  <td>
                    {canManageAuth(u) && (
                      <div className="users-table__actions">
                        {u.authorized ? (
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => handleRevoke(u.id)}
                          >
                            <ShieldOff size={14} /> 撤销
                          </button>
                        ) : (
                          <button
                            className="btn btn-primary btn-sm"
                            onClick={() => handleAuthorize(u.id)}
                          >
                            <Shield size={14} /> 授权
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
