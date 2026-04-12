import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import InternalSidebar from './InternalSidebar';
import './InternalLayout.css';

export default function InternalLayout() {
  const { isAuthenticated, loading } = useAuth();

  if (loading) return null;

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="internal-layout">
      <InternalSidebar />
      <div className="internal-layout__content">
        <Outlet />
      </div>
    </div>
  );
}
