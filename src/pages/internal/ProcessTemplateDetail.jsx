import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Navigate, useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useSiteContent } from '../../contexts/SiteContentContext';
import { marked } from 'marked';
import {
  ChevronLeft,
  Clock,
  User,
  Eye,
  ThumbsUp,
  Code2,
  FileText,
  FolderOpen,
  Paperclip,
  Download,
  File,
  Image as ImageIcon,
  FileSpreadsheet,
  FileArchive,
  List,
  X,
  HardDrive,
  Pencil,
  Save,
  Clipboard,
  Check,
  AlertTriangle,
} from 'lucide-react';
import { documentsData } from '../../data/siteData';
import WordPreview from '../../components/WordPreview';
import TextAnnotation from '../../components/TextAnnotation';
import {
  fetchAllFromCloud,
  fetchViewsFromCloud,
  incrementView,
  updateDoc as cloudUpdateDoc,
  canUseSupabase,
  subscribeDocuments,
  subscribeDeletedDefaults,
} from '../../lib/documentsService';
import './ProcessTemplateDetail.css';
// 复用"成员内部分享"发布页的 Markdown 左编辑右预览样式（.msc-md-split 相关）
import './MemberSharingCreate.css';

const DOCUMENTS_KEY = 'riemer_documents';
const DELETED_DEFAULT_IDS_KEY = 'riemer_documents_deleted_default_ids';
const PROCESS_VIEWS_KEY = 'riemer_process_template_views';

const DEFAULT_TYPE_LABELS = {
  process: '流程手册及模版文件',
  regulation: '规章制度',
  course: '课程及考试资料',
  history: '历史会议',
  experience: '成员经验分享',
};

const DEFAULT_TYPE_COLORS = {
  process: '#D4A44C',
  regulation: '#8B5CF6',
  course: '#5EAD8C',
  history: '#4FBFC4',
  experience: '#EC4899',
};

/* ========== 工具函数 ========== */
function getFileIcon(name) {
  const ext = (name || '').split('.').pop().toLowerCase();
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return ImageIcon;
  if (['pdf'].includes(ext)) return FileText;
  if (['xls', 'xlsx', 'csv'].includes(ext)) return FileSpreadsheet;
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return FileArchive;
  if (['doc', 'docx', 'ppt', 'pptx', 'txt', 'md'].includes(ext)) return FileText;
  return File;
}

function formatFileSize(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function downloadFile({ dataUrl, url, name }) {
  const href = dataUrl || url;
  if (!href) return;
  const a = document.createElement('a');
  a.href = href;
  a.download = name || 'download';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function loadUserDocs() {
  try {
    const stored = localStorage.getItem(DOCUMENTS_KEY);
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return [];
}

function loadDeletedDefaultIds() {
  try {
    const stored = localStorage.getItem(DELETED_DEFAULT_IDS_KEY);
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return [];
}

function loadViews() {
  try {
    const stored = localStorage.getItem(PROCESS_VIEWS_KEY);
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return {};
}

function saveViews(data) {
  try {
    localStorage.setItem(PROCESS_VIEWS_KEY, JSON.stringify(data));
  } catch { /* ignore */ }
}

function saveUserDocs(data) {
  try {
    localStorage.setItem(DOCUMENTS_KEY, JSON.stringify(data));
  } catch { /* ignore */ }
}

function isUserDoc(doc) {
  return String(doc?.id || '').startsWith('doc-');
}

/* ========== 主组件 ========== */
export default function ProcessTemplateDetail() {
  const { isAuthenticated, user, isAdmin, getAllUsers } = useAuth();
  const { filterOptions } = useSiteContent();
  const { id } = useParams();
  const navigate = useNavigate();

  /* ==========
     贡献者真名映射：Supabase + 本地成员的 id → 真名
     历史数据中 uploadedBy 可能存的是昵称，这里通过 uploadedById 动态解析回真名，
     保证"贡献者"展示始终是注册时的真名。
     ========== */
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
      } catch {
        /* 拉取失败时降级：使用文档里原始 uploadedBy */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getAllUsers]);

  const resolveContributorName = useCallback(
    (uid, fallback) => {
      if (uid && userNameMap[uid]) return userNameMap[uid];
      if (uid && user?.id === uid && (user.name || user.nickname)) {
        return user.name || user.nickname;
      }
      return fallback || 'Unknown';
    },
    [userNameMap, user],
  );
  const contentRef = useRef(null);

  // 合并数据源：
  // - 挂载时先用 localStorage 渲染（避免白屏），随后异步从 Supabase 拉取最新数据
  // - docsVersion 递增会强制 useMemo 重新计算
  // - cloudData 存放云端返回的快照（包含用户文档 + 已删除默认 id）
  const [docsVersion, setDocsVersion] = useState(0);
  const [cloudData, setCloudData] = useState(null); // { userDocs, deletedIds } | null

  // 挂载时从云端拉一次 + 浏览计数
  useEffect(() => {
    if (!canUseSupabase()) return;
    let cancelled = false;
    (async () => {
      const cloud = await fetchAllFromCloud();
      if (cancelled || !cloud) return;
      const userDocs = cloud.docs.filter((d) => String(d.id).startsWith('doc-'));
      setCloudData({ userDocs, deletedIds: cloud.deletedIds.map(String) });
      // 浏览计数合并
      await fetchViewsFromCloud();
    })();
    return () => { cancelled = true; };
  }, []);

  // ---- 订阅 documents / documents_deleted_defaults 变更：当前文档被其它设备编辑或删除时自动刷新 ----
  // 用 ref 持有 isEditing，避免闭包陷阱 + 编辑态下不强制刷新（防止覆盖用户输入）
  const isEditingRef = useRef(false);
  useEffect(() => {
    if (!canUseSupabase()) return;
    let timer = null;
    const refetch = () => {
      if (isEditingRef.current) return; // 编辑态下不要刷新
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        const cloud = await fetchAllFromCloud();
        if (!cloud) return;
        const userDocs = cloud.docs.filter((d) => String(d.id).startsWith('doc-'));
        setCloudData({ userDocs, deletedIds: cloud.deletedIds.map(String) });
      }, 200);
    };
    const unsubDocs = subscribeDocuments(() => refetch());
    const unsubDeleted = subscribeDeletedDefaults(() => refetch());
    return () => {
      if (timer) clearTimeout(timer);
      unsubDocs();
      unsubDeleted();
    };
  }, []);

  const allDocs = useMemo(() => {
    void docsVersion;
    if (cloudData) {
      // 云端数据优先
      const deletedSet = new Set(cloudData.deletedIds);
      const defaults = documentsData.filter((d) => !deletedSet.has(String(d.id)));
      return [...cloudData.userDocs, ...defaults];
    }
    // 退回本地缓存
    const userDocs = loadUserDocs();
    const deletedSet = new Set(loadDeletedDefaultIds().map(String));
    const defaults = documentsData.filter((d) => !deletedSet.has(String(d.id)));
    return [...userDocs, ...defaults];
  }, [docsVersion, cloudData]);

  const doc = useMemo(() => allDocs.find((d) => String(d.id) === String(id)), [allDocs, id]);

  /* 浏览次数：
     - 本地 localStorage: riemer_process_template_views（与卡片列表共享）
     - 云端 document_views 表（跨设备累计）
     - 同一个会话内刷新不重复计数，避免"每刷一次就 +1"
     - 关闭窗口重开 → sessionStorage 清空 → 新会话再计一次
  */
  useEffect(() => {
    if (!doc) return;
    try {
      const SESSION_KEY = 'riemer_ptd_session_viewed';
      const sessionViewed = new Set(
        JSON.parse(sessionStorage.getItem(SESSION_KEY) || '[]')
      );
      if (sessionViewed.has(String(doc.id))) {
        return;
      }
      // 本地即时 +1（incrementView 内部会同时写云端，异步不阻塞）
      const views = loadViews();
      views[doc.id] = (views[doc.id] || 0) + 1;
      saveViews(views);
      sessionViewed.add(String(doc.id));
      sessionStorage.setItem(SESSION_KEY, JSON.stringify([...sessionViewed]));

      // 云端同步（Supabase 可用时）
      if (canUseSupabase()) {
        incrementView(String(doc.id)).catch((err) => {
          console.warn('[ProcessTemplateDetail] 云端浏览计数同步失败:', err);
        });
      }
    } catch { /* ignore */ }
  }, [doc?.id]);

  /* Markdown / Word-HTML 渲染 */
  const renderedContent = useMemo(() => {
    if (!doc || !doc.content) return '';
    if (doc.format === 'markdown') {
      marked.setOptions({ breaks: true, gfm: true });
      return marked.parse(doc.content);
    }
    return doc.content; // word 格式：已是 HTML
  }, [doc]);

  /* ========== 目录（TOC） ========== */
  const [toc, setToc] = useState([]);
  const [activeTocId, setActiveTocId] = useState('');
  const [tocOpenMobile, setTocOpenMobile] = useState(false);

  useEffect(() => {
    if (!contentRef.current) return;
    const root = contentRef.current;
    // 扩展到 h1-h4，兼容更深层标题的目录跳转
    const headings = root.querySelectorAll('h1, h2, h3, h4');
    const items = [];
    const slugCount = {};
    headings.forEach((el, idx) => {
      const raw = (el.textContent || '').trim();
      if (!raw) return;
      let slug = raw
        .toLowerCase()
        .replace(/[\s\u3000]+/g, '-')
        .replace(/[^\w\u4e00-\u9fa5-]/g, '')
        .slice(0, 50) || `heading-${idx}`;
      if (slugCount[slug]) {
        slugCount[slug] += 1;
        slug = `${slug}-${slugCount[slug]}`;
      } else {
        slugCount[slug] = 1;
      }
      el.id = slug;
      el.classList.add('ptd-heading-anchor');
      items.push({ id: slug, text: raw, level: Number(el.tagName.substring(1)) });
    });
    setToc(items);
    setActiveTocId(items[0]?.id || '');
  }, [renderedContent]);

  useEffect(() => {
    if (!toc.length || !contentRef.current) return;
    const headings = toc.map((t) => document.getElementById(t.id)).filter(Boolean);
    if (!headings.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.target.getBoundingClientRect().top - b.target.getBoundingClientRect().top);
        if (visible[0]) setActiveTocId(visible[0].target.id);
      },
      { rootMargin: '-80px 0px -70% 0px', threshold: 0 },
    );
    headings.forEach((h) => observer.observe(h));
    return () => observer.disconnect();
  }, [toc]);

  // 首次渲染若 URL 带 hash，自动滚到对应锚点（支持分享链接）
  useEffect(() => {
    if (!toc.length) return;
    const hash = decodeURIComponent(window.location.hash || '').replace(/^#/, '');
    if (!hash) return;
    const el = document.getElementById(hash);
    if (!el) return;
    // 下一帧再滚，确保布局已完成
    requestAnimationFrame(() => {
      const offset = 80;
      const top = el.getBoundingClientRect().top + window.pageYOffset - offset;
      window.scrollTo({ top, behavior: 'auto' });
      setActiveTocId(hash);
    });
  }, [toc]);

  const handleTocClick = useCallback((tocId) => {
    const el = document.getElementById(tocId);
    if (!el) {
      console.warn('[TOC] 未找到对应标题元素：', tocId);
      return;
    }
    // 优先用 scrollIntoView（会自动找到最近的可滚动容器，更兼容）
    // 再用 window.scrollTo 校准偏移（避开顶部 sticky 栏 80px）
    try {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      // 额外补偿顶部 sticky topbar 高度（80px）
      const offset = 80;
      const currentTop = el.getBoundingClientRect().top;
      if (Math.abs(currentTop) < 200) {
        window.scrollBy({ top: currentTop - offset, behavior: 'smooth' });
      } else {
        // scrollIntoView 未立刻生效（例如目标还未进入视口），再退回手动计算
        const top = el.getBoundingClientRect().top + window.pageYOffset - offset;
        window.scrollTo({ top, behavior: 'smooth' });
      }
    } catch {
      // 老浏览器兜底
      const offset = 80;
      const top = el.getBoundingClientRect().top + window.pageYOffset - offset;
      window.scrollTo({ top, behavior: 'smooth' });
    }
    // 写入 hash，便于分享/刷新保留锚点
    try {
      window.history.replaceState(null, '', `#${tocId}`);
    } catch { /* ignore */ }
    setActiveTocId(tocId);
    setTocOpenMobile(false);
  }, []);

  /* ========== 点赞 ========== */
  const [liked, setLiked] = useState(false);
  const [likes, setLikes] = useState(doc?.likes || []);

  useEffect(() => {
    if (!doc) return;
    const currentLikes = doc.likes || [];
    setLikes(currentLikes);
    setLiked(currentLikes.some((l) => l.userId === user?.id));
  }, [doc?.id, user?.id]);

  const handleLike = useCallback(() => {
    if (!doc || !user) return;
    const likeInfo = {
      userId: user.id,
      userName: user.nickname || user.name || user.email,
      userAvatar: user.avatar || null,
    };
    let nextLikes;
    if (liked) {
      nextLikes = likes.filter((l) => l.userId !== user.id);
    } else {
      nextLikes = [...likes, likeInfo];
    }
    setLikes(nextLikes);
    setLiked(!liked);
    // 仅对用户发布的文档（doc-*）能持久化 likes
    if (isUserDoc(doc)) {
      // 本地
      const userDocs = loadUserDocs().map((d) =>
        d.id === doc.id ? { ...d, likes: nextLikes } : d
      );
      saveUserDocs(userDocs);
      // 云端
      if (canUseSupabase()) {
        cloudUpdateDoc(doc.id, { likes: nextLikes }).catch((err) => {
          console.warn('[ProcessTemplateDetail] 云端点赞同步失败:', err);
        });
      }
    }
  }, [doc, user, liked, likes]);

  /* ========== 编辑模式 ========== */
  const [isEditing, setIsEditing] = useState(false);
  // 同步 isEditing 到 ref，realtime 订阅回调需要读最新值（避免闭包陷阱）
  useEffect(() => {
    isEditingRef.current = isEditing;
  }, [isEditing]);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);
  // 保存结果的轻提示：'saved' | 'cloud-failed' | null
  // 'saved'：本地已保存、云端同步已发起/完成
  // 'cloud-failed'：本地已保存但云端同步失败（不阻塞，提示用户）
  const [saveHint, setSaveHint] = useState(null);

  const startEdit = useCallback(() => {
    if (!doc) return;
    setEditTitle(doc.title || '');
    setEditDescription(doc.description || '');
    setEditContent(doc.content || '');
    setIsEditing(true);
  }, [doc]);

  const cancelEdit = useCallback(() => {
    setIsEditing(false);
  }, []);

  /* Markdown 编辑态的实时预览（仅当 doc.format === 'markdown' 时使用） */
  const editMarkdownPreview = useMemo(() => {
    if (!doc || doc.format !== 'markdown') return '';
    if (!editContent || !editContent.trim()) return '';
    marked.setOptions({ breaks: true, gfm: true });
    return marked.parse(editContent);
  }, [editContent, doc?.format, doc]);

  const saveEdit = useCallback(async () => {
    if (!doc) return;
    const title = editTitle.trim();
    if (!title) {
      alert('标题不能为空');
      return;
    }
    setSaving(true);
    try {
      const userDocs = loadUserDocs();
      const idx = userDocs.findIndex((d) => String(d.id) === String(doc.id));
      if (idx === -1) {
        alert('仅支持编辑用户发布的文档');
        setSaving(false);
        return;
      }
      const nowDate = new Date().toISOString().split('T')[0];
      // 最后编辑人统一使用真名（user.name）优先
      const editor = user?.name || user?.nickname || user?.email || 'Unknown';
      const updated = {
        ...userDocs[idx],
        title,
        description: editDescription,
        content: editContent,
        lastEditedAt: nowDate,
        lastEditedBy: editor,
      };
      userDocs[idx] = updated;
      saveUserDocs(userDocs);

      // —— 本地已保存成功，立即给用户反馈 ——
      // 关闭编辑态 + 显示"已保存"提示，不再阻塞在云端同步上
      setDocsVersion((v) => v + 1);
      setIsEditing(false);
      setSaving(false);
      setSaveHint('saved');
      // 2.5s 后自动消失
      setTimeout(() => {
        setSaveHint((h) => (h === 'saved' ? null : h));
      }, 2500);

      // —— 云端异步同步（不阻塞 UI） ——
      if (canUseSupabase()) {
        cloudUpdateDoc(doc.id, {
          title,
          description: editDescription,
          content: editContent,
          lastEditedAt: nowDate,
          lastEditedBy: editor,
        })
          .then((result) => {
            if (!result.remote) {
              console.warn('[ProcessTemplateDetail] 云端编辑同步失败，其他设备暂不可见', result.error);
              setSaveHint('cloud-failed');
              setTimeout(() => {
                setSaveHint((h) => (h === 'cloud-failed' ? null : h));
              }, 4000);
            } else {
              // 云端成功后同步刷新 cloudData，避免下次重新进入页面读到旧版
              setCloudData((prev) => {
                if (!prev) return prev;
                return {
                  ...prev,
                  userDocs: prev.userDocs.map((d) =>
                    String(d.id) === String(doc.id)
                      ? { ...d, title, description: editDescription, content: editContent, lastEditedAt: nowDate, lastEditedBy: editor }
                      : d
                  ),
                };
              });
            }
          })
          .catch((err) => {
            console.error('[ProcessTemplateDetail] 云端同步异常:', err);
            setSaveHint('cloud-failed');
            setTimeout(() => {
              setSaveHint((h) => (h === 'cloud-failed' ? null : h));
            }, 4000);
          });
      }
    } catch (err) {
      console.error('[ProcessTemplateDetail] 保存失败:', err);
      alert('保存失败，请重试');
      setSaving(false);
    }
  }, [doc, editTitle, editDescription, editContent, user]);

  if (!isAuthenticated) return <Navigate to="/login" replace />;

  if (!doc) {
    return (
      <div className="ptd-page">
        <div className="ptd-topbar">
          <button className="ptd-topbar__back" onClick={() => navigate('/internal/process-templates')}>
            <ChevronLeft size={20} /> 返回列表
          </button>
        </div>
        <div className="ptd-content">
          <div className="ptd-not-found">
            <FolderOpen size={48} />
            <h3>找不到该文档</h3>
            <p>内容可能已被删除或链接不正确</p>
            <button className="btn btn-secondary" onClick={() => navigate('/internal/process-templates')}>
              <ChevronLeft size={16} /> 返回列表
            </button>
          </div>
        </div>
      </div>
    );
  }

  const typeLabel = DEFAULT_TYPE_LABELS[doc.type] || doc.type;
  const typeColor = DEFAULT_TYPE_COLORS[doc.type] || '#6B7280';
  // 合并用户自定义分类配置：Documents 页支持管理员自定义分类 label/color，
  // 这里优先使用动态配置，回退到内置默认值
  const customType = (filterOptions?.documentTypes || []).find(
    (t) => t.key === doc.type
  );
  const finalTypeLabel = customType?.label || typeLabel;
  const finalTypeColor = customType?.color || typeColor;
  const views = loadViews();

  const hasTextContent = doc.content && String(doc.content).trim().length > 0;
  const hasAttachments = Array.isArray(doc.attachments) && doc.attachments.length > 0;
  const hasFileUrl = Boolean(doc.fileUrl);

  const showToc = toc.length > 0 && hasTextContent && (doc.format === 'markdown' || doc.format === 'word');

  /* ========== 编辑权限：用户发布的文档 + （管理员 或 发布者本人） ========== */
  const canEdit = isUserDoc(doc) && (isAdmin || (user?.id && String(user.id) === String(doc.uploadedById)));

  return (
    <div className="ptd-page">
      {/* 顶部导航栏 */}
      <div className="ptd-topbar">
        <button className="ptd-topbar__back" onClick={() => navigate('/internal/process-templates')}>
          <ChevronLeft size={20} /> 返回列表
        </button>
        {/*
          右侧操作区：所有需要吸附到右边的元素（编辑按钮 / 编辑操作组 / 保存提示）
          必须包在同一个容器里，否则顶栏的 space-between 会把中间的子元素
          挤到正中，导致"保存完成时，编辑按钮短暂跳到中间再跳回右边"。
        */}
        <div className="ptd-topbar__right">
          {canEdit && !isEditing && (
            <button
              type="button"
              className="ptd-topbar__edit"
              onClick={startEdit}
              title="编辑此文档"
            >
              <Pencil size={16} /> 编辑
            </button>
          )}
          {canEdit && isEditing && (
            <div className="ptd-topbar__edit-actions">
              <button
                type="button"
                className="ptd-topbar__cancel"
                onClick={cancelEdit}
                disabled={saving}
              >
                <X size={16} /> 取消
              </button>
              <button
                type="button"
                className="ptd-topbar__save"
                onClick={saveEdit}
                disabled={saving}
              >
                <Save size={16} /> {saving ? '保存中…' : '保存'}
              </button>
            </div>
          )}
          {saveHint && (
            <div
              className={`ptd-topbar__save-hint ptd-topbar__save-hint--${saveHint}`}
              role="status"
              aria-live="polite"
            >
              {saveHint === 'saved' ? (
                <>
                  <Check size={14} /> 已保存
                </>
              ) : (
                <>
                  <AlertTriangle size={14} /> 已本地保存，云端同步失败
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 全屏内容区域 */}
      <div className="ptd-content">
        <div className={`ptd-content__inner ${showToc ? 'ptd-content__inner--with-toc' : ''} ${isEditing ? 'ptd-content__inner--editing' : ''}`}>
          {/* 左侧目录 */}
          {showToc && (
            <aside className="ptd-toc ptd-toc--left" aria-label="文档目录">
              <div className="ptd-toc__header">
                <List size={14} />
                <span>目录</span>
              </div>
              <nav className="ptd-toc__list">
                {toc.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`ptd-toc__item ptd-toc__item--l${item.level} ${activeTocId === item.id ? 'ptd-toc__item--active' : ''}`}
                    onClick={() => handleTocClick(item.id)}
                    title={item.text}
                  >
                    <span className="ptd-toc__dot" />
                    <span className="ptd-toc__text">{item.text}</span>
                  </button>
                ))}
              </nav>
            </aside>
          )}

          {/* 文章主体 */}
          <article className={`ptd-article ${isEditing ? 'ptd-article--editing' : ''}`}>
            {/* 文章头部 */}
            <header className="ptd-article__header">
              <span
                className="ptd-article__badge"
                style={{ color: finalTypeColor, background: `${finalTypeColor}15` }}
              >
                {finalTypeLabel}
              </span>
              {doc.format && (
                <span className="ptd-article__format-tag">
                  {doc.format === 'markdown' ? (
                    <><Code2 size={12} /> Markdown</>
                  ) : (
                    <><FileText size={12} /> Word</>
                  )}
                </span>
              )}

              {isEditing ? (
                <input
                  type="text"
                  className="ptd-edit__title-input"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  placeholder="文档标题"
                  maxLength={120}
                />
              ) : (
                <h1 className="ptd-article__title">{doc.title}</h1>
              )}

              {isEditing ? (
                <textarea
                  className="ptd-edit__desc-input"
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  placeholder="简介（可选，支持多行）"
                  rows={2}
                  maxLength={300}
                />
              ) : (
                doc.description && (
                  <p className="ptd-article__desc">{doc.description}</p>
                )
              )}

              <div className="ptd-article__meta">
                <span><User size={14} /> {resolveContributorName(doc.uploadedById, doc.uploadedBy)}</span>
                <span><Clock size={14} /> {doc.date}</span>
                <span><Eye size={14} /> {(views[doc.id] || 0) + (doc.viewCount || 0)} 次浏览</span>
                {doc.size && doc.size !== '—' && (
                  <span><HardDrive size={14} /> {doc.size}</span>
                )}
                {doc.lastEditedAt && !isEditing && (
                  <span title={`由 ${doc.lastEditedBy || 'Unknown'} 编辑`}>
                    <Pencil size={14} /> 最后编辑 {doc.lastEditedAt}
                  </span>
                )}
              </div>
            </header>

            {/* 正文（Markdown / Word-HTML）—— 编辑模式下显示 textarea；非编辑态按原渲染 */}
            {isEditing ? (
              hasTextContent || doc.format === 'markdown' || doc.format === 'word' ? (
                <div className="ptd-edit__content">
                  <div className="ptd-edit__content-hint">
                    <Clipboard size={12} />
                    <span>
                      {doc.format === 'markdown'
                        ? '当前文档为 Markdown 格式，支持 Markdown 语法'
                        : doc.format === 'word'
                          ? '当前文档为 Word 富文本格式，HTML 标签将被保留'
                          : '纯文本编辑'}
                    </span>
                  </div>
                  {doc.format === 'markdown' ? (
                    <div className="msc-md-split ptd-edit__md-split">
                      <div className="msc-md-split__pane">
                        <div className="msc-md-split__label">
                          <Code2 size={14} /> 编辑
                        </div>
                        <textarea
                          className="msc-md-split__editor"
                          value={editContent}
                          onChange={(e) => setEditContent(e.target.value)}
                          placeholder={'# 文档标题\n\n## 一、xxx\n\n正文内容…'}
                          spellCheck={false}
                        />
                      </div>
                      <div className="msc-md-split__pane">
                        <div className="msc-md-split__label">
                          <Eye size={14} /> 预览
                        </div>
                        <div
                          className="msc-md-split__preview"
                          dangerouslySetInnerHTML={{
                            __html:
                              editMarkdownPreview ||
                              '<p class="msc-md-split__empty">在左侧输入 Markdown 内容后，这里会显示实时预览</p>',
                          }}
                        />
                      </div>
                    </div>
                  ) : (
                    <textarea
                      className="ptd-edit__content-textarea"
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      placeholder={'正文内容…'}
                      spellCheck={false}
                    />
                  )}
                </div>
              ) : (
                <div className="ptd-edit__content-empty">
                  <p>该文档为附件/文件型，暂不支持在线编辑正文内容。</p>
                  <p>如需更换文件，请删除后重新发布。</p>
                </div>
              )
            ) : (
              hasTextContent && (
                <div
                  ref={contentRef}
                  className={`ptd-article__content ${doc.format === 'word' ? 'ptd-article__content--word' : 'ptd-article__content--markdown'}`}
                  dangerouslySetInnerHTML={{ __html: renderedContent }}
                />
              )
            )}

            {/* 当没有 content 但有主文件 fileUrl 时：PDF / 图片 / Word 嵌入预览 */}
            {!hasTextContent && hasFileUrl && (
              <div className="ptd-article__file-preview">
                {doc.fileType === 'pdf' && (
                  <iframe src={doc.fileUrl} className="ptd-article__pdf" title={doc.title} />
                )}
                {doc.fileType === 'image' && (
                  <div className="ptd-article__image-wrap">
                    <img src={doc.fileUrl} alt={doc.title} className="ptd-article__image" />
                  </div>
                )}
                {doc.fileType === 'docx' && (
                  <WordPreview fileUrl={doc.fileUrl} docId={doc.id} title={doc.title} />
                )}
                {!['pdf', 'image', 'docx'].includes(doc.fileType) && (
                  <div className="ptd-article__no-preview">
                    <FileText size={48} />
                    <p>该文件格式暂不支持在线预览，请点击下方按钮下载到本地查看。</p>
                    <button
                      className="btn btn-primary"
                      onClick={() => downloadFile({ url: doc.fileUrl, name: doc.title })}
                    >
                      <Download size={16} /> 下载原文件
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* 没有任何内容的兜底 */}
            {!hasTextContent && !hasFileUrl && !hasAttachments && (
              <div className="ptd-article__no-preview">
                <FolderOpen size={48} />
                <p>该文档尚未关联正文或附件。</p>
              </div>
            )}

            {/* 附件列表 */}
            {hasAttachments && (
              <div className="ptd-attachments">
                <div className="ptd-attachments__header">
                  <Paperclip size={16} />
                  <span>附件（{doc.attachments.length}）</span>
                </div>
                <div className="ptd-attachments__list">
                  {doc.attachments.map((f) => {
                    const IconComp = getFileIcon(f.name);
                    return (
                      <button
                        key={f.id || f.name}
                        type="button"
                        className="ptd-attachments__item"
                        onClick={() => downloadFile(f)}
                        title={`下载 ${f.name}`}
                      >
                        <IconComp size={20} className="ptd-attachments__item-icon" />
                        <div className="ptd-attachments__item-info">
                          <span className="ptd-attachments__item-name">{f.name}</span>
                          <span className="ptd-attachments__item-size">{formatFileSize(f.size)}</span>
                        </div>
                        <Download size={16} className="ptd-attachments__item-dl" />
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 底部点赞（编辑模式下隐藏） */}
            {!isEditing && (
              <footer className="ptd-article__footer">
                <button
                  className={`ptd-like-btn ${liked ? 'ptd-like-btn--active' : ''}`}
                  onClick={handleLike}
                >
                  <ThumbsUp size={16} />
                  <span>{liked ? '已赞' : '点赞'}</span>
                </button>
                {likes.length > 0 && (
                  <div className="ptd-like-info">
                    <div className="ptd-like-names">
                      {likes.map((l, idx) => (
                        <span key={l.userId}>
                          {l.userName}{idx < likes.length - 1 ? '、' : ''}
                        </span>
                      ))}
                    </div>
                    <span className="ptd-like-count">{likes.length} 人觉得有用</span>
                  </div>
                )}
              </footer>
            )}
          </article>

          {/* 右侧：所有用户可划线 / 整体评论 */}
          {showToc && !isEditing && (
            <aside className="ptd-comments" aria-label="划线评论">
              <TextAnnotation
                targetType="template"
                targetId={doc.id}
                contentRef={contentRef}
                inline
              />
            </aside>
          )}
        </div>
      </div>

      {/* 移动端浮动目录 */}
      {showToc && (
        <>
          <button
            type="button"
            className="ptd-toc-fab"
            onClick={() => setTocOpenMobile(true)}
            aria-label="打开目录"
          >
            <List size={18} />
          </button>
          {tocOpenMobile && (
            <div
              className="ptd-toc-drawer-mask"
              onClick={() => setTocOpenMobile(false)}
            >
              <div className="ptd-toc-drawer" onClick={(e) => e.stopPropagation()}>
                <div className="ptd-toc-drawer__header">
                  <div className="ptd-toc__header">
                    <List size={14} />
                    <span>目录</span>
                  </div>
                  <button
                    type="button"
                    className="ptd-toc-drawer__close"
                    onClick={() => setTocOpenMobile(false)}
                    aria-label="关闭目录"
                  >
                    <X size={18} />
                  </button>
                </div>
                <nav className="ptd-toc__list">
                  {toc.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`ptd-toc__item ptd-toc__item--l${item.level} ${activeTocId === item.id ? 'ptd-toc__item--active' : ''}`}
                      onClick={() => handleTocClick(item.id)}
                      title={item.text}
                    >
                      <span className="ptd-toc__dot" />
                      <span className="ptd-toc__text">{item.text}</span>
                    </button>
                  ))}
                </nav>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
