import { NavLink } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useNotifications } from '../contexts/NotificationContext';
import { useSiteContent } from '../contexts/SiteContentContext';
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
  const { internalConfig } = useSiteContent();
  const sc = internalConfig.sidebar;

  const navItems = [
    { to: '/internal', icon: Home, label: sc.labelHome, end: true },
    {
      to: '/internal/notifications',
      icon: Bell,
      label: sc.labelNotifications,
      badge: unreadCount > 0 ? unreadCount : null,
    },
    { to: '/internal/documents', icon: FileText, label: sc.labelDocuments },
    { to: '/internal/tasks', icon: CheckSquare, label: sc.labelTasks },
    { to: '/internal/gallery', icon: Camera, label: sc.labelGallery },
  ];

  // 管理员专属菜单项
  const adminItems = [
    { to: '/internal/users', icon: Users, label: sc.labelUsers },
    { to: '/internal/content', icon: Settings, label: sc.labelContent },
  ];

  return (
    <aside className="internal-sidebar">
      <div className="internal-sidebar__section">
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
          <div className="internal-sidebar__section-label">{sc.sectionLabelAdmin}</div>
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
