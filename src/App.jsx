import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { SiteContentProvider } from './contexts/SiteContentContext';
import { NotificationProvider } from './contexts/NotificationContext';
import ScrollToTop from './components/ScrollToTop';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import Home from './pages/public/Home';
import Timeline from './pages/public/Timeline';
import Articles from './pages/public/Articles';
import ArticleDetail from './pages/public/ArticleDetail';
import Login from './pages/internal/Login';
import InternalLayout from './components/InternalLayout';
import Documents from './pages/internal/Documents';
import ProcessTemplates from './pages/internal/ProcessTemplates';
import MemberSharing from './pages/internal/MemberSharing';
import Tasks from './pages/internal/Tasks';
import UserManagement from './pages/internal/UserManagement';
import ContentManagement from './pages/internal/ContentManagement';
import Notifications from './pages/internal/Notifications';
import Gallery from './pages/internal/Gallery';
import InternalArticles from './pages/internal/InternalArticles';
import InternalArticleDetail from './pages/internal/InternalArticleDetail';
import MemberContributions from './pages/internal/MemberContributions';
import Suggestions from './pages/internal/Suggestions';

function App() {
  return (
    <AuthProvider>
      <SiteContentProvider>
        <Router>
          <NotificationProvider>
            <ScrollToTop />
            <Navbar />
            <main>
              <Routes>
                {/* Public Routes */}
                <Route path="/" element={<Home />} />
                <Route path="/timeline" element={<Timeline />} />
                <Route path="/articles" element={<Articles />} />
                <Route path="/article/:id" element={<ArticleDetail />} />

                {/* Auth */}
                <Route path="/login" element={<Login />} />

                {/* Internal Routes (Protected) — 带侧边栏布局 */}
                <Route path="/internal" element={<InternalLayout />}>
                  <Route index element={<Navigate to="notifications" replace />} />
                  <Route path="process-templates" element={<ProcessTemplates />} />
                  <Route path="member-sharing" element={<MemberSharing />} />
                  {/* 兼容旧链接 */}
                  <Route path="documents" element={<Documents />} />
                  <Route path="articles" element={<InternalArticles />} />
                  <Route path="article/:id" element={<InternalArticleDetail />} />
                  <Route path="tasks" element={<Tasks />} />
                  <Route path="gallery" element={<Gallery />} />
                  <Route path="users" element={<UserManagement />} />
                  <Route path="content" element={<ContentManagement />} />
                  <Route path="notifications" element={<Notifications />} />
                  <Route path="contributions" element={<MemberContributions />} />
                  <Route path="suggestions" element={<Suggestions />} />
                </Route>
              </Routes>
            </main>
            <Footer />
          </NotificationProvider>
        </Router>
      </SiteContentProvider>
    </AuthProvider>
  );
}

export default App;
