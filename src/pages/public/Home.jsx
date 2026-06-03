import { useState, useMemo, useRef } from 'react';
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
  CalendarDays,
} from 'lucide-react';
import CoverImage from '../../components/CoverImage';
import { articlesData } from '../../data/siteData';
import { useSiteContent } from '../../contexts/SiteContentContext';
import { trackEvent } from '../../lib/analytics';
import { useEqualTitleHeights } from '../../hooks/useEqualTitleHeights';
import './Home.css';

const EVENT_CATEGORY_RENAMES = {
  腾讯会议分享会: '腾讯会议分享',
};
const HIDDEN_EVENT_CATEGORIES = new Set(['分享会', '经验分享']);

function normalizeEventCategory(category) {
  const value = String(category || '').trim();
  if (!value || HIDDEN_EVENT_CATEGORIES.has(value)) return '';
  return EVENT_CATEGORY_RENAMES[value] || value;
}

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
  // 最新活动：按日期从新到旧排序，首页最多展示 3 场，更多通过"查看全部活动"进入 /events。
  const sortedEvents = useMemo(
    () => [...events].sort((a, b) => (b.date || '').localeCompare(a.date || '')),
    [events],
  );
  const recentEvents = sortedEvents.slice(0, 3);

  // 活动卡片标题按行对齐（结构含可选倒计时行，无法用 subgrid，改用 JS 逐行等高）
  const eventsGridRef = useRef(null);
  useEqualTitleHeights(eventsGridRef, '.featured__title', [recentEvents.length]);

  // 计算活动倒计时天数（活动日期比当前晚则返回天数，否则返回 null）
  const getCountdownDays = (eventDate) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(eventDate + 'T00:00:00');
    const diff = target - today;
    if (diff > 0) {
      return Math.ceil(diff / (1000 * 60 * 60 * 24));
    }
    return null;
  };

  // 动态计算统计数据：
  // - 活动讲座 = events 总数
  // - 文章分享 = 所有文章总数
  // - 公众号累计阅读 = 所有文章 readNum 求和（>=1000 时显示 "X.XK+"）
  const totalReadNum = allArticles.reduce(
    (sum, a) => sum + (Number(a.readNum) || 0),
    0,
  );
  const formatReadNum = (n) => {
    if (!n || n <= 0) return '0';
    if (n >= 10000) {
      // 1.2w+ 形式，保留一位小数（但若为整数则去小数）
      const v = n / 10000;
      return `${v >= 10 ? Math.floor(v) : v.toFixed(1).replace(/\.0$/, '')}w+`;
    }
    if (n >= 1000) {
      const v = n / 1000;
      return `${v.toFixed(1).replace(/\.0$/, '')}k+`;
    }
    return `${n}`;
  };

  const dynamicStats = content.stats.map((stat) => {
    if (stat.label === '活动讲座') {
      return { ...stat, value: `${events.length}` };
    }
    if (stat.label === '文章分享') {
      return { ...stat, value: `${allArticles.length}` };
    }
    if (stat.label === '公众号累计阅读') {
      return { ...stat, value: formatReadNum(totalReadNum) };
    }
    return stat;
  });

  // 点击活动卡片
  const handleEventClick = (event) => {
    trackEvent('event_click', {
      event_id: event.id,
      event_title: event.title,
      event_category: normalizeEventCategory(event.category),
      has_replay: event.hasReplay,
    });
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
      trackEvent('replay_unlock', {
        event_id: replayModal.id,
        event_title: replayModal.title,
      });
      window.open(replayModal.replayUrl, '_blank', 'noopener,noreferrer');
      setReplayModal(null);
      setPasswordInput('');
      setPasswordError('');
    } else {
      trackEvent('replay_unlock_fail', {
        event_id: replayModal.id,
        event_title: replayModal.title,
      });
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
            {dynamicStats.map((stat, i) => {
              // 「活动讲座」「文章分享」两个统计支持点击跳转到对应列表页
              const statLink =
                stat.label === '活动讲座' ? '/events'
                : stat.label === '文章分享' ? '/articles'
                : null;
              const inner = (
                <>
                  <div className="stats__value">{stat.value}</div>
                  <div className="stats__label">{stat.label}</div>
                </>
              );
              return statLink ? (
                <Link
                  key={i}
                  to={statLink}
                  className="stats__item stats__item--link"
                  onClick={() => trackEvent('nav_click', { link: statLink, source: 'home_stats' })}
                >
                  {inner}
                </Link>
              ) : (
                <div key={i} className="stats__item">
                  {inner}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Latest Events */}
      <section className="featured section section--compact">
        <div className="container">
          <div className="featured__header">
            <h2 className="section-title">最新活动</h2>
          </div>
          <div className="featured__grid" ref={eventsGridRef}>
            {recentEvents.map((event) => {
              const countdownDays = getCountdownDays(event.date);
              const eventCategory = normalizeEventCategory(event.category);
              return (
                <div
                  key={event.id}
                  className={`featured__card ${event.hasReplay ? 'featured__card--clickable' : ''} ${countdownDays ? 'featured__card--upcoming' : ''}`}
                  onClick={() => handleEventClick(event)}
                  style={event.hasReplay ? { cursor: 'pointer' } : undefined}
                >
                  <div className="featured__card-accent" />
                  <div className="featured__card-body">
                    {countdownDays && (
                      <div className="featured__card-top">
                        <span className="featured__countdown-badge">
                          <CalendarDays size={12} /> {countdownDays} 天后
                        </span>
                      </div>
                    )}
                    <h3 className="featured__title">{event.title}</h3>
                    <p className="featured__excerpt">{event.excerpt}</p>
                    <div className="featured__meta">
                      <span className="featured__meta-item">
                        <Clock size={14} />
                        {event.date}
                      </span>
                      {eventCategory && (
                        <span className="featured__category">{eventCategory}</span>
                      )}
                      {event.hasReplay && (
                        <span className="featured__replay-badge">
                          <Video size={12} /> 回放
                        </span>
                      )}
                      {countdownDays && (
                        <span className="featured__meta-item featured__meta-item--countdown">
                          <MapPin size={12} /> {event.location}
                        </span>
                      )}
                      {event.hasReplay && (
                        <span className="featured__meta-item featured__meta-item--replay">
                          <Lock size={12} /> 需密码
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {events.length > recentEvents.length && (
            <div className="featured__more">
              <Link to="/events" className="btn btn-secondary" onClick={() => trackEvent('nav_click', { link: '/events', source: 'home' })}>
                查看全部活动 <ArrowRight size={16} />
              </Link>
            </div>
          )}
        </div>
      </section>

      {/* Featured Articles */}
      <section className="featured section">
        <div className="container">
          <div className="featured__header">
            <h2 className="section-title">{content.articlesSectionTitle}</h2>
          </div>
          <div className="featured__grid featured__grid--articles">
            {recentArticles.map((article) => {
              const hasUrl = !!article.url;
              const trackClick = () =>
                trackEvent('article_click', {
                  article_id: article.id,
                  article_title: article.title,
                  article_category: article.category,
                  source: 'home',
                  target: hasUrl ? 'wechat' : 'detail',
                });

              const cardInner = (
                <>
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
                    <h3 className="featured__title">{article.title}</h3>
                    <p className="featured__excerpt">{article.excerpt}</p>
                    <div className="featured__meta">
                      <span className="featured__meta-item">
                        <Clock size={14} />
                        {article.date}
                      </span>
                      {article.category && (
                        <span className="featured__category">{article.category}</span>
                      )}
                    </div>
                  </div>
                </>
              );

              return hasUrl ? (
                <a
                  key={article.id}
                  href={article.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="featured__card"
                  onClick={trackClick}
                >
                  {cardInner}
                </a>
              ) : (
                <Link
                  key={article.id}
                  to={`/article/${article.id}`}
                  className="featured__card"
                  onClick={trackClick}
                >
                  {cardInner}
                </Link>
              );
            })}
          </div>
          <div className="featured__more">
            <Link to="/articles" className="btn btn-secondary" onClick={() => trackEvent('nav_click', { link: '/articles', source: 'home' })}>
              查看全部文章 <ArrowRight size={16} />
            </Link>
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
