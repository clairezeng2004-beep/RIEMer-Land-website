import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { SiteContentProvider } from './contexts/SiteContentContext';
import { NotificationProvider } from './contexts/NotificationContext';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import Home from './pages/public/Home';
import Timeline from './pages/public/Timeline';
import Articles from './pages/public/Articles';
import ArticleDetail from './pages/public/ArticleDetail';
import Login from './pages/internal/Login';
import InternalLayout from './components/InternalLayout';
import Documents from './pages/internal/Documents';
import Tasks from './pages/internal/Tasks';
import UserManagement from './pages/internal/UserManagement';
import ContentManagement from './pages/internal/ContentManagement';
import Notifications from './pages/internal/Notifications';
import Gallery from './pages/internal/Gallery';
import InternalHome from './pages/internal/InternalHome';

function App() {
  return (
    <AuthProvider>
      <SiteContentProvider>
        <NotificationProvider>
          <Router>
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
                  <Route index element={<InternalHome />} />
                  <Route path="documents" element={<Documents />} />
                  <Route path="tasks" element={<Tasks />} />
                  <Route path="gallery" element={<Gallery />} />
                  <Route path="users" element={<UserManagement />} />
                  <Route path="content" element={<ContentManagement />} />
                  <Route path="notifications" element={<Notifications />} />
                </Route>
              </Routes>
            </main>
            <Footer />
          </Router>
        </NotificationProvider>
      </SiteContentProvider>
    </AuthProvider>
  );
}

export default App;
