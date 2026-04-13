import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Clock,
  MapPin,
  FileText,
  Video,
  Lock,
  Eye,
  EyeOff,
  X,
  ExternalLink,
  AlertCircle,
} from 'lucide-react';
import { articlesData } from '../../data/siteData';
import { useSiteContent } from '../../contexts/SiteContentContext';
import './Home.css';

export default function Home() {
  const { content, userArticles, events } = useSiteContent();

  // 密码弹窗状态
  const [replayModal, setReplayModal] = useState(null); // { event, passwordInput, error, showPassword }
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // 合并硬编码文章和用户添加的文章，按日期降序排列
  const allArticles = [...userArticles, ...articlesData]
    .sort((a, b) => b.date.localeCompare(a.date));
  const recentArticles = allArticles.slice(0, 6);
  const recentEvents = events.slice(0, 4);

  // 点击活动卡片
  const handleEventClick = (event) => {
    if (event.hasReplay && event.replayUrl) {
      setReplayModal(event);
      setPasswordInput('');
      setPasswordError('');
      setShowPassword(false);
    }
  };

  // 验证密码
  const handlePasswordSubmit = () => {
    if (!replayModal) return;
    if (passwordInput === replayModal.replayPassword) {
      window.open(replayModal.replayUrl, '_blank', 'noopener,noreferrer');
      setReplayModal(null);
      setPasswordInput('');
      setPasswordError('');
    } else {
      setPasswordError('密码不正确，请重试');
    }
  };

  // 关闭弹窗
  const closeModal = () => {
    setReplayModal(null);
    setPasswordInput('');
    setPasswordError('');
    setShowPassword(false);
  };

  return (
    <div className="home">
      {/* Hero Section — 与 Articles / Timeline 保持一致的简洁风格 */}
      <section className="hero">
        <div className="hero__content container">
          <h1 className="hero__title">
            <span className="hero__title-accent">{content.heroTitle}</span>
          </h1>
          <p className="hero__subtitle">{content.heroDescription}</p>
        </div>
      </section>


      {/* Stats Section */}
      <section className="stats section">
        <div className="container">
          <div className="stats__grid">
            {content.stats.map((stat, i) => (
              <div key={i} className="stats__item">
                <div className="stats__value">{stat.value}</div>
                <div className="stats__label">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Featured Articles */}
      <section className="featured section">
        <div className="container">
          <div className="featured__header">
            <h2 className="section-title">{content.articlesSectionTitle}</h2>
          </div>
          <div className="featured__grid">
            {recentArticles.map((article) => (
              <Link
                key={article.id}
                to={`/article/${article.id}`}
                className="featured__card"
              >
                {/* 封面图 */}
                <div className="featured__cover">
                  {article.coverImage ? (
                    <CoverImage
                      src={article.coverImage}
                      alt={article.title}
                      className="featured__cover-img"
                    />
                  ) : (
                    <div className="featured__cover-placeholder">
                      <FileText size={28} />
                    </div>
                  )}
                </div>
                <div className="featured__card-body">
                  <div className="featured__card-top">
                    <span className="featured__category">{article.category}</span>
                  </div>
                  <h3 className="featured__title">{article.title}</h3>
                  <p className="featured__excerpt">{article.excerpt}</p>
                  <div className="featured__meta">
                    <span className="featured__meta-item">
                      <Clock size={14} />
                      {article.date}
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
          <div className="featured__more">
            <Link to="/articles" className="btn btn-secondary">
              查看全部文章 <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </section>

      {/* Latest Events */}
      <section className="featured section section--compact">
        <div className="container">
          <div className="featured__header">
            <h2 className="section-title">最新活动</h2>
          </div>
          <div className="featured__grid">
            {recentEvents.map((event) => (
                <div
                  key={event.id}
                  className={`featured__card ${event.hasReplay ? 'featured__card--clickable' : ''}`}
                  onClick={() => handleEventClick(event)}
                  style={event.hasReplay ? { cursor: 'pointer' } : undefined}
                >
                  <div className="featured__card-accent" />
                  <div className="featured__card-body">
                    <div className="featured__card-top">
                      <span className="featured__category">{event.category}</span>
                      {event.hasReplay && (
                        <span className="featured__replay-badge">
                          <Video size={12} /> 回放
                        </span>
                      )}
                    </div>
                    <h3 className="featured__title">{event.title}</h3>
                    <p className="featured__excerpt">{event.excerpt}</p>
                    <div className="featured__meta">
                      <span className="featured__meta-item">
                        <Clock size={14} />
                        {event.date}
                      </span>
                      {event.hasReplay && (
                        <span className="featured__meta-item featured__meta-item--replay">
                          <Lock size={12} /> 需密码
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
          </div>
        </div>
      </section>

      {/* 密码验证弹窗 */}
      {replayModal && (
        <div className="replay-modal__overlay" onClick={closeModal}>
          <div className="replay-modal" onClick={(e) => e.stopPropagation()}>
            <button className="replay-modal__close" onClick={closeModal}>
              <X size={18} />
            </button>

            <div className="replay-modal__icon">
              <Video size={32} />
            </div>

            <h3 className="replay-modal__title">查看活动回放</h3>
            <p className="replay-modal__event-name">{replayModal.title}</p>
            <p className="replay-modal__desc">
              此活动回放需要输入密码才能访问，请向负责人获取密码。
            </p>

            <div className="replay-modal__input-group">
              <div className="replay-modal__input-wrap">
                <Lock size={16} className="replay-modal__input-icon" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  className={`replay-modal__input ${passwordError ? 'replay-modal__input--error' : ''}`}
                  value={passwordInput}
                  onChange={(e) => {
                    setPasswordInput(e.target.value);
                    setPasswordError('');
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handlePasswordSubmit();
                  }}
                  placeholder="请输入回放密码"
                  autoFocus
                />
                <button
                  className="replay-modal__eye-btn"
                  onClick={() => setShowPassword(!showPassword)}
                  type="button"
                  title={showPassword ? '隐藏密码' : '显示密码'}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {passwordError && (
                <div className="replay-modal__error">
                  <AlertCircle size={14} />
                  <span>{passwordError}</span>
                </div>
              )}
            </div>

            <div className="replay-modal__actions">
              <button
                className="btn btn-primary replay-modal__submit"
                disabled={!passwordInput.trim()}
                onClick={handlePasswordSubmit}
              >
                <ExternalLink size={16} /> 验证并打开回放
              </button>
              <button
                className="btn btn-ghost"
                onClick={closeModal}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
