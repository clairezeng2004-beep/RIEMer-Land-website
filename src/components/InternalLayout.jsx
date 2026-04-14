import { useEffect, useState, useRef } from 'react';
import { Navigate, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useNotifications } from '../contexts/NotificationContext';
import { useSiteContent } from '../contexts/SiteContentContext';
import { WysiwygProvider } from '../contexts/WysiwygContext';
import InternalSidebar from './InternalSidebar';
import WysiwygToolbar from './WysiwygToolbar';
import ErrorBoundary from './ErrorBoundary';
import {
  Bell, FolderOpen, Share2, BookOpen, CheckSquare,
  Camera, BarChart3, MessageSquarePlus, UserCircle, Contact,
  Users, Settings,
} from 'lucide-react';
import './InternalLayout.css';

/* 手机端水平导航条 */
function MobileInternalNav() {
  const { unreadCount } = useNotifications();
  const { internalConfig } = useSiteContent();
  const sc = internalConfig.sidebar;
  const scrollRef = useRef(null);
  const location = useLocation();

  const navItems = [
    { to: '/internal/tasks', icon: CheckSquare, label: sc.labelTasks },
    { to: '/internal/notifications', icon: Bell, label: sc.labelNotifications, badge: unreadCount > 0 ? unreadCount : null },
    { to: '/internal/process-templates', icon: FolderOpen, label: '流程模板文件' },
    { to: '/internal/member-sharing', icon: Share2, label: '成员内部分享' },
    { to: '/internal/articles', icon: BookOpen, label: '公众号历史文章归档' },
    { to: '/internal/contributions', icon: BarChart3, label: '成员贡献' },
    { to: '/internal/suggestions', icon: MessageSquarePlus, label: '建设建议' },
    { to: '/internal/member-profiles', icon: Contact, label: '成员通讯录' },
    { to: '/internal/gallery', icon: Camera, label: sc.labelGallery },
    { to: '/internal/profile', icon: UserCircle, label: '个人主页' },
    { to: '/internal/users', icon: Users, label: sc.labelUsers },
    { to: '/internal/content', icon: Settings, label: sc.labelContent },
  ];

  // 路由变化时将当前激活项滚动到可见区域
  useEffect(() => {
    if (!scrollRef.current) return;
    const active = scrollRef.current.querySelector('.internal-mobile-nav__item--active');
    if (active) {
      active.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  }, [location.pathname]);

  return (
    <nav className="internal-mobile-nav" ref={scrollRef}>
      {navItems.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) =>
            `internal-mobile-nav__item ${isActive ? 'internal-mobile-nav__item--active' : ''}`
          }
        >
          <item.icon size={16} />
          <span>{item.label}</span>
          {item.badge && (
            <span className="internal-mobile-nav__badge">{item.badge}</span>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

export default function InternalLayout() {
  const { isAuthenticated, loading, supabaseOk } = useAuth();
  const location = useLocation();
  const [loadingTimeout, setLoadingTimeout] = useState(false);

  // 每次路由变化时立即跳到页面顶部（覆盖 CSS smooth 滚动）
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [location.pathname]);

  // loading 超时保护：15 秒后强制结束等待
  // initSession 内部有独立超时（getSession 5s + refreshSession 5s + 健康检查 3s ≈ 13s），
  // 这里留 15s 作为最终兜底
  useEffect(() => {
    if (!loading) return;
    const timer = setTimeout(() => {
      console.warn('[InternalLayout] Loading 超时（15s），结束等待');
      setLoadingTimeout(true);
    }, 15000);
    return () => clearTimeout(timer);
  }, [loading]);

  if (loading && !loadingTimeout) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '60vh',
        gap: '16px',
        color: 'var(--color-text-muted, #888)',
      }}>
        <div style={{
          width: '32px',
          height: '32px',
          border: '3px solid var(--color-border-light, #e5e5e5)',
          borderTop: '3px solid var(--color-primary, #5B8C3E)',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }} />
        <span style={{ fontSize: '14px' }}>正在验证登录状态…</span>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return (
    <WysiwygProvider>
      <div className="internal-layout">
        <InternalSidebar />
        <MobileInternalNav />
        <div className="internal-layout__content">
          <ErrorBoundary key={location.pathname}>
            <Outlet />
          </ErrorBoundary>
        </div>
        <WysiwygToolbar />
      </div>
    </WysiwygProvider>
  );
}
