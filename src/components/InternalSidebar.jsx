import { NavLink } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useNotifications } from '../contexts/NotificationContext';
import {
  Home,
  Bell,
  FileText,
  CheckSquare,
  Camera,
  Users,
  Settings,
} from 'lucide-react';
import './InternalSidebar.css';

export default function InternalSidebar() {
  const { isAdmin } = useAuth();
  const { unreadCount } = useNotifications();

  const navItems = [
    { to: '/internal', icon: Home, label: '首页', end: true },
    {
      to: '/internal/notifications',
      icon: Bell,
      label: '消息通知',
      badge: unreadCount > 0 ? unreadCount : null,
    },
    { to: '/internal/documents', icon: FileText, label: '文档管理' },
    { to: '/internal/tasks', icon: CheckSquare, label: '事项追踪' },
    { to: '/internal/gallery', icon: Camera, label: '成员相册' },
  ];

  // 管理员专属菜单项
  const adminItems = [
    { to: '/internal/users', icon: Users, label: '用户管理' },
    { to: '/internal/content', icon: Settings, label: '内容管理' },
  ];

  return (
    <aside className="internal-sidebar">
      <div className="internal-sidebar__section">
        <div className="internal-sidebar__section-label">导航</div>
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `internal-sidebar__item ${isActive ? 'internal-sidebar__item--active' : ''}`
            }
          >
            <item.icon size={18} className="internal-sidebar__icon" />
            <span className="internal-sidebar__label">{item.label}</span>
            {item.badge && (
              <span className="internal-sidebar__badge">{item.badge}</span>
            )}
          </NavLink>
        ))}
      </div>

      {isAdmin && (
        <div className="internal-sidebar__section">
          <div className="internal-sidebar__section-label">管理</div>
          {adminItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `internal-sidebar__item ${isActive ? 'internal-sidebar__item--active' : ''}`
              }
            >
              <item.icon size={18} className="internal-sidebar__icon" />
              <span className="internal-sidebar__label">{item.label}</span>
            </NavLink>
          ))}
        </div>
      )}
    </aside>
  );
}
