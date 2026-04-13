import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useSiteContent } from '../../contexts/SiteContentContext';
import { useNotifications } from '../../contexts/NotificationContext';
import { fetchAndParseArticle, cleanTitle, generateSummary, inferCategory, inferTags } from '../../services/articleService';
import {
  Settings,
  Save,
  RotateCcw,
  Type,
  BarChart3,
  FileText,
  MapPin,
  Mail,
  Plus,
  Trash2,
  CheckCircle,
  AlertCircle,
  Filter,
  Pencil,
  X,
  Link2,
  Loader2,
  ExternalLink,
  Tag,
  Calendar,
  LayoutGrid,
  MessageSquarePlus,
  User,
  Clock,
  Video,
  Lock,
  Eye,
  EyeOff,
} from 'lucide-react';
import './ContentManagement.css';

export default function ContentManagement() {
  const { isAuthenticated, isAdmin } = useAuth();
  const { content, updateContent, resetContent, filterOptions, updateFilterOptions, resetFilterOptions, userArticles, addArticle, updateArticle, deleteArticle, internalConfig, updateInternalConfig, resetInternalConfig, suggestions, addSuggestion, updateSuggestion, deleteSuggestion, events, addEvent, updateEvent, deleteEvent } = useSiteContent();
  const { addNotification } = useNotifications();

  // 本地编辑状态
  const [form, setForm] = useState({ ...content });
  const [filtersForm, setFiltersForm] = useState({ ...filterOptions });
  const [internalForm, setInternalForm] = useState(JSON.parse(JSON.stringify(internalConfig)));
  const [saved, setSaved] = useState(false);
  const [activeTab, setActiveTab] = useState('hero');

  // 编辑中的成员索引
  const [editingMemberIndex, setEditingMemberIndex] = useState(null);

  // 文章管理状态
  const [articleUrl, setArticleUrl] = useState('');
  const [fetchingArticle, setFetchingArticle] = useState(false);
  const [fetchError, setFetchError] = useState('');
  const [editingArticle, setEditingArticle] = useState(null); // 正在编辑的文章（新建或修改）
  const [editingArticleId, setEditingArticleId] = useState(null); // 正在编辑的已有文章 ID

  // 建议管理状态
  const [editingSuggestion, setEditingSuggestion] = useState(null); // 新建建议
  const [editingSuggestionId, setEditingSuggestionId] = useState(null); // 正在编辑的建议 ID

  // 活动管理状态
  const [editingEvent, setEditingEvent] = useState(null); // 新建/编辑中的活动
  const [editingEventId, setEditingEventId] = useState(null); // 正在编辑的已有活动 ID

  // 头像 URL 生成
  const sugAvatarUrl = (name) =>
    name
      ? `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=5B8C3E&color=fff&size=80&font-size=0.4&rounded=true`
      : null;

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  const handleSave = () => {
    updateContent(form);
    updateFilterOptions(filtersForm);
    updateInternalConfig(internalForm);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const handleReset = () => {
    if (window.confirm('确定要重置所有内容为默认值吗？此操作不可撤销。')) {
      resetContent();
      resetFilterOptions();
      resetInternalConfig();
      setForm({ ...content });
      setFiltersForm({ ...filterOptions });
      // 需要从 context 获取重置后的值
      window.location.reload();
    }
  };

  const updateStat = (index, field, value) => {
    const newStats = [...form.stats];
    newStats[index] = { ...newStats[index], [field]: value };
    setForm({ ...form, stats: newStats });
  };

  const addStat = () => {
    setForm({ ...form, stats: [...form.stats, { label: '', value: '' }] });
  };

  const removeStat = (index) => {
    setForm({ ...form, stats: form.stats.filter((_, i) => i !== index) });
  };

  const tabs = [
    { id: 'hero', label: 'Hero 区域', icon: <Type size={16} /> },
    { id: 'stats', label: '数据统计', icon: <BarChart3 size={16} /> },
    { id: 'filters', label: '筛选选项', icon: <Filter size={16} /> },
    { id: 'articles', label: '文章板块', icon: <FileText size={16} /> },
    { id: 'events', label: '活动管理', icon: <Video size={16} /> },
    { id: 'footer', label: '页脚信息', icon: <MapPin size={16} /> },
    { id: 'internal', label: '内部空间', icon: <LayoutGrid size={16} /> },
    { id: 'suggestions', label: '建设建议', icon: <MessageSquarePlus size={16} /> },
  ];

  return (
    <div className="content-mgmt">
      <div className="container">
        <div className="content-mgmt__header">
          <div>
            <h1>
              <Settings size={28} /> 内容管理
            </h1>
            <p>编辑网站首页展示的文字内容</p>
          </div>
          {isAdmin && (
            <div className="content-mgmt__header-actions">
              <button className="btn btn-ghost" onClick={handleReset}>
                <RotateCcw size={16} /> 重置默认
              </button>
              <button className="btn btn-primary" onClick={handleSave}>
                <Save size={16} /> 保存更改
              </button>
            </div>
          )}
        </div>

        {!isAdmin && (
          <div className="content-mgmt__readonly-banner">
            <Eye size={16} />
            <span>当前为只读模式，仅管理员可编辑内容</span>
          </div>
        )}

        {saved && (
          <div className="content-mgmt__toast">
            <CheckCircle size={18} />
            <span>内容已保存，刷新首页即可查看更改</span>
          </div>
        )}

        <div className="content-mgmt__layout">
          {/* 左侧标签导航 */}
          <div className="content-mgmt__tabs">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                className={`content-mgmt__tab ${activeTab === tab.id ? 'content-mgmt__tab--active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            ))}
          </div>

          {/* 右侧编辑区 */}
          <div className={`content-mgmt__panel ${!isAdmin ? 'content-mgmt__panel--readonly' : ''}`}>

            {/* Hero 区域 */}
            {activeTab === 'hero' && (
              <div className="content-mgmt__section">
                <h3 className="content-mgmt__section-title">Hero 区域</h3>
                <p className="content-mgmt__section-desc">首页顶部的标题和介绍文字</p>

                <div className="content-mgmt__field">
                  <label>标语</label>
                  <input
                    type="text"
                    value={form.heroTagline}
                    onChange={(e) => setForm({ ...form, heroTagline: e.target.value })}
                    className="content-mgmt__input"
                    placeholder="如：探索 · 研究 · 交流"
                  />
                </div>

                <div className="content-mgmt__field">
                  <label>主标题</label>
                  <input
                    type="text"
                    value={form.heroTitle}
                    onChange={(e) => setForm({ ...form, heroTitle: e.target.value })}
                    className="content-mgmt__input"
                    placeholder="如：RIEMer Land"
                  />
                </div>

                <div className="content-mgmt__field">
                  <label>简介描述</label>
                  <textarea
                    value={form.heroDescription}
                    onChange={(e) => setForm({ ...form, heroDescription: e.target.value })}
                    className="content-mgmt__input content-mgmt__textarea"
                    rows={4}
                    placeholder="首页 Hero 区域的描述文字"
                  />
                </div>
              </div>
            )}

            {/* 数据统计 */}
            {activeTab === 'stats' && (
              <div className="content-mgmt__section">
                <h3 className="content-mgmt__section-title">数据统计</h3>
                <p className="content-mgmt__section-desc">首页展示的统计数字</p>

                {form.stats.map((stat, i) => (
                  <div key={i} className="content-mgmt__inline-group">
                    <div className="content-mgmt__field content-mgmt__field--flex">
                      <label>标签</label>
                      <input
                        type="text"
                        value={stat.label}
                        onChange={(e) => updateStat(i, 'label', e.target.value)}
                        className="content-mgmt__input"
                        placeholder="如：活跃成员"
                      />
                    </div>
                    <div className="content-mgmt__field content-mgmt__field--flex">
                      <label>数值</label>
                      <input
                        type="text"
                        value={stat.value}
                        onChange={(e) => updateStat(i, 'value', e.target.value)}
                        className="content-mgmt__input"
                        placeholder="如：120+"
                      />
                    </div>
                    <button
                      className="content-mgmt__remove-btn"
                      onClick={() => removeStat(i)}
                      title="删除"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}

                <button className="content-mgmt__add-btn" onClick={addStat}>
                  <Plus size={16} /> 添加统计项
                </button>
              </div>
            )}

            {/* 筛选选项 */}
            {activeTab === 'filters' && (
              <div className="content-mgmt__section">
                <h3 className="content-mgmt__section-title">筛选选项管理</h3>
                <p className="content-mgmt__section-desc">管理事项追踪页面中的分类、状态和团队成员选项</p>

                {/* 事项分类 */}
                <div className="content-mgmt__subsection">
                  <h4 className="content-mgmt__subsection-title">事项分类</h4>
                  {filtersForm.taskCategories.map((cat, i) => (
                    <div key={i} className="content-mgmt__inline-group">
                      <div className="content-mgmt__field content-mgmt__field--flex">
                        <input
                          type="text"
                          value={cat}
                          onChange={(e) => {
                            const arr = [...filtersForm.taskCategories];
                            arr[i] = e.target.value;
                            setFiltersForm({ ...filtersForm, taskCategories: arr });
                          }}
                          className="content-mgmt__input"
                          placeholder="分类名称"
                        />
                      </div>
                      <button
                        className="content-mgmt__remove-btn"
                        onClick={() => {
                          setFiltersForm({
                            ...filtersForm,
                            taskCategories: filtersForm.taskCategories.filter((_, idx) => idx !== i),
                          });
                        }}
                        title="删除"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                  <button
                    className="content-mgmt__add-btn"
                    onClick={() =>
                      setFiltersForm({
                        ...filtersForm,
                        taskCategories: [...filtersForm.taskCategories, ''],
                      })
                    }
                  >
                    <Plus size={16} /> 添加分类
                  </button>
                </div>

                {/* 事项状态 */}
                <div className="content-mgmt__subsection">
                  <h4 className="content-mgmt__subsection-title">事项状态</h4>
                  {filtersForm.taskStatuses.map((status, i) => (
                    <div key={i} className="content-mgmt__inline-group">
                      <div className="content-mgmt__field content-mgmt__field--flex">
                        <input
                          type="text"
                          value={status}
                          onChange={(e) => {
                            const arr = [...filtersForm.taskStatuses];
                            arr[i] = e.target.value;
                            setFiltersForm({ ...filtersForm, taskStatuses: arr });
                          }}
                          className="content-mgmt__input"
                          placeholder="状态名称"
                        />
                      </div>
                      <button
                        className="content-mgmt__remove-btn"
                        onClick={() => {
                          setFiltersForm({
                            ...filtersForm,
                            taskStatuses: filtersForm.taskStatuses.filter((_, idx) => idx !== i),
                          });
                        }}
                        title="删除"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                  <button
                    className="content-mgmt__add-btn"
                    onClick={() =>
                      setFiltersForm({
                        ...filtersForm,
                        taskStatuses: [...filtersForm.taskStatuses, ''],
                      })
                    }
                  >
                    <Plus size={16} /> 添加状态
                  </button>
                </div>

                {/* 团队成员 */}
                <div className="content-mgmt__subsection">
                  <h4 className="content-mgmt__subsection-title">团队成员</h4>
                  {filtersForm.teamMembers.map((member, i) => (
                    <div key={member.id || i} className="content-mgmt__card">
                      <div className="content-mgmt__card-header">
                        <span className="content-mgmt__card-index">#{i + 1}</span>
                        <div className="content-mgmt__card-header-actions">
                          <button
                            className="content-mgmt__edit-btn"
                            onClick={() => setEditingMemberIndex(editingMemberIndex === i ? null : i)}
                            title={editingMemberIndex === i ? '收起' : '编辑'}
                          >
                            {editingMemberIndex === i ? <X size={14} /> : <Pencil size={14} />}
                          </button>
                          <button
                            className="content-mgmt__remove-btn"
                            onClick={() => {
                              setFiltersForm({
                                ...filtersForm,
                                teamMembers: filtersForm.teamMembers.filter((_, idx) => idx !== i),
                              });
                              if (editingMemberIndex === i) setEditingMemberIndex(null);
                            }}
                            title="删除"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                      {editingMemberIndex === i ? (
                        <>
                          <div className="content-mgmt__field">
                            <label>姓名</label>
                            <input
                              type="text"
                              value={member.name}
                              onChange={(e) => {
                                const arr = [...filtersForm.teamMembers];
                                arr[i] = { ...arr[i], name: e.target.value };
                                setFiltersForm({ ...filtersForm, teamMembers: arr });
                              }}
                              className="content-mgmt__input"
                              placeholder="成员姓名"
                            />
                          </div>
                        </>
                      ) : (
                        <div className="content-mgmt__member-summary">
                          <span className="content-mgmt__member-name">{member.name || '未命名'}</span>
                        </div>
                      )}
                    </div>
                  ))}
                  <button
                    className="content-mgmt__add-btn"
                    onClick={() => {
                      const newId = `member-${Date.now()}`;
                      setFiltersForm({
                        ...filtersForm,
                        teamMembers: [...filtersForm.teamMembers, { id: newId, name: '', role: '' }],
                      });
                      setEditingMemberIndex(filtersForm.teamMembers.length);
                    }}
                  >
                    <Plus size={16} /> 添加成员
                  </button>
                </div>

                <div className="content-mgmt__hint">
                  <AlertCircle size={16} />
                  <span>修改后请点击顶部「保存更改」按钮，筛选选项将同步更新到事项追踪页面。</span>
                </div>
              </div>
            )}

            {/* 文章板块 */}
            {activeTab === 'articles' && (
              <div className="content-mgmt__section">
                <h3 className="content-mgmt__section-title">文章管理</h3>
                <p className="content-mgmt__section-desc">通过粘贴公众号链接添加文章，自动提取标题、时间并生成智能摘要</p>

                {/* 板块标题 */}
                <div className="content-mgmt__subsection">
                  <h4 className="content-mgmt__subsection-title">板块标题</h4>
                  <div className="content-mgmt__field">
                    <input
                      type="text"
                      value={form.articlesSectionTitle}
                      onChange={(e) => setForm({ ...form, articlesSectionTitle: e.target.value })}
                      className="content-mgmt__input"
                      placeholder="如：最新文章"
                    />
                  </div>
                </div>

                {/* 添加新文章 */}
                <div className="content-mgmt__subsection">
                  <h4 className="content-mgmt__subsection-title">添加新文章</h4>

                  {/* URL 输入 + 抓取 */}
                  <div className="content-mgmt__url-bar">
                    <div className="content-mgmt__url-input-wrap">
                      <Link2 size={16} className="content-mgmt__url-icon" />
                      <input
                        type="text"
                        value={articleUrl}
                        onChange={(e) => {
                          setArticleUrl(e.target.value);
                          setFetchError('');
                        }}
                        className="content-mgmt__input content-mgmt__url-input"
                        placeholder="粘贴微信公众号文章链接…"
                        disabled={fetchingArticle}
                      />
                    </div>
                    <button
                      className="btn btn-primary content-mgmt__fetch-btn"
                      disabled={!articleUrl.trim() || fetchingArticle}
                      onClick={async () => {
                        setFetchingArticle(true);
                        setFetchError('');
                        try {
                          const result = await fetchAndParseArticle(articleUrl.trim());
                          setEditingArticle({
                            id: `user-${Date.now()}`,
                            ...result,
                          });
                          setEditingArticleId(null);
                        } catch (err) {
                          setFetchError(err.message);
                        } finally {
                          setFetchingArticle(false);
                        }
                      }}
                    >
                      {fetchingArticle ? (
                        <><Loader2 size={16} className="content-mgmt__spinner" /> 提取中…</>
                      ) : (
                        <>提取文章</>
                      )}
                    </button>
                  </div>

                  {fetchError && (
                    <div className="content-mgmt__error">
                      <AlertCircle size={14} />
                      <span>{fetchError}</span>
                    </div>
                  )}

                  {/* 手动添加按钮 */}
                  {!editingArticle && (
                    <button
                      className="content-mgmt__add-btn"
                      style={{ marginTop: 'var(--space-md)' }}
                      onClick={() => {
                        setEditingArticle({
                          id: `user-${Date.now()}`,
                          title: '',
                          rawTitle: '',
                          date: new Date().toISOString().split('T')[0],
                          author: 'RIEMer Land',
                          category: '经验分享',
                          tags: [],
                          excerpt: '',
                          url: '',
                          content: '',
                        });
                        setEditingArticleId(null);
                      }}
                    >
                      <Plus size={16} /> 手动添加文章
                    </button>
                  )}

                  {/* 编辑表单（新建 / 从链接提取后编辑） */}
                  {editingArticle && !editingArticleId && (
                    <div className="content-mgmt__article-form">
                      <div className="content-mgmt__article-form-header">
                        <h4>{editingArticle.url ? '提取结果（可编辑）' : '新建文章'}</h4>
                        <button
                          className="content-mgmt__edit-btn"
                          onClick={() => setEditingArticle(null)}
                          title="取消"
                        >
                          <X size={14} />
                        </button>
                      </div>

                      {editingArticle.rawTitle && editingArticle.rawTitle !== editingArticle.title && (
                        <div className="content-mgmt__hint" style={{ marginBottom: 'var(--space-md)' }}>
                          <AlertCircle size={14} />
                          <span>原标题「{editingArticle.rawTitle}」已自动删减前缀</span>
                        </div>
                      )}

                      <div className="content-mgmt__field">
                        <label>标题</label>
                        <input
                          type="text"
                          value={editingArticle.title}
                          onChange={(e) => setEditingArticle({ ...editingArticle, title: e.target.value })}
                          className="content-mgmt__input"
                          placeholder="文章标题"
                        />
                      </div>

                      <div className="content-mgmt__inline-group">
                        <div className="content-mgmt__field content-mgmt__field--flex">
                          <label><Calendar size={14} /> 发布日期</label>
                          <input
                            type="date"
                            value={editingArticle.date}
                            onChange={(e) => setEditingArticle({ ...editingArticle, date: e.target.value })}
                            className="content-mgmt__input"
                          />
                        </div>
                        <div className="content-mgmt__field content-mgmt__field--flex">
                          <label>分类</label>
                          <input
                            type="text"
                            value={editingArticle.category}
                            onChange={(e) => setEditingArticle({ ...editingArticle, category: e.target.value })}
                            className="content-mgmt__input"
                            placeholder="如：听 RIEMer 说系列"
                          />
                        </div>
                      </div>

                      <div className="content-mgmt__field content-mgmt__field--ai">
                        <label>
                          <Tag size={14} /> 标签（逗号分隔）
                          {editingArticle.url && <span className="content-mgmt__ai-badge">✨ AI 生成 · 可修改</span>}
                        </label>
                        <input
                          type="text"
                          value={editingArticle.tags.join('、')}
                          onChange={(e) => setEditingArticle({
                            ...editingArticle,
                            tags: e.target.value.split(/[,，、]/).map(t => t.trim()).filter(Boolean),
                          })}
                          className="content-mgmt__input"
                          placeholder="如：保研、经验分享、学术"
                        />
                      </div>

                      <div className="content-mgmt__field content-mgmt__field--ai">
                        <label>
                          摘要（首页卡片展示）
                          {editingArticle.url && <span className="content-mgmt__ai-badge">✨ AI 生成 · 可修改</span>}
                        </label>
                        <textarea
                          value={editingArticle.excerpt}
                          onChange={(e) => setEditingArticle({ ...editingArticle, excerpt: e.target.value })}
                          className="content-mgmt__input content-mgmt__textarea"
                          rows={3}
                          placeholder="AI 自动生成的智能摘要，也可手动修改"
                        />
                      </div>

                      {editingArticle.url && (
                        <div className="content-mgmt__field">
                          <label><Link2 size={14} /> 原文链接</label>
                          <input
                            type="text"
                            value={editingArticle.url}
                            onChange={(e) => setEditingArticle({ ...editingArticle, url: e.target.value })}
                            className="content-mgmt__input"
                            placeholder="公众号文章链接"
                          />
                        </div>
                      )}

                      <div className="content-mgmt__article-form-actions">
                        <button
                          className="btn btn-primary content-mgmt__confirm-btn"
                          disabled={!editingArticle.title.trim()}
                          onClick={() => {
                            addArticle(editingArticle);
                            setEditingArticle(null);
                            setArticleUrl('');
                          }}
                        >
                          <CheckCircle size={18} /> 确认添加文章
                        </button>
                        <button
                          className="btn btn-ghost"
                          onClick={() => setEditingArticle(null)}
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* 已添加的文章列表 */}
                {userArticles.length > 0 && (
                  <div className="content-mgmt__subsection">
                    <h4 className="content-mgmt__subsection-title">
                      已添加文章（{userArticles.length}）
                    </h4>
                    {userArticles.map((article) => (
                      <div key={article.id} className="content-mgmt__card">
                        <div className="content-mgmt__card-header">
                          <div className="content-mgmt__article-meta">
                            <span className="badge badge-primary">{article.category}</span>
                            <span className="content-mgmt__article-date">{article.date}</span>
                          </div>
                          <div className="content-mgmt__card-header-actions">
                            {article.url && (
                              <a
                                href={article.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="content-mgmt__edit-btn"
                                title="查看原文"
                              >
                                <ExternalLink size={14} />
                              </a>
                            )}
                            <button
                              className="content-mgmt__edit-btn"
                              onClick={() => {
                                if (editingArticleId === article.id) {
                                  setEditingArticleId(null);
                                  setEditingArticle(null);
                                } else {
                                  setEditingArticleId(article.id);
                                  setEditingArticle({ ...article });
                                }
                              }}
                              title={editingArticleId === article.id ? '收起' : '编辑'}
                            >
                              {editingArticleId === article.id ? <X size={14} /> : <Pencil size={14} />}
                            </button>
                            <button
                              className="content-mgmt__remove-btn"
                              onClick={() => {
                                if (window.confirm(`确定删除「${article.title}」？`)) {
                                  deleteArticle(article.id);
                                  if (editingArticleId === article.id) {
                                    setEditingArticleId(null);
                                    setEditingArticle(null);
                                  }
                                }
                              }}
                              title="删除"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>

                        {editingArticleId === article.id && editingArticle ? (
                          <>
                            <div className="content-mgmt__field">
                              <label>标题</label>
                              <input
                                type="text"
                                value={editingArticle.title}
                                onChange={(e) => setEditingArticle({ ...editingArticle, title: e.target.value })}
                                className="content-mgmt__input"
                              />
                            </div>
                            <div className="content-mgmt__inline-group">
                              <div className="content-mgmt__field content-mgmt__field--flex">
                                <label>日期</label>
                                <input
                                  type="date"
                                  value={editingArticle.date}
                                  onChange={(e) => setEditingArticle({ ...editingArticle, date: e.target.value })}
                                  className="content-mgmt__input"
                                />
                              </div>
                              <div className="content-mgmt__field content-mgmt__field--flex">
                                <label>分类</label>
                                <input
                                  type="text"
                                  value={editingArticle.category}
                                  onChange={(e) => setEditingArticle({ ...editingArticle, category: e.target.value })}
                                  className="content-mgmt__input"
                                />
                              </div>
                            </div>
                            <div className="content-mgmt__field content-mgmt__field--ai">
                              <label>
                                <Tag size={14} /> 标签
                                <span className="content-mgmt__ai-badge">✨ AI 生成 · 可修改</span>
                              </label>
                              <input
                                type="text"
                                value={editingArticle.tags.join('、')}
                                onChange={(e) => setEditingArticle({
                                  ...editingArticle,
                                  tags: e.target.value.split(/[,，、]/).map(t => t.trim()).filter(Boolean),
                                })}
                                className="content-mgmt__input"
                                placeholder="如：保研、经验分享、学术"
                              />
                            </div>
                            <div className="content-mgmt__field content-mgmt__field--ai">
                              <label>
                                摘要
                                <span className="content-mgmt__ai-badge">✨ AI 生成 · 可修改</span>
                              </label>
                              <textarea
                                value={editingArticle.excerpt}
                                onChange={(e) => setEditingArticle({ ...editingArticle, excerpt: e.target.value })}
                                className="content-mgmt__input content-mgmt__textarea"
                                rows={3}
                                placeholder="AI 自动生成的智能摘要，也可手动修改"
                              />
                            </div>
                            <button
                              className="btn btn-primary content-mgmt__confirm-btn"
                              onClick={() => {
                                updateArticle(article.id, editingArticle);
                                setEditingArticleId(null);
                                setEditingArticle(null);
                              }}
                            >
                              <CheckCircle size={18} /> 确认保存修改
                            </button>
                          </>
                        ) : (
                          <div className="content-mgmt__article-summary">
                            <h5 className="content-mgmt__article-title">{article.title}</h5>
                            <p className="content-mgmt__article-excerpt">{article.excerpt}</p>
                            {article.tags.length > 0 && (
                              <div className="content-mgmt__article-tags">
                                {article.tags.map((tag) => (
                                  <span key={tag} className="content-mgmt__article-tag">{tag}</span>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <div className="content-mgmt__hint">
                  <AlertCircle size={16} />
                  <span>添加的文章会自动展示在首页和文章列表页，无需额外点击「保存更改」。</span>
                </div>
              </div>
            )}

            {/* 活动管理 */}
            {activeTab === 'events' && (
              <div className="content-mgmt__section">
                <h3 className="content-mgmt__section-title">活动管理</h3>
                <p className="content-mgmt__section-desc">管理首页展示的活动信息，可为活动添加回放链接（需密码访问）</p>

                {/* 添加新活动 */}
                {!editingEvent && (
                  <button
                    className="content-mgmt__add-btn"
                    style={{ marginBottom: 'var(--space-xl)' }}
                    onClick={() => {
                      setEditingEvent({
                        id: `event-${Date.now()}`,
                        title: '',
                        date: new Date().toISOString().split('T')[0],
                        category: '分享会',
                        location: '线上',
                        leaderId: '',
                        excerpt: '',
                        hasReplay: false,
                        replayUrl: '',
                        replayPassword: '',
                      });
                      setEditingEventId(null);
                    }}
                  >
                    <Plus size={16} /> 添加活动
                  </button>
                )}

                {/* 新建活动表单 */}
                {editingEvent && !editingEventId && (
                  <div className="content-mgmt__article-form" style={{ marginBottom: 'var(--space-xl)' }}>
                    <div className="content-mgmt__article-form-header">
                      <h4>新建活动</h4>
                      <button
                        className="content-mgmt__edit-btn"
                        onClick={() => setEditingEvent(null)}
                        title="取消"
                      >
                        <X size={14} />
                      </button>
                    </div>

                    <div className="content-mgmt__field">
                      <label>活动标题</label>
                      <input
                        type="text"
                        value={editingEvent.title}
                        onChange={(e) => setEditingEvent({ ...editingEvent, title: e.target.value })}
                        className="content-mgmt__input"
                        placeholder="如：快消行业经验分享"
                      />
                    </div>

                    <div className="content-mgmt__inline-group">
                      <div className="content-mgmt__field content-mgmt__field--flex">
                        <label><Calendar size={14} /> 活动日期</label>
                        <input
                          type="date"
                          value={editingEvent.date}
                          onChange={(e) => setEditingEvent({ ...editingEvent, date: e.target.value })}
                          className="content-mgmt__input"
                        />
                      </div>
                      <div className="content-mgmt__field content-mgmt__field--flex">
                        <label>活动分类</label>
                        <select
                          value={editingEvent.category}
                          onChange={(e) => setEditingEvent({ ...editingEvent, category: e.target.value })}
                          className="content-mgmt__input"
                        >
                          <option value="分享会">分享会</option>
                          <option value="经验分享">经验分享</option>
                          <option value="团队招新">团队招新</option>
                          <option value="校园活动">校园活动</option>
                        </select>
                      </div>
                    </div>

                    <div className="content-mgmt__field">
                      <label>活动地点</label>
                      <input
                        type="text"
                        value={editingEvent.location}
                        onChange={(e) => setEditingEvent({ ...editingEvent, location: e.target.value })}
                        className="content-mgmt__input"
                        placeholder="如：线上 / 西南财经大学"
                      />
                    </div>

                    <div className="content-mgmt__field">
                      <label>活动简介</label>
                      <textarea
                        value={editingEvent.excerpt}
                        onChange={(e) => setEditingEvent({ ...editingEvent, excerpt: e.target.value })}
                        className="content-mgmt__input content-mgmt__textarea"
                        rows={3}
                        placeholder="活动的简要描述，将展示在首页卡片中"
                      />
                    </div>

                    {/* 回放设置 */}
                    <div className="content-mgmt__subsection">
                      <h4 className="content-mgmt__subsection-title">
                        <Video size={14} /> 活动回放设置
                      </h4>
                      <div className="content-mgmt__field">
                        <label className="content-mgmt__toggle-label">
                          <input
                            type="checkbox"
                            checked={editingEvent.hasReplay}
                            onChange={(e) => setEditingEvent({ ...editingEvent, hasReplay: e.target.checked })}
                            className="content-mgmt__checkbox"
                          />
                          <span>开启活动回放</span>
                        </label>
                      </div>

                      {editingEvent.hasReplay && (
                        <>
                          <div className="content-mgmt__field">
                            <label><Link2 size={14} /> 回放链接</label>
                            <input
                              type="text"
                              value={editingEvent.replayUrl}
                              onChange={(e) => setEditingEvent({ ...editingEvent, replayUrl: e.target.value })}
                              className="content-mgmt__input"
                              placeholder="粘贴回放视频链接…"
                            />
                          </div>
                          <div className="content-mgmt__field">
                            <label><Lock size={14} /> 回放密码（用户需输入密码才能查看回放）</label>
                            <input
                              type="text"
                              value={editingEvent.replayPassword}
                              onChange={(e) => setEditingEvent({ ...editingEvent, replayPassword: e.target.value })}
                              className="content-mgmt__input"
                              placeholder="设置回放访问密码"
                            />
                          </div>
                        </>
                      )}
                    </div>

                    <div className="content-mgmt__article-form-actions">
                      <button
                        className="btn btn-primary content-mgmt__confirm-btn"
                        disabled={!editingEvent.title.trim()}
                        onClick={() => {
                          addEvent(editingEvent);
                          setEditingEvent(null);
                        }}
                      >
                        <CheckCircle size={18} /> 确认添加活动
                      </button>
                      <button
                        className="btn btn-ghost"
                        onClick={() => setEditingEvent(null)}
                      >
                        取消
                      </button>
                    </div>
                  </div>
                )}

                {/* 已添加的活动列表 */}
                {events.length > 0 && (
                  <div className="content-mgmt__subsection">
                    <h4 className="content-mgmt__subsection-title">
                      活动列表（{events.length}）
                    </h4>
                    {events.map((event) => (
                      <div key={event.id} className="content-mgmt__card">
                        <div className="content-mgmt__card-header">
                          <div className="content-mgmt__article-meta">
                            <span className="badge badge-primary">{event.category}</span>
                            <span className="content-mgmt__article-date">{event.date}</span>
                            {event.hasReplay && (
                              <span className="badge" style={{ background: 'rgba(139,92,246,0.12)', color: '#8B5CF6', fontSize: 'var(--text-xs)', padding: '0.1rem 0.5rem', borderRadius: 'var(--radius-full)' }}>
                                <Video size={12} style={{ marginRight: 2, verticalAlign: -1 }} /> 有回放
                              </span>
                            )}
                          </div>
                          <div className="content-mgmt__card-header-actions">
                            <button
                              className="content-mgmt__edit-btn"
                              onClick={() => {
                                if (editingEventId === event.id) {
                                  setEditingEventId(null);
                                  setEditingEvent(null);
                                } else {
                                  setEditingEventId(event.id);
                                  setEditingEvent({ ...event });
                                }
                              }}
                              title={editingEventId === event.id ? '收起' : '编辑'}
                            >
                              {editingEventId === event.id ? <X size={14} /> : <Pencil size={14} />}
                            </button>
                            <button
                              className="content-mgmt__remove-btn"
                              onClick={() => {
                                if (window.confirm(`确定删除「${event.title}」？`)) {
                                  deleteEvent(event.id);
                                  if (editingEventId === event.id) {
                                    setEditingEventId(null);
                                    setEditingEvent(null);
                                  }
                                }
                              }}
                              title="删除"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>

                        {editingEventId === event.id && editingEvent ? (
                          <>
                            <div className="content-mgmt__field">
                              <label>活动标题</label>
                              <input
                                type="text"
                                value={editingEvent.title}
                                onChange={(e) => setEditingEvent({ ...editingEvent, title: e.target.value })}
                                className="content-mgmt__input"
                              />
                            </div>
                            <div className="content-mgmt__inline-group">
                              <div className="content-mgmt__field content-mgmt__field--flex">
                                <label>日期</label>
                                <input
                                  type="date"
                                  value={editingEvent.date}
                                  onChange={(e) => setEditingEvent({ ...editingEvent, date: e.target.value })}
                                  className="content-mgmt__input"
                                />
                              </div>
                              <div className="content-mgmt__field content-mgmt__field--flex">
                                <label>分类</label>
                                <select
                                  value={editingEvent.category}
                                  onChange={(e) => setEditingEvent({ ...editingEvent, category: e.target.value })}
                                  className="content-mgmt__input"
                                >
                                  <option value="分享会">分享会</option>
                                  <option value="经验分享">经验分享</option>
                                  <option value="团队招新">团队招新</option>
                                  <option value="校园活动">校园活动</option>
                                </select>
                              </div>
                            </div>
                            <div className="content-mgmt__field">
                              <label>活动地点</label>
                              <input
                                type="text"
                                value={editingEvent.location}
                                onChange={(e) => setEditingEvent({ ...editingEvent, location: e.target.value })}
                                className="content-mgmt__input"
                              />
                            </div>
                            <div className="content-mgmt__field">
                              <label>活动简介</label>
                              <textarea
                                value={editingEvent.excerpt}
                                onChange={(e) => setEditingEvent({ ...editingEvent, excerpt: e.target.value })}
                                className="content-mgmt__input content-mgmt__textarea"
                                rows={3}
                              />
                            </div>

                            {/* 编辑回放设置 */}
                            <div className="content-mgmt__subsection" style={{ marginTop: 'var(--space-md)' }}>
                              <h4 className="content-mgmt__subsection-title">
                                <Video size={14} /> 活动回放设置
                              </h4>
                              <div className="content-mgmt__field">
                                <label className="content-mgmt__toggle-label">
                                  <input
                                    type="checkbox"
                                    checked={editingEvent.hasReplay}
                                    onChange={(e) => setEditingEvent({ ...editingEvent, hasReplay: e.target.checked })}
                                    className="content-mgmt__checkbox"
                                  />
                                  <span>开启活动回放</span>
                                </label>
                              </div>

                              {editingEvent.hasReplay && (
                                <>
                                  <div className="content-mgmt__field">
                                    <label><Link2 size={14} /> 回放链接</label>
                                    <input
                                      type="text"
                                      value={editingEvent.replayUrl}
                                      onChange={(e) => setEditingEvent({ ...editingEvent, replayUrl: e.target.value })}
                                      className="content-mgmt__input"
                                      placeholder="粘贴回放视频链接…"
                                    />
                                  </div>
                                  <div className="content-mgmt__field">
                                    <label><Lock size={14} /> 回放密码</label>
                                    <input
                                      type="text"
                                      value={editingEvent.replayPassword}
                                      onChange={(e) => setEditingEvent({ ...editingEvent, replayPassword: e.target.value })}
                                      className="content-mgmt__input"
                                      placeholder="设置回放访问密码"
                                    />
                                  </div>
                                </>
                              )}
                            </div>

                            <button
                              className="btn btn-primary content-mgmt__confirm-btn"
                              onClick={() => {
                                updateEvent(event.id, editingEvent);
                                setEditingEventId(null);
                                setEditingEvent(null);
                              }}
                            >
                              <CheckCircle size={18} /> 确认保存修改
                            </button>
                          </>
                        ) : (
                          <div className="content-mgmt__article-summary">
                            <h5 className="content-mgmt__article-title">{event.title}</h5>
                            <p className="content-mgmt__article-excerpt">{event.excerpt}</p>
                            <div style={{ display: 'flex', gap: 'var(--space-sm)', marginTop: 'var(--space-xs)', flexWrap: 'wrap' }}>
                              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>📍 {event.location}</span>
                              {event.hasReplay && (
                                <span style={{ fontSize: 'var(--text-xs)', color: '#8B5CF6', fontWeight: 500 }}>
                                  🔗 回放链接已设置 · 密码: {event.replayPassword}
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {events.length === 0 && (
                  <div className="content-mgmt__hint">
                    <AlertCircle size={16} />
                    <span>暂无活动，点击上方按钮添加第一个活动。</span>
                  </div>
                )}

                <div className="content-mgmt__hint">
                  <AlertCircle size={16} />
                  <span>添加的活动会自动展示在首页「最新活动」区域，有回放的活动用户点击后需输入密码才能访问回放链接。</span>
                </div>
              </div>
            )}

            {/* 页脚信息 */}
            {activeTab === 'footer' && (
              <div className="content-mgmt__section">
                <h3 className="content-mgmt__section-title">页脚信息</h3>
                <p className="content-mgmt__section-desc">网站底部的联系和介绍信息</p>

                <div className="content-mgmt__field">
                  <label>简介描述</label>
                  <textarea
                    value={form.footerDescription}
                    onChange={(e) => setForm({ ...form, footerDescription: e.target.value })}
                    className="content-mgmt__input content-mgmt__textarea"
                    rows={3}
                    placeholder="页脚中的社团简介"
                  />
                </div>

                <div className="content-mgmt__field">
                  <label>
                    <Mail size={14} /> 联系邮箱
                  </label>
                  <input
                    type="email"
                    value={form.footerEmail}
                    onChange={(e) => setForm({ ...form, footerEmail: e.target.value })}
                    className="content-mgmt__input"
                    placeholder="contact@riemerland.org"
                  />
                </div>

                <div className="content-mgmt__field">
                  <label>
                    <MapPin size={14} /> 地点
                  </label>
                  <input
                    type="text"
                    value={form.footerLocation}
                    onChange={(e) => setForm({ ...form, footerLocation: e.target.value })}
                    className="content-mgmt__input"
                    placeholder="学术楼 A-301"
                  />
                </div>
              </div>
            )}

            {/* 内部空间配置 */}
            {activeTab === 'internal' && (
              <div className="content-mgmt__section">
                <h3 className="content-mgmt__section-title">内部空间配置</h3>
                <p className="content-mgmt__section-desc">自定义内部空间各页面的按钮文字和描述内容</p>

                {/* 侧边栏 */}
                <div className="content-mgmt__subsection">
                  <h4 className="content-mgmt__subsection-title">侧边栏导航</h4>
                  <div className="content-mgmt__inline-group">
                    <div className="content-mgmt__field content-mgmt__field--flex">
                      <label>导航分组标签</label>
                      <input
                        type="text"
                        value={internalForm.sidebar.sectionLabelNav}
                        onChange={(e) => setInternalForm({ ...internalForm, sidebar: { ...internalForm.sidebar, sectionLabelNav: e.target.value } })}
                        className="content-mgmt__input"
                        placeholder="导航"
                      />
                    </div>
                    <div className="content-mgmt__field content-mgmt__field--flex">
                      <label>管理分组标签</label>
                      <input
                        type="text"
                        value={internalForm.sidebar.sectionLabelAdmin}
                        onChange={(e) => setInternalForm({ ...internalForm, sidebar: { ...internalForm.sidebar, sectionLabelAdmin: e.target.value } })}
                        className="content-mgmt__input"
                        placeholder="管理"
                      />
                    </div>
                  </div>
                  <div className="content-mgmt__inline-group">
                    <div className="content-mgmt__field content-mgmt__field--flex">
                      <label>首页</label>
                      <input type="text" value={internalForm.sidebar.labelHome} onChange={(e) => setInternalForm({ ...internalForm, sidebar: { ...internalForm.sidebar, labelHome: e.target.value } })} className="content-mgmt__input" />
                    </div>
                    <div className="content-mgmt__field content-mgmt__field--flex">
                      <label>消息通知</label>
                      <input type="text" value={internalForm.sidebar.labelNotifications} onChange={(e) => setInternalForm({ ...internalForm, sidebar: { ...internalForm.sidebar, labelNotifications: e.target.value } })} className="content-mgmt__input" />
                    </div>
                  </div>
                  <div className="content-mgmt__inline-group">
                    <div className="content-mgmt__field content-mgmt__field--flex">
                      <label>文档管理</label>
                      <input type="text" value={internalForm.sidebar.labelDocuments} onChange={(e) => setInternalForm({ ...internalForm, sidebar: { ...internalForm.sidebar, labelDocuments: e.target.value } })} className="content-mgmt__input" />
                    </div>
                    <div className="content-mgmt__field content-mgmt__field--flex">
                      <label>事项追踪</label>
                      <input type="text" value={internalForm.sidebar.labelTasks} onChange={(e) => setInternalForm({ ...internalForm, sidebar: { ...internalForm.sidebar, labelTasks: e.target.value } })} className="content-mgmt__input" />
                    </div>
                  </div>
                  <div className="content-mgmt__inline-group">
                    <div className="content-mgmt__field content-mgmt__field--flex">
                      <label>成员相册</label>
                      <input type="text" value={internalForm.sidebar.labelGallery} onChange={(e) => setInternalForm({ ...internalForm, sidebar: { ...internalForm.sidebar, labelGallery: e.target.value } })} className="content-mgmt__input" />
                    </div>
                    <div className="content-mgmt__field content-mgmt__field--flex">
                      <label>用户管理</label>
                      <input type="text" value={internalForm.sidebar.labelUsers} onChange={(e) => setInternalForm({ ...internalForm, sidebar: { ...internalForm.sidebar, labelUsers: e.target.value } })} className="content-mgmt__input" />
                    </div>
                  </div>
                  <div className="content-mgmt__field">
                    <label>内容管理</label>
                    <input type="text" value={internalForm.sidebar.labelContent} onChange={(e) => setInternalForm({ ...internalForm, sidebar: { ...internalForm.sidebar, labelContent: e.target.value } })} className="content-mgmt__input" />
                  </div>
                </div>

                {/* 内部首页 */}
                <div className="content-mgmt__subsection">
                  <h4 className="content-mgmt__subsection-title">内部首页</h4>
                  <div className="content-mgmt__inline-group">
                    <div className="content-mgmt__field content-mgmt__field--flex">
                      <label>欢迎区标题</label>
                      <input type="text" value={internalForm.home.greeting} onChange={(e) => setInternalForm({ ...internalForm, home: { ...internalForm.home, greeting: e.target.value } })} className="content-mgmt__input" placeholder="RIEMer Land" />
                    </div>
                    <div className="content-mgmt__field content-mgmt__field--flex">
                      <label>欢迎后缀</label>
                      <input type="text" value={internalForm.home.welcomeSuffix} onChange={(e) => setInternalForm({ ...internalForm, home: { ...internalForm.home, welcomeSuffix: e.target.value } })} className="content-mgmt__input" placeholder="欢迎回到内部空间 ✨" />
                    </div>
                  </div>
                  <div className="content-mgmt__inline-group">
                    <div className="content-mgmt__field content-mgmt__field--flex">
                      <label>功能模块标题</label>
                      <input type="text" value={internalForm.home.sectionModules} onChange={(e) => setInternalForm({ ...internalForm, home: { ...internalForm.home, sectionModules: e.target.value } })} className="content-mgmt__input" />
                    </div>
                    <div className="content-mgmt__field content-mgmt__field--flex">
                      <label>最近消息标题</label>
                      <input type="text" value={internalForm.home.sectionRecentMessages} onChange={(e) => setInternalForm({ ...internalForm, home: { ...internalForm.home, sectionRecentMessages: e.target.value } })} className="content-mgmt__input" />
                    </div>
                  </div>
                  <div className="content-mgmt__field">
                    <label>小贴士标题</label>
                    <input type="text" value={internalForm.home.tipTitle} onChange={(e) => setInternalForm({ ...internalForm, home: { ...internalForm.home, tipTitle: e.target.value } })} className="content-mgmt__input" />
                  </div>
                  <div className="content-mgmt__field">
                    <label>小贴士内容</label>
                    <textarea value={internalForm.home.tipContent} onChange={(e) => setInternalForm({ ...internalForm, home: { ...internalForm.home, tipContent: e.target.value } })} className="content-mgmt__input content-mgmt__textarea" rows={2} />
                  </div>

                  <h4 className="content-mgmt__subsection-title" style={{ marginTop: 'var(--space-lg)' }}>功能模块卡片文字</h4>
                  {[
                    { key: 'moduleNotifications', descKey: 'moduleNotificationsDesc', label: '消息通知' },
                    { key: 'moduleDocuments', descKey: 'moduleDocumentsDesc', label: '文档管理' },
                    { key: 'moduleTasks', descKey: 'moduleTasksDesc', label: '事项追踪' },
                    { key: 'moduleGallery', descKey: 'moduleGalleryDesc', label: '成员相册' },
                    { key: 'moduleUsers', descKey: 'moduleUsersDesc', label: '用户管理' },
                    { key: 'moduleContent', descKey: 'moduleContentDesc', label: '内容管理' },
                  ].map((item) => (
                    <div key={item.key} className="content-mgmt__inline-group">
                      <div className="content-mgmt__field content-mgmt__field--flex">
                        <label>{item.label} 名称</label>
                        <input type="text" value={internalForm.home[item.key]} onChange={(e) => setInternalForm({ ...internalForm, home: { ...internalForm.home, [item.key]: e.target.value } })} className="content-mgmt__input" />
                      </div>
                      <div className="content-mgmt__field content-mgmt__field--flex">
                        <label>{item.label} 描述</label>
                        <input type="text" value={internalForm.home[item.descKey]} onChange={(e) => setInternalForm({ ...internalForm, home: { ...internalForm.home, [item.descKey]: e.target.value } })} className="content-mgmt__input" />
                      </div>
                    </div>
                  ))}
                </div>

                {/* 各页面标题和按钮 */}
                <div className="content-mgmt__subsection">
                  <h4 className="content-mgmt__subsection-title">各页面标题与按钮</h4>

                  {/* 文档管理 */}
                  <div className="content-mgmt__card">
                    <div className="content-mgmt__card-header">
                      <span className="content-mgmt__card-index">文档管理页</span>
                    </div>
                    <div className="content-mgmt__inline-group">
                      <div className="content-mgmt__field content-mgmt__field--flex">
                        <label>页面标题</label>
                        <input type="text" value={internalForm.documents.pageTitle} onChange={(e) => setInternalForm({ ...internalForm, documents: { ...internalForm.documents, pageTitle: e.target.value } })} className="content-mgmt__input" />
                      </div>
                      <div className="content-mgmt__field content-mgmt__field--flex">
                        <label>上传按钮</label>
                        <input type="text" value={internalForm.documents.uploadBtn} onChange={(e) => setInternalForm({ ...internalForm, documents: { ...internalForm.documents, uploadBtn: e.target.value } })} className="content-mgmt__input" />
                      </div>
                    </div>
                    <div className="content-mgmt__field" style={{ marginBottom: 0 }}>
                      <label>页面描述</label>
                      <input type="text" value={internalForm.documents.pageDesc} onChange={(e) => setInternalForm({ ...internalForm, documents: { ...internalForm.documents, pageDesc: e.target.value } })} className="content-mgmt__input" />
                    </div>
                  </div>

                  {/* 事项追踪 */}
                  <div className="content-mgmt__card">
                    <div className="content-mgmt__card-header">
                      <span className="content-mgmt__card-index">事项追踪页</span>
                    </div>
                    <div className="content-mgmt__inline-group">
                      <div className="content-mgmt__field content-mgmt__field--flex">
                        <label>页面标题</label>
                        <input type="text" value={internalForm.tasks.pageTitle} onChange={(e) => setInternalForm({ ...internalForm, tasks: { ...internalForm.tasks, pageTitle: e.target.value } })} className="content-mgmt__input" />
                      </div>
                      <div className="content-mgmt__field content-mgmt__field--flex">
                        <label>新建按钮</label>
                        <input type="text" value={internalForm.tasks.newTaskBtn} onChange={(e) => setInternalForm({ ...internalForm, tasks: { ...internalForm.tasks, newTaskBtn: e.target.value } })} className="content-mgmt__input" />
                      </div>
                    </div>
                    <div className="content-mgmt__field" style={{ marginBottom: 0 }}>
                      <label>页面描述</label>
                      <input type="text" value={internalForm.tasks.pageDesc} onChange={(e) => setInternalForm({ ...internalForm, tasks: { ...internalForm.tasks, pageDesc: e.target.value } })} className="content-mgmt__input" />
                    </div>
                  </div>

                  {/* 成员相册 */}
                  <div className="content-mgmt__card">
                    <div className="content-mgmt__card-header">
                      <span className="content-mgmt__card-index">成员相册页</span>
                    </div>
                    <div className="content-mgmt__inline-group">
                      <div className="content-mgmt__field content-mgmt__field--flex">
                        <label>页面标题</label>
                        <input type="text" value={internalForm.gallery.pageTitle} onChange={(e) => setInternalForm({ ...internalForm, gallery: { ...internalForm.gallery, pageTitle: e.target.value } })} className="content-mgmt__input" />
                      </div>
                      <div className="content-mgmt__field content-mgmt__field--flex">
                        <label>新建按钮</label>
                        <input type="text" value={internalForm.gallery.newAlbumBtn} onChange={(e) => setInternalForm({ ...internalForm, gallery: { ...internalForm.gallery, newAlbumBtn: e.target.value } })} className="content-mgmt__input" />
                      </div>
                    </div>
                    <div className="content-mgmt__field" style={{ marginBottom: 0 }}>
                      <label>页面描述</label>
                      <input type="text" value={internalForm.gallery.pageDesc} onChange={(e) => setInternalForm({ ...internalForm, gallery: { ...internalForm.gallery, pageDesc: e.target.value } })} className="content-mgmt__input" />
                    </div>
                  </div>

                  {/* 消息通知 */}
                  <div className="content-mgmt__card">
                    <div className="content-mgmt__card-header">
                      <span className="content-mgmt__card-index">消息通知页</span>
                    </div>
                    <div className="content-mgmt__inline-group">
                      <div className="content-mgmt__field content-mgmt__field--flex">
                        <label>页面标题</label>
                        <input type="text" value={internalForm.notifications.pageTitle} onChange={(e) => setInternalForm({ ...internalForm, notifications: { ...internalForm.notifications, pageTitle: e.target.value } })} className="content-mgmt__input" />
                      </div>
                      <div className="content-mgmt__field content-mgmt__field--flex">
                        <label>全部已读按钮</label>
                        <input type="text" value={internalForm.notifications.markAllReadBtn} onChange={(e) => setInternalForm({ ...internalForm, notifications: { ...internalForm.notifications, markAllReadBtn: e.target.value } })} className="content-mgmt__input" />
                      </div>
                    </div>
                  </div>

                  {/* 用户管理 */}
                  <div className="content-mgmt__card">
                    <div className="content-mgmt__card-header">
                      <span className="content-mgmt__card-index">用户管理页</span>
                    </div>
                    <div className="content-mgmt__field">
                      <label>页面标题</label>
                      <input type="text" value={internalForm.users.pageTitle} onChange={(e) => setInternalForm({ ...internalForm, users: { ...internalForm.users, pageTitle: e.target.value } })} className="content-mgmt__input" />
                    </div>
                    <div className="content-mgmt__field" style={{ marginBottom: 0 }}>
                      <label>页面描述</label>
                      <input type="text" value={internalForm.users.pageDesc} onChange={(e) => setInternalForm({ ...internalForm, users: { ...internalForm.users, pageDesc: e.target.value } })} className="content-mgmt__input" />
                    </div>
                  </div>
                </div>

                <div className="content-mgmt__hint">
                  <AlertCircle size={16} />
                  <span>修改后请点击顶部「保存更改」按钮，内部空间的文字将即时生效。</span>
                </div>
              </div>
            )}

            {/* 网站建设建议 */}
            {activeTab === 'suggestions' && (
              <div className="content-mgmt__section">
                <h3 className="content-mgmt__section-title">网站建设建议</h3>
                <p className="content-mgmt__section-desc">收集和追踪网站改进建议的进度</p>

                {/* 添加新建议 */}
                {!editingSuggestion && (
                  <button
                    className="content-mgmt__add-btn"
                    style={{ marginBottom: 'var(--space-xl)' }}
                    onClick={() => {
                      setEditingSuggestion({
                        id: `sug-${Date.now()}`,
                        content: '',
                        proposer: '',
                        status: '修复中',
                        statusUpdatedAt: new Date().toISOString().split('T')[0],
                        statusUpdatedBy: '',
                        statusUpdatedByAvatar: null,
                        createdAt: new Date().toISOString().split('T')[0],
                        resolver: '',
                        skipReason: '',
                      });
                      setEditingSuggestionId(null);
                    }}
                  >
                    <Plus size={16} /> 添加建议
                  </button>
                )}

                {/* 新建表单 */}
                {editingSuggestion && !editingSuggestionId && (
                  <div className="content-mgmt__article-form" style={{ marginBottom: 'var(--space-xl)' }}>
                    <div className="content-mgmt__article-form-header">
                      <h4>新建建议</h4>
                      <button
                        className="content-mgmt__edit-btn"
                        onClick={() => setEditingSuggestion(null)}
                        title="取消"
                      >
                        <X size={14} />
                      </button>
                    </div>

                    <div className="content-mgmt__field">
                      <label>具体建议</label>
                      <textarea
                        value={editingSuggestion.content}
                        onChange={(e) => setEditingSuggestion({ ...editingSuggestion, content: e.target.value })}
                        className="content-mgmt__input content-mgmt__textarea"
                        rows={3}
                        placeholder="描述你的网站改进建议…"
                      />
                    </div>

                    <div className="content-mgmt__inline-group">
                      <div className="content-mgmt__field content-mgmt__field--flex">
                        <label><User size={14} /> 提出人</label>
                        <input
                          type="text"
                          value={editingSuggestion.proposer}
                          onChange={(e) => setEditingSuggestion({ ...editingSuggestion, proposer: e.target.value })}
                          className="content-mgmt__input"
                          placeholder="你的姓名"
                        />
                      </div>
                      <div className="content-mgmt__field content-mgmt__field--flex">
                        <label><Calendar size={14} /> 提出时间</label>
                        <input
                          type="date"
                          value={editingSuggestion.createdAt}
                          onChange={(e) => setEditingSuggestion({ ...editingSuggestion, createdAt: e.target.value })}
                          className="content-mgmt__input"
                        />
                      </div>
                    </div>

                    <div className="content-mgmt__inline-group">
                      <div className="content-mgmt__field content-mgmt__field--flex">
                        <label>当前状态</label>
                        <select
                          value={editingSuggestion.status}
                          onChange={(e) => setEditingSuggestion({ ...editingSuggestion, status: e.target.value })}
                          className="content-mgmt__input"
                        >
                          <option value="修复中">修复中</option>
                          <option value="已修复">已修复</option>
                          <option value="暂时不做">暂时不做</option>
                        </select>
                      </div>
                      <div className="content-mgmt__field content-mgmt__field--flex">
                        <label>解决人</label>
                        <input
                          type="text"
                          value={editingSuggestion.resolver}
                          onChange={(e) => setEditingSuggestion({ ...editingSuggestion, resolver: e.target.value })}
                          className="content-mgmt__input"
                          placeholder="负责处理此建议的成员"
                        />
                      </div>
                    </div>

                    {editingSuggestion.status === '暂时不做' && (
                      <div className="content-mgmt__field">
                        <label><AlertCircle size={14} /> 暂不处理原因</label>
                        <textarea
                          value={editingSuggestion.skipReason}
                          onChange={(e) => setEditingSuggestion({ ...editingSuggestion, skipReason: e.target.value })}
                          className="content-mgmt__input content-mgmt__textarea"
                          rows={2}
                          placeholder="请说明暂时不做的原因…"
                        />
                      </div>
                    )}

                    <div className="content-mgmt__article-form-actions">
                      <button
                        className="btn btn-primary"
                        disabled={!editingSuggestion.content.trim() || !editingSuggestion.proposer.trim()}
                        onClick={() => {
                          addSuggestion({
                            ...editingSuggestion,
                            statusUpdatedBy: editingSuggestion.proposer,
                            statusUpdatedByAvatar: sugAvatarUrl(editingSuggestion.proposer),
                          });
                          // 新建建议时自动发送已读通知
                          addNotification({
                            title: '新建设建议',
                            message: `${editingSuggestion.proposer} 提出了建议：${editingSuggestion.content.slice(0, 40)}${editingSuggestion.content.length > 40 ? '…' : ''}`,
                            type: 'system',
                            read: true,
                          });
                          setEditingSuggestion(null);
                        }}
                      >
                        <Plus size={16} /> 添加建议
                      </button>
                      <button
                        className="btn btn-ghost"
                        onClick={() => setEditingSuggestion(null)}
                      >
                        取消
                      </button>
                    </div>
                  </div>
                )}

                {/* 建议列表表格 */}
                {suggestions.length > 0 && (
                  <div className="sug-table-wrap">
                    <table className="sug-table">
                      <thead>
                        <tr>
                          <th className="sug-table__th">具体建议</th>
                          <th className="sug-table__th">提出人</th>
                          <th className="sug-table__th">当前状态</th>
                          <th className="sug-table__th">提出时间</th>
                          <th className="sug-table__th">状态更新时间</th>
                          <th className="sug-table__th">解决人</th>
                          <th className="sug-table__th">操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {suggestions.map((sug) => (
                          editingSuggestionId === sug.id && editingSuggestion ? (
                            <tr key={sug.id} className="sug-table__row sug-table__row--editing">
                              <td colSpan={7} className="sug-table__td sug-table__td--edit">
                                <div className="sug-edit-form">
                                  <div className="content-mgmt__field">
                                    <label>具体建议</label>
                                    <textarea
                                      value={editingSuggestion.content}
                                      onChange={(e) => setEditingSuggestion({ ...editingSuggestion, content: e.target.value })}
                                      className="content-mgmt__input content-mgmt__textarea"
                                      rows={2}
                                    />
                                  </div>
                                  <div className="content-mgmt__inline-group">
                                    <div className="content-mgmt__field content-mgmt__field--flex">
                                      <label>提出人</label>
                                      <input type="text" value={editingSuggestion.proposer} onChange={(e) => setEditingSuggestion({ ...editingSuggestion, proposer: e.target.value })} className="content-mgmt__input" />
                                    </div>
                                    <div className="content-mgmt__field content-mgmt__field--flex">
                                      <label>当前状态</label>
                                      <select value={editingSuggestion.status} onChange={(e) => setEditingSuggestion({ ...editingSuggestion, status: e.target.value })} className="content-mgmt__input">
                                        <option value="修复中">修复中</option>
                                        <option value="已修复">已修复</option>
                                        <option value="暂时不做">暂时不做</option>
                                      </select>
                                    </div>
                                  </div>
                                  <div className="content-mgmt__inline-group">
                                    <div className="content-mgmt__field content-mgmt__field--flex">
                                      <label>解决人</label>
                                      <input type="text" value={editingSuggestion.resolver} onChange={(e) => setEditingSuggestion({ ...editingSuggestion, resolver: e.target.value })} className="content-mgmt__input" />
                                    </div>
                                    <div className="content-mgmt__field content-mgmt__field--flex">
                                      <label>状态更新人（显示头像）</label>
                                      <input type="text" value={editingSuggestion.statusUpdatedBy} onChange={(e) => setEditingSuggestion({ ...editingSuggestion, statusUpdatedBy: e.target.value })} className="content-mgmt__input" placeholder="谁更新了这个状态" />
                                    </div>
                                  </div>
                                  {editingSuggestion.status === '暂时不做' && (
                                    <div className="content-mgmt__field">
                                      <label>暂不处理原因</label>
                                      <textarea
                                        value={editingSuggestion.skipReason}
                                        onChange={(e) => setEditingSuggestion({ ...editingSuggestion, skipReason: e.target.value })}
                                        className="content-mgmt__input content-mgmt__textarea"
                                        rows={2}
                                        placeholder="请说明暂时不做的原因…"
                                      />
                                    </div>
                                  )}
                                  <div className="content-mgmt__article-form-actions">
                                    <button
                                      className="btn btn-primary"
                                      onClick={() => {
                                        const oldSug = suggestions.find(s => s.id === sug.id);
                                        updateSuggestion(sug.id, {
                                          ...editingSuggestion,
                                          statusUpdatedAt: new Date().toISOString().split('T')[0],
                                          statusUpdatedByAvatar: sugAvatarUrl(editingSuggestion.statusUpdatedBy),
                                        });
                                        // 状态变更时自动发送已读通知
                                        if (oldSug && oldSug.status !== editingSuggestion.status) {
                                          addNotification({
                                            title: '建设建议状态变更',
                                            message: `建议「${editingSuggestion.content.slice(0, 30)}${editingSuggestion.content.length > 30 ? '…' : ''}」状态：${oldSug.status} → ${editingSuggestion.status}`,
                                            type: 'system',
                                            read: true,
                                          });
                                        }
                                        setEditingSuggestionId(null);
                                        setEditingSuggestion(null);
                                      }}
                                    >
                                      <Save size={14} /> 保存
                                    </button>
                                    <button
                                      className="btn btn-ghost"
                                      onClick={() => { setEditingSuggestionId(null); setEditingSuggestion(null); }}
                                    >
                                      取消
                                    </button>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          ) : (
                            <tr key={sug.id} className="sug-table__row">
                              <td className="sug-table__td sug-table__td--content">
                                <span>{sug.content}</span>
                                {sug.status === '暂时不做' && sug.skipReason && (
                                  <span className="sug-table__skip-reason">
                                    <AlertCircle size={12} /> {sug.skipReason}
                                  </span>
                                )}
                              </td>
                              <td className="sug-table__td">
                                <span className="sug-table__person">
                                  <img src={sugAvatarUrl(sug.proposer)} alt={sug.proposer} className="sug-table__avatar" />
                                  {sug.proposer}
                                </span>
                              </td>
                              <td className="sug-table__td">
                                <span className={`sug-table__status sug-table__status--${sug.status === '已修复' ? 'done' : sug.status === '修复中' ? 'wip' : 'skip'}`}>
                                  {sug.status}
                                </span>
                              </td>
                              <td className="sug-table__td sug-table__td--date">{sug.createdAt}</td>
                              <td className="sug-table__td sug-table__td--date">
                                <span className="sug-table__person">
                                  {sug.statusUpdatedByAvatar || sugAvatarUrl(sug.statusUpdatedBy) ? (
                                    <img src={sug.statusUpdatedByAvatar || sugAvatarUrl(sug.statusUpdatedBy)} alt={sug.statusUpdatedBy} className="sug-table__avatar" />
                                  ) : null}
                                  <span>
                                    <span className="sug-table__date-text">{sug.statusUpdatedAt}</span>
                                    {sug.statusUpdatedBy && <span className="sug-table__updater">by {sug.statusUpdatedBy}</span>}
                                  </span>
                                </span>
                              </td>
                              <td className="sug-table__td">
                                {sug.resolver ? (
                                  <span className="sug-table__person">
                                    <img src={sugAvatarUrl(sug.resolver)} alt={sug.resolver} className="sug-table__avatar" />
                                    {sug.resolver}
                                  </span>
                                ) : (
                                  <span className="sug-table__empty">未指派</span>
                                )}
                              </td>
                              <td className="sug-table__td sug-table__td--actions">
                                <button
                                  className="content-mgmt__edit-btn"
                                  onClick={() => {
                                    setEditingSuggestionId(sug.id);
                                    setEditingSuggestion({ ...sug });
                                  }}
                                  title="编辑"
                                >
                                  <Pencil size={14} />
                                </button>
                                <button
                                  className="content-mgmt__remove-btn"
                                  onClick={() => {
                                    if (window.confirm(`确定删除这条建议吗？`)) {
                                      deleteSuggestion(sug.id);
                                    }
                                  }}
                                  title="删除"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </td>
                            </tr>
                          )
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {suggestions.length === 0 && (
                  <div className="content-mgmt__hint">
                    <AlertCircle size={16} />
                    <span>暂无建议，点击上方按钮添加第一条网站建设建议。</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}