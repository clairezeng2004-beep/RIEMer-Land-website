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
import PrevNextNavigator from '../../components/PrevNextNavigator';
import useTocScroll from '../../hooks/useTocScroll';
import useAdjacentItems from '../../hooks/useAdjacentItems';
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
  const ext = String(name || '').split('.').pop().toLowerCase();
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return Image;
  if (['pdf'].includes(ext)) return FileText;
  if (['xls', 'xlsx', 'csv'].includes(ext)) return FileSpreadsheet;
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return FileArchive;
  if (['doc', 'docx', 'ppt', 'pptx', 'txt', 'md'].includes(ext)) return FileText;
  return File;
}

function formatFileSize(bytes) {
  if (!Number.isFinite(Number(bytes))) return '—';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function downloadFile(attachment) {
  const href = attachment?.url || attachment?.dataUrl;
  if (!href) return;
  const a = document.createElement('a');
  a.href = href;
  a.download = attachment.name || 'attachment';
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

  // 多贡献者展示：优先读 post.contributorIds，缺省回退到旧的单作者字段（与流程模板文件一致）
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
  const resolveContributors = useCallback(
    (p) => {
      const ids = Array.isArray(p?.contributorIds) ? p.contributorIds : [];
      if (ids.length > 0) {
        return ids.map((uid) => resolveContributorName(uid, null)).filter(Boolean).join('、')
          || (p?.author || 'Unknown');
      }
      return resolveContributorName(p?.authorId, p?.author);
    },
    [resolveContributorName],
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

  // 动态分类
  const [categoryList, setCategoryList] = useState(DEFAULT_CATEGORIES);
  const { labels: categoryLabels, colors: categoryColors } = buildCategoryMaps(categoryList);

  const [sharings, setSharings] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const post = sharings.find((s) => String(s.id) === String(id));

  // 浏览器标签页标题：新窗口里直观显示这是成员分享的文档
  useEffect(() => {
    const prev = document.title;
    document.title = '成员内部分享 - 文档查看';
    return () => { document.title = prev; };
  }, []);

  // 首次加载：云端拉取 + 分类拉取
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [list, cats] = await Promise.all([fetchSharings(), fetchCategories()]);
        if (cancelled) return;
        setSharings(list);
        // 兼容云端返回空数组（他人已在另一设备把分类全部删除的场景）
        if (Array.isArray(cats)) setCategoryList(cats);
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
    const rawContent = String(post.content || '');
    if (post.format === 'markdown') {
      return stripUnderline(marked.parse(stripUnderline(rawContent), { breaks: true, gfm: true }));
    }
    // word (HTML) 格式直接返回（清掉下划线）
    return stripUnderline(rawContent);
  }, [post]);

  // 上/下一篇：sharings 已按 created_at 降序；同作者优先（authorId 可能为 null，
  // hook 会自动 fallback 到按 author 字符串匹配）
  const { prev: prevSharing, next: nextSharing, prevSameAuthor, nextSameAuthor } = useAdjacentItems({
    items: sharings,
    currentId: id,
    getId: (s) => s?.id,
    getAuthorKey: (s) => s?.authorId || s?.author || null,
  });

  /* ========== 目录导航（TOC） ==========
   * 实现下沉到 useTocScroll 公共 hook，与 ProcessTemplateDetail
   * 共用同一套逻辑（强兜底：id 丢失时按文本内容重找；rect=0 时
   * rAF 重试；探测真实滚动容器等），避免两边行为漂移。 */
  const {
    toc,
    activeTocId,
    tocOpenMobile,
    setTocOpenMobile,
    handleTocClick,
  } = useTocScroll({
    contentRef,
    renderedContent,
    headingSelector: 'h1, h2, h3',
    anchorClassName: 'msd-heading-anchor',
    // navbar(72) + fixed topbar(~60) + 缓冲(~12)
    scrollOffset: 144,
  });

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
          : [...likes, { userId: user.id, userName: user.name || user.nickname || user.email }];
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

              <h1 className="msd-article__title">{post.title}</h1>

              {post.period && (
                <div className="msd-article__period">
                  {/* 历史会议存的是单个年月点（如 "2025.06"），用"会议时间"更贴切；
                      其它分类（目前只有"成员经验分享"会用）仍叫"时间段"。 */}
                  <Clock size={13} /> {post.category === 'history' ? '会议时间' : '时间段'}：{post.period}
                </div>
              )}

              <div className="msd-article__meta">
                <span><User size={14} /> {resolveContributors(post)}</span>
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
            {Array.isArray(post.attachments) && post.attachments.length > 0 && (
              <div className="msd-attachments">
                <div className="msd-attachments__header">
                  <Paperclip size={16} />
                  <span>附件（{post.attachments.length}）</span>
                </div>
                <div className="msd-attachments__list">
                  {post.attachments.map((file) => {
                    const IconComp = getFileIcon(file?.name);
                    return (
                      <button
                        key={file?.id || file?.name}
                        className="msd-attachments__item"
                        onClick={() => downloadFile(file)}
                        title={`下载 ${file?.name || '附件'}`}
                      >
                        <IconComp size={20} className="msd-attachments__item-icon" />
                        <div className="msd-attachments__item-info">
                          <span className="msd-attachments__item-name">{file?.name || '未命名附件'}</span>
                          <span className="msd-attachments__item-size">{formatFileSize(file?.size)}</span>
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
                        {resolveLikeUserName(l)}{idx < post.likes.length - 1 ? '、' : ''}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </footer>

            {/* 上一篇 / 下一篇 —— 同作者优先推荐；两端到尽头时对应卡位会隐去 */}
            <PrevNextNavigator
              prev={prevSharing}
              next={nextSharing}
              prevSameAuthor={prevSameAuthor}
              nextSameAuthor={nextSameAuthor}
              getHref={(s) => `/internal/member-sharing/view/${s.id}`}
              getTitle={(s) => s.title}
              getAuthor={(s) => s.author || ''}
            />
          </article>

          {/* 右侧：所有用户可划线 / 整体评论（与流程模板文件详情页一致） */}
          {showToc && (
            <aside className="msd-comments" aria-label="划线评论">
              <TextAnnotation
                targetType="sharing"
                targetId={post.id}
                contentRef={contentRef}
                inline
              />
            </aside>
          )}
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

      {/* 划线评论 — 无目录时（短文档无标题）回退为浮动按钮 + 右侧抽屉；
          有目录时已在上方以 inline 侧栏形式呈现，与流程模板文件详情页一致。 */}
      {!showToc && (
        <TextAnnotation
          targetType="sharing"
          targetId={post.id}
          contentRef={contentRef}
        />
      )}
    </div>
  );
}
