import { useMemo, useState, useCallback } from 'react';
import { Link, Navigate } from 'react-router-dom';
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
  ChevronDown, ChevronUp, Pencil,
} from 'lucide-react';
import './InternalArticles.css';

export default function InternalArticles() {
  const { isAuthenticated, user } = useAuth();
  const { userArticles, addArticle, internalConfig, updateInternalConfig } = useSiteContent();
  const { editing } = useWysiwyg();
  const ia = internalConfig.internalArticles || {};
  const updateIA = useCallback((key, val) => updateInternalConfig({ internalArticles: { [key]: val } }), [updateInternalConfig]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('全部');

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

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  const allArticles = useMemo(
    () => [...userArticles, ...articlesData].sort((a, b) => b.date.localeCompare(a.date)),
    [userArticles]
  );

  const categories = useMemo(() => {
    const cats = new Set(allArticles.map((a) => a.category));
    return ['全部', ...cats];
  }, [allArticles]);

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

    addArticle(newArticle, user?.id);
    closeModal();
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
    </div>
  );
}
