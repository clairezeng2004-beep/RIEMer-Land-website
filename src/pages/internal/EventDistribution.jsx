import { useState, useMemo, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useSiteContent } from '../../contexts/SiteContentContext';
import EditableText from '../../components/EditableText';
import {
  CalendarRange,
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
  Tag,
} from 'lucide-react';
import './EventDistribution.css';

/**
 * 活动分布
 * - 数据源：useSiteContent().events，与首页「最新活动」实时同步
 * - 展示：分类统计条 + 即将开始 / 已结束 两个时间分组
 * - 交互：有回放的活动点击弹密码验证（和首页一致）
 * - 所有文案通过 EditableText 接入 internalConfig.eventDistribution
 */
export default function EventDistribution() {
  const { isAuthenticated } = useAuth();
  const { internalConfig, updateInternalConfig, events } = useSiteContent();
  const ed = internalConfig.eventDistribution || {};

  const updateEd = useCallback(
    (key, val) => updateInternalConfig({ eventDistribution: { [key]: val } }),
    [updateInternalConfig]
  );

  // 回放密码弹窗
  const [replayModal, setReplayModal] = useState(null);
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // 计算倒计时天数（活动日期晚于今天则返回天数，否则 null）
  const getCountdownDays = (eventDate) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(eventDate);
    target.setHours(0, 0, 0, 0);
    const diff = Math.ceil((target - today) / (1000 * 60 * 60 * 24));
    return diff > 0 ? diff : null;
  };

  // 分组：即将开始 vs 已结束
  const { upcoming, past, categoryStats, replayCount } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const up = [];
    const pa = [];
    const catMap = {};
    let replay = 0;
    for (const ev of events) {
      const d = new Date(ev.date);
      d.setHours(0, 0, 0, 0);
      if (d >= today) up.push(ev);
      else pa.push(ev);
      catMap[ev.category] = (catMap[ev.category] || 0) + 1;
      if (ev.hasReplay) replay += 1;
    }
    // 即将开始按日期升序（最近在前），已结束按日期降序（最新在前）
    up.sort((a, b) => a.date.localeCompare(b.date));
    pa.sort((a, b) => b.date.localeCompare(a.date));
    const cats = Object.entries(catMap)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
    return { upcoming: up, past: pa, categoryStats: cats, replayCount: replay };
  }, [events]);

  const handleEventClick = (event) => {
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
      window.open(replayModal.replayUrl, '_blank', 'noopener,noreferrer');
      setReplayModal(null);
      setPasswordInput('');
      setPasswordError('');
    } else {
      setPasswordError('密码不正确，请重试');
    }
  };

  const closeModal = () => {
    setReplayModal(null);
    setPasswordInput('');
    setPasswordError('');
    setShowPassword(false);
  };

  if (!isAuthenticated) return <Navigate to="/login" replace />;

  const renderCard = (event) => {
    const countdownDays = getCountdownDays(event.date);
    return (
      <div
        key={event.id}
        className={`ed-card ${event.hasReplay ? 'ed-card--clickable' : ''} ${countdownDays ? 'ed-card--upcoming' : ''}`}
        onClick={() => handleEventClick(event)}
        style={event.hasReplay ? { cursor: 'pointer' } : undefined}
      >
        <div className="ed-card__accent" />
        <div className="ed-card__body">
          <div className="ed-card__top">
            <span className="ed-card__category">{event.category}</span>
            {countdownDays && (
              <span className="ed-card__countdown-badge">
                <CalendarDays size={12} /> {countdownDays} 天后
              </span>
            )}
            {event.hasReplay && (
              <span className="ed-card__replay-badge">
                <Video size={12} /> 回放
              </span>
            )}
          </div>
          <h3 className="ed-card__title">{event.title}</h3>
          <p className="ed-card__excerpt">{event.excerpt}</p>
          <div className="ed-card__meta">
            <span className="ed-card__meta-item">
              <Clock size={14} />
              {event.date}
            </span>
            <span className="ed-card__meta-item">
              <MapPin size={12} /> {event.location}
            </span>
            {event.hasReplay && (
              <span className="ed-card__meta-item ed-card__meta-item--replay">
                <Lock size={12} /> 需密码
              </span>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="ed-page">
      <div className="container">
        {/* Header */}
        <div className="ed-page__header">
          <div>
            <h1>
              <CalendarRange size={28} />{' '}
              <EditableText
                value={ed.pageTitle}
                onChange={(v) => updateEd('pageTitle', v)}
                configKey="eventDistribution.pageTitle"
                as="span"
              />
            </h1>
            <p>
              <EditableText
                value={ed.pageDesc}
                onChange={(v) => updateEd('pageDesc', v)}
                configKey="eventDistribution.pageDesc"
                as="span"
              />
            </p>
          </div>
        </div>

        {/* 统计概览 */}
        <div className="ed-stats">
          <div className="ed-stats__item">
            <div className="ed-stats__value">{events.length}</div>
            <div className="ed-stats__label">活动总数</div>
          </div>
          <div className="ed-stats__item">
            <div className="ed-stats__value ed-stats__value--accent">
              {upcoming.length}
            </div>
            <div className="ed-stats__label">即将开始</div>
          </div>
          <div className="ed-stats__item">
            <div className="ed-stats__value">{past.length}</div>
            <div className="ed-stats__label">已结束</div>
          </div>
          <div className="ed-stats__item">
            <div className="ed-stats__value">{replayCount}</div>
            <div className="ed-stats__label">可回放</div>
          </div>
        </div>

        {/* 分类分布 */}
        {categoryStats.length > 0 && (
          <div className="ed-category-bar">
            <div className="ed-category-bar__label">
              <Tag size={14} /> 按分类
            </div>
            <div className="ed-category-bar__tags">
              {categoryStats.map((c) => (
                <span key={c.name} className="ed-category-bar__tag">
                  {c.name}
                  <em>{c.count}</em>
                </span>
              ))}
            </div>
          </div>
        )}

        {events.length === 0 && (
          <div className="ed-empty">
            <CalendarRange size={48} />
            <p>
              <EditableText
                value={ed.emptyText}
                onChange={(v) => updateEd('emptyText', v)}
                configKey="eventDistribution.emptyText"
                as="span"
              />
            </p>
          </div>
        )}

        {/* 即将开始 */}
        {upcoming.length > 0 && (
          <section className="ed-section">
            <h2 className="ed-section__title">
              <span className="ed-section__dot ed-section__dot--upcoming" />
              <EditableText
                value={ed.sectionUpcoming}
                onChange={(v) => updateEd('sectionUpcoming', v)}
                configKey="eventDistribution.sectionUpcoming"
                as="span"
              />
              <span className="ed-section__count">{upcoming.length}</span>
            </h2>
            <div className="ed-grid">{upcoming.map(renderCard)}</div>
          </section>
        )}

        {/* 已结束 */}
        {past.length > 0 && (
          <section className="ed-section">
            <h2 className="ed-section__title">
              <span className="ed-section__dot" />
              <EditableText
                value={ed.sectionPast}
                onChange={(v) => updateEd('sectionPast', v)}
                configKey="eventDistribution.sectionPast"
                as="span"
              />
              <span className="ed-section__count">{past.length}</span>
            </h2>
            <div className="ed-grid">{past.map(renderCard)}</div>
          </section>
        )}
      </div>

      {/* 回放密码弹窗 */}
      {replayModal && (
        <div className="replay-modal-overlay" onClick={closeModal}>
          <div className="replay-modal" onClick={(e) => e.stopPropagation()}>
            <button className="replay-modal__close" onClick={closeModal} title="关闭">
              <X size={18} />
            </button>
            <div className="replay-modal__icon">
              <Lock size={24} />
            </div>
            <h3 className="replay-modal__title">回放访问验证</h3>
            <p className="replay-modal__desc">
              该活动回放受密码保护，请输入密码后查看
            </p>
            <div className="replay-modal__event-info">
              <div className="replay-modal__event-title">{replayModal.title}</div>
              <div className="replay-modal__event-date">
                <Clock size={12} /> {replayModal.date}
              </div>
            </div>
            <div className="replay-modal__field">
              <div className="replay-modal__input-wrap">
                <input
                  type={showPassword ? 'text' : 'password'}
                  className="replay-modal__input"
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
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
                className="btn btn-primary"
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
