import { useState, useCallback, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useSiteContent } from '../../contexts/SiteContentContext';
import { useWysiwyg } from '../../contexts/WysiwygContext';
import EditableText from '../../components/EditableText';
import ViewLogPopover from '../../components/ViewLogPopover';
import { fetchViewLog } from '../../lib/documentsService';
import { pinyinMatch } from '../../utils/pinyinSearch';
import {
  fetchSharings,
  subscribeSharings,
  updateSharing,
  deleteSharing,
  migrateLocalSharingsToDb,
  fetchCategories,
  addCategory as addCategoryRemote,
  updateCategory as updateCategoryRemote,
  deleteCategory as deleteCategoryRemote,
  subscribeCategories,
  DEFAULT_CATEGORIES,
} from '../../services/memberSharingService';
import {
  Share2,
  Plus,
  Search,
  Clock,
  User,
  Eye,
  Trash2,
  FileText,
  Code2,
  ThumbsUp,
  ExternalLink,
  Settings2,
  X,
  Check,
  Pencil,
  Palette,
  Paperclip,
} from 'lucide-react';
import './MemberSharing.css';

const SHARING_VIEWS_KEY = 'riemer_sharing_views';

// 预设颜色供选择
const PRESET_COLORS = [
  '#5EAD8C', '#4FBFC4', '#EC4899', '#F59E0B', '#8B5CF6',
  '#EF4444', '#3B82F6', '#10B981', '#F97316', '#6366F1',
  '#14B8A6', '#E11D48', '#0EA5E9', '#84CC16', '#A855F7',
];

// 从分类数组构建 label / color 映射
function buildCategoryMaps(cats) {
  const labels = {};
  const colors = {};
  cats.forEach((c) => {
    labels[c.key] = c.label;
    colors[c.key] = c.color;
  });
  return { labels, colors };
}

function loadViews() {
  try {
    const stored = localStorage.getItem(SHARING_VIEWS_KEY);
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return {};
}

export default function MemberSharing() {
  const { isAuthenticated, isAdmin, user, getAllUsers } = useAuth();
  const { internalConfig, updateInternalConfig } = useSiteContent();
  useWysiwyg();

  // 访问记录弹层：viewLogPost 保存当前查看日志的分享帖
  const [viewLogPost, setViewLogPost] = useState(null);

  // 访问者真名映射
  const [userNameMap, setUserNameMap] = useState({});
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = (await getAllUsers?.()) || [];
        if (cancelled) return;
        const map = {};
        list.forEach((u) => {
          if (u?.id) map[u.id] = u.name || u.nickname || '';
        });
        setUserNameMap(map);
      } catch { /* ignore */ }
    })();
    return () => {
      cancelled = true;
    };
  }, [getAllUsers]);

  const resolveVisitorName = useCallback(
    (uid, fallback) => {
      if (uid && userNameMap[uid]) return userNameMap[uid];
      if (uid && user?.id === uid && (user.name || user.nickname)) {
        return user.name || user.nickname;
      }
      return fallback || '访客';
    },
    [userNameMap, user],
  );

  const sc = internalConfig.memberSharing || {};
  const updateSC = useCallback(
    (key, val) => updateInternalConfig({ memberSharing: { [key]: val } }),
    [updateInternalConfig],
  );

  const [sharings, setSharings] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('全部');
  const views = loadViews();

  // 动态分类管理
  const [categoryList, setCategoryList] = useState(DEFAULT_CATEGORIES);
  const { labels: categoryLabels, colors: categoryColors } = buildCategoryMaps(categoryList);

  // 首次加载：从云端拉取分享 + 分类，并把本地已有的旧数据一次性迁移到云端
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // 先把 localStorage 的旧数据迁到云端（幂等、只在云端可用时生效）
        await migrateLocalSharingsToDb();
      } catch { /* ignore */ }
      if (cancelled) return;
      try {
        const [list, cats] = await Promise.all([fetchSharings(), fetchCategories()]);
        if (cancelled) return;
        setSharings(list);
        if (cats && cats.length > 0) setCategoryList(cats);
      } catch (err) {
        console.warn('[MemberSharing] 初次加载失败:', err);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // 订阅 member_sharing 表实时变更
  useEffect(() => {
    const unsubscribe = subscribeSharings(({ type, newItem, oldItem }) => {
      if (type === 'INSERT' && newItem) {
        setSharings((prev) => {
          if (prev.some((s) => String(s.id) === String(newItem.id))) return prev;
          return [newItem, ...prev];
        });
      } else if (type === 'UPDATE' && newItem) {
        setSharings((prev) =>
          prev.map((s) => (String(s.id) === String(newItem.id) ? { ...s, ...newItem } : s)),
        );
      } else if (type === 'DELETE' && oldItem) {
        setSharings((prev) => prev.filter((s) => String(s.id) !== String(oldItem.id)));
      }
    });
    return () => unsubscribe();
  }, []);

  // 订阅分类变更
  useEffect(() => {
    const unsubscribe = subscribeCategories(() => {
      fetchCategories().then((cats) => {
        if (cats && cats.length > 0) setCategoryList(cats);
      }).catch(() => { /* ignore */ });
    });
    return () => unsubscribe();
  }, []);

  // 分类管理面板状态
  const [showCatManager, setShowCatManager] = useState(false);
  const [newCatLabel, setNewCatLabel] = useState('');
  const [newCatColor, setNewCatColor] = useState(PRESET_COLORS[0]);
  // 编辑中的分类（仅管理员）
  const [editingCatKey, setEditingCatKey] = useState(null);
  const [editCatLabel, setEditCatLabel] = useState('');
  const [editCatColor, setEditCatColor] = useState('');
  // 就地新增分类（对齐流程模板文件页，所有成员可用；管理员还可在分类标签上就地编辑/删除）
  const [showInlineAddCat, setShowInlineAddCat] = useState(false);

  if (!isAuthenticated) return <Navigate to="/login" replace />;

  const categories = ['全部', ...categoryList.map((c) => c.key)];

  // 新建分类（所有成员可用）
  const handleAddCategory = () => {
    const label = newCatLabel.trim();
    if (!label) return;
    // 检查重名
    if (categoryList.some((c) => c.label === label)) {
      alert('该分类名称已存在');
      return;
    }
    const key = 'cat_' + Date.now();
    const cat = { key, label, color: newCatColor };
    // 乐观更新本地 UI
    setCategoryList((prev) => [...prev, cat]);
    // 立即写云端；失败时回滚本地并弹窗，避免"本地看得见 → 刷新就消失"的假象
    addCategoryRemote(cat).then((res) => {
      if (!res?.success) {
        setCategoryList((prev) => prev.filter((c) => c.key !== cat.key));
        alert(
          `新增分类失败，已回滚。原因：${res?.error || '未知错误'}\n` +
          `若提示"relation does not exist"，请在 Supabase 里执行 supabase-member-sharing.sql。`
        );
      }
    });
    setNewCatLabel('');
    setNewCatColor(PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)]);
  };

  // 开始编辑分类（仅管理员）
  const startEditCategory = (cat) => {
    setEditingCatKey(cat.key);
    setEditCatLabel(cat.label);
    setEditCatColor(cat.color);
  };

  // 保存编辑（仅管理员）
  const saveEditCategory = () => {
    if (!editCatLabel.trim()) return;
    const label = editCatLabel.trim();
    const color = editCatColor;
    // 记录旧值用于回滚
    const prevCat = categoryList.find((c) => c.key === editingCatKey);
    setCategoryList((prev) =>
      prev.map((c) => (c.key === editingCatKey ? { ...c, label, color } : c)),
    );
    updateCategoryRemote(editingCatKey, { label, color }).then((res) => {
      if (!res?.success) {
        if (prevCat) {
          setCategoryList((prev) =>
            prev.map((c) => (c.key === editingCatKey ? { ...c, label: prevCat.label, color: prevCat.color } : c)),
          );
        }
        alert(`更新分类失败，已回滚。原因：${res?.error || '未知错误'}`);
      }
    });
    setEditingCatKey(null);
  };

  // 删除分类（仅管理员）
  const handleDeleteCategory = (key) => {
    const cat = categoryList.find((c) => c.key === key);
    if (!cat) return;
    if (!window.confirm(`确定要删除分类「${cat.label}」吗？该分类下的分享不会被删除。`)) return;
    // 保留快照用于回滚
    const snapshot = categoryList;
    setCategoryList((prev) => prev.filter((c) => c.key !== key));
    deleteCategoryRemote(key).then((res) => {
      if (!res?.success) {
        setCategoryList(snapshot);
        alert(`删除分类失败，已回滚。原因：${res?.error || '未知错误'}`);
      }
    });
    if (selectedCategory === key) setSelectedCategory('全部');
  };

  const filtered = sharings.filter((s) => {
    const matchSearch =
      !searchTerm ||
      pinyinMatch(s.title, searchTerm) ||
      pinyinMatch(s.author, searchTerm);
    const matchCat = selectedCategory === '全部' || s.category === selectedCategory;
    return matchSearch && matchCat;
  });

  const handleDelete = (id) => {
    if (!window.confirm('确定要删除这篇分享吗？')) return;
    setSharings((prev) => prev.filter((s) => s.id !== id));
    deleteSharing(id).catch(() => { /* ignore */ });
  };

  const handleLike = (id, e) => {
    if (e) e.preventDefault();
    if (!user) return;
    let newLikes = null;
    setSharings((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        const likes = s.likes || [];
        const already = likes.some((l) => l.userId === user.id);
        newLikes = already
          ? likes.filter((l) => l.userId !== user.id)
          : [...likes, { userId: user.id, userName: user.nickname || user.name || user.email }];
        return { ...s, likes: newLikes };
      }),
    );
    if (newLikes) {
      updateSharing(id, { likes: newLikes }).catch(() => { /* ignore */ });
    }
  };

  const hasLiked = (post) => {
    if (!user || !post.likes) return false;
    return post.likes.some((l) => l.userId === user.id);
  };

  const canModify = (post) => {
    if (isAdmin) return true;
    if (post.authorId && post.authorId === user?.id) return true;
    return false;
  };

  // 获取文本的纯文摘要（前 120 字）
  const getExcerpt = (post) => {
    let text = post.content || '';
    if (post.format === 'word') {
      // 用 DOMParser 同时完成"剥标签 + 解码 HTML 实体（&amp; &nbsp; 等）"
      try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(`<!doctype html><body>${text}`, 'text/html');
        text = doc.body.textContent || '';
      } catch {
        text = text.replace(/<[^>]+>/g, ' ');
      }
    } else {
      // Markdown: 去掉标记
      text = text
        .replace(/#{1,6}\s/g, '')
        .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/[>\-|`~]/g, ' ')
        .replace(/!\[.*?\]\(.*?\)/g, '');
      // 顺便把可能夹杂的 HTML 实体也解码一下
      try {
        const el = document.createElement('textarea');
        el.innerHTML = text;
        text = el.value;
      } catch {
        /* noop */
      }
    }
    // 合并所有空白（包含 &nbsp; 解码后的不间断空格 \u00A0）
    text = text.replace(/[\s\u00A0]+/g, ' ').trim();
    return text.length > 120 ? text.slice(0, 120) + '…' : text;
  };

  return (
    <div className="ms-page">
      <div className="container">
        {/* Header */}
        <div className="ms-page__header">
          <div>
            <h1>
              <Share2 size={28} />{' '}
              <EditableText
                value={sc.pageTitle || '成员内部分享'}
                configKey="memberSharing.pageTitle"
                onChange={(v) => updateSC('pageTitle', v)}
                as="span"
              />
            </h1>
            <p>
              <EditableText
                value={sc.pageDesc || '浏览课程资料、历史会议记录及成员经验分享，支持 Word 与 Markdown 格式'}
                configKey="memberSharing.pageDesc"
                onChange={(v) => updateSC('pageDesc', v)}
                as="span"
              />
            </p>
          </div>
          <a href="/internal/member-sharing/create" target="_blank" rel="noopener noreferrer" className="btn btn-primary">
            <Plus size={18} /> 发布分享
          </a>
        </div>

        {/* Filters */}
        <div className="ms-filters">
          <div className="ms-filters__search">
            <Search size={18} className="ms-filters__icon" />
            <input
              type="text"
              placeholder="搜索分享..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="ms-filters__input"
            />
          </div>
          <div className="ms-filters__bar">
            <div className="ms-filters__categories">
              {categories.map((cat) => {
                if (cat === '全部') {
                  return (
                    <button
                      key={cat}
                      className={`ms-filters__cat ${selectedCategory === cat ? 'ms-filters__cat--active' : ''}`}
                      onClick={() => setSelectedCategory(cat)}
                    >
                      全部
                    </button>
                  );
                }
                // cat 是 categoryList[i].key；只有管理员且该 key 在托管列表里时才开就地编辑
                const managed = categoryList.find((c) => c.key === cat);
                const canEditInline = !!managed && isAdmin;
                const isRenaming = canEditInline && editingCatKey === managed.key;

                if (isRenaming) {
                  return (
                    <span key={managed.key} className="ms-filters__cat-rename">
                      <span
                        className="ms-filters__cat-rename-dot"
                        style={{ background: editCatColor }}
                      />
                      <input
                        type="text"
                        className="ms-filters__cat-rename-input"
                        value={editCatLabel}
                        onChange={(e) => setEditCatLabel(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveEditCategory();
                          if (e.key === 'Escape') setEditingCatKey(null);
                        }}
                        autoFocus
                      />
                      <button
                        className="ms-filters__cat-rename-confirm"
                        onClick={saveEditCategory}
                        disabled={!editCatLabel.trim()}
                        title="确认"
                      >
                        <Check size={14} />
                      </button>
                      <button
                        className="ms-filters__cat-rename-cancel"
                        onClick={() => setEditingCatKey(null)}
                        title="取消"
                      >
                        <X size={14} />
                      </button>
                    </span>
                  );
                }

                return (
                  <div key={cat} className="ms-filters__cat-wrapper">
                    <button
                      className={`ms-filters__cat ${selectedCategory === cat ? 'ms-filters__cat--active' : ''}`}
                      onClick={() => setSelectedCategory(cat)}
                    >
                      {categoryLabels[cat] || cat}
                    </button>
                    {canEditInline && (
                      <div className="ms-filters__cat-actions">
                        <button
                          className="ms-filters__cat-edit"
                          onClick={(e) => {
                            e.stopPropagation();
                            startEditCategory(managed);
                          }}
                          title="重命名"
                        >
                          <Pencil size={12} />
                        </button>
                        <button
                          className="ms-filters__cat-delete"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteCategory(managed.key);
                          }}
                          title="删除分类"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* 就地新增（管理员、非管理员均可——该页原本允许所有成员加分类） */}
              {showInlineAddCat ? (
                <span className="ms-filters__cat-add-inline">
                  <span
                    className="ms-filters__cat-rename-dot"
                    style={{ background: newCatColor }}
                  />
                  <input
                    type="text"
                    className="ms-filters__cat-add-input"
                    placeholder="新分类名称"
                    value={newCatLabel}
                    onChange={(e) => setNewCatLabel(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleAddCategory();
                        setShowInlineAddCat(false);
                      }
                      if (e.key === 'Escape') {
                        setShowInlineAddCat(false);
                        setNewCatLabel('');
                      }
                    }}
                    autoFocus
                  />
                  <button
                    className="ms-filters__cat-add-confirm"
                    onClick={() => {
                      handleAddCategory();
                      setShowInlineAddCat(false);
                    }}
                    disabled={!newCatLabel.trim()}
                    title="确认添加"
                  >
                    <Check size={14} />
                  </button>
                  <button
                    className="ms-filters__cat-add-cancel"
                    onClick={() => {
                      setShowInlineAddCat(false);
                      setNewCatLabel('');
                    }}
                    title="取消"
                  >
                    <X size={14} />
                  </button>
                </span>
              ) : (
                <button
                  className="ms-filters__cat ms-filters__cat--add"
                  onClick={() => setShowInlineAddCat(true)}
                  title="添加新分类"
                >
                  <Plus size={14} /> 添加分类
                </button>
              )}
            </div>
            <button
              className={`ms-filters__manage-btn ${showCatManager ? 'ms-filters__manage-btn--active' : ''}`}
              onClick={() => setShowCatManager(!showCatManager)}
              title="管理筛选分类（含颜色/批量）"
            >
              <Settings2 size={16} />
            </button>
          </div>

          {/* 分类管理面板 */}
          {showCatManager && (
            <div className="ms-cat-manager card">
              <div className="ms-cat-manager__header">
                <h4><Settings2 size={16} /> 筛选分类管理</h4>
                <button className="ms-cat-manager__close" onClick={() => setShowCatManager(false)}>
                  <X size={16} />
                </button>
              </div>

              {/* 现有分类列表 */}
              <div className="ms-cat-manager__list">
                {categoryList.map((cat) => (
                  <div key={cat.key} className="ms-cat-item">
                    {editingCatKey === cat.key ? (
                      /* 编辑模式（仅管理员） */
                      <div className="ms-cat-item__edit">
                        <div className="ms-cat-item__edit-row">
                          <span
                            className="ms-cat-item__color-dot"
                            style={{ background: editCatColor }}
                          />
                          <input
                            type="text"
                            className="ms-cat-item__edit-input"
                            value={editCatLabel}
                            onChange={(e) => setEditCatLabel(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && saveEditCategory()}
                            autoFocus
                          />
                          <button className="ms-cat-item__action ms-cat-item__action--save" onClick={saveEditCategory} title="保存">
                            <Check size={14} />
                          </button>
                          <button className="ms-cat-item__action" onClick={() => setEditingCatKey(null)} title="取消">
                            <X size={14} />
                          </button>
                        </div>
                        <div className="ms-cat-item__colors">
                          {PRESET_COLORS.map((c) => (
                            <button
                              key={c}
                              className={`ms-cat-item__color-btn ${editCatColor === c ? 'ms-cat-item__color-btn--active' : ''}`}
                              style={{ background: c }}
                              onClick={() => setEditCatColor(c)}
                            />
                          ))}
                        </div>
                      </div>
                    ) : (
                      /* 展示模式 */
                      <div className="ms-cat-item__display">
                        <span
                          className="ms-cat-item__color-dot"
                          style={{ background: cat.color }}
                        />
                        <span className="ms-cat-item__label">{cat.label}</span>
                        {isAdmin && (
                          <div className="ms-cat-item__actions">
                            <button className="ms-cat-item__action" onClick={() => startEditCategory(cat)} title="编辑">
                              <Pencil size={12} />
                            </button>
                            <button className="ms-cat-item__action ms-cat-item__action--danger" onClick={() => handleDeleteCategory(cat.key)} title="删除">
                              <Trash2 size={12} />
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* 新建分类（所有成员可用） */}
              <div className="ms-cat-manager__add">
                <div className="ms-cat-manager__add-row">
                  <span
                    className="ms-cat-item__color-dot"
                    style={{ background: newCatColor }}
                  />
                  <input
                    type="text"
                    className="ms-cat-manager__add-input"
                    placeholder="输入新分类名称..."
                    value={newCatLabel}
                    onChange={(e) => setNewCatLabel(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddCategory()}
                  />
                  <button
                    className="ms-cat-manager__add-btn"
                    onClick={handleAddCategory}
                    disabled={!newCatLabel.trim()}
                  >
                    <Plus size={14} /> 添加
                  </button>
                </div>
                <div className="ms-cat-item__colors">
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c}
                      className={`ms-cat-item__color-btn ${newCatColor === c ? 'ms-cat-item__color-btn--active' : ''}`}
                      style={{ background: c }}
                      onClick={() => setNewCatColor(c)}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Sharing List */}
        <div className="ms-list">
          {filtered.map((post) => (
            <div key={post.id} className="ms-card card">
              <div className="ms-card__accent" style={{ background: categoryColors[post.category] || '#6B7280' }} />
              <a href={`/internal/member-sharing/view/${post.id}`} target="_blank" rel="noopener noreferrer" className="ms-card__body-link">
                <div className="ms-card__body">
                  <div className="ms-card__top">
                    <span
                      className="ms-card__badge"
                      style={{
                        color: categoryColors[post.category] || '#6B7280',
                        background: `${categoryColors[post.category] || '#6B7280'}15`,
                      }}
                    >
                      {categoryLabels[post.category] || post.category}
                    </span>
                    <span className="ms-card__format-tag">
                      {post.format === 'markdown' ? <><Code2 size={11} /> Markdown</> : <><FileText size={11} /> Word</>}
                    </span>
                    {post.attachments && post.attachments.length > 0 && (
                      <span className="ms-card__attach-tag">
                        <Paperclip size={11} /> {post.attachments.length} 个附件
                      </span>
                    )}
                  </div>

                  <h4 className="ms-card__title">{post.title}</h4>

                  <p className="ms-card__excerpt">{getExcerpt(post)}</p>

                  {post.period && (
                    <span className="ms-card__period">
                      <Clock size={11} /> {post.period}
                    </span>
                  )}

                  <div className="ms-card__meta">
                    <span className="ms-card__author">
                      <User size={12} /> {post.author}
                    </span>
                    <span className="ms-card__date">
                      <Clock size={12} /> {post.createdAt}
                    </span>
                    <button
                      type="button"
                      className="ms-card__views views-trigger"
                      onClick={(e) => {
                        // 卡片本身包在 <a> 里，需要阻止默认导航与冒泡
                        e.preventDefault();
                        e.stopPropagation();
                        setViewLogPost(post);
                      }}
                      title="查看所有访问记录"
                    >
                      <Eye size={12} /> {views[post.id] || 0}
                    </button>
                  </div>
                </div>
              </a>

              <div className="ms-card__bottom" onClick={(e) => e.stopPropagation()}>
                <div className="ms-card__bottom-left">
                  <button
                    className={`ms-card__like-btn ${hasLiked(post) ? 'ms-card__like-btn--active' : ''}`}
                    onClick={(e) => handleLike(post.id, e)}
                  >
                    <ThumbsUp size={14} />
                    <span>{(post.likes || []).length}</span>
                  </button>
                  {(post.likes || []).length > 0 && (
                    <div className="ms-card__like-names">
                      {post.likes.map((l, idx) => (
                        <span key={l.userId}>
                          {l.userName}{idx < post.likes.length - 1 ? '、' : ''}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="ms-card__bottom-right">
                  <a
                    href={`/internal/member-sharing/view/${post.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ms-card__action-icon"
                    title="查看全文"
                  >
                    <ExternalLink size={14} />
                  </a>
                  {canModify(post) && (
                    <button
                      className="ms-card__action-icon ms-card__action-icon--danger"
                      onClick={() => handleDelete(post.id)}
                      title="删除"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {filtered.length === 0 && (
          <div className="ms-empty">
            <Share2 size={48} />
            <h3>暂无分享</h3>
            <p>点击"发布分享"按钮开始分享内容</p>
          </div>
        )}
      </div>

      {/* 访问记录弹层：点击卡片上的浏览数小眼睛时弹出 */}
      <ViewLogPopover
        open={Boolean(viewLogPost)}
        onClose={() => setViewLogPost(null)}
        totalCount={viewLogPost ? (views[viewLogPost.id] || 0) : 0}
        fetchLog={
          viewLogPost ? () => fetchViewLog(String(viewLogPost.id)) : undefined
        }
        resolveName={resolveVisitorName}
      />
    </div>
  );
}
