import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Navigate, useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { marked } from 'marked';
import { stripUnderline } from '../../utils/stripUnderline';
import {
  ChevronLeft,
  Clock,
  User,
  Eye,
  ThumbsUp,
  Code2,
  FileText,
  Share2,
  Paperclip,
  Download,
  File,
  Image,
  FileSpreadsheet,
  FileArchive,
  List,
  X,
} from 'lucide-react';
import TextAnnotation from '../../components/TextAnnotation';
import ViewLogPopover from '../../components/ViewLogPopover';
import { recordViewLog, fetchViewLog } from '../../lib/documentsService';
import {
  fetchSharings,
  subscribeSharings,
  updateSharing,
  fetchCategories,
  DEFAULT_CATEGORIES,
} from '../../services/memberSharingService';
import './MemberSharingDetail.css';

const SHARING_VIEWS_KEY = 'riemer_sharing_views';

function buildCategoryMaps(cats) {
  const labels = {};
  const colors = {};
  cats.forEach((c) => {
    labels[c.key] = c.label;
    colors[c.key] = c.color;
  });
  return { labels, colors };
}

/* 附件辅助函数 */
function getFileIcon(name) {
  const ext = name.split('.').pop().toLowerCase();
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return Image;
  if (['pdf'].includes(ext)) return FileText;
  if (['xls', 'xlsx', 'csv'].includes(ext)) return FileSpreadsheet;
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return FileArchive;
  if (['doc', 'docx', 'ppt', 'pptx', 'txt', 'md'].includes(ext)) return FileText;
  return File;
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function downloadFile(attachment) {
  const a = document.createElement('a');
  a.href = attachment.dataUrl;
  a.download = attachment.name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function loadViews() {
  try {
    const stored = localStorage.getItem(SHARING_VIEWS_KEY);
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return {};
}

function saveViews(data) {
  localStorage.setItem(SHARING_VIEWS_KEY, JSON.stringify(data));
}

export default function MemberSharingDetail() {
  const { isAuthenticated, user, getAllUsers } = useAuth();
  const { id } = useParams();
  const navigate = useNavigate();
  const contentRef = useRef(null);

  // 访问记录弹层开关
  const [viewLogOpen, setViewLogOpen] = useState(false);

  // 成员真名映射（用于弹层里把历史数据存的 userName 还原到真名）
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

  // 动态分类
  const [categoryList, setCategoryList] = useState(DEFAULT_CATEGORIES);
  const { labels: categoryLabels, colors: categoryColors } = buildCategoryMaps(categoryList);

  const [sharings, setSharings] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const post = sharings.find((s) => String(s.id) === String(id));

  // 首次加载：云端拉取 + 分类拉取
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [list, cats] = await Promise.all([fetchSharings(), fetchCategories()]);
        if (cancelled) return;
        setSharings(list);
        if (cats && cats.length > 0) setCategoryList(cats);
      } catch (err) {
        console.warn('[MemberSharingDetail] 加载失败:', err);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // 订阅 member_sharing 实时变更
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

  // 浏览次数统计 + 访问日志
  // 同一个会话内重复刷新不重复计数，避免"每刷一次 +1"；
  // 关闭窗口重开 → sessionStorage 清空 → 新会话再计一次。
  useEffect(() => {
    if (!post) return;
    try {
      const SESSION_KEY = 'riemer_msd_session_viewed';
      const sessionViewed = new Set(
        JSON.parse(sessionStorage.getItem(SESSION_KEY) || '[]')
      );
      if (sessionViewed.has(String(post.id))) return;
      const views = loadViews();
      views[post.id] = (views[post.id] || 0) + 1;
      saveViews(views);
      sessionViewed.add(String(post.id));
      sessionStorage.setItem(SESSION_KEY, JSON.stringify([...sessionViewed]));
      // 访问日志（云端 + 本地兜底）
      recordViewLog(String(post.id), user).catch((err) => {
        console.warn('[MemberSharingDetail] 访问日志写入失败:', err);
      });
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post?.id]);

  // 配置 marked
  const renderedContent = useMemo(() => {
    if (!post) return '';
    if (post.format === 'markdown') {
      marked.setOptions({
        breaks: true,
        gfm: true,
      });
      return stripUnderline(marked.parse(stripUnderline(post.content)));
    }
    // word (HTML) 格式直接返回（清掉下划线）
    return stripUnderline(post.content);
  }, [post]);

  // ========== 目录导航（TOC） ==========
  const [toc, setToc] = useState([]);           // [{ id, text, level }]
  const [activeTocId, setActiveTocId] = useState('');
  const [tocOpenMobile, setTocOpenMobile] = useState(false);

  // 内容渲染完毕后提取标题，并给每个标题打 id
  useEffect(() => {
    if (!contentRef.current) return;
    const root = contentRef.current;
    const headings = root.querySelectorAll('h1, h2, h3');
    const items = [];
    const slugCount = {};
    headings.forEach((el, idx) => {
      const raw = (el.textContent || '').trim();
      if (!raw) return;
      // 生成稳定的 id
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
      el.classList.add('msd-heading-anchor');
      items.push({
        id: slug,
        text: raw,
        level: Number(el.tagName.substring(1)), // 1/2/3
      });
    });
    setToc(items);
    setActiveTocId(items[0]?.id || '');
  }, [renderedContent]);

  // 滚动时高亮当前章节
  useEffect(() => {
    if (!toc.length || !contentRef.current) return;
    const headings = toc
      .map((t) => document.getElementById(t.id))
      .filter(Boolean);
    if (!headings.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // 所有交叉中的标题，取最接近顶部的那个
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.target.getBoundingClientRect().top - b.target.getBoundingClientRect().top);
        if (visible[0]) {
          setActiveTocId(visible[0].target.id);
        }
      },
      {
        rootMargin: '-80px 0px -70% 0px',
        threshold: 0,
      },
    );
    headings.forEach((h) => observer.observe(h));
    return () => observer.disconnect();
  }, [toc]);

  const handleTocClick = useCallback((id) => {
    // 优先用最新的内容区 DOM 查找，避免同名 id 残留到页面其它地方
    const root = contentRef.current;
    let el = null;
    try {
      el = root && root.querySelector(`#${CSS.escape(id)}`);
    } catch {
      el = null;
    }
    if (!el) el = document.getElementById(id);
    // 兜底：按文本内容匹配（id 可能因为 DOM 被其它副作用重置或被 sanitize 而丢失）
    if (!el && root) {
      const item = toc.find((t) => t.id === id);
      if (item) {
        const headings = Array.from(root.querySelectorAll('h1, h2, h3'));
        el = headings.find((h) => (h.textContent || '').trim() === item.text) || null;
        if (el && !el.id) el.id = id;
      }
    }
    if (!el) {
      console.warn('[TOC] 未找到对应标题元素：', id);
      return;
    }

    // 找到真正的"可滚动祖先"：谁的 overflow-y 是 auto/scroll 且确实在滚就是它
    const findScrollParent = (node) => {
      let p = node?.parentElement;
      while (p && p !== document.body) {
        const style = window.getComputedStyle(p);
        const oy = style.overflowY;
        if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight) {
          return p;
        }
        p = p.parentElement;
      }
      return null;
    };

    const offset = 80;
    const scrollParent = findScrollParent(el);
    try {
      if (scrollParent) {
        const containerRect = scrollParent.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        const target = scrollParent.scrollTop + (elRect.top - containerRect.top) - offset;
        scrollParent.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
      } else {
        const top = el.getBoundingClientRect().top + window.pageYOffset - offset;
        window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
      }
    } catch {
      const top = el.getBoundingClientRect().top + window.pageYOffset - offset;
      window.scrollTo(0, Math.max(0, top));
    }

    try {
      window.history.replaceState(null, '', `#${id}`);
    } catch { /* ignore */ }
    setActiveTocId(id);
    setTocOpenMobile(false);
  }, [toc]);

  if (!isAuthenticated) return <Navigate to="/login" replace />;

  if (!post) {
    if (!loaded) {
      return (
        <div className="msd-page">
          <div className="msd-topbar">
            <button className="msd-topbar__back" onClick={() => navigate('/internal/member-sharing')}>
              <ChevronLeft size={20} /> 返回列表
            </button>
          </div>
          <div className="msd-content">
            <div className="msd-not-found">
              <Share2 size={48} />
              <h3>加载中…</h3>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="msd-page">
        <div className="msd-topbar">
          <button className="msd-topbar__back" onClick={() => navigate('/internal/member-sharing')}>
            <ChevronLeft size={20} /> 返回列表
          </button>
        </div>
        <div className="msd-content">
          <div className="msd-not-found">
            <Share2 size={48} />
            <h3>找不到该分享</h3>
            <p>内容可能已被删除或链接不正确</p>
            <button className="btn btn-secondary" onClick={() => navigate('/internal/member-sharing')}>
              <ChevronLeft size={16} /> 返回列表
            </button>
          </div>
        </div>
      </div>
    );
  }

  const handleLike = () => {
    if (!user) return;
    let newLikes = null;
    setSharings((prev) =>
      prev.map((s) => {
        if (String(s.id) !== String(post.id)) return s;
        const likes = s.likes || [];
        const already = likes.some((l) => l.userId === user.id);
        newLikes = already
          ? likes.filter((l) => l.userId !== user.id)
          : [...likes, { userId: user.id, userName: user.nickname || user.name || user.email }];
        return { ...s, likes: newLikes };
      }),
    );
    if (newLikes) {
      updateSharing(post.id, { likes: newLikes }).catch(() => { /* ignore */ });
    }
  };

  const hasLiked = post.likes?.some((l) => l.userId === user?.id);
  const views = loadViews();

  const showToc = toc.length > 0 && (post.format === 'markdown' || post.format === 'word');

  return (
    <div className="msd-page">
      {/* 顶部导航栏 — 类似 MemberSharingCreate */}
      <div className="msd-topbar">
        <button className="msd-topbar__back" onClick={() => navigate('/internal/member-sharing')}>
          <ChevronLeft size={20} /> 返回列表
        </button>
      </div>

      {/* 全屏内容区域 */}
      <div className="msd-content">
        <div className={`msd-content__inner ${showToc ? 'msd-content__inner--with-toc' : ''}`}>
          {/* 目录导航（桌面端左侧 sticky） —— 放在 article 之前，确保 grid 顺序：左目录 | 中文章 */}
          {showToc && (
            <aside className="msd-toc" aria-label="文章目录">
              <div className="msd-toc__header">
                <List size={14} />
                <span>目录</span>
              </div>
              <nav className="msd-toc__list">
                {toc.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`msd-toc__item msd-toc__item--l${item.level} ${activeTocId === item.id ? 'msd-toc__item--active' : ''}`}
                    onClick={() => handleTocClick(item.id)}
                    title={item.text}
                  >
                    <span className="msd-toc__dot" />
                    <span className="msd-toc__text">{item.text}</span>
                  </button>
                ))}
              </nav>
            </aside>
          )}

          {/* 文章主体 */}
          <article className="msd-article">
            {/* 文章头部 */}
            <header className="msd-article__header">
              <span
                className="msd-article__badge"
                style={{
                  color: categoryColors[post.category] || '#6B7280',
                  background: `${categoryColors[post.category] || '#6B7280'}15`,
                }}
              >
                {categoryLabels[post.category] || post.category}
              </span>
              <span className="msd-article__format-tag">
                {post.format === 'markdown' ? <><Code2 size={12} /> Markdown</> : <><FileText size={12} /> Word</>}
              </span>

              <h1 className="msd-article__title">{post.title}</h1>

              {post.period && (
                <div className="msd-article__period">
                  <Clock size={13} /> 时间段：{post.period}
                </div>
              )}

              <div className="msd-article__meta">
                <span><User size={14} /> {post.author}</span>
                <span><Clock size={14} /> {post.createdAt}</span>
                <button
                  type="button"
                  className="views-trigger"
                  onClick={() => setViewLogOpen(true)}
                  title="查看所有访问记录"
                >
                  <Eye size={14} /> {views[post.id] || 0} 次浏览
                </button>
              </div>
            </header>

            {/* 文章内容 */}
            <div
              ref={contentRef}
              className={`msd-article__content ${post.format === 'word' ? 'msd-article__content--word' : 'msd-article__content--markdown'}`}
              dangerouslySetInnerHTML={{ __html: renderedContent }}
            />

            {/* 附件列表 */}
            {post.attachments && post.attachments.length > 0 && (
              <div className="msd-attachments">
                <div className="msd-attachments__header">
                  <Paperclip size={16} />
                  <span>附件（{post.attachments.length}）</span>
                </div>
                <div className="msd-attachments__list">
                  {post.attachments.map((file) => {
                    const IconComp = getFileIcon(file.name);
                    return (
                      <button
                        key={file.id}
                        className="msd-attachments__item"
                        onClick={() => downloadFile(file)}
                        title={`下载 ${file.name}`}
                      >
                        <IconComp size={20} className="msd-attachments__item-icon" />
                        <div className="msd-attachments__item-info">
                          <span className="msd-attachments__item-name">{file.name}</span>
                          <span className="msd-attachments__item-size">{formatFileSize(file.size)}</span>
                        </div>
                        <Download size={16} className="msd-attachments__item-dl" />
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 底部点赞 */}
            <footer className="msd-article__footer">
              <button
                className={`msd-like-btn ${hasLiked ? 'msd-like-btn--active' : ''}`}
                onClick={handleLike}
              >
                <ThumbsUp size={16} />
                <span>{hasLiked ? '已赞' : '点赞'}</span>
              </button>
              {(post.likes || []).length > 0 && (
                <div className="msd-like-info">
                  <div className="msd-like-names">
                    {post.likes.map((l, idx) => (
                      <span key={l.userId}>
                        {l.userName}{idx < post.likes.length - 1 ? '、' : ''}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </footer>
          </article>
        </div>
      </div>

      {/* 移动端：浮动目录按钮 + 抽屉 */}
      {showToc && (
        <>
          <button
            type="button"
            className="msd-toc-fab"
            onClick={() => setTocOpenMobile(true)}
            aria-label="打开目录"
          >
            <List size={18} />
          </button>
          {tocOpenMobile && (
            <div
              className="msd-toc-drawer-mask"
              onClick={() => setTocOpenMobile(false)}
            >
              <div
                className="msd-toc-drawer"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="msd-toc-drawer__header">
                  <div className="msd-toc__header">
                    <List size={14} />
                    <span>目录</span>
                  </div>
                  <button
                    type="button"
                    className="msd-toc-drawer__close"
                    onClick={() => setTocOpenMobile(false)}
                    aria-label="关闭目录"
                  >
                    <X size={18} />
                  </button>
                </div>
                <nav className="msd-toc__list">
                  {toc.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`msd-toc__item msd-toc__item--l${item.level} ${activeTocId === item.id ? 'msd-toc__item--active' : ''}`}
                      onClick={() => handleTocClick(item.id)}
                      title={item.text}
                    >
                      <span className="msd-toc__dot" />
                      <span className="msd-toc__text">{item.text}</span>
                    </button>
                  ))}
                </nav>
              </div>
            </div>
          )}
        </>
      )}

      {/* 访问记录弹层：点击浏览数小眼睛时弹出 */}
      <ViewLogPopover
        open={viewLogOpen}
        onClose={() => setViewLogOpen(false)}
        totalCount={views[post.id] || 0}
        fetchLog={() => fetchViewLog(String(post.id))}
        resolveName={resolveVisitorName}
      />

      {/* 划线评论 — 对 Markdown / Word 正文都生效（浮动按钮 + 右侧抽屉） */}
      <TextAnnotation
        targetType="sharing"
        targetId={post.id}
        contentRef={contentRef}
      />
    </div>
  );
}
