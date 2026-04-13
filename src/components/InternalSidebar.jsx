import { useCallback } from 'react';
import { NavLink } from 'react-router-dom';
import { useNotifications } from '../contexts/NotificationContext';
import { useSiteContent } from '../contexts/SiteContentContext';
import { useWysiwyg } from '../contexts/WysiwygContext';
import EditableText from './EditableText';
import {
  Home,
  Bell,
  FileText,
  CheckSquare,
  Camera,
  Users,
  Settings,
  BookOpen,
  BarChart3,
} from 'lucide-react';
import './InternalSidebar.css';

export default function InternalSidebar() {
  const { unreadCount } = useNotifications();
  const { internalConfig, updateInternalConfig } = useSiteContent();
  const { editing } = useWysiwyg();
  const sc = internalConfig.sidebar;

  const updateSidebar = useCallback(
    (key, val) => updateInternalConfig({ sidebar: { [key]: val } }),
    [updateInternalConfig]
  );

  const navItems = [
    { to: '/internal', icon: Home, configKey: 'labelHome', label: sc.labelHome, end: true },
    {
      to: '/internal/notifications',
      icon: Bell,
      configKey: 'labelNotifications',
      label: sc.labelNotifications,
      badge: unreadCount > 0 ? unreadCount : null,
    },
    { to: '/internal/documents', icon: FileText, configKey: 'labelDocuments', label: sc.labelDocuments },
    { to: '/internal/articles', icon: BookOpen, label: '文章浏览' },
    { to: '/internal/tasks', icon: CheckSquare, configKey: 'labelTasks', label: sc.labelTasks },
    { to: '/internal/gallery', icon: Camera, configKey: 'labelGallery', label: sc.labelGallery },
    { to: '/internal/contributions', icon: BarChart3, label: '成员贡献' },
  ];

  // 管理菜单项（所有成员可见，仅管理员可编辑）
  const adminItems = [
    { to: '/internal/users', icon: Users, configKey: 'labelUsers', label: sc.labelUsers },
    { to: '/internal/content', icon: Settings, configKey: 'labelContent', label: sc.labelContent },
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
            onClick={(e) => editing && e.preventDefault()}
          >
            <item.icon size={18} className="internal-sidebar__icon" />
            {item.configKey ? (
              <EditableText
                value={item.label}
                onChange={(v) => updateSidebar(item.configKey, v)}
                configKey={`sidebar.${item.configKey}`}
                as="span"
                className="internal-sidebar__label"
              />
            ) : (
              <span className="internal-sidebar__label">{item.label}</span>
            )}
            {item.badge && (
              <span className="internal-sidebar__badge">{item.badge}</span>
            )}
          </NavLink>
        ))}
      </div>

      <div className="internal-sidebar__section">
        <EditableText
          value={sc.sectionLabelAdmin}
          onChange={(v) => updateSidebar('sectionLabelAdmin', v)}
          configKey="sidebar.sectionLabelAdmin"
          as="div"
          className="internal-sidebar__section-label"
        />
        {adminItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `internal-sidebar__item ${isActive ? 'internal-sidebar__item--active' : ''}`
            }
            onClick={(e) => editing && e.preventDefault()}
          >
            <item.icon size={18} className="internal-sidebar__icon" />
            {item.configKey ? (
              <EditableText
                value={item.label}
                onChange={(v) => updateSidebar(item.configKey, v)}
                configKey={`sidebar.${item.configKey}`}
                as="span"
                className="internal-sidebar__label"
              />
            ) : (
              <span className="internal-sidebar__label">{item.label}</span>
            )}
          </NavLink>
        ))}
      </div>
    </aside>
  );
}
