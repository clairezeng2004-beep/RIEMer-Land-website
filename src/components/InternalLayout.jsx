import { useEffect, useState } from 'react';
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
  const [loadingTimeout, setLoadingTimeout] = useState(false);

  // 每次路由变化时滚动到页面顶部
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  // loading 超时保护：5 秒后强制认为未登录（兜底，正常情况下 initSession 会更快结束）
  useEffect(() => {
    if (!loading) return;
    const timer = setTimeout(() => {
      console.warn('[InternalLayout] Loading 超时（5s），跳转登录页');
      setLoadingTimeout(true);
    }, 5000);
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
