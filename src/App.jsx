import { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { SiteContentProvider } from './contexts/SiteContentContext';
import { NotificationProvider } from './contexts/NotificationContext';
import ScrollToTop from './components/ScrollToTop';
import usePageTracking from './hooks/usePageTracking';
import Navbar from './components/Navbar';
import Footer from './components/Footer';

const Home = lazy(() => import('./pages/public/Home'));
const Timeline = lazy(() => import('./pages/public/Timeline'));
const Articles = lazy(() => import('./pages/public/Articles'));
const Events = lazy(() => import('./pages/public/Events'));
const ArticleDetail = lazy(() => import('./pages/public/ArticleDetail'));
const Login = lazy(() => import('./pages/internal/Login'));
const ResetPassword = lazy(() => import('./pages/internal/ResetPassword'));
const InternalLayout = lazy(() => import('./components/InternalLayout'));
const Documents = lazy(() => import('./pages/internal/Documents'));
const ProcessTemplates = lazy(() => import('./pages/internal/ProcessTemplates'));
const ProcessTemplateCreate = lazy(() => import('./pages/internal/ProcessTemplateCreate'));
const ProcessTemplateDetail = lazy(() => import('./pages/internal/ProcessTemplateDetail'));
const MemberSharing = lazy(() => import('./pages/internal/MemberSharing'));
const MemberSharingCreate = lazy(() => import('./pages/internal/MemberSharingCreate'));
const MemberSharingDetail = lazy(() => import('./pages/internal/MemberSharingDetail'));
const Tasks = lazy(() => import('./pages/internal/Tasks'));
const UserManagement = lazy(() => import('./pages/internal/UserManagement'));
const ContentManagement = lazy(() => import('./pages/internal/ContentManagement'));
const Notifications = lazy(() => import('./pages/internal/Notifications'));
const Gallery = lazy(() => import('./pages/internal/Gallery'));
const InternalArticles = lazy(() => import('./pages/internal/InternalArticles'));
const InternalArticleDetail = lazy(() => import('./pages/internal/InternalArticleDetail'));
const MemberContributions = lazy(() => import('./pages/internal/MemberContributions'));
const MemberProfiles = lazy(() => import('./pages/internal/MemberProfiles'));
const Profile = lazy(() => import('./pages/internal/Profile'));
const Suggestions = lazy(() => import('./pages/internal/Suggestions'));
const Guestbook = lazy(() => import('./pages/internal/Guestbook'));
const NotificationManagement = lazy(() => import('./pages/internal/NotificationManagement'));
const EventPublish = lazy(() => import('./pages/internal/EventPublish'));
const SyncDiagnostic = lazy(() => import('./pages/internal/SyncDiagnostic'));
const NotificationRulesProvider = lazy(() =>
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
