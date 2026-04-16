import { useMemo, useState, useCallback } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useSiteContent } from '../../contexts/SiteContentContext';
import { useWysiwyg } from '../../contexts/WysiwygContext';
import EditableText from '../../components/EditableText';
import { articlesData } from '../../data/siteData';
import { getCommentCount } from '../../services/commentService';
import {
  fetchAndParseArticle,
  generateOutline,
  inferCategory,
  inferTags,
  generateSummary,
} from '../../services/articleService';
import {
  FileText, Search, MessageSquare, Calendar, ArrowRight,
  Plus, Link2, Loader2, X, Check, Tag, List, AlertCircle,
  ChevronDown, ChevronUp, Pencil, Settings2, Trash2, Palette,
  CheckSquare,
} from 'lucide-react';
import '../../components/CrossLinkToast.css';
import './InternalArticles.css';

// ---- 分类管理 ----
const ARTICLE_CATEGORIES_KEY = 'riemer_article_categories';

const PRESET_COLORS = [
  '#5EAD8C', '#4FBFC4', '#EC4899', '#F59E0B', '#8B5CF6',
  '#EF4444', '#3B82F6', '#10B981', '#F97316', '#6366F1',
  '#14B8A6', '#E11D48', '#0EA5E9', '#84CC16', '#A855F7',
];

const DEFAULT_ARTICLE_CATEGORIES = [
  { key: 'riemer-say', label: '听 RIEMer 说系列', color: '#5EAD8C' },
  { key: 'course-review', label: '课程测评', color: '#4FBFC4' },
  { key: 'campus-event', label: '校园活动', color: '#EC4899' },
  { key: 'experience', label: '经验分享', color: '#F59E0B' },
];

function loadArticleCategories() {
  try {
    const stored = localStorage.getItem(ARTICLE_CATEGORIES_KEY);
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return DEFAULT_ARTICLE_CATEGORIES;
}

function saveArticleCategories(data) {
  localStorage.setItem(ARTICLE_CATEGORIES_KEY, JSON.stringify(data));
}

function buildCategoryMaps(cats) {
  const labels = {};
  const colors = {};
  cats.forEach((c) => {
    labels[c.label] = c.label;
    colors[c.label] = c.color;
  });
  return { labels, colors };
}

export default function InternalArticles() {
  const { isAuthenticated, isAdmin, user } = useAuth();
  const { userArticles, addArticle, internalConfig, updateInternalConfig } = useSiteContent();
  const { editing } = useWysiwyg();
  const navigate = useNavigate();
  const ia = internalConfig.internalArticles || {};
  const updateIA = useCallback((key, val) => updateInternalConfig({ internalArticles: { [key]: val } }), [updateInternalConfig]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('全部');

  // ---- 分类管理状态 ----
  const [categoryList, setCategoryList] = useState(loadArticleCategories);
  const { labels: categoryLabels, colors: categoryColors } = buildCategoryMaps(categoryList);
  const [showCatManager, setShowCatManager] = useState(false);
  const [newCatLabel, setNewCatLabel] = useState('');
  const [newCatColor, setNewCatColor] = useState(PRESET_COLORS[0]);
  const [editingCatKey, setEditingCatKey] = useState(null);
  const [editCatLabel, setEditCatLabel] = useState('');
  const [editCatColor, setEditCatColor] = useState('');

  // ---- 新建归档弹窗状态 ----
  const [showModal, setShowModal] = useState(false);
  const [step, setStep] = useState('input'); // 'input' | 'loading' | 'confirm'
  const [urlInput, setUrlInput] = useState('');
  const [fetchError, setFetchError] = useState('');

  // 抓取后的文章数据（待确认）
  const [draft, setDraft] = useState(null);
  // 用户可编辑的大纲和标签
  const [editOutline, setEditOutline] = useState([]);
  const [editTags, setEditTags] = useState([]);
  const [editTitle, setEditTitle] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editExcerpt, setEditExcerpt] = useState('');
  const [newTagInput, setNewTagInput] = useState('');
  const [newOutlineInput, setNewOutlineInput] = useState('');
  const [showOutlineEditor, setShowOutlineEditor] = useState(true);
  const [showTagsEditor, setShowTagsEditor] = useState(true);
  // 跨模块联动提示
  const [taskPrompt, setTaskPrompt] = useState(null);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  const allArticles = useMemo(
    () => [...userArticles, ...articlesData].sort((a, b) => b.date.localeCompare(a.date)),
    [userArticles]
  );

  // 合并持久化分类 + 文章中动态提取的分类（去重）
  const categories = useMemo(() => {
    const managedLabels = new Set(categoryList.map((c) => c.label));
    const dynamicCats = allArticles
      .map((a) => a.category)
      .filter((cat) => cat && !managedLabels.has(cat));
    const uniqueDynamic = [...new Set(dynamicCats)];
    return ['全部', ...categoryList.map((c) => c.label), ...uniqueDynamic];
  }, [allArticles, categoryList]);

  // ---- 分类 CRUD ----
  const handleAddCategory = () => {
    const label = newCatLabel.trim();
    if (!label) return;
    if (categoryList.some((c) => c.label === label)) {
      alert('该分类名称已存在');
      return;
    }
    const key = 'acat_' + Date.now();
    const updated = [...categoryList, { key, label, color: newCatColor }];
    setCategoryList(updated);
    saveArticleCategories(updated);
    setNewCatLabel('');
    setNewCatColor(PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)]);
  };

  const startEditCategory = (cat) => {
    setEditingCatKey(cat.key);
    setEditCatLabel(cat.label);
    setEditCatColor(cat.color);
  };

  const saveEditCategory = () => {
    if (!editCatLabel.trim()) return;
    const updated = categoryList.map((c) =>
      c.key === editingCatKey ? { ...c, label: editCatLabel.trim(), color: editCatColor } : c,
    );
    setCategoryList(updated);
    saveArticleCategories(updated);
    setEditingCatKey(null);
  };

  const handleDeleteCategory = (key) => {
    const cat = categoryList.find((c) => c.key === key);
    if (!cat) return;
    if (!window.confirm(`确定要删除分类「${cat.label}」吗？该分类下的文章不会被删除。`)) return;
    const updated = categoryList.filter((c) => c.key !== key);
    setCategoryList(updated);
    saveArticleCategories(updated);
    if (selectedCategory === cat.label) setSelectedCategory('全部');
  };

  const filtered = useMemo(() => {
    return allArticles.filter((a) => {
      const matchesSearch =
        !searchTerm ||
        a.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        a.excerpt.toLowerCase().includes(searchTerm.toLowerCase()) ||
        a.tags.some((t) => t.toLowerCase().includes(searchTerm.toLowerCase()));
      const matchesCat =
        selectedCategory === '全部' || a.category === selectedCategory;
      return matchesSearch && matchesCat;
    });
  }, [allArticles, searchTerm, selectedCategory]);

  // ---- 打开新建弹窗 ----
  const openModal = () => {
    setShowModal(true);
    setStep('input');
    setUrlInput('');
    setFetchError('');
    setDraft(null);
  };

  const closeModal = () => {
    setShowModal(false);
    setStep('input');
    setUrlInput('');
    setFetchError('');
    setDraft(null);
    setEditOutline([]);
    setEditTags([]);
    setNewTagInput('');
    setNewOutlineInput('');
  };

  // ---- 抓取文章 ----
  const handleFetch = async () => {
    const url = urlInput.trim();
    if (!url) {
      setFetchError('请输入文章链接');
      return;
    }

    setFetchError('');
    setStep('loading');

    try {
      const parsed = await fetchAndParseArticle(url);
      setDraft(parsed);
      setEditTitle(parsed.title);
      setEditCategory(parsed.category);
      setEditTags([...parsed.tags]);
      setEditExcerpt(parsed.excerpt);
      setEditOutline(parsed.outline || []);
      setStep('confirm');
    } catch (err) {
      setFetchError(err.message || '抓取失败，请检查链接');
      setStep('input');
    }
  };

  // ---- 标签操作 ----
  const removeTag = (index) => {
    setEditTags((prev) => prev.filter((_, i) => i !== index));
  };

  const addTag = () => {
    const tag = newTagInput.trim();
    if (tag && !editTags.includes(tag)) {
      setEditTags((prev) => [...prev, tag]);
      setNewTagInput('');
    }
  };

  // ---- 大纲操作 ----
  const removeOutlineItem = (index) => {
    setEditOutline((prev) => prev.filter((_, i) => i !== index));
  };

  const addOutlineItem = () => {
    const item = newOutlineInput.trim();
    if (item) {
      setEditOutline((prev) => [...prev, item]);
      setNewOutlineInput('');
    }
  };

  const updateOutlineItem = (index, value) => {
    setEditOutline((prev) => prev.map((item, i) => (i === index ? value : item)));
  };

  // ---- 确认保存 ----
  const handleConfirmSave = () => {
    if (!draft) return;

    const newArticle = {
      id: `user-${Date.now()}`,
      title: editTitle.trim() || draft.title,
      rawTitle: draft.rawTitle || '',
      author: draft.author || 'RIEMer Land',
      avatar: null,
      coverImage: null,
      date: draft.date,
      category: editCategory || draft.category,
      tags: editTags.length > 0 ? editTags : draft.tags,
      excerpt: editExcerpt.trim() || draft.excerpt,
      outline: editOutline,
      url: draft.url,
      content: draft.content,
      archivedBy: user?.name || user?.nickname || '未知',
      archivedAt: new Date().toISOString(),
    };

    const articleTitle = newArticle.title;
    addArticle(newArticle, user?.id);
    closeModal();
    // 归档成功后提示用户是否去事项追踪标记对应事项为"已完成"
    setTaskPrompt({ articleTitle });
  };

  return (
    <div className="ia-list-page">
      <div className="container">
        <div className="ia-list__header">
          <div>
            <h1>
              <FileText size={28} /> <EditableText as="span" value={ia.pageTitle || '公众号历史文章归档'} configKey="internalArticles.pageTitle" onChange={v => updateIA('pageTitle', v)} />
            </h1>
            <EditableText as="p" value={ia.pageDesc || '浏览公众号历史推送内容，回顾与归档'} configKey="internalArticles.pageDesc" onChange={v => updateIA('pageDesc', v)} />
          </div>
          <button className="btn btn-primary" onClick={openModal}>
            <Plus size={16} /> 新建归档
          </button>
        </div>

        {/* 筛选 */}
        <div className="ia-list__filters">
          <div className="ia-list__search">
            <Search size={18} className="ia-list__search-icon" />
            <input
              type="text"
              placeholder="搜索文章…"
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
            {editing && (
              <button
                className={`ia-list__manage-btn ${showCatManager ? 'ia-list__manage-btn--active' : ''}`}
                onClick={() => setShowCatManager(!showCatManager)}
                title="管理筛选分类"
              >
                <Settings2 size={16} />
              </button>
            )}
          </div>

          {/* 分类管理面板 */}
          {editing && showCatManager && (
            <div className="ia-cat-manager card">
              <div className="ia-cat-manager__header">
                <h4><Settings2 size={16} /> 筛选分类管理</h4>
                <button className="ia-cat-manager__close" onClick={() => setShowCatManager(false)}>
                  <X size={16} />
                </button>
              </div>

              {/* 现有分类列表 */}
              <div className="ia-cat-manager__list">
                {categoryList.map((cat) => (
                  <div key={cat.key} className="ia-cat-item">
                    {editingCatKey === cat.key ? (
                      <div className="ia-cat-item__edit">
                        <div className="ia-cat-item__edit-row">
                          <span
                            className="ia-cat-item__color-dot"
                            style={{ background: editCatColor }}
                          />
                          <input
                            type="text"
                            className="ia-cat-item__edit-input"
                            value={editCatLabel}
                            onChange={(e) => setEditCatLabel(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && saveEditCategory()}
                            autoFocus
                          />
                          <button className="ia-cat-item__action ia-cat-item__action--save" onClick={saveEditCategory} title="保存">
                            <Check size={14} />
                          </button>
                          <button className="ia-cat-item__action" onClick={() => setEditingCatKey(null)} title="取消">
                            <X size={14} />
                          </button>
                        </div>
                        <div className="ia-cat-item__colors">
                          {PRESET_COLORS.map((c) => (
                            <button
                              key={c}
                              className={`ia-cat-item__color-btn ${editCatColor === c ? 'ia-cat-item__color-btn--active' : ''}`}
                              style={{ background: c }}
                              onClick={() => setEditCatColor(c)}
                            />
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="ia-cat-item__display">
                        <span
                          className="ia-cat-item__color-dot"
                          style={{ background: cat.color }}
                        />
                        <span className="ia-cat-item__label">{cat.label}</span>
                        <div className="ia-cat-item__actions">
                          <button className="ia-cat-item__action" onClick={() => startEditCategory(cat)} title="编辑">
                            <Pencil size={12} />
                          </button>
                          <button className="ia-cat-item__action ia-cat-item__action--danger" onClick={() => handleDeleteCategory(cat.key)} title="删除">
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
                  <span
                    className="ia-cat-item__color-dot"
                    style={{ background: newCatColor }}
                  />
                  <input
                    type="text"
                    className="ia-cat-manager__add-input"
                    placeholder="输入新分类名称..."
                    value={newCatLabel}
                    onChange={(e) => setNewCatLabel(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddCategory()}
                  />
                  <button
                    className="ia-cat-manager__add-btn"
                    onClick={handleAddCategory}
                    disabled={!newCatLabel.trim()}
                  >
                    <Plus size={14} /> 添加
                  </button>
                </div>
                <div className="ia-cat-item__colors">
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c}
                      className={`ia-cat-item__color-btn ${newCatColor === c ? 'ia-cat-item__color-btn--active' : ''}`}
                      style={{ background: c }}
                      onClick={() => setNewCatColor(c)}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 文章列表 */}
        <div className="ia-list__grid">
          {filtered.map((article) => {
            const commentCount = getCommentCount('article', article.id);
            return (
              <Link
                key={article.id}
                to={`/internal/article/${article.id}`}
                className="ia-card card"
              >
                <div className="ia-card__body">
                  <span className="ia-card__category">{article.category}</span>
                  <h3 className="ia-card__title">{article.title}</h3>
                  <p className="ia-card__excerpt">{article.excerpt}</p>
                  <div className="ia-card__footer">
                    <span className="ia-card__meta">
                      <Calendar size={13} /> {article.date}
                    </span>
                    {commentCount > 0 && (
                      <span className="ia-card__comments">
                        <MessageSquare size={13} /> {commentCount}
                      </span>
                    )}
                    <span className="ia-card__arrow">
                      <ArrowRight size={14} />
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>

        {filtered.length === 0 && (
          <div className="ia-list__empty">
            <FileText size={48} />
            <h3>未找到匹配的文章</h3>
            <p>尝试更换搜索关键词</p>
          </div>
        )}
      </div>

      {/* ========== 新建归档弹窗 ========== */}
      {showModal && (
        <div className="ia-modal-overlay" onClick={closeModal}>
          <div className="ia-modal" onClick={(e) => e.stopPropagation()}>
            <div className="ia-modal__header">
              <h2>
                {step === 'input' && '新建文章归档'}
                {step === 'loading' && '正在提取文章…'}
                {step === 'confirm' && '确认归档信息'}
              </h2>
              <button className="ia-modal__close" onClick={closeModal}>
                <X size={20} />
              </button>
            </div>

            <div className="ia-modal__body">
              {/* Step 1: 输入链接 */}
              {step === 'input' && (
                <div className="ia-modal__step-input">
                  <p className="ia-modal__hint">
                    请输入微信公众号文章链接，系统将自动提取标题、生成大纲和标签。
                  </p>
                  <div className="ia-modal__url-row">
                    <div className="ia-modal__url-input-wrap">
                      <Link2 size={18} className="ia-modal__url-icon" />
                      <input
                        type="url"
                        className="ia-modal__url-input"
                        placeholder="粘贴微信公众号文章链接…"
                        value={urlInput}
                        onChange={(e) => setUrlInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleFetch()}
                        autoFocus
                      />
                    </div>
                    <button
                      className="btn btn-primary"
                      onClick={handleFetch}
                      disabled={!urlInput.trim()}
                    >
                      提取文章
                    </button>
                  </div>
                  {fetchError && (
                    <div className="ia-modal__error">
                      <AlertCircle size={16} /> {fetchError}
                    </div>
                  )}
                </div>
              )}

              {/* Step 2: 加载中 */}
              {step === 'loading' && (
                <div className="ia-modal__step-loading">
                  <Loader2 size={36} className="ia-modal__spinner" />
                  <p>正在抓取并分析文章内容，请稍候…</p>
                </div>
              )}

              {/* Step 3: 确认 */}
              {step === 'confirm' && draft && (
                <div className="ia-modal__step-confirm">
                  {/* 标题 */}
                  <div className="ia-modal__field">
                    <label className="ia-modal__label">标题</label>
                    <input
                      type="text"
                      className="ia-modal__text-input"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                    />
                  </div>

                  {/* 分类 */}
                  <div className="ia-modal__field">
                    <label className="ia-modal__label">分类</label>
                    <input
                      type="text"
                      className="ia-modal__text-input"
                      value={editCategory}
                      onChange={(e) => setEditCategory(e.target.value)}
                    />
                  </div>

                  {/* 摘要 */}
                  <div className="ia-modal__field">
                    <label className="ia-modal__label">摘要</label>
                    <textarea
                      className="ia-modal__textarea"
                      value={editExcerpt}
                      onChange={(e) => setEditExcerpt(e.target.value)}
                      rows={3}
                    />
                  </div>

                  {/* 大纲 */}
                  <div className="ia-modal__field">
                    <div
                      className="ia-modal__label-row ia-modal__label-row--toggle"
                      onClick={() => setShowOutlineEditor(!showOutlineEditor)}
                    >
                      <label className="ia-modal__label">
                        <List size={16} /> 大纲
                        <span className="ia-modal__count">（{editOutline.length} 项）</span>
                      </label>
                      {showOutlineEditor ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </div>
                    {showOutlineEditor && (
                      <div className="ia-modal__outline-editor">
                        {editOutline.length === 0 && (
                          <p className="ia-modal__empty-hint">暂无大纲，可手动添加</p>
                        )}
                        {editOutline.map((item, idx) => (
                          <div key={idx} className="ia-modal__outline-item">
                            <span className="ia-modal__outline-num">{idx + 1}.</span>
                            <input
                              type="text"
                              className="ia-modal__outline-input"
                              value={item}
                              onChange={(e) => updateOutlineItem(idx, e.target.value)}
                            />
                            <button
                              className="ia-modal__outline-remove"
                              onClick={() => removeOutlineItem(idx)}
                              title="移除"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        ))}
                        <div className="ia-modal__outline-add">
                          <input
                            type="text"
                            className="ia-modal__outline-input"
                            placeholder="添加大纲条目…"
                            value={newOutlineInput}
                            onChange={(e) => setNewOutlineInput(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && addOutlineItem()}
                          />
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={addOutlineItem}
                            disabled={!newOutlineInput.trim()}
                          >
                            <Plus size={14} /> 添加
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 标签 */}
                  <div className="ia-modal__field">
                    <div
                      className="ia-modal__label-row ia-modal__label-row--toggle"
                      onClick={() => setShowTagsEditor(!showTagsEditor)}
                    >
                      <label className="ia-modal__label">
                        <Tag size={16} /> 标签
                        <span className="ia-modal__count">（{editTags.length} 个）</span>
                      </label>
                      {showTagsEditor ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </div>
                    {showTagsEditor && (
                      <div className="ia-modal__tags-editor">
                        <div className="ia-modal__tags-list">
                          {editTags.map((tag, idx) => (
                            <span key={idx} className="ia-modal__tag">
                              {tag}
                              <button
                                className="ia-modal__tag-remove"
                                onClick={() => removeTag(idx)}
                              >
                                <X size={12} />
                              </button>
                            </span>
                          ))}
                        </div>
                        <div className="ia-modal__tag-add">
                          <input
                            type="text"
                            className="ia-modal__tag-input"
                            placeholder="添加标签…"
                            value={newTagInput}
                            onChange={(e) => setNewTagInput(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && addTag()}
                          />
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={addTag}
                            disabled={!newTagInput.trim()}
                          >
                            <Plus size={14} />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 元信息 */}
                  <div className="ia-modal__meta-row">
                    <span><Calendar size={14} /> {draft.date}</span>
                    <span>来源：{draft.author}</span>
                  </div>
                </div>
              )}
            </div>

            {/* 底部按钮 */}
            {step === 'confirm' && (
              <div className="ia-modal__footer">
                <button className="btn btn-ghost" onClick={() => { setStep('input'); setFetchError(''); }}>
                  重新输入
                </button>
                <button className="btn btn-primary" onClick={handleConfirmSave}>
                  <Check size={16} /> 确认归档
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 跨模块联动提示：归档成功 → 引导去事项追踪 */}
      {taskPrompt && (
        <div className="cross-link-overlay" onClick={() => setTaskPrompt(null)}>
          <div className="cross-link-toast" onClick={(e) => e.stopPropagation()}>
            <div className="cross-link-toast__icon cross-link-toast__icon--archive">
              <FileText size={22} />
            </div>
            <div className="cross-link-toast__body">
              <p className="cross-link-toast__title">文章归档成功 🎉</p>
              <p className="cross-link-toast__desc">
                「{taskPrompt.articleTitle}」已成功归档，是否前往
                <strong>事项追踪</strong>页面将对应的事项标记为"已完成"？
              </p>
            </div>
            <div className="cross-link-toast__actions">
              <button
                className="cross-link-toast__btn cross-link-toast__btn--primary"
                onClick={() => {
                  setTaskPrompt(null);
                  navigate('/internal/tasks');
                }}
              >
                <CheckSquare size={15} /> 去标记完成
                <ArrowRight size={14} />
              </button>
              <button
                className="cross-link-toast__btn cross-link-toast__btn--ghost"
                onClick={() => setTaskPrompt(null)}
              >
                暂不需要
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
