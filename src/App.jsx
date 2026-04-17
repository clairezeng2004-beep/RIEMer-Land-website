import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { SiteContentProvider } from './contexts/SiteContentContext';
import { NotificationProvider } from './contexts/NotificationContext';
import ScrollToTop from './components/ScrollToTop';
import usePageTracking from './hooks/usePageTracking';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import Home from './pages/public/Home';
import Timeline from './pages/public/Timeline';
import Articles from './pages/public/Articles';
import ArticleDetail from './pages/public/ArticleDetail';
import Login from './pages/internal/Login';
import ResetPassword from './pages/internal/ResetPassword';
import InternalLayout from './components/InternalLayout';
import Documents from './pages/internal/Documents';
import ProcessTemplates from './pages/internal/ProcessTemplates';
import ProcessTemplateCreate from './pages/internal/ProcessTemplateCreate';
import MemberSharing from './pages/internal/MemberSharing';
import MemberSharingCreate from './pages/internal/MemberSharingCreate';
import MemberSharingDetail from './pages/internal/MemberSharingDetail';
import Tasks from './pages/internal/Tasks';
import UserManagement from './pages/internal/UserManagement';
import ContentManagement from './pages/internal/ContentManagement';
import Notifications from './pages/internal/Notifications';
import Gallery from './pages/internal/Gallery';
import InternalArticles from './pages/internal/InternalArticles';
import InternalArticleDetail from './pages/internal/InternalArticleDetail';
import MemberContributions from './pages/internal/MemberContributions';
import MemberProfiles from './pages/internal/MemberProfiles';
import Profile from './pages/internal/Profile';
import Suggestions from './pages/internal/Suggestions';
import Guestbook from './pages/internal/Guestbook';
import NotificationManagement from './pages/internal/NotificationManagement';
import EventPublish from './pages/internal/EventPublish';

/* 独立全屏页面路径（不显示 Navbar / Footer） */
const FULLSCREEN_PATHS = [
  '/internal/member-sharing/create',
  '/internal/member-sharing/view/',
  '/internal/process-templates/create',
];

function AppShell() {
  const { pathname } = useLocation();
  usePageTracking();
  const isFullscreen = FULLSCREEN_PATHS.some((p) => pathname.startsWith(p));

  return (
    <>
      <ScrollToTop />
      {!isFullscreen && <Navbar />}
      <main>
        <Routes>
          {/* Public Routes */}
          <Route path="/" element={<Home />} />
          <Route path="/timeline" element={<Timeline />} />
          <Route path="/articles" element={<Articles />} />
          <Route path="/article/:id" element={<ArticleDetail />} />

          {/* Auth */}
          <Route path="/login" element={<Login />} />
          <Route path="/reset-password" element={<ResetPassword />} />

          {/* 独立全屏页面（不带侧边栏、不带 Navbar/Footer） */}
          <Route path="/internal/member-sharing/create" element={<MemberSharingCreate />} />
          <Route path="/internal/member-sharing/view/:id" element={<MemberSharingDetail />} />
          <Route path="/internal/process-templates/create" element={<ProcessTemplateCreate />} />

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
          </Route>
        </Routes>
      </main>
      {!isFullscreen && <Footer />}
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
