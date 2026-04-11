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
} from 'lucide-react';
import './UserManagement.css';

export default function UserManagement() {
  const { isAuthenticated, isAdmin, getAllUsers, authorizeUser, revokeUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (isAuthenticated && isAdmin) {
      setUsers(getAllUsers());
    }
  }, [isAuthenticated, isAdmin, refreshKey]);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (!isAdmin) {
    return <Navigate to="/internal/documents" replace />;
  }

  const handleAuthorize = (userId) => {
    authorizeUser(userId);
    setRefreshKey((k) => k + 1);
  };

  const handleRevoke = (userId) => {
    if (window.confirm('确定要撤销此用户的授权吗？')) {
      revokeUser(userId);
      setRefreshKey((k) => k + 1);
    }
  };

  return (
    <div className="users-page">
      <div className="container">
        <div className="users-page__header">
          <h1>
            <Users size={28} /> 用户管理
          </h1>
          <p>管理成员账户和访问权限</p>
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
                    <span className={`users-table__role ${u.role === 'admin' ? 'users-table__role--admin' : ''}`}>
                      {u.role === 'admin' ? '管理员' : '成员'}
                    </span>
                  </td>
                  <td>
                    <span className="users-table__date">
                      {new Date(u.createdAt).toLocaleDateString('zh-CN')}
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
                    {u.role !== 'admin' && (
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
