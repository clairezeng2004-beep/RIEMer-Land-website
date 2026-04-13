import { useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { WysiwygProvider } from '../contexts/WysiwygContext';
import InternalSidebar from './InternalSidebar';
import WysiwygToolbar from './WysiwygToolbar';
import ErrorBoundary from './ErrorBoundary';
import './InternalLayout.css';

export default function InternalLayout() {
  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();

  // 每次路由变化时滚动到页面顶部
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  if (loading) return null;

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return (
    <WysiwygProvider>
      <div className="internal-layout">
        <InternalSidebar />
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
