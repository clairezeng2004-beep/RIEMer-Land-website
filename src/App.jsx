import { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { SiteContentProvider } from './contexts/SiteContentContext';
import { NotificationProvider } from './contexts/NotificationContext';
import ScrollToTop from './components/ScrollToTop';
import usePageTracking from './hooks/usePageTracking';
import Navbar from './components/Navbar';
import Footer from './components/Footer';

// 懒加载防错包装：
// 路由都是 lazy(() => import(...))，发布新版本后旧的分包(chunk)文件名会失效，
// 此时已经打开页面的用户点进某个路由会因为 import() 失败而触发"页面加载出错了"，
// 刷新后才正常。这里先重试一次（应对偶发网络抖动），仍失败则自动整页刷新一次
// 去拉取最新资源；用 sessionStorage 时间戳防止无限刷新循环。
function lazyWithReload(factory) {
  return lazy(async () => {
    try {
      return await factory();
    } catch (err) {
      // 重试一次
      try {
        await new Promise((r) => setTimeout(r, 350));
        return await factory();
      } catch {
        const KEY = 'chunkReloadAt';
        const last = Number(sessionStorage.getItem(KEY) || 0);
        // 10 秒内只自动刷新一次，避免真正的错误导致反复刷新
        if (Date.now() - last > 10000) {
          sessionStorage.setItem(KEY, String(Date.now()));
          window.location.reload();
          // 返回永不 resolve 的占位，等待刷新接管渲染
          return new Promise(() => {});
        }
        throw err;
      }
    }
  });
}

const Home = lazyWithReload(() => import('./pages/public/Home'));
const Timeline = lazyWithReload(() => import('./pages/public/Timeline'));
const Articles = lazyWithReload(() => import('./pages/public/Articles'));
const Events = lazyWithReload(() => import('./pages/public/Events'));
const ArticleDetail = lazyWithReload(() => import('./pages/public/ArticleDetail'));
const Login = lazyWithReload(() => import('./pages/internal/Login'));
const ResetPassword = lazyWithReload(() => import('./pages/internal/ResetPassword'));
const InternalLayout = lazyWithReload(() => import('./components/InternalLayout'));
const Documents = lazyWithReload(() => import('./pages/internal/Documents'));
const ProcessTemplates = lazyWithReload(() => import('./pages/internal/ProcessTemplates'));
const ProcessTemplateCreate = lazyWithReload(() => import('./pages/internal/ProcessTemplateCreate'));
const ProcessTemplateDetail = lazyWithReload(() => import('./pages/internal/ProcessTemplateDetail'));
const MemberSharing = lazyWithReload(() => import('./pages/internal/MemberSharing'));
const MemberSharingCreate = lazyWithReload(() => import('./pages/internal/MemberSharingCreate'));
const MemberSharingDetail = lazyWithReload(() => import('./pages/internal/MemberSharingDetail'));
const Tasks = lazyWithReload(() => import('./pages/internal/Tasks'));
const UserManagement = lazyWithReload(() => import('./pages/internal/UserManagement'));
const ContentManagement = lazyWithReload(() => import('./pages/internal/ContentManagement'));
const Notifications = lazyWithReload(() => import('./pages/internal/Notifications'));
const Gallery = lazyWithReload(() => import('./pages/internal/Gallery'));
const InternalArticles = lazyWithReload(() => import('./pages/internal/InternalArticles'));
const InternalArticleDetail = lazyWithReload(() => import('./pages/internal/InternalArticleDetail'));
const MemberContributions = lazyWithReload(() => import('./pages/internal/MemberContributions'));
const MemberProfiles = lazyWithReload(() => import('./pages/internal/MemberProfiles'));
const Profile = lazyWithReload(() => import('./pages/internal/Profile'));
const Suggestions = lazyWithReload(() => import('./pages/internal/Suggestions'));
const Guestbook = lazyWithReload(() => import('./pages/internal/Guestbook'));
const NotificationManagement = lazyWithReload(() => import('./pages/internal/NotificationManagement'));
const EventPublish = lazyWithReload(() => import('./pages/internal/EventPublish'));
const SyncDiagnostic = lazyWithReload(() => import('./pages/internal/SyncDiagnostic'));
const NotificationRulesProvider = lazyWithReload(() =>
  import('./contexts/NotificationRulesContext').then((module) => ({
    default: module.NotificationRulesProvider,
  }))
);

/* 独立全屏页面路径（不显示 Navbar / Footer） */
const FULLSCREEN_PATHS = [
  '/internal/member-sharing/create',
  '/internal/member-sharing/view/',
  '/internal/process-templates/create',
  '/internal/process-templates/view/',
];

function PublicRouteSkeleton() {
  return (
    <div className="route-skeleton route-skeleton--public" aria-label="页面加载中" aria-busy="true">
      <section className="route-skeleton__hero">
        <div className="container">
          <div className="route-skeleton__title route-skeleton__shimmer" />
          <div className="route-skeleton__line route-skeleton__line--wide route-skeleton__shimmer" />
          <div className="route-skeleton__line route-skeleton__line--short route-skeleton__shimmer" />
        </div>
      </section>

      <section className="route-skeleton__section">
        <div className="container">
          <div className="route-skeleton__grid">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="route-skeleton__card">
                <div className="route-skeleton__thumb route-skeleton__shimmer" />
                <div className="route-skeleton__card-body">
                  <div className="route-skeleton__line route-skeleton__line--tiny route-skeleton__shimmer" />
                  <div className="route-skeleton__line route-skeleton__shimmer" />
                  <div className="route-skeleton__line route-skeleton__line--wide route-skeleton__shimmer" />
                  <div className="route-skeleton__line route-skeleton__line--short route-skeleton__shimmer" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function InternalRouteSkeleton() {
  return (
    <div className="route-skeleton route-skeleton--internal" aria-label="页面加载中" aria-busy="true">
      <aside className="route-skeleton__sidebar" aria-hidden="true">
        <div className="route-skeleton__brand route-skeleton__shimmer" />
        {Array.from({ length: 10 }).map((_, index) => (
          <div key={index} className="route-skeleton__nav-item route-skeleton__shimmer" />
        ))}
      </aside>
      <section className="route-skeleton__internal-content">
        <div className="route-skeleton__internal-header">
          <div>
            <div className="route-skeleton__title route-skeleton__shimmer" />
            <div className="route-skeleton__line route-skeleton__line--wide route-skeleton__shimmer" />
          </div>
          <div className="route-skeleton__button route-skeleton__shimmer" />
        </div>
        <div className="route-skeleton__toolbar route-skeleton__shimmer" />
        <div className="route-skeleton__grid route-skeleton__grid--internal">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="route-skeleton__card">
              <div className="route-skeleton__card-body">
                <div className="route-skeleton__line route-skeleton__line--tiny route-skeleton__shimmer" />
                <div className="route-skeleton__line route-skeleton__shimmer" />
                <div className="route-skeleton__line route-skeleton__line--wide route-skeleton__shimmer" />
                <div className="route-skeleton__line route-skeleton__line--short route-skeleton__shimmer" />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function RouteSkeleton({ isInternal }) {
  return isInternal ? <InternalRouteSkeleton /> : <PublicRouteSkeleton />;
}

function AppShell() {
  const { pathname } = useLocation();
  usePageTracking();
  const isFullscreen = FULLSCREEN_PATHS.some((p) => pathname.startsWith(p));
  // 内部页面（/internal/**）桌面端带固定侧边栏，Footer 需相应让出左侧空间
  const isInternal = pathname.startsWith('/internal');
  const routes = (
    <Routes>
      {/* Public Routes */}
      <Route path="/" element={<Home />} />
      <Route path="/timeline" element={<Timeline />} />
      <Route path="/articles" element={<Articles />} />
      <Route path="/events" element={<Events />} />
      <Route path="/article/:id" element={<ArticleDetail />} />

      {/* Auth */}
      <Route path="/login" element={<Login />} />
      <Route path="/reset-password" element={<ResetPassword />} />

      {/* 独立全屏页面（不带侧边栏、不带 Navbar/Footer） */}
      <Route path="/internal/member-sharing/create" element={<MemberSharingCreate />} />
      <Route path="/internal/member-sharing/view/:id" element={<MemberSharingDetail />} />
      <Route path="/internal/process-templates/create" element={<ProcessTemplateCreate />} />
      <Route path="/internal/process-templates/view/:id" element={<ProcessTemplateDetail />} />

      {/* Internal Routes (Protected) — 带侧边栏布局 */}
      <Route path="/internal" element={<InternalLayout />}>
        <Route index element={<Navigate to="notifications" replace />} />
        <Route path="process-templates" element={<ProcessTemplates />} />
        <Route path="member-sharing" element={<MemberSharing />} />
        <Route path="member-sharing/:id" element={<MemberSharingDetail />} />
        {/* 兼容旧链接 */}
        <Route path="documents" element={<Documents />} />
        <Route path="articles" element={<InternalArticles />} />
        <Route path="article/:id" element={<InternalArticleDetail />} />
        <Route path="tasks" element={<Tasks />} />
        <Route path="gallery" element={<Gallery />} />
        <Route path="users" element={<UserManagement />} />
        <Route path="content" element={<ContentManagement />} />
        <Route path="notification-management" element={<NotificationManagement />} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="contributions" element={<MemberContributions />} />
        <Route path="suggestions" element={<Suggestions />} />
        <Route path="guestbook" element={<Guestbook />} />
        <Route path="profile" element={<Profile />} />
        <Route path="member-profiles" element={<MemberProfiles />} />
        <Route path="event-publish" element={<EventPublish />} />
        <Route path="sync-diagnostic" element={<SyncDiagnostic />} />
      </Route>
    </Routes>
  );

  return (
    <>
      <ScrollToTop />
      {!isFullscreen && <Navbar />}
      <main>
        <Suspense fallback={<RouteSkeleton isInternal={isInternal} />}>
          {isInternal ? (
            <NotificationRulesProvider>{routes}</NotificationRulesProvider>
          ) : (
            routes
          )}
        </Suspense>
      </main>
      {!isFullscreen && <Footer isInternal={isInternal} />}
    </>
  );
}

function App() {
  return (
    <AuthProvider>
      <SiteContentProvider>
        <Router>
          <NotificationProvider>
            <AppShell />
          </NotificationProvider>
        </Router>
      </SiteContentProvider>
    </AuthProvider>
  );
}

export default App;
