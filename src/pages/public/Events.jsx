import { useState, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  Clock,
  MapPin,
  Video,
  Lock,
  Eye,
  EyeOff,
  X,
  ExternalLink,
  AlertCircle,
  CalendarDays,
  CalendarRange,
} from 'lucide-react';
import { useSiteContent } from '../../contexts/SiteContentContext';
import { trackEvent } from '../../lib/analytics';
import { useEqualTitleHeights } from '../../hooks/useEqualTitleHeights';
import './Home.css';

const EVENT_CATEGORY_RENAMES = {
  腾讯会议分享会: '经验分享',
  腾讯会议分享: '经验分享',
};
const HIDDEN_EVENT_CATEGORIES = new Set(['分享会']);

function normalizeEventCategory(category) {
  const value = String(category || '').trim();
  if (!value || HIDDEN_EVENT_CATEGORIES.has(value)) return '';
  return EVENT_CATEGORY_RENAMES[value] || value;
}

export default function Events() {
  const { events } = useSiteContent();

  const [selectedCategory, setSelectedCategory] = useState('全部');

  // 密码弹窗状态
  const [replayModal, setReplayModal] = useState(null);
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const sortedEvents = useMemo(
    () => [...events].sort((a, b) => (b.date || '').localeCompare(a.date || '')),
    [events],
  );

  const categories = useMemo(() => {
    const cats = [...new Set(sortedEvents.map((e) => normalizeEventCategory(e.category)).filter(Boolean))];
    return ['全部', ...cats];
  }, [sortedEvents]);

  const filtered = useMemo(() => {
    if (selectedCategory === '全部') return sortedEvents;
    return sortedEvents.filter((e) => normalizeEventCategory(e.category) === selectedCategory);
  }, [sortedEvents, selectedCategory]);

  // 活动卡片标题按行对齐
  const eventsGridRef = useRef(null);
  useEqualTitleHeights(eventsGridRef, '.featured__title', [filtered.length, selectedCategory]);

  const getCountdownDays = (eventDate) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(eventDate + 'T00:00:00');
    const diff = target - today;
    if (diff > 0) return Math.ceil(diff / (1000 * 60 * 60 * 24));
    return null;
  };

  const handleEventClick = (event) => {
    trackEvent('event_click', {
      event_id: event.id,
      event_title: event.title,
      event_category: normalizeEventCategory(event.category),
      has_replay: event.hasReplay,
      source: 'events_page',
    });
    if (event.hasReplay && event.replayUrl) {
      setReplayModal(event);
      setPasswordInput('');
      setPasswordError('');
      setShowPassword(false);
    }
  };

  const handlePasswordSubmit = () => {
    if (!replayModal) return;
    if (passwordInput === replayModal.replayPassword) {
      trackEvent('replay_unlock', { event_id: replayModal.id, event_title: replayModal.title });
      window.open(replayModal.replayUrl, '_blank', 'noopener,noreferrer');
      setReplayModal(null);
      setPasswordInput('');
      setPasswordError('');
    } else {
      trackEvent('replay_unlock_fail', { event_id: replayModal.id, event_title: replayModal.title });
      setPasswordError('密码不正确，请重试');
    }
  };

  const closeModal = () => {
    setReplayModal(null);
    setPasswordInput('');
    setPasswordError('');
    setShowPassword(false);
  };

  return (
    <div className="home">
      {/* Hero */}
      <section className="hero">
        <div className="hero__content container">
          <h1 className="hero__title">
            <span className="hero__title-accent">全部活动</span>
          </h1>
          <p className="hero__subtitle">回顾 RIEMer Land 的历次活动与讲座，查看回放与往期内容。</p>
        </div>
      </section>

      <section className="featured section section--compact">
        <div className="container">
          {categories.length > 1 && (
            <div className="featured__header" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {categories.map((cat) => (
                <button
                  key={cat}
                  className={`featured__tag-btn ${selectedCategory === cat ? 'featured__tag-btn--active' : ''}`}
                  onClick={() => setSelectedCategory(cat)}
                >
                  {cat}
                </button>
              ))}
            </div>
          )}

          <div className="featured__grid" ref={eventsGridRef}>
            {filtered.map((event) => {
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

          {filtered.length === 0 && (
            <div className="articles-list__empty" style={{ textAlign: 'center', padding: '3rem 0', color: 'var(--color-text-muted)' }}>
              <CalendarRange size={48} />
              <h3>暂无活动</h3>
              <p>换个分类看看，或稍后再来。</p>
            </div>
          )}

          <div className="featured__more">
            <Link to="/" className="btn btn-secondary">
              <ArrowLeft size={16} /> 返回首页
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
              <button className="btn btn-ghost" onClick={closeModal}>
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
