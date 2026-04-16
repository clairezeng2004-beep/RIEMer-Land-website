import { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useNotifications } from '../contexts/NotificationContext';
import { Menu, X, LogOut, User } from 'lucide-react';
import { trackEvent } from '../lib/analytics';
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
    trackEvent('logout');
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
            onClick={() => trackEvent('nav_click', { link: '/', label: '首页' })}
          >
            首页
          </Link>
          <Link
            to="/articles"
            className={`navbar__nav-item ${isActive('/articles') || location.pathname.startsWith('/article/') ? 'navbar__nav-item--active' : ''}`}
            onClick={() => trackEvent('nav_click', { link: '/articles', label: '分享回顾' })}
          >
            分享回顾
          </Link>
          <Link
            to="/timeline"
            className={`navbar__nav-item ${isActive('/timeline') ? 'navbar__nav-item--active' : ''}`}
            onClick={() => trackEvent('nav_click', { link: '/timeline', label: '关于我们' })}
          >
            关于我们
          </Link>
        </div>

        {/* 最右侧：成员入口 / 用户信息 */}
        <div className="navbar__right">
          {(isAuthenticated || (loading && user)) ? (
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
                <Link to="/internal" className="navbar__user-link">
                  <div className="navbar__user-avatar">
                    {user?.avatar ? (
                      <img src={user.avatar} alt="" />
                    ) : (
                      <span style={{ background: 'var(--color-primary)' }}>
                        <User size={16} />
                      </span>
                    )}
                  </div>
                  <span className="navbar__user-name">{user?.nickname || user?.name}</span>
                </Link>
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

          {(isAuthenticated || (loading && user)) && (
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
            {(isAuthenticated || (loading && user)) ? (
              <div className="navbar__mobile-user">
                <span className="navbar__user-name">{user?.nickname || '未设置昵称'}</span>
                <button onClick={handleLogout} className="btn btn-ghost btn-sm">
                  <LogOut size={16} />
                  退出
                </button>
              </div>
            ) : !loading ? (
              <Link to="/login" className="navbar__link navbar__mobile-entry">
                主理团队内部空间
              </Link>
            ) : null}
          </div>
        </div>
      </div>
    </nav>
  );
}
