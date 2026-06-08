import { Suspense, useEffect, useState, useRef } from 'react';
import { Navigate, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useNotifications } from '../contexts/NotificationContext';
import { useSiteContent } from '../contexts/SiteContentContext';
import { WysiwygProvider } from '../contexts/WysiwygContext';
import InternalSidebar from './InternalSidebar';
import WysiwygToolbar from './WysiwygToolbar';
import ErrorBoundary from './ErrorBoundary';
import {
  Bell, BellRing, FolderOpen, Share2, BookOpen, CheckSquare,
  Camera, BarChart3, MessageSquarePlus, MessageCircle, UserCircle, Contact,
  Users, Settings, CalendarRange, Activity,
  Trash2,
} from 'lucide-react';
import './InternalLayout.css';

function InternalPageFallback() {
  return (
    <div className="internal-page-fallback" aria-label="页面加载中">
      <div className="internal-page-fallback__header">
        <div>
          <div className="internal-page-fallback__title" />
          <div className="internal-page-fallback__desc" />
        </div>
        <div className="internal-page-fallback__button" />
      </div>
      <div className="internal-page-fallback__content">
        <div className="internal-page-fallback__bar" />
        <div className="internal-page-fallback__grid">
          <div />
          <div />
          <div />
          <div />
        </div>
      </div>
    </div>
  );
}

/* 手机端水平导航条 */
function MobileInternalNav() {
  const { unreadCount } = useNotifications();
  const { internalConfig } = useSiteContent();
  const { isAdmin } = useAuth();
  const sc = internalConfig.sidebar || {};
  const scrollRef = useRef(null);
  const location = useLocation();

  // 手机端导航条的顺序必须与电脑端 InternalSidebar 保持一致，
  // 否则用户在两种设备间切换时会找不到同一个入口。分组依据同样是
  // 「日常管理 / 成员 / 管理」三段，段内顺序严格 follow InternalSidebar.jsx
  // 里的 dailyItems / memberItems / adminItems。修改侧边栏顺序时，
  // 这里也必须一并同步。
  const navItems = [
    // 日常管理（对齐 InternalSidebar.dailyItems）
    { to: '/internal/tasks', icon: CheckSquare, label: sc.labelTasks },
    { to: '/internal/notifications', icon: Bell, label: sc.labelNotifications, badge: unreadCount > 0 ? unreadCount : null },
    { to: '/internal/process-templates', icon: FolderOpen, label: sc.labelProcessTemplates },
    { to: '/internal/articles', icon: BookOpen, label: sc.labelArticles },
    { to: '/internal/event-publish', icon: CalendarRange, label: sc.labelEventPublish },
    { to: '/internal/contributions', icon: BarChart3, label: sc.labelContributions },
    { to: '/internal/guestbook', icon: MessageCircle, label: sc.labelGuestbook },
    // 成员（对齐 InternalSidebar.memberItems：内部分享 → 通讯录 → 建设建议 → 互动相册 → 个人主页）
    { to: '/internal/member-sharing', icon: Share2, label: sc.labelMemberSharing },
    { to: '/internal/member-profiles', icon: Contact, label: sc.labelMemberProfiles },
    { to: '/internal/suggestions', icon: MessageSquarePlus, label: sc.labelSuggestions },
    { to: '/internal/gallery', icon: Camera, label: sc.labelGallery },
    { to: '/internal/profile', icon: UserCircle, label: sc.labelProfile },
    // 管理（对齐 InternalSidebar.adminItems）
    { to: '/internal/users', icon: Users, label: sc.labelUsers },
    { to: '/internal/content', icon: Settings, label: sc.labelContent },
    { to: '/internal/notification-management', icon: BellRing, label: sc.labelNotificationMgmt },
    { to: '/internal/recycle-bin', icon: Trash2, label: '回收站' },
    // 同步诊断：仅管理员可见
    ...(isAdmin ? [
      { to: '/internal/sync-diagnostic', icon: Activity, label: '同步诊断' },
    ] : []),
  ];

  // 路由变化时把当前激活项滚到可见区域。
  // 注意：刷新后第一次进入也会执行这个 effect。
  // 若直接用 behavior:'smooth'，浏览器会从 scrollLeft=0 平滑滚到目标位置 ——
  // 用户感知就是"导航栏左右抖一下"。
  // 同时 sc.labelXxx 来自异步加载的 internalConfig，刷新瞬间 label 可能
  // 还是空字符串/默认值，等云端拉回来后每个 chip 宽度会跳变，
  // 此时若已经平滑滚动过一次，会再被推一次 → 二次抖动。
  // 修复：
  //   1) 首次挂载（initialPositionDoneRef 还是 false）用 'auto' 瞬时居中，不动画；
  //   2) 用 requestAnimationFrame 等首次 layout 完成（label 文字已稳定）再定位，
  //      避免在 label 还在跳变时定位、之后又被异步 label 推一次；
  //   3) 后续路由切换才允许 smooth。
  const initialPositionDoneRef = useRef(false);
  useEffect(() => {
    if (!scrollRef.current) return;
    const raf = requestAnimationFrame(() => {
      if (!scrollRef.current) return;
      const active = scrollRef.current.querySelector('.internal-mobile-nav__item--active');
      if (!active) return;
      active.scrollIntoView({
        behavior: initialPositionDoneRef.current ? 'smooth' : 'auto',
        inline: 'center',
        block: 'nearest',
      });
      initialPositionDoneRef.current = true;
    });
    return () => cancelAnimationFrame(raf);
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
  const { isAuthenticated, loading } = useAuth();
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
            <Suspense fallback={<InternalPageFallback />}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </div>
        <WysiwygToolbar />
      </div>
    </WysiwygProvider>
  );
}
