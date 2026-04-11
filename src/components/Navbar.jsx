import { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Menu, X, LogOut, ChevronDown } from 'lucide-react';
import './Navbar.css';

export default function Navbar() {
  const [isOpen, setIsOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [internalOpen, setInternalOpen] = useState(false);
  const { user, isAuthenticated, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    let lastScrollY = window.scrollY;
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      setScrolled(currentScrollY > 20);
      // 向下滚动超过 80px 就隐藏，向上滚动就显示
      if (currentScrollY > 80 && currentScrollY > lastScrollY) {
        setHidden(true);
      } else {
        setHidden(false);
      }
      lastScrollY = currentScrollY;
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    setIsOpen(false);
    setInternalOpen(false);
  }, [location.pathname]);

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  const isActive = (path) => location.pathname === path;

  return (
    <nav className={`navbar ${scrolled ? 'navbar--scrolled' : ''} ${hidden ? 'navbar--hidden' : ''}`}>
      <div className="navbar__container">
        <Link to="/" className="navbar__logo">
          <img src="/logo.png" alt="RIEMer Land" className="navbar__logo-img" />
          <span className="navbar__logo-text">RIEMer Land</span>
        </Link>

        <div className={`navbar__links ${isOpen ? 'navbar__links--open' : ''}`}>
          <Link
            to="/"
            className={`navbar__link ${isActive('/') ? 'navbar__link--active' : ''}`}
          >
            首页
          </Link>
          <Link
            to="/timeline"
            className={`navbar__link ${isActive('/timeline') ? 'navbar__link--active' : ''}`}
          >
            历史
          </Link>
          <Link
            to="/articles"
            className={`navbar__link ${isActive('/articles') || location.pathname.startsWith('/article/') ? 'navbar__link--active' : ''}`}
          >
            文章
          </Link>

          {isAuthenticated && (
            <div className="navbar__dropdown">
              <button
                className={`navbar__link navbar__dropdown-trigger ${
                  location.pathname.startsWith('/internal') ? 'navbar__link--active' : ''
                }`}
                onClick={() => setInternalOpen(!internalOpen)}
              >
                内部空间 <ChevronDown size={14} />
              </button>
              <div className={`navbar__dropdown-menu ${internalOpen ? 'navbar__dropdown-menu--open' : ''}`}>
                <Link to="/internal/documents" className="navbar__dropdown-item">
                  文档管理
                </Link>
                <Link to="/internal/tasks" className="navbar__dropdown-item">
                  事项追踪
                </Link>
                {user?.role === 'admin' && (
                  <Link to="/internal/users" className="navbar__dropdown-item">
                    用户管理
                  </Link>
                )}
                {user?.role === 'admin' && (
                  <Link to="/internal/content" className="navbar__dropdown-item">
                    内容管理
                  </Link>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="navbar__right">
          {isAuthenticated ? (
            <div className="navbar__user">
              <span className="navbar__user-name">{user?.name}</span>
              <button onClick={handleLogout} className="btn btn-ghost btn-sm">
                <LogOut size={16} />
                退出
              </button>
            </div>
          ) : (
            <Link to="/login" className="navbar__member-entry">成员入口</Link>
          )}
        </div>

        <button
          className="navbar__toggle"
          onClick={() => setIsOpen(!isOpen)}
          aria-label="Toggle menu"
        >
          {isOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>
    </nav>
  );
}
