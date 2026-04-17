import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Navigate, useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
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
} from 'lucide-react';
import { documentsData } from '../../data/siteData';
import WordPreview from '../../components/WordPreview';
import './ProcessTemplateDetail.css';

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
  const { isAuthenticated, user, isAdmin } = useAuth();
  const { id } = useParams();
  const navigate = useNavigate();
  const contentRef = useRef(null);

  // 合并数据源：localStorage（用户发布） + siteData.documentsData（默认模拟，排除被删除的）
  // 使用 state + 版本号 让"保存"后重新加载数据，而不是永远锁死在首次 mount 快照
  const [docsVersion, setDocsVersion] = useState(0);
  const allDocs = useMemo(() => {
    // 依赖 docsVersion：编辑保存后递增，强制重算；loadUserDocs/loadDeletedDefaultIds 是直接读 localStorage 的纯函数
    void docsVersion;
    const userDocs = loadUserDocs();
    const deletedIds = new Set(loadDeletedDefaultIds());
    const defaults = documentsData.filter((d) => !deletedIds.has(String(d.id)));
    return [...userDocs, ...defaults];
  }, [docsVersion]);

  const doc = useMemo(() => allDocs.find((d) => String(d.id) === String(id)), [allDocs, id]);

  /* 浏览次数：
     - 存在 localStorage: riemer_process_template_views （与卡片列表共享）
     - 同一个会话（同一标签页）内刷新不重复计数，避免"每刷一次就 +1"
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
        // 当前会话内已经计过一次，刷新不再增加
        return;
      }
      const views = loadViews();
      views[doc.id] = (views[doc.id] || 0) + 1;
      saveViews(views);
      sessionViewed.add(String(doc.id));
      sessionStorage.setItem(SESSION_KEY, JSON.stringify([...sessionViewed]));
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
    const headings = root.querySelectorAll('h1, h2, h3');
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

  const handleTocClick = useCallback((tocId) => {
    const el = document.getElementById(tocId);
    if (!el) return;
    const offset = 80;
    const top = el.getBoundingClientRect().top + window.pageYOffset - offset;
    window.scrollTo({ top, behavior: 'smooth' });
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
      const userDocs = loadUserDocs().map((d) =>
        d.id === doc.id ? { ...d, likes: nextLikes } : d
      );
      saveUserDocs(userDocs);
    }
  }, [doc, user, liked, likes]);

  /* ========== 编辑模式 ========== */
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);

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

  const saveEdit = useCallback(() => {
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
      userDocs[idx] = {
        ...userDocs[idx],
        title,
        description: editDescription,
        content: editContent,
        // 保留旧的 format：markdown / word
        lastEditedAt: new Date().toISOString().split('T')[0],
        lastEditedBy: user?.nickname || user?.name || user?.email || 'Unknown',
      };
      saveUserDocs(userDocs);
      setDocsVersion((v) => v + 1);
      setIsEditing(false);
    } catch (err) {
      console.error('[ProcessTemplateDetail] 保存失败:', err);
      alert('保存失败，请重试');
    } finally {
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
      </div>

      {/* 全屏内容区域 */}
      <div className="ptd-content">
        <div className={`ptd-content__inner ${showToc ? 'ptd-content__inner--with-toc' : ''}`}>
          {/* 文章主体 */}
          <article className={`ptd-article ${isEditing ? 'ptd-article--editing' : ''}`}>
            {/* 文章头部 */}
            <header className="ptd-article__header">
              <span
                className="ptd-article__badge"
                style={{ color: typeColor, background: `${typeColor}15` }}
              >
                {typeLabel}
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
                <span><User size={14} /> {doc.uploadedBy || 'Unknown'}</span>
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
                  <textarea
                    className="ptd-edit__content-textarea"
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    placeholder={
                      doc.format === 'markdown'
                        ? '# 标题\n\n正文内容…'
                        : '正文内容…'
                    }
                    spellCheck={false}
                  />
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

            {/* 底部点赞 */}
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
          </article>

          {/* 右侧目录 */}
          {showToc && (
            <aside className="ptd-toc" aria-label="文档目录">
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
