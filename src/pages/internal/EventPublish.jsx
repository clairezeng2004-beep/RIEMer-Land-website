import { useMemo, useState, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useSiteContent } from '../../contexts/SiteContentContext';
import { useWysiwyg } from '../../contexts/WysiwygContext';
import EditableText from '../../components/EditableText';
import {
  CalendarRange,
  Search,
  Calendar,
  MapPin,
  Video,
  Lock,
  Plus,
  X,
  Check,
  ArrowRight,
  Eye,
  EyeOff,
  ExternalLink,
  AlertCircle,
} from 'lucide-react';
import './InternalArticles.css';
import './EventPublish.css';

/**
 * 活动发布
 * - 数据源：useSiteContent().events，与首页「最新活动」实时同步（CRUD 走 addEvent）
 * - 排版/输入逻辑：完全沿用「公众号历史文章归档」的 ia- 视觉语言（卡片网格 + 顶部 header + 弹窗表单）
 * - 文案：通过 EditableText 接入 internalConfig.eventPublish
 */

// 计算倒计时天数（活动日期晚于今天则返回天数，否则 null）
function getCountdownDays(eventDate) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(eventDate);
  target.setHours(0, 0, 0, 0);
  const diff = Math.ceil((target - today) / (1000 * 60 * 60 * 24));
  return diff > 0 ? diff : null;
}

const EMPTY_EVENT = {
  title: '',
  date: '',
  category: '分享会',
  location: '',
  excerpt: '',
  officialUrl: '',
  hasReplay: false,
  replayUrl: '',
  replayPassword: '',
};

export default function EventPublish() {
  const { isAuthenticated, isAdmin } = useAuth();
  const { events, addEvent, internalConfig, updateInternalConfig } = useSiteContent();
  const { editing } = useWysiwyg();
  const ep = internalConfig.eventPublish || {};
  const updateEP = useCallback(
    (key, val) => updateInternalConfig({ eventPublish: { [key]: val } }),
    [updateInternalConfig]
  );

  // ---- 列表筛选 ----
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('全部');

  // ---- 新建活动弹窗 ----
  const [showModal, setShowModal] = useState(false);
  const [draft, setDraft] = useState(EMPTY_EVENT);
  const [formError, setFormError] = useState('');

  // ---- 回放密码弹窗（点击有回放的卡片）----
  const [replayModal, setReplayModal] = useState(null);
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  if (!isAuthenticated) return <Navigate to="/login" replace />;

  // 分类（"全部" + 出现过的所有 category）
  const categories = useMemo(() => {
    const set = new Set();
    events.forEach((e) => e.category && set.add(e.category));
    return ['全部', ...set];
  }, [events]);

  // 排序：未来活动优先（按日期升序），过去活动按降序
  const sortedEvents = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const upcoming = [];
    const past = [];
    events.forEach((e) => {
      const d = new Date(e.date);
      d.setHours(0, 0, 0, 0);
      if (d >= today) upcoming.push(e);
      else past.push(e);
    });
    upcoming.sort((a, b) => a.date.localeCompare(b.date));
    past.sort((a, b) => b.date.localeCompare(a.date));
    return [...upcoming, ...past];
  }, [events]);

  // 过滤
  const filtered = useMemo(() => {
    return sortedEvents.filter((e) => {
      const matchesSearch =
        !searchTerm ||
        e.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (e.excerpt || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (e.location || '').toLowerCase().includes(searchTerm.toLowerCase());
      const matchesCat = selectedCategory === '全部' || e.category === selectedCategory;
      return matchesSearch && matchesCat;
    });
  }, [sortedEvents, searchTerm, selectedCategory]);

  // ---- 弹窗操作 ----
  const openModal = () => {
    setDraft(EMPTY_EVENT);
    setFormError('');
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setDraft(EMPTY_EVENT);
    setFormError('');
  };

  const handleSave = () => {
    if (!draft.title.trim()) {
      setFormError('请填写活动标题');
      return;
    }
    if (!draft.date) {
      setFormError('请选择活动日期');
      return;
    }
    if (draft.hasReplay && !draft.replayUrl.trim()) {
      setFormError('已勾选「有回放」，请填写回放链接');
      return;
    }
    addEvent({
      ...draft,
      id: `evt-${Date.now()}`,
      title: draft.title.trim(),
      location: draft.location.trim(),
      excerpt: draft.excerpt.trim(),
      officialUrl: draft.officialUrl.trim(),
      replayUrl: draft.replayUrl.trim(),
      replayPassword: draft.replayPassword.trim(),
    });
    closeModal();
  };

  // ---- 卡片点击：
  //   1. 优先跳转公众号推文链接（officialUrl）
  //   2. 其次：如果有回放 → 弹密码框
  //   3. 否则不响应
  const handleCardClick = (event) => {
    if (event.officialUrl && /^https?:\/\//i.test(event.officialUrl)) {
      window.open(event.officialUrl, '_blank', 'noopener,noreferrer');
      return;
    }
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
    } else {
      setPasswordError('密码不正确，请重试');
    }
  };

  const closeReplayModal = () => {
    setReplayModal(null);
    setPasswordInput('');
    setPasswordError('');
    setShowPassword(false);
  };

  return (
    <div className="ia-list-page">
      <div className="container">
        {/* Header（沿用 ia-list__header 排版） */}
        <div className="ia-list__header">
          <div>
            <h1>
              <CalendarRange size={28} />{' '}
              <EditableText
                as="span"
                value={ep.pageTitle || '活动发布'}
                configKey="eventPublish.pageTitle"
                onChange={(v) => updateEP('pageTitle', v)}
              />
            </h1>
            <EditableText
              as="p"
              value={ep.pageDesc || '发布与维护团队活动，数据与首页「最新活动」实时同步'}
              configKey="eventPublish.pageDesc"
              onChange={(v) => updateEP('pageDesc', v)}
            />
          </div>
          {isAdmin && !editing && (
            <button className="btn btn-primary" onClick={openModal}>
              <Plus size={16} />{' '}
              <EditableText
                as="span"
                value={ep.btnNew || '新建活动'}
                configKey="eventPublish.btnNew"
                onChange={(v) => updateEP('btnNew', v)}
              />
            </button>
          )}
        </div>

        {/* 筛选 */}
        <div className="ia-list__filters">
          <div className="ia-list__search">
            <Search size={18} className="ia-list__search-icon" />
            <input
              type="text"
              placeholder="搜索活动…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="ia-list__filter-bar">
            <div className="ia-list__categories">
              {categories.map((cat) => (
                <button
                  key={cat}
                  className={`ia-list__cat ${selectedCategory === cat ? 'ia-list__cat--active' : ''}`}
                  onClick={() => setSelectedCategory(cat)}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 活动卡片列表（沿用 ia-card 视觉） */}
        <div className="ia-list__grid">
          {filtered.map((event) => {
            const countdownDays = getCountdownDays(event.date);
            const hasOfficial = !!(event.officialUrl && /^https?:\/\//i.test(event.officialUrl));
            const clickable = hasOfficial || (event.hasReplay && event.replayUrl);
            return (
              <div
                key={event.id}
                className={`ia-card card ep-card ${clickable ? 'ep-card--clickable' : ''}`}
                onClick={() => handleCardClick(event)}
                style={clickable ? { cursor: 'pointer' } : undefined}
              >
                <div className="ia-card__body">
                  <div className="ep-card__top">
                    <span className="ia-card__category">{event.category}</span>
                    {countdownDays && (
                      <span className="ep-card__badge ep-card__badge--upcoming">
                        <Calendar size={12} /> {countdownDays} 天后
                      </span>
                    )}
                    {event.hasReplay && (
                      <span className="ep-card__badge ep-card__badge--replay">
                        <Video size={12} /> 回放
                      </span>
                    )}
                  </div>
                  <h3 className="ia-card__title">{event.title}</h3>
                  {event.excerpt && (
                    <p className="ia-card__excerpt">{event.excerpt}</p>
                  )}
                  <div className="ia-card__footer">
                    <span className="ia-card__meta">
                      <Calendar size={13} /> {event.date}
                    </span>
                    {event.location && (
                      <span className="ia-card__meta">
                        <MapPin size={13} /> {event.location}
                      </span>
                    )}
                    {event.hasReplay && (
                      <span className="ia-card__meta ep-card__meta--lock">
                        <Lock size={12} /> 需密码
                      </span>
                    )}
                    <span className="ia-card__arrow">
                      <ArrowRight size={14} />
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {filtered.length === 0 && (
          <div className="ia-list__empty">
            <CalendarRange size={48} />
            <h3>{events.length === 0 ? '还没有活动' : '未找到匹配的活动'}</h3>
            <p>
              {events.length === 0
                ? '点击右上角「新建活动」开始发布'
                : '尝试更换搜索关键词或分类'}
            </p>
          </div>
        )}
      </div>

      {/* ========== 新建活动弹窗（沿用 ia-modal 排版） ========== */}
      {showModal && (
        <div className="ia-modal-overlay" onClick={closeModal}>
          <div className="ia-modal" onClick={(e) => e.stopPropagation()}>
            <div className="ia-modal__header">
              <h2>新建活动</h2>
              <button className="ia-modal__close" onClick={closeModal}>
                <X size={20} />
              </button>
            </div>

            <div className="ia-modal__body">
              <div className="ia-modal__step-confirm">
                {/* 标题 */}
                <div className="ia-modal__field">
                  <label className="ia-modal__label">活动标题 *</label>
                  <input
                    type="text"
                    className="ia-modal__text-input"
                    placeholder="请输入活动标题…"
                    value={draft.title}
                    onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                    autoFocus
                  />
                </div>

                {/* 日期 + 分类 同行 */}
                <div className="ep-modal__row">
                  <div className="ia-modal__field">
                    <label className="ia-modal__label">活动日期 *</label>
                    <input
                      type="date"
                      className="ia-modal__text-input"
                      value={draft.date}
                      onChange={(e) => setDraft({ ...draft, date: e.target.value })}
                    />
                  </div>
                  <div className="ia-modal__field">
                    <label className="ia-modal__label">分类</label>
                    <input
                      type="text"
                      className="ia-modal__text-input"
                      placeholder="如：分享会 / 经验分享 / 团队招新"
                      value={draft.category}
                      onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                    />
                  </div>
                </div>

                {/* 地点 */}
                <div className="ia-modal__field">
                  <label className="ia-modal__label">地点</label>
                  <input
                    type="text"
                    className="ia-modal__text-input"
                    placeholder="如：线上腾讯会议 / 西南财经大学"
                    value={draft.location}
                    onChange={(e) => setDraft({ ...draft, location: e.target.value })}
                  />
                </div>

                {/* 摘要 */}
                <div className="ia-modal__field">
                  <label className="ia-modal__label">活动简介</label>
                  <textarea
                    className="ia-modal__textarea"
                    placeholder="简要介绍活动内容…"
                    value={draft.excerpt}
                    onChange={(e) => setDraft({ ...draft, excerpt: e.target.value })}
                    rows={3}
                  />
                </div>

                {/* 公众号推文链接 */}
                <div className="ia-modal__field">
                  <label className="ia-modal__label">
                    <ExternalLink size={14} /> 公众号推文链接
                  </label>
                  <input
                    type="url"
                    className="ia-modal__text-input"
                    placeholder="https://mp.weixin.qq.com/s/…（填写后点击卡片将直接跳转）"
                    value={draft.officialUrl}
                    onChange={(e) => setDraft({ ...draft, officialUrl: e.target.value })}
                  />
                </div>

                {/* 回放设置 */}
                <div className="ia-modal__field">
                  <label className="ia-modal__label">
                    <input
                      type="checkbox"
                      checked={draft.hasReplay}
                      onChange={(e) => setDraft({ ...draft, hasReplay: e.target.checked })}
                      style={{ marginRight: 6 }}
                    />
                    <Video size={14} /> 提供活动回放（需设置链接与访问密码）
                  </label>
                </div>

                {draft.hasReplay && (
                  <>
                    <div className="ia-modal__field">
                      <label className="ia-modal__label">设置回放链接 *</label>
                      <input
                        type="url"
                        className="ia-modal__text-input"
                        placeholder="https://meeting.tencent.com/…"
                        value={draft.replayUrl}
                        onChange={(e) => setDraft({ ...draft, replayUrl: e.target.value })}
                      />
                    </div>
                    <div className="ia-modal__field">
                      <label className="ia-modal__label">设置访问密码</label>
                      <input
                        type="text"
                        className="ia-modal__text-input"
                        placeholder="为回放设置访问密码，留空则无需密码即可访问"
                        value={draft.replayPassword}
                        onChange={(e) => setDraft({ ...draft, replayPassword: e.target.value })}
                      />
                    </div>
                  </>
                )}

                {formError && (
                  <div className="ia-modal__error">
                    <AlertCircle size={16} /> {formError}
                  </div>
                )}
              </div>
            </div>

            <div className="ia-modal__footer">
              <button className="btn btn-ghost" onClick={closeModal}>
                取消
              </button>
              <button className="btn btn-primary" onClick={handleSave}>
                <Check size={16} /> 确认发布
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 回放密码弹窗 */}
      {replayModal && (
        <div className="replay-modal-overlay" onClick={closeReplayModal}>
          <div className="replay-modal" onClick={(e) => e.stopPropagation()}>
            <button className="replay-modal__close" onClick={closeReplayModal} title="关闭">
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
                <Calendar size={12} /> {replayModal.date}
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
              <button className="btn btn-ghost" onClick={closeReplayModal}>
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
