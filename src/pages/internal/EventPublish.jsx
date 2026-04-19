import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
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
  Settings2,
  Pencil,
  Trash2,
} from 'lucide-react';
import {
  SITE_KEYS,
  fetchSetting,
  saveSetting,
  subscribeSetting,
} from '../../services/siteSettingsService';
import { isSupabaseConfigured } from '../../lib/supabase';
import './InternalArticles.css';
import './EventPublish.css';

/**
 * 活动发布
 * - 数据源：useSiteContent().events，与首页「最新活动」实时同步（CRUD 走 addEvent）
 * - 筛选分类：独立持久化到 site_settings.event_categories，跨设备同步，所有成员可新增
 * - 排版/输入逻辑：完全沿用「公众号历史文章归档」的 ia- 视觉语言（卡片网格 + 顶部 header + 弹窗表单）
 * - 文案：通过 EditableText 接入 internalConfig.eventPublish
 */

// ---- 分类管理 ----
// 事件分类只有文本（无颜色），存 string[]；本地 key 与 site_settings.event_categories 双写
const EVENT_CATEGORIES_KEY = 'riemer_event_categories';

const DEFAULT_EVENT_CATEGORIES = ['腾讯会议分享', '团队招新', '其他'];

function loadEventCategories() {
  try {
    const stored = localStorage.getItem(EVENT_CATEGORIES_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'string')) {
        return parsed;
      }
    }
  } catch { /* ignore */ }
  return [...DEFAULT_EVENT_CATEGORIES];
}

function saveEventCategoriesLocal(data) {
  localStorage.setItem(EVENT_CATEGORIES_KEY, JSON.stringify(data));
}

// 双写：本地 + 云端（site_settings.event_categories），便于跨设备同步
async function persistEventCategories(data, lastSyncRef) {
  saveEventCategoriesLocal(data);
  if (!isSupabaseConfigured) return;
  const res = await saveSetting(SITE_KEYS.EVENT_CATEGORIES, data);
  if (res.success && lastSyncRef) {
    lastSyncRef.current = res.updatedAt;
  } else if (!res.success) {
    console.warn('[EventPublish] 分类云端同步失败:', res.error);
  }
}

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
  category: '腾讯会议分享',
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

  // ---- 分类管理（跨设备同步：事件分类单独存 site_settings.event_categories）----
  const [categoryList, setCategoryList] = useState(loadEventCategories);
  const lastCatSyncRef = useRef(null);

  // 首次拉云 + 订阅变更（与 InternalArticles 的 ARTICLE_CATEGORIES 同款模式）
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;

    fetchSetting(SITE_KEYS.EVENT_CATEGORIES).then(({ value, updatedAt, error }) => {
      if (cancelled || error) return;
      if (Array.isArray(value) && value.length > 0 && value.every((x) => typeof x === 'string')) {
        lastCatSyncRef.current = updatedAt;
        setCategoryList(value);
        saveEventCategoriesLocal(value);
      }
    });

    const unsub = subscribeSetting(SITE_KEYS.EVENT_CATEGORIES, (value, updatedAt) => {
      if (updatedAt && lastCatSyncRef.current === updatedAt) return; // 自己的回流
      if (!Array.isArray(value)) return;
      lastCatSyncRef.current = updatedAt;
      setCategoryList(value);
      saveEventCategoriesLocal(value);
    });

    return () => {
      cancelled = true;
      if (unsub) unsub();
    };
  }, []);

  // ---- 普通成员快速新增分类弹窗 ----
  const [showAddCatModal, setShowAddCatModal] = useState(false);
  const [quickCatLabel, setQuickCatLabel] = useState('');
  const [quickCatError, setQuickCatError] = useState('');

  // ---- 管理员（编辑模式）分类管理面板 ----
  const [showCatManager, setShowCatManager] = useState(false);
  const [editingCatLabel, setEditingCatLabel] = useState(null); // 正在编辑的分类原名
  const [editCatDraft, setEditCatDraft] = useState('');
  const [newCatLabel, setNewCatLabel] = useState('');

  // ---- 新建活动弹窗 ----
  const [showModal, setShowModal] = useState(false);
  const [draft, setDraft] = useState(EMPTY_EVENT);
  const [formError, setFormError] = useState('');
  // 新建活动弹窗内"其他"自定义分类临时值
  const [customCategoryInput, setCustomCategoryInput] = useState('');

  // ---- 回放密码弹窗（点击有回放的卡片）----
  const [replayModal, setReplayModal] = useState(null);
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  if (!isAuthenticated) return <Navigate to="/login" replace />;

  // 分类（"全部" + 预设分类 + events 中出现但不在预设里的历史分类）
  // 历史分类（老活动里 category 是 "分享会 / 经验分享"）保留在列表末尾，
  // 避免老数据筛不到。分类按插入顺序去重。
  const categories = useMemo(() => {
    const result = ['全部', ...categoryList];
    const set = new Set(result);
    events.forEach((e) => {
      if (e.category && !set.has(e.category)) {
        result.push(e.category);
        set.add(e.category);
      }
    });
    return result;
  }, [events, categoryList]);

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

  // ---- 分类 CRUD ----
  // 普通成员快速新增（打开弹窗）
  const openAddCatModal = () => {
    setQuickCatLabel('');
    setQuickCatError('');
    setShowAddCatModal(true);
  };
  const closeAddCatModal = () => {
    setShowAddCatModal(false);
    setQuickCatError('');
  };
  const handleQuickAddCategory = () => {
    const label = quickCatLabel.trim();
    if (!label) {
      setQuickCatError('请输入分类名称');
      return;
    }
    if (categoryList.includes(label)) {
      setQuickCatError('该分类已存在');
      return;
    }
    const updated = [...categoryList, label];
    setCategoryList(updated);
    persistEventCategories(updated, lastCatSyncRef);
    setShowAddCatModal(false);
  };

  // 管理员在编辑模式下 —— 重命名 / 删除 / 追加
  const startEditCategory = (label) => {
    setEditingCatLabel(label);
    setEditCatDraft(label);
  };
  const saveEditCategory = () => {
    const next = editCatDraft.trim();
    if (!next) return;
    if (next !== editingCatLabel && categoryList.includes(next)) {
      // 重名，终止
      return;
    }
    const updated = categoryList.map((c) => (c === editingCatLabel ? next : c));
    setCategoryList(updated);
    persistEventCategories(updated, lastCatSyncRef);
    // 如果当前选中的正是被改名的分类，同步选中到新名
    if (selectedCategory === editingCatLabel) setSelectedCategory(next);
    setEditingCatLabel(null);
    setEditCatDraft('');
  };
  const handleDeleteCategory = (label) => {
    if (!window.confirm(`确定要删除分类「${label}」吗？\n（已有活动的分类值不会被删除，仅从筛选项中移除）`)) return;
    const updated = categoryList.filter((c) => c !== label);
    setCategoryList(updated);
    persistEventCategories(updated, lastCatSyncRef);
    if (selectedCategory === label) setSelectedCategory('全部');
  };
  const handleAddCategoryInManager = () => {
    const label = newCatLabel.trim();
    if (!label || categoryList.includes(label)) {
      setNewCatLabel('');
      return;
    }
    const updated = [...categoryList, label];
    setCategoryList(updated);
    persistEventCategories(updated, lastCatSyncRef);
    setNewCatLabel('');
  };

  // ---- 弹窗操作 ----
  const openModal = () => {
    // 新建默认选第一个预设分类
    const defaultCat = categoryList[0] || '其他';
    setDraft({ ...EMPTY_EVENT, category: defaultCat });
    setCustomCategoryInput('');
    setFormError('');
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setDraft(EMPTY_EVENT);
    setCustomCategoryInput('');
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
    // 如果选了"__custom__"（自定义），用输入的文本作为分类
    let finalCategory = draft.category;
    if (draft.category === '__custom__') {
      const custom = customCategoryInput.trim();
      if (!custom) {
        setFormError('请输入自定义分类名称');
        return;
      }
      finalCategory = custom;
      // 若新分类不在分类列表，顺带添加进去（让它成为可筛选项）
      if (!categoryList.includes(custom)) {
        const updated = [...categoryList, custom];
        setCategoryList(updated);
        persistEventCategories(updated, lastCatSyncRef);
      }
    }
    addEvent({
      ...draft,
      category: finalCategory,
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
              {/* 所有登录成员可用：快速新增分类 */}
              <button
                className="ia-list__cat ia-list__cat--add"
                onClick={openAddCatModal}
                title="新增筛选分类（所有成员可用）"
              >
                <Plus size={14} /> 新增筛选
              </button>
            </div>
            {/* 管理员编辑模式：进入分类管理（重命名/删除） */}
            {isAdmin && editing && (
              <button
                className={`ia-list__manage-btn ${showCatManager ? 'ia-list__manage-btn--active' : ''}`}
                onClick={() => setShowCatManager(!showCatManager)}
                title="管理筛选分类"
              >
                <Settings2 size={16} />
              </button>
            )}
          </div>

          {/* 分类管理面板（仅管理员 + 编辑模式）*/}
          {isAdmin && editing && showCatManager && (
            <div className="ia-cat-manager card">
              <div className="ia-cat-manager__header">
                <h4><Settings2 size={16} /> 筛选分类管理</h4>
                <button className="ia-cat-manager__close" onClick={() => setShowCatManager(false)}>
                  <X size={16} />
                </button>
              </div>

              {/* 现有分类列表 */}
              <div className="ia-cat-manager__list">
                {categoryList.map((label) => (
                  <div key={label} className="ia-cat-item">
                    {editingCatLabel === label ? (
                      <div className="ia-cat-item__edit">
                        <div className="ia-cat-item__edit-row">
                          <input
                            type="text"
                            className="ia-cat-item__edit-input"
                            value={editCatDraft}
                            onChange={(e) => setEditCatDraft(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && saveEditCategory()}
                            autoFocus
                          />
                          <button
                            className="ia-cat-item__action ia-cat-item__action--save"
                            onClick={saveEditCategory}
                            title="保存"
                          >
                            <Check size={14} />
                          </button>
                          <button
                            className="ia-cat-item__action"
                            onClick={() => { setEditingCatLabel(null); setEditCatDraft(''); }}
                            title="取消"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="ia-cat-item__display">
                        <span className="ia-cat-item__label">{label}</span>
                        <div className="ia-cat-item__actions">
                          <button
                            className="ia-cat-item__action"
                            onClick={() => startEditCategory(label)}
                            title="重命名"
                          >
                            <Pencil size={12} />
                          </button>
                          <button
                            className="ia-cat-item__action ia-cat-item__action--danger"
                            onClick={() => handleDeleteCategory(label)}
                            title="删除"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* 新建分类 */}
              <div className="ia-cat-manager__add">
                <div className="ia-cat-manager__add-row">
                  <input
                    type="text"
                    className="ia-cat-manager__add-input"
                    placeholder="输入新分类名称..."
                    value={newCatLabel}
                    onChange={(e) => setNewCatLabel(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddCategoryInManager()}
                  />
                  <button
                    className="ia-cat-manager__add-btn"
                    onClick={handleAddCategoryInManager}
                    disabled={!newCatLabel.trim() || categoryList.includes(newCatLabel.trim())}
                  >
                    <Plus size={14} /> 添加
                  </button>
                </div>
              </div>
            </div>
          )}
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
                    <select
                      className="ia-modal__text-input"
                      value={draft.category}
                      onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                    >
                      {categoryList.map((cat) => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                      {/* 若当前 draft.category 是历史分类（不在预设里），先把它显示为选项 */}
                      {draft.category &&
                        !categoryList.includes(draft.category) &&
                        draft.category !== '__custom__' && (
                          <option value={draft.category}>{draft.category}</option>
                        )}
                      <option value="__custom__">＋ 自定义…</option>
                    </select>
                    {draft.category === '__custom__' && (
                      <input
                        type="text"
                        className="ia-modal__text-input"
                        placeholder="请输入新分类名称，保存时将自动加入筛选项"
                        value={customCategoryInput}
                        onChange={(e) => setCustomCategoryInput(e.target.value)}
                        style={{ marginTop: 8 }}
                        maxLength={20}
                      />
                    )}
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

      {/* ========== 普通成员快速新增分类弹窗 ========== */}
      {showAddCatModal && (
        <div className="ia-modal-overlay" onClick={closeAddCatModal}>
          <div
            className="ia-modal"
            style={{ maxWidth: 420 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="ia-modal__header">
              <h2><Plus size={18} /> 新增筛选分类</h2>
              <button className="ia-modal__close" onClick={closeAddCatModal}>
                <X size={20} />
              </button>
            </div>
            <div className="ia-modal__body">
              <div className="ia-modal__field">
                <label className="ia-modal__label">分类名称</label>
                <input
                  type="text"
                  className="ia-modal__text-input"
                  placeholder="例如：读书会、线下聚会…"
                  value={quickCatLabel}
                  onChange={(e) => {
                    setQuickCatLabel(e.target.value);
                    setQuickCatError('');
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && handleQuickAddCategory()}
                  autoFocus
                  maxLength={20}
                />
                {quickCatError && (
                  <div className="ia-modal__error" style={{ marginTop: 8 }}>
                    <AlertCircle size={14} /> {quickCatError}
                  </div>
                )}
                <p style={{
                  fontSize: 12,
                  color: 'var(--color-text-muted)',
                  marginTop: 8,
                  lineHeight: 1.6,
                }}>
                  新增的分类会立即同步给所有成员。只有管理员在编辑模式下才能重命名或删除分类。
                </p>
              </div>
            </div>
            <div className="ia-modal__footer">
              <button className="btn btn-ghost" onClick={closeAddCatModal}>
                取消
              </button>
              <button
                className="btn btn-primary"
                onClick={handleQuickAddCategory}
                disabled={!quickCatLabel.trim()}
              >
                <Plus size={16} /> 新增
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
