import { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useNotifications } from '../contexts/NotificationContext';
import { Menu, X, LogOut } from 'lucide-react';
import './Navbar.css';

export default function Navbar() {
  const [isOpen, setIsOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const { user, isAuthenticated, loading, logout } = useAuth();
  const { unreadCount } = useNotifications();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    setIsOpen(false);
  }, [location.pathname]);

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  const isActive = (path) => location.pathname === path;

  return (
    <nav className={`navbar ${scrolled ? 'navbar--scrolled' : ''}`}>
      <div className="navbar__container">
        {/* 最左侧：Logo */}
        <Link to="/" className="navbar__logo">
          <img src="/logo.png" alt="RIEMer Land" className="navbar__logo-img" />
          <span className="navbar__logo-text">RIEMer Land</span>
        </Link>

        {/* 中间：三个等宽导航按钮（进度条风格） */}
        <div className="navbar__nav-bar">
          <Link
            to="/"
            className={`navbar__nav-item ${isActive('/') ? 'navbar__nav-item--active' : ''}`}
          >
            首页
          </Link>
          <Link
            to="/articles"
            className={`navbar__nav-item ${isActive('/articles') || location.pathname.startsWith('/article/') ? 'navbar__nav-item--active' : ''}`}
          >
            分享回顾
          </Link>
          <Link
            to="/timeline"
            className={`navbar__nav-item ${isActive('/timeline') ? 'navbar__nav-item--active' : ''}`}
          >
            关于我们
          </Link>
        </div>

        {/* 最右侧：成员入口 / 用户信息 */}
        <div className="navbar__right">
          {loading ? (
            <Link to="/login" className="navbar__member-entry">主理团队内部空间</Link>
          ) : isAuthenticated ? (
            <>
              <Link
                to="/internal"
                className={`navbar__link ${
                  location.pathname.startsWith('/internal') ? 'navbar__link--active' : ''
                }`}
              >
                主理团队内部空间
                {unreadCount > 0 && (
                  <span className="navbar__badge">{unreadCount > 9 ? '9+' : unreadCount}</span>
                )}
              </Link>
              <div className="navbar__user">
                <div className="navbar__user-avatar">
                  {user?.avatar ? (
                    <img src={user.avatar} alt="" />
                  ) : (
                    <span style={{ background: (() => {
                      const name = user?.nickname || user?.name || '';
                      const colors = ['#5B8C3E','#4FBFC4','#D4A44C','#8B5CF6','#EC4899','#3B82F6','#EF4444','#F59E0B','#10B981','#6366F1'];
                      let hash = 0;
                      for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
                      return colors[Math.abs(hash) % colors.length];
                    })() }}>
                      {(user?.nickname || user?.name || '?').charAt(0).toUpperCase()}
                    </span>
                  )}
                </div>
                <span className="navbar__user-name">{user?.nickname || user?.name}</span>
                <button onClick={handleLogout} className="btn btn-ghost btn-sm">
                  <LogOut size={16} />
                  退出
                </button>
              </div>
            </>
          ) : (
            <Link to="/login" className="navbar__member-entry">主理团队内部空间</Link>
          )}
        </div>

        {/* 手机端汉堡菜单按钮 */}
        <button
          className="navbar__toggle"
          onClick={() => setIsOpen(!isOpen)}
          aria-label="Toggle menu"
        >
          {isOpen ? <X size={24} /> : <Menu size={24} />}
        </button>

        {/* 手机端展开菜单 */}
        <div className={`navbar__links ${isOpen ? 'navbar__links--open' : ''}`}>
          <Link
            to="/"
            className={`navbar__link ${isActive('/') ? 'navbar__link--active' : ''}`}
          >
            首页
          </Link>
          <Link
            to="/articles"
            className={`navbar__link ${isActive('/articles') || location.pathname.startsWith('/article/') ? 'navbar__link--active' : ''}`}
          >
            分享回顾
          </Link>
          <Link
            to="/timeline"
            className={`navbar__link ${isActive('/timeline') ? 'navbar__link--active' : ''}`}
          >
            关于我们
          </Link>

          {!loading && isAuthenticated && (
            <Link
              to="/internal"
              className={`navbar__link ${
                location.pathname.startsWith('/internal') ? 'navbar__link--active' : ''
              }`}
            >
              主理团队内部空间
              {unreadCount > 0 && (
                <span className="navbar__badge">{unreadCount > 9 ? '9+' : unreadCount}</span>
              )}
            </Link>
          )}

          <div className="navbar__mobile-auth">
            {loading ? null : isAuthenticated ? (
              <div className="navbar__mobile-user">
                <span className="navbar__user-name">{user?.nickname || user?.name}</span>
                <button onClick={handleLogout} className="btn btn-ghost btn-sm">
                  <LogOut size={16} />
                  退出
                </button>
              </div>
            ) : (
              <Link to="/login" className="navbar__link navbar__mobile-entry">
                主理团队内部空间
              </Link>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
