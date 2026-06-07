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
  getCachedSharings,
  DEFAULT_CATEGORIES,
} from '../../services/memberSharingService';
import { moveToRecycleBin } from '../../services/recycleBinService';
import {
  Share2,
  Plus,
  Search,
  Clock,
  User,
  Eye,
  Trash2,
  FileText,
  ThumbsUp,
  Settings2,
  X,
  Check,
  Pencil,
  Palette,
  Paperclip,
  Loader2,
} from 'lucide-react';
import './MemberSharing.css';

const SHARING_VIEWS_KEY = 'riemer_sharing_views';
const HIDDEN_CATEGORY_KEYS = new Set(['history']);

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

function getVisibleCategories(cats) {
  return (Array.isArray(cats) ? cats : []).filter((cat) => !HIDDEN_CATEGORY_KEYS.has(cat.key));
}

function loadViews() {
  try {
    const stored = localStorage.getItem(SHARING_VIEWS_KEY);
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return {};
}

function getAttachmentExtension(file = {}) {
  const name = String(file.name || '');
  const type = String(file.type || '').toLowerCase();
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  if (ext) return ext;
  if (type.includes('pdf')) return 'pdf';
  if (type.includes('word') || type.includes('msword')) return 'docx';
  if (type.includes('zip') || type.includes('compressed')) return 'zip';
  return '';
}

function getAttachmentTypeLabel(file) {
  const ext = getAttachmentExtension(file);
  if (ext === 'pdf') return 'PDF';
  if (['doc', 'docx'].includes(ext)) return 'Word';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'ZIP';
  if (['ppt', 'pptx'].includes(ext)) return 'PPT';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return 'Excel';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) return '图片';
  return ext ? ext.toUpperCase() : '附件';
}

function getAttachmentTypeSummary(attachments) {
  if (!Array.isArray(attachments) || attachments.length === 0) return '';
  const labels = [...new Set(attachments.map(getAttachmentTypeLabel).filter(Boolean))];
  return labels.join(' / ');
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

  const resolveLikeUserName = useCallback(
    (like) => {
      const uid = like?.userId;
      if (uid && userNameMap[uid]) return userNameMap[uid];
      if (uid && user?.id === uid && (user.name || user.nickname)) {
        return user.name || user.nickname;
      }
      return like?.userName || '访客';
    },
    [userNameMap, user],
  );

  const resolveAuthorName = useCallback(
    (post) => {
      const uid = post?.authorId;
      if (uid && userNameMap[uid]) return userNameMap[uid];
      if (uid && user?.id === uid && (user.name || user.nickname)) {
        return user.name || user.nickname;
      }
      return post?.author || 'Unknown';
    },
    [userNameMap, user],
  );

  const sc = internalConfig.memberSharing || {};
  const updateSC = useCallback(
    (key, val) => updateInternalConfig({ memberSharing: { [key]: val } }),
    [updateInternalConfig],
  );

  // 首屏用本地缓存做种子，先把上次的内容立刻显示出来（手机端尤其明显），
  // 云端数据回来后再覆盖/合并，避免"先空一下再加载"的空窗。
  const [sharings, setSharings] = useState(() => getCachedSharings());
  // 首次云端拉取是否完成：未完成且暂无内容时显示"加载中"而不是"暂无分享"
  const [loaded, setLoaded] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategories, setSelectedCategories] = useState([]);
  const views = loadViews();

  // 动态分类管理
  const [categoryList, setCategoryList] = useState(DEFAULT_CATEGORIES);
  const { labels: categoryLabels, colors: categoryColors } = buildCategoryMaps(categoryList);

  // 首次加载：从云端拉取分享 + 分类，并把本地已有的旧数据一次性迁移到云端
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // 把 localStorage 的旧数据后台迁到云端，不阻塞列表首屏加载。
        migrateLocalSharingsToDb().catch(() => { /* ignore */ });
      } catch { /* ignore */ }
      if (cancelled) return;
      try {
        const [list, cats] = await Promise.all([fetchSharings(), fetchCategories()]);
        if (cancelled) return;
        setSharings(list);
        // ⚠️ 必须兼容"空数组"—— 若只有云端可用且用户已在另一设备把分类全删光，
        // fetchCategories 会返回 []，直接同步给 UI；若 cats 为 null/undefined
        // （服务层意外分支）才保留默认列表不动。
        if (Array.isArray(cats)) setCategoryList(getVisibleCategories(cats));
      } catch (err) {
        console.warn('[MemberSharing] 初次加载失败:', err);
      } finally {
        if (!cancelled) setLoaded(true);
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
        // 同上：cats 可能是空数组（别的设备把所有分类都删了），原样应用
        if (Array.isArray(cats)) setCategoryList(getVisibleCategories(cats));
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
  // 分类操作提交中：防止用户在 await 期间重复点击（双推、双删、双改）
  const [catOpBusy, setCatOpBusy] = useState(false);

  if (!isAuthenticated) return <Navigate to="/login" replace />;

  const categories = ['全部', ...categoryList.map((c) => c.key)];

  // 新建分类（所有成员可用）
  //
  // 跨设备同步关键点（与 EventPublish / Tasks 同款对齐修复）：
  //   ① 提交中禁用：await 返回前再次点击会发起重复 insert，第二次还会用
  //      同一毫秒生成的 key → 主键冲突失败。用 catOpBusy 守住这个窗口。
  //   ② key 加随机后缀：两个设备（或同一设备快速连点）在同一毫秒新增时，
  //      单靠 Date.now() 会撞 key，其中一边 INSERT 因 PK 冲突失败，用户
  //      看到的现象就是"新增了但另一台没同步过来"。加 6 位随机后缀即可。
  //   ③ await 后再清空输入框：失败时保留用户刚输入的 label 和颜色，方便
  //      他直接改名重试，不用再输一遍。
  const handleAddCategory = async () => {
    if (catOpBusy) return;
    const label = newCatLabel.trim();
    if (!label) return;
    // 检查重名
    if (categoryList.some((c) => c.label === label)) {
      alert('该分类名称已存在');
      return;
    }
    // key 必须全局唯一：毫秒时间戳 + 随机后缀，防止并发碰撞
    const key = 'cat_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const cat = { key, label, color: newCatColor };

    setCatOpBusy(true);
    // 乐观更新本地 UI
    setCategoryList((prev) => [...prev, cat]);

    try {
      const res = await addCategoryRemote(cat);
      if (!res?.success) {
        // 回滚：只移除刚插入的这条，不整体覆盖，避免冲掉 realtime 中到的并发变更
        setCategoryList((prev) => prev.filter((c) => c.key !== cat.key));
        alert(
          `新增分类失败，已回滚。原因：${res?.error || '未知错误'}\n` +
          `若提示"relation does not exist"，请在 Supabase 里执行 supabase-member-sharing.sql。`,
        );
        return;
      }
      // 成功后再清空输入，失败时保留给用户重试
      setNewCatLabel('');
      setNewCatColor(PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)]);
    } finally {
      setCatOpBusy(false);
    }
  };

  // 开始编辑分类（仅管理员）
  const startEditCategory = (cat) => {
    setEditingCatKey(cat.key);
    setEditCatLabel(cat.label);
    setEditCatColor(cat.color);
  };

  // 保存编辑（仅管理员）
  const saveEditCategory = async () => {
    if (catOpBusy) return;
    if (!editCatLabel.trim()) return;
    const label = editCatLabel.trim();
    const color = editCatColor;
    const targetKey = editingCatKey;
    // 记录旧值用于回滚
    const prevCat = categoryList.find((c) => c.key === targetKey);
    if (!prevCat) return;

    setCatOpBusy(true);
    // 乐观更新
    setCategoryList((prev) =>
      prev.map((c) => (c.key === targetKey ? { ...c, label, color } : c)),
    );
    // 立即退出编辑态，UI 流畅；失败时再次打开不现实，只做 alert + 回滚
    setEditingCatKey(null);

    try {
      const res = await updateCategoryRemote(targetKey, { label, color });
      if (!res?.success) {
        setCategoryList((prev) =>
          prev.map((c) =>
            c.key === targetKey ? { ...c, label: prevCat.label, color: prevCat.color } : c,
          ),
        );
        alert(`更新分类失败，已回滚。原因：${res?.error || '未知错误'}`);
      }
    } finally {
      setCatOpBusy(false);
    }
  };

  // 删除分类（仅管理员）
  const handleDeleteCategory = async (key) => {
    if (catOpBusy) return;
    const cat = categoryList.find((c) => c.key === key);
    if (!cat) return;
    if (!window.confirm(`确定要删除分类「${cat.label}」吗？该分类下的分享不会被删除。`)) return;
    // 保留快照用于回滚
    const snapshot = categoryList;

    setCatOpBusy(true);
    setCategoryList((prev) => prev.filter((c) => c.key !== key));
    setSelectedCategories((prev) => prev.filter((item) => item !== key));

    try {
      const res = await deleteCategoryRemote(key);
      if (!res?.success) {
        setCategoryList(snapshot);
        alert(`删除分类失败，已回滚。原因：${res?.error || '未知错误'}`);
      }
    } finally {
      setCatOpBusy(false);
    }
  };

  const filtered = sharings.filter((s) => {
    const matchSearch =
      !searchTerm ||
      pinyinMatch(s.title, searchTerm) ||
      pinyinMatch(resolveAuthorName(s), searchTerm) ||
      pinyinMatch(s.author, searchTerm);
    const matchCat = selectedCategories.length === 0 || selectedCategories.includes(s.category);
    return matchSearch && matchCat;
  });

  const handleDelete = (id) => {
    if (!window.confirm('确定要删除这篇分享吗？')) return;
    const target = sharings.find((s) => String(s.id) === String(id));
    // 删除前先把整条快照挪进回收站，支持后续恢复
    if (target) {
      moveToRecycleBin({ itemType: 'member_sharing', item: target, user })
        .catch(() => { /* 回收站写入失败不阻塞删除，已有本地兜底 */ });
    }
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
          : [...likes, { userId: user.id, userName: user.name || user.nickname || user.email }];
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

  const isPostPublisherOrContributor = (post) => {
    if (!user?.id) return false;
    if (post.authorId && String(post.authorId) === String(user.id)) return true;
    if (Array.isArray(post.contributorIds)
      && post.contributorIds.map(String).includes(String(user.id))) return true;
    return false;
  };

  const canEditPost = (post) => isPostPublisherOrContributor(post);
  const canDeletePost = (post) => isAdmin || isPostPublisherOrContributor(post);

  // 获取文本的纯文摘要（前 120 字）
  const getExcerpt = (post) => {
    const manualSummary = String(post.summary || '').replace(/[\s\u00A0]+/g, ' ').trim();
    if (manualSummary) {
      return manualSummary.length > 120 ? manualSummary.slice(0, 120) + '…' : manualSummary;
    }

    let text = String(post.content || '');
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
              <span className="ms-page__confidential-note">
                内部分享仅面向 RIEMer Land 主理团队，禁止外传。
              </span>
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
                      className={`ms-filters__cat ${selectedCategories.length === 0 ? 'ms-filters__cat--active' : ''}`}
                      onClick={() => setSelectedCategories([])}
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
                        disabled={!editCatLabel.trim() || catOpBusy}
                        title={catOpBusy ? '正在同步…' : '确认'}
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
                      className={`ms-filters__cat ${selectedCategories.includes(cat) ? 'ms-filters__cat--active' : ''}`}
                      onClick={() => setSelectedCategories((prev) => (
                        prev.includes(cat) ? prev.filter((item) => item !== cat) : [...prev, cat]
                      ))}
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
                    disabled={!newCatLabel.trim() || catOpBusy}
                    title={catOpBusy ? '正在同步…' : '确认添加'}
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
                    disabled={!newCatLabel.trim() || catOpBusy}
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
              {canEditPost(post) && (
                <a
                  href={`/internal/member-sharing/create?edit=${encodeURIComponent(post.id)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ms-card__edit-btn"
                  title="编辑分享"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Pencil size={14} />
                </a>
              )}
              {canDeletePost(post) && (
                <button
                  type="button"
                  className="ms-card__edit-btn ms-card__delete-btn"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleDelete(post.id);
                  }}
                  title="删除分享"
                >
                  <Trash2 size={14} />
                </button>
              )}
              <a href={`/internal/member-sharing/view/${post.id}`} target="_blank" rel="noopener noreferrer" className="ms-card__body-link">
                <div className="ms-card__body">
                  {Array.isArray(post.attachments) && post.attachments.length > 0 && (
                    <div className="ms-card__top">
                      <span className="ms-card__attach-tag">
                        <Paperclip size={11} /> {post.attachments.length} 个附件
                      </span>
                    </div>
                  )}

                  <h4 className="ms-card__title">{post.title}</h4>

                  <p className="ms-card__excerpt">{getExcerpt(post)}</p>

                  {post.period && (
                    <span className="ms-card__period">
                      <Clock size={11} /> 经验时间段：{post.period}
                    </span>
                  )}

                  <div className="ms-card__meta">
                    <div className="ms-card__meta-row ms-card__meta-row--primary">
                      <span className="ms-card__author">
                        <User size={13} /> {resolveAuthorName(post)}
                      </span>
                      <span className="ms-card__date">
                        <Clock size={13} /> {post.createdAt}
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
                        <Eye size={13} /> {views[post.id] || 0}
                      </button>
                    </div>
                    <div className="ms-card__meta-row ms-card__meta-row--secondary">
                      <button
                        type="button"
                        className={`ms-card__like-btn ${hasLiked(post) ? 'ms-card__like-btn--active' : ''}`}
                        onClick={(e) => handleLike(post.id, e)}
                      >
                        <ThumbsUp size={13} />
                        <span>{(post.likes || []).length}</span>
                      </button>
                      {Array.isArray(post.likes) && post.likes.length > 0 && (
                        <div className="ms-card__like-names">
                          {post.likes.map((l, idx) => (
                            <span key={l.userId}>
                              {resolveLikeUserName(l)}{idx < post.likes.length - 1 ? '、' : ''}
                            </span>
                          ))}
                        </div>
                      )}
                      <span
                        className="ms-card__badge"
                        style={{
                          color: categoryColors[post.category] || '#6B7280',
                          background: `${categoryColors[post.category] || '#6B7280'}15`,
                        }}
                      >
                        {categoryLabels[post.category] || post.category}
                      </span>
                      {getAttachmentTypeSummary(post.attachments) && (
                        <span className="ms-card__format-tag">
                          <FileText size={13} /> {getAttachmentTypeSummary(post.attachments)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </a>
            </div>
          ))}
        </div>

        {/* 首屏云端拉取未完成且暂无内容 → 显示"加载中"占位，
            避免在数据回来前先闪一下"暂无分享"空状态（手机端尤其明显）。 */}
        {!loaded && filtered.length === 0 && (
          <div className="ms-empty ms-empty--loading">
            <Loader2 size={40} className="ms-empty__spinner" />
            <h3>加载中…</h3>
            <p>正在为你加载成员分享内容</p>
          </div>
        )}

        {loaded && filtered.length === 0 && (
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
