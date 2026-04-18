import { useCallback } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useNotifications } from '../contexts/NotificationContext';
import { useSiteContent } from '../contexts/SiteContentContext';
import { useWysiwyg } from '../contexts/WysiwygContext';
import EditableText from './EditableText';
import {
  Bell,
  BellRing,
  FileText,
  CheckSquare,
  Camera,
  Users,
  Settings,
  BookOpen,
  BarChart3,
  MessageSquarePlus,
  MessageCircle,
  FolderOpen,
  Share2,
  Contact,
  UserCircle,
  CalendarRange,
  Activity,
} from 'lucide-react';
import './InternalSidebar.css';

// 侧边栏 label key → 对应页面 internalConfig 节 key
// 改某个 label 时，该节的 pageTitle 会被同步成同样的值，保持侧边栏和页面 h1 一致
const LABEL_TO_SECTION = {
  labelNotifications: 'notifications',
  labelDocuments: 'documents',
  labelTasks: 'tasks',
  labelProcessTemplates: 'processTemplates',
  labelMemberSharing: 'memberSharing',
  labelArticles: 'internalArticles',
  labelContributions: 'contributions',
  labelSuggestions: 'suggestions',
  labelMemberProfiles: 'memberProfiles',
  labelGallery: 'gallery',
  labelEventPublish: 'eventPublish',
  labelProfile: 'profile',
  labelUsers: 'users',
  // labelHome / labelGuestbook / labelContent / labelNotificationMgmt 对应的页面
  // 要么没有 pageTitle 字段，要么标题是硬编码，这里不同步
};

export default function InternalSidebar() {
  const { unreadCount } = useNotifications();
  const { internalConfig, updateInternalConfig } = useSiteContent();
  const { editing } = useWysiwyg();
  const { isAdmin } = useAuth();
  const sc = internalConfig.sidebar || {};

  const updateSidebar = useCallback(
    (key, val) => {
      const section = LABEL_TO_SECTION[key];
      if (section) {
        // 一次性更新 sidebar.labelXxx + <section>.pageTitle，让标签和页面 h1 保持一致
        updateInternalConfig({
          sidebar: { [key]: val },
          [section]: { pageTitle: val },
        });
      } else {
        updateInternalConfig({ sidebar: { [key]: val } });
      }
    },
    [updateInternalConfig]
  );

  // 日常管理：常规业务/协作/内容类
  const dailyItems = [
    { to: '/internal/tasks', icon: CheckSquare, configKey: 'labelTasks', label: sc.labelTasks },
    {
      to: '/internal/notifications',
      icon: Bell,
      configKey: 'labelNotifications',
      label: sc.labelNotifications,
      badge: unreadCount > 0 ? unreadCount : null,
    },
    { to: '/internal/process-templates', icon: FolderOpen, configKey: 'labelProcessTemplates', label: sc.labelProcessTemplates },
    { to: '/internal/articles', icon: BookOpen, configKey: 'labelArticles', label: sc.labelArticles },
    { to: '/internal/event-publish', icon: CalendarRange, configKey: 'labelEventPublish', label: sc.labelEventPublish },
    { to: '/internal/contributions', icon: BarChart3, configKey: 'labelContributions', label: sc.labelContributions },
    { to: '/internal/guestbook', icon: MessageCircle, configKey: 'labelGuestbook', label: sc.labelGuestbook },
  ];

  // 成员：成员个人信息/互动/分享类
  // 顺序：成员内部分享 → 成员通讯录 → 建设建议 → 互动相册 → 个人主页
  const memberItems = [
    { to: '/internal/member-sharing', icon: Share2, configKey: 'labelMemberSharing', label: sc.labelMemberSharing },
    { to: '/internal/member-profiles', icon: Contact, configKey: 'labelMemberProfiles', label: sc.labelMemberProfiles },
    { to: '/internal/suggestions', icon: MessageSquarePlus, configKey: 'labelSuggestions', label: sc.labelSuggestions },
    { to: '/internal/gallery', icon: Camera, configKey: 'labelGallery', label: sc.labelGallery },
    { to: '/internal/profile', icon: UserCircle, configKey: 'labelProfile', label: sc.labelProfile },
  ];

  // 管理菜单项（所有成员可见，仅管理员可编辑）
  const adminItems = [
    { to: '/internal/users', icon: Users, configKey: 'labelUsers', label: sc.labelUsers },
    { to: '/internal/content', icon: Settings, configKey: 'labelContent', label: sc.labelContent },
    { to: '/internal/notification-management', icon: BellRing, configKey: 'labelNotificationMgmt', label: sc.labelNotificationMgmt },
    // 同步诊断入口：仅管理员可见（用于排查跨设备数据同步问题）
    ...(isAdmin ? [
      { to: '/internal/sync-diagnostic', icon: Activity, label: '同步诊断' },
    ] : []),
  ];

  // 渲染一组菜单项的辅助函数
  const renderItem = (item) => (
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
  );

  return (
    <aside className="internal-sidebar">
      {/* 日常管理 */}
      <div className="internal-sidebar__section">
        <EditableText
          value={sc.sectionLabelDaily}
          onChange={(v) => updateSidebar('sectionLabelDaily', v)}
          configKey="sidebar.sectionLabelDaily"
          as="div"
          className="internal-sidebar__section-label"
        />
        {dailyItems.map(renderItem)}
      </div>

      {/* 成员 */}
      <div className="internal-sidebar__section">
        <EditableText
          value={sc.sectionLabelMembers}
          onChange={(v) => updateSidebar('sectionLabelMembers', v)}
          configKey="sidebar.sectionLabelMembers"
          as="div"
          className="internal-sidebar__section-label"
        />
        {memberItems.map(renderItem)}
      </div>

      {/* 管理 */}
      <div className="internal-sidebar__section">
        <EditableText
          value={sc.sectionLabelAdmin}
          onChange={(v) => updateSidebar('sectionLabelAdmin', v)}
          configKey="sidebar.sectionLabelAdmin"
          as="div"
          className="internal-sidebar__section-label"
        />
        {adminItems.map(renderItem)}
      </div>
    </aside>
  );
}
