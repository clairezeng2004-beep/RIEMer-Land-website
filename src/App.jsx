import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { SiteContentProvider } from './contexts/SiteContentContext';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import Home from './pages/public/Home';
import Timeline from './pages/public/Timeline';
import Articles from './pages/public/Articles';
import ArticleDetail from './pages/public/ArticleDetail';
import Login from './pages/internal/Login';
import Documents from './pages/internal/Documents';
import Tasks from './pages/internal/Tasks';
import UserManagement from './pages/internal/UserManagement';
import ContentManagement from './pages/internal/ContentManagement';

function App() {
  return (
    <AuthProvider>
      <SiteContentProvider>
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

              {/* Internal Routes (Protected) */}
              <Route path="/internal/documents" element={<Documents />} />
              <Route path="/internal/tasks" element={<Tasks />} />
              <Route path="/internal/users" element={<UserManagement />} />
              <Route path="/internal/content" element={<ContentManagement />} />
            </Routes>
          </main>
          <Footer />
        </Router>
      </SiteContentProvider>
    </AuthProvider>
  );
}

export default App;
