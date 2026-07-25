import { useState, useEffect, useRef, useCallback } from 'react';
import {
  MessageSquare, X, Send, Trash2, CornerDownRight,
  CheckCircle, Circle, ChevronDown, ChevronUp, User,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  getComments, addComment, replyToComment,
  toggleResolve, deleteComment, deleteReply,
} from '../services/commentService';
import { getCachedAllUsers } from '../lib/userDirectoryCache';
import './TextAnnotation.css';

// ---- 头像背景色（统一主题色） ----
const AVATAR_BG = '#5B8C3E';
const FLOATING_COMMENT_WIDTH = 360;
const FLOATING_COMMENT_MAX_HEIGHT = 220;
const FLOATING_TRIGGER_WIDTH = 86;
const MOBILE_COMMENT_BREAKPOINT = 768;

function timeAgo(dateStr) {
  const now = new Date();
  const d = new Date(dateStr);
  const diffMs = now - d;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return d.toLocaleDateString('zh-CN');
}

function getSelectionEndRect(range) {
  if (!range) return null;
  const caretRange = range.cloneRange();
  caretRange.collapse(false);
  const caretRect = caretRange.getBoundingClientRect();
  if (caretRect && (caretRect.height > 0 || caretRect.width > 0)) return caretRect;

  const rects = Array.from(range.getClientRects()).filter((rect) => rect.height > 0);
  const lastRect = rects[rects.length - 1] || range.getBoundingClientRect();
  return {
    left: lastRect.right,
    right: lastRect.right,
    top: lastRect.top,
    bottom: lastRect.bottom,
    width: 0,
    height: lastRect.height,
  };
}

function getSelectionToolbarPosition(rect, toolbarWidth = FLOATING_TRIGGER_WIDTH) {
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
  const safeGap = 10;
  const safeEdge = 12;
  const width = Math.min(toolbarWidth, Math.max(1, viewportWidth - safeEdge * 2));
  const rawCenter = rect.right;
  const minX = safeEdge + width / 2;
  const maxX = Math.max(minX, viewportWidth - safeEdge - width / 2);
  const x = Math.min(maxX, Math.max(minX, rawCenter));
  const hasRoomBelow = rect.bottom + safeGap + FLOATING_COMMENT_MAX_HEIGHT < viewportHeight;
  const y = hasRoomBelow
    ? rect.bottom + safeGap
    : Math.max(safeEdge, rect.top - safeGap);
  return {
    x,
    y,
    placement: hasRoomBelow ? 'bottom' : 'top',
  };
}

function autoGrowTextarea(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${Math.min(140, Math.max(36, el.scrollHeight))}px`;
}

function getAnnotationGroupKey(text) {
  return String(text || '').trim();
}

function groupAnchoredComments(commentList) {
  const groups = [];
  const groupMap = new Map();

  commentList.forEach((comment) => {
    const key = getAnnotationGroupKey(comment.selectedText);
    if (!key) return;

    if (!groupMap.has(key)) {
      const group = {
        key,
        selectedText: comment.selectedText,
        comments: [],
      };
      groupMap.set(key, group);
      groups.push(group);
    }

    groupMap.get(key).comments.push(comment);
  });

  return groups;
}

/**
 * TextAnnotation — 划词评论组件
 *
 * Props:
 *   targetType: 'article' | 'document' | 'sharing' | 'template'
 *   targetId: string
 *   contentRef: React.RefObject — 包裹可选中内容的 DOM 容器
 *   disabled?: boolean — 如果为 true 则不显示划词工具栏
 *   inline?: boolean —
 *     false（默认）：浮动按钮 + 右侧抽屉面板（老版样式）。
 *     true：不渲染浮动按钮和抽屉，评论面板作为子元素直接输出，
 *           由父组件布局到想要的位置（例如右侧侧栏）。
 */
export default function TextAnnotation({
  targetType,
  targetId,
  contentRef,
  disabled,
  inline = false,
}) {
  const { user, getAllUsers } = useAuth();
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showPanel, setShowPanel] = useState(false);
  const [showResolved, setShowResolved] = useState(false);

  // 评论作者真名映射（id → 真名），保证评论始终显示注册时的真名而非昵称。
  // 来源：AuthContext.getAllUsers()（合并 Supabase + 本地），经 getCachedAllUsers
  // 做了 30s 模块级缓存 + 并发去重——同一页面里其它组件（如 ProcessTemplateDetail）
  // 同时调用时只会真正触发一次 profiles 全表拉取，解决打开文档时「加载评论中…」
  // 被冗余的用户目录请求拖慢的问题。
  const [userNameMap, setUserNameMap] = useState({});
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await getCachedAllUsers(getAllUsers);
        if (cancelled) return;
        const map = {};
        list.forEach((u) => {
          if (u?.id) map[u.id] = u.name || u.nickname || '';
        });
        setUserNameMap(map);
      } catch {
        /* 拉取失败时回退到 comment.userName 原值 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getAllUsers]);

  // 解析评论作者显示名：优先真名映射，其次当前登录用户的 name（覆盖本人旧评论），
  // 再回退到写入时存储的 userName
  const resolveDisplayName = useCallback(
    (uid, fallback) => {
      if (uid && userNameMap[uid]) return userNameMap[uid];
      if (uid && user?.id === uid && (user.name || user.nickname)) {
        return user.name || user.nickname;
      }
      return fallback || '';
    },
    [userNameMap, user],
  );

  // 浮动工具栏（划中文字后弹出）
  const [toolbar, setToolbar] = useState({ visible: false, x: 0, y: 0, placement: 'bottom' });
  const [selection, setSelection] = useState({ text: '', anchorData: null });

  // 评论输入
  const [commentInput, setCommentInput] = useState('');
  const [isCommenting, setIsCommenting] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // 回复
  const [replyingTo, setReplyingTo] = useState(null);
  const [replyInput, setReplyInput] = useState('');

  // 活跃高亮
  const [activeCommentId, setActiveCommentId] = useState(null);
  const [commentAnchors, setCommentAnchors] = useState({});
  const [contentHeight, setContentHeight] = useState(0);
  const [mobileThread, setMobileThread] = useState(null);

  const toolbarRef = useRef(null);
  const panelRef = useRef(null);
  const anchoredMapRef = useRef(null);

  // ---- 加载评论（异步） ----
  const loadComments = useCallback(async () => {
    setLoading(true);
    try {
      const list = await getComments(targetType, targetId);
      setComments(list);
    } catch (err) {
      console.error('[TextAnnotation] 加载评论失败:', err);
      setComments([]);
    } finally {
      setLoading(false);
    }
  }, [targetType, targetId]);

  useEffect(() => {
    loadComments();
  }, [loadComments]);

  // ---- 高亮已有评论的文本 ----
  useEffect(() => {
    if (!contentRef?.current) return;
    const container = contentRef.current;

    // 清除旧高亮
    container.querySelectorAll('.ta-highlight').forEach((el) => {
      const parent = el.parentNode;
      parent.replaceChild(document.createTextNode(el.textContent), el);
      parent.normalize();
    });

    // 只高亮有选中文本的、未解决的评论；同一段文字只标一次，并显示该处评论数
    const activeComments = comments.filter((c) => c.selectedText && !c.resolved);
    const activeGroups = groupAnchoredComments(activeComments);

    activeGroups.forEach((group) => {
      try {
        highlightText(container, group.selectedText, group.key, group.comments.length);
      } catch {
        // 文本可能已变化，忽略
      }
    });

    requestAnimationFrame(() => {
      const containerRect = container.getBoundingClientRect();
      const next = {};
      const marks = Array.from(container.querySelectorAll('.ta-highlight'));
      setContentHeight(Math.max(container.scrollHeight || 0, containerRect.height || 0));
      activeGroups.forEach((group) => {
        const mark = marks.find((el) => el.dataset.commentGroup === group.key);
        if (!mark) return;
        const rect = mark.getBoundingClientRect();
        const top = Math.max(0, rect.top - containerRect.top + container.scrollTop);
        group.comments.forEach((comment) => {
          next[comment.id] = top;
        });
      });
      setCommentAnchors(next);
    });
  }, [comments, contentRef]);

  // 图片/折叠内容加载、窗口变化或页面滚动时，重新量一次高亮位置，
  // 让右侧评论卡片始终跟随它对应的下划线段落。
  useEffect(() => {
    if (!inline || !contentRef?.current) return;
    const container = contentRef.current;
    let frame = null;

    const measureAnchors = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const containerRect = container.getBoundingClientRect();
        const mapRect = anchoredMapRef.current?.getBoundingClientRect?.() || null;
        const next = {};
        setContentHeight(Math.max(container.scrollHeight || 0, containerRect.height || 0));
        const activeComments = comments.filter((c) => c.selectedText && !c.resolved);
        const activeGroups = groupAnchoredComments(activeComments);
        const marks = Array.from(container.querySelectorAll('.ta-highlight'));
        activeGroups.forEach((group) => {
          const mark = marks.find((el) => el.dataset.commentGroup === group.key);
          if (!mark) return;
          const rect = mark.getBoundingClientRect();
          const top = mapRect
            ? rect.top - mapRect.top
            : rect.top - containerRect.top + container.scrollTop;
          group.comments.forEach((comment) => {
            next[comment.id] = top;
          });
        });
        setCommentAnchors(next);
      });
    };

    measureAnchors();
    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(measureAnchors)
      : null;
    try { resizeObserver?.observe(container); } catch { /* ignore */ }
    const imgs = Array.from(container.querySelectorAll('img'));
    imgs.forEach((img) => {
      img.addEventListener('load', measureAnchors);
      img.addEventListener('error', measureAnchors);
    });
    window.addEventListener('scroll', measureAnchors, { passive: true, capture: true });
    window.addEventListener('resize', measureAnchors);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      imgs.forEach((img) => {
        img.removeEventListener('load', measureAnchors);
        img.removeEventListener('error', measureAnchors);
      });
      window.removeEventListener('scroll', measureAnchors, { capture: true });
      window.removeEventListener('resize', measureAnchors);
    };
  }, [comments, contentRef, inline]);

  // 手机端阅读：点击划词标记，展开该位置对应的评论
  useEffect(() => {
    if (!contentRef?.current) return;
    const container = contentRef.current;

    const handleHighlightClick = (e) => {
      const mark = e.target.closest?.('.ta-highlight');
      if (!mark || !container.contains(mark)) return;
      if ((window.innerWidth || document.documentElement.clientWidth || 0) > MOBILE_COMMENT_BREAKPOINT) {
        return;
      }

      const key = mark.dataset.commentGroup;
      const groups = groupAnchoredComments(comments.filter((c) => c.selectedText && !c.resolved));
      const group = groups.find((item) => item.key === key);
      if (!group) return;

      e.preventDefault();
      e.stopPropagation();
      setMobileThread(group);
      setActiveCommentId(group.comments[0]?.id || null);
    };

    container.addEventListener('click', handleHighlightClick);
    return () => {
      container.removeEventListener('click', handleHighlightClick);
    };
  }, [comments, contentRef]);

  // ---- 划词检测 ----
  useEffect(() => {
    if (disabled || !contentRef?.current) return;

    const handleMouseUp = (e) => {
      // 延迟一下让浏览器完成选区
      setTimeout(() => {
        const sel = window.getSelection();
        const text = sel?.toString().trim();

        if (!text || text.length < 2) {
          // 如果不是点击在工具栏上，隐藏工具栏
          if (toolbarRef.current && !toolbarRef.current.contains(e.target)) {
            setToolbar({ visible: false, x: 0, y: 0, placement: 'bottom' });
          }
          return;
        }

        // 检查选区是否在 contentRef 内
        if (!contentRef.current.contains(sel.anchorNode)) return;

        const range = sel.getRangeAt(0);
        const rect = getSelectionEndRect(range);
        if (!rect) return;
        const nextPos = getSelectionToolbarPosition(rect);

        setSelection({
          text,
          anchorData: {
            contextBefore: getContextBefore(sel.anchorNode, 30),
            contextAfter: getContextAfter(sel.focusNode, 30),
          },
        });

        setToolbar({
          visible: true,
          ...nextPos,
        });
      }, 10);
    };

    const container = contentRef.current;
    container.addEventListener('mouseup', handleMouseUp);
    container.addEventListener('touchend', handleMouseUp);
    return () => {
      container.removeEventListener('mouseup', handleMouseUp);
      container.removeEventListener('touchend', handleMouseUp);
    };
  }, [disabled, contentRef]);

  // 点击外部关闭工具栏
  useEffect(() => {
    const handleClick = (e) => {
      if (
        toolbar.visible &&
        toolbarRef.current &&
        !toolbarRef.current.contains(e.target)
      ) {
        const sel = window.getSelection();
        if (!sel?.toString().trim()) {
          setToolbar({ visible: false, x: 0, y: 0, placement: 'bottom' });
          setIsCommenting(false);
          setCommentInput('');
        }
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [toolbar.visible]);

  // 滚动 / 窗口尺寸变化时：重新计算工具栏位置（固定定位需要跟随选区视口坐标）
  useEffect(() => {
    if (!toolbar.visible || !contentRef?.current) return;
    const recomputePosition = () => {
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount || !sel.toString().trim()) return;
      try {
        const range = sel.getRangeAt(0);
        const rect = getSelectionEndRect(range);
        if (!rect) return;
        const nextPos = getSelectionToolbarPosition(
          rect,
          isCommenting ? FLOATING_COMMENT_WIDTH : FLOATING_TRIGGER_WIDTH,
        );
        setToolbar((prev) => ({
          ...prev,
          ...nextPos,
        }));
      } catch {
        /* ignore */
      }
    };
    window.addEventListener('scroll', recomputePosition, true);
    window.addEventListener('resize', recomputePosition);
    return () => {
      window.removeEventListener('scroll', recomputePosition, true);
      window.removeEventListener('resize', recomputePosition);
    };
  }, [toolbar.visible, contentRef, isCommenting]);

  // ---- 提交评论（划中文本） ----
  const handleSubmitComment = async () => {
    if (!commentInput.trim() || !user || submitting) return;
    setSubmitting(true);
    try {
      const newComment = await addComment({
        targetType,
        targetId,
        selectedText: selection.text,
        content: commentInput.trim(),
        user,
        anchorData: selection.anchorData,
      });
      // 乐观更新：先把新评论塞进列表，即便 loadComments 之后再刷新一次也不会闪
      if (newComment) {
        setComments((prev) => [newComment, ...prev]);
      }
      setCommentInput('');
      setIsCommenting(false);
      setToolbar({ visible: false, x: 0, y: 0, placement: 'bottom' });
      window.getSelection()?.removeAllRanges();
      if (!inline) setShowPanel(true);
      // 异步对齐远端数据（失败也无所谓，乐观插入已经生效）
      loadComments().catch(() => {});
    } catch (err) {
      console.error('[TextAnnotation] 提交评论失败:', err);
      alert(`评论提交失败：${err?.message || '未知错误'}\n请检查网络或稍后再试`);
    } finally {
      setSubmitting(false);
    }
  };

  // ---- 提交整体评论（无选中文本） ----
  const handleSubmitGeneralComment = async () => {
    if (!commentInput.trim() || !user || submitting) return;
    setSubmitting(true);
    try {
      const newComment = await addComment({
        targetType,
        targetId,
        selectedText: '',
        content: commentInput.trim(),
        user,
        anchorData: null,
      });
      if (newComment) {
        setComments((prev) => [newComment, ...prev]);
      }
      setCommentInput('');
      loadComments().catch(() => {});
    } catch (err) {
      console.error('[TextAnnotation] 提交整体评论失败:', err);
      alert(`评论提交失败：${err?.message || '未知错误'}\n请检查网络或稍后再试`);
    } finally {
      setSubmitting(false);
    }
  };

  // ---- 提交回复 ----
  const handleSubmitReply = async (commentId) => {
    if (!replyInput.trim() || !user) return;
    try {
      const newReply = await replyToComment(commentId, { content: replyInput.trim(), user });
      if (newReply) {
        setComments((prev) =>
          prev.map((c) =>
            c.id === commentId
              ? { ...c, replies: [...(c.replies || []), newReply] }
              : c,
          ),
        );
      }
      setReplyInput('');
      setReplyingTo(null);
      loadComments().catch(() => {});
    } catch (err) {
      console.error('[TextAnnotation] 回复失败:', err);
      alert(`回复提交失败：${err?.message || '未知错误'}\n请检查网络或稍后再试`);
    }
  };

  // ---- 解决 / 删除 ----
  const handleResolve = async (id) => {
    try {
      await toggleResolve(id);
      await loadComments();
    } catch (err) {
      console.error('[TextAnnotation] 切换状态失败:', err);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('确定要删除这条评论吗？')) return;
    try {
      await deleteComment(id);
      await loadComments();
    } catch (err) {
      console.error('[TextAnnotation] 删除失败:', err);
      alert('删除失败，请稍后再试');
    }
  };

  const handleDeleteReply = async (commentId, replyId) => {
    try {
      await deleteReply(commentId, replyId);
      await loadComments();
    } catch (err) {
      console.error('[TextAnnotation] 删除回复失败:', err);
    }
  };

  // ---- 分组 ----
  const generalComments = comments.filter((c) => !c.selectedText && !c.resolved);
  const anchoredComments = comments.filter((c) => c.selectedText && !c.resolved);
  const unresolvedComments = comments.filter((c) => !c.resolved);
  const resolvedComments = comments.filter((c) => c.resolved);
  const anchoredGroupsForReading = groupAnchoredComments(anchoredComments)
    .map((group) => {
      const tops = group.comments
        .map((comment) => commentAnchors[comment.id])
        .filter(Number.isFinite);
      return {
        ...group,
        anchorTop: tops.length ? Math.min(...tops) : null,
      };
    })
    .sort((a, b) => {
      if (a.anchorTop !== null && b.anchorTop !== null) return a.anchorTop - b.anchorTop;
      if (a.anchorTop !== null) return -1;
      if (b.anchorTop !== null) return 1;
      const aTime = Math.max(...a.comments.map((comment) => new Date(comment.createdAt || 0).getTime()));
      const bTime = Math.max(...b.comments.map((comment) => new Date(comment.createdAt || 0).getTime()));
      return bTime - aTime;
    });

  // ---- 渲染头像 ----
  const renderAvatar = (name, avatar, size = 28) => {
    if (avatar) {
      return (
        <img
          src={avatar}
          alt={name}
          className="ta-avatar-img"
          style={{ width: size, height: size }}
        />
      );
    }
    return (
      <div
        className="ta-avatar-placeholder"
        style={{
          width: size,
          height: size,
          background: AVATAR_BG,
          fontSize: size * 0.45,
        }}
      >
        <User size={size * 0.55} />
      </div>
    );
  };

  // ---- 渲染单条评论 ----
  const renderComment = (comment) => {
    const isOwner = user?.id === comment.userId;
    const isActive = activeCommentId === comment.id;

    return (
      <div
        key={comment.id}
        className={`ta-comment ${isActive ? 'ta-comment--active' : ''} ${comment.resolved ? 'ta-comment--resolved' : ''}`}
        onMouseEnter={() => setActiveCommentId(comment.id)}
        onMouseLeave={() => setActiveCommentId(null)}
      >
        {/* 选中的文本引用 */}
        {comment.selectedText && (
          <div className="ta-comment__quote">
            <span className="ta-comment__quote-mark">&ldquo;</span>
            <span className="ta-comment__quote-text">
              {comment.selectedText.length > 80
                ? comment.selectedText.slice(0, 80) + '…'
                : comment.selectedText}
            </span>
            <span className="ta-comment__quote-mark">&rdquo;</span>
          </div>
        )}

        {/* 评论头部 */}
        <div className="ta-comment__header">
          {(() => {
            const displayName = resolveDisplayName(comment.userId, comment.userName);
            return (
              <>
                {renderAvatar(displayName, comment.userAvatar, 26)}
                <span className="ta-comment__author">{displayName}</span>
              </>
            );
          })()}
          <span className="ta-comment__time">{timeAgo(comment.createdAt)}</span>
        </div>

        {/* 评论内容 */}
        <div className="ta-comment__content">{comment.content}</div>

        {/* 操作按钮 */}
        <div className="ta-comment__actions">
          <button
            className={`ta-comment__action ${comment.resolved ? 'ta-comment__action--resolved' : ''}`}
            onClick={() => handleResolve(comment.id)}
            title={comment.resolved ? '取消解决' : '标记为已解决'}
          >
            {comment.resolved ? <CheckCircle size={13} /> : <Circle size={13} />}
            <span>{comment.resolved ? '已解决' : '解决'}</span>
          </button>
          <button
            className="ta-comment__action"
            onClick={() => {
              setReplyingTo(replyingTo === comment.id ? null : comment.id);
              setReplyInput('');
            }}
          >
            <CornerDownRight size={13} />
            <span>回复</span>
          </button>
          {isOwner && (
            <button
              className="ta-comment__action ta-comment__action--danger"
              onClick={() => handleDelete(comment.id)}
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>

        {/* 回复列表 */}
        {comment.replies && comment.replies.length > 0 && (
          <div className="ta-comment__replies">
            {comment.replies.map((reply) => {
              const replyName = resolveDisplayName(reply.userId, reply.userName);
              return (
                <div key={reply.id} className="ta-reply">
                  <div className="ta-reply__header">
                    {renderAvatar(replyName, reply.userAvatar, 22)}
                    <span className="ta-reply__author">{replyName}</span>
                    <span className="ta-reply__time">{timeAgo(reply.createdAt)}</span>
                    {user?.id === reply.userId && (
                      <button
                        className="ta-reply__delete"
                        onClick={() => handleDeleteReply(comment.id, reply.id)}
                        title="删除回复"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                  <div className="ta-reply__content">{reply.content}</div>
                </div>
              );
            })}
          </div>
        )}

        {/* 回复输入框 */}
        {replyingTo === comment.id && (
          <div className="ta-reply-input">
            <input
              type="text"
              value={replyInput}
              onChange={(e) => setReplyInput(e.target.value)}
              placeholder="回复评论…"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSubmitReply(comment.id);
                if (e.key === 'Escape') setReplyingTo(null);
              }}
            />
            <button
              onClick={() => handleSubmitReply(comment.id)}
              disabled={!replyInput.trim()}
            >
              <Send size={14} />
            </button>
          </div>
        )}
      </div>
    );
  };

  const renderAnchoredGroup = (group, index) => {
    const currentTop = group.anchorTop;
    const fallbackTop = index * 180;
    const top = currentTop !== null ? currentTop : fallbackTop;
    return (
      <div
        key={group.key}
        className="ta-anchored-comment"
        style={inline ? { top: `${top}px` } : undefined}
      >
        {group.comments.map(renderComment)}
      </div>
    );
  };

  if (!user) return null;

  // ---- 共享的"面板内部"内容（输入框 + 列表） ----
  const panelBody = (
    <>
      {/* 整体评论输入 */}
      <div className="ta-panel__new-comment">
        <div className="ta-panel__new-input-row">
          <textarea
            value={!isCommenting ? commentInput : ''}
            onChange={(e) => {
              if (!isCommenting) setCommentInput(e.target.value);
              autoGrowTextarea(e.target);
            }}
            placeholder="添加整体评论…（或划选文字精准评论）"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmitGeneralComment();
            }}
            rows={1}
          />
          <button
            onClick={handleSubmitGeneralComment}
            disabled={isCommenting || !commentInput.trim() || submitting}
          >
            <Send size={14} />
          </button>
        </div>
      </div>

      {/* 评论列表 */}
      <div className="ta-panel__list">
        {loading && comments.length === 0 && (
          <div className="ta-panel__empty">
            <MessageSquare size={28} />
            <p>加载评论中…</p>
          </div>
        )}

        {!loading &&
          unresolvedComments.length === 0 &&
          resolvedComments.length === 0 && (
            <div className="ta-panel__empty">
              <MessageSquare size={32} />
              <p>暂无评论</p>
              <span>选中文字后点击「评论」，或在上方输入整体评论</span>
            </div>
          )}

        {inline ? (
          <>
            {generalComments.length > 0 && (
              <div className="ta-panel__section">
                <div className="ta-panel__section-title">整体评论</div>
                {generalComments.map(renderComment)}
              </div>
            )}
            {anchoredGroupsForReading.length > 0 && (
              <div className="ta-panel__section ta-panel__section--anchored">
                <div className="ta-panel__section-title">划词评论</div>
                <div
                  ref={anchoredMapRef}
                  className="ta-anchored-map"
                  style={{ minHeight: `${Math.max(contentHeight, 240)}px` }}
                >
                  {anchoredGroupsForReading.map(renderAnchoredGroup)}
                </div>
              </div>
            )}
          </>
        ) : (
          unresolvedComments.map(renderComment)
        )}

        {/* 已解决评论折叠 */}
        {resolvedComments.length > 0 && (
          <div className="ta-panel__resolved-section">
            <button
              className="ta-panel__resolved-toggle"
              onClick={() => setShowResolved(!showResolved)}
            >
              {showResolved ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              <span>已解决 ({resolvedComments.length})</span>
            </button>
            {showResolved && resolvedComments.map(renderComment)}
          </div>
        )}
      </div>
    </>
  );

  // ---- 浮动工具栏（划中文字后弹出，inline 与否都需要） ----
  const floatingToolbar = toolbar.visible && (
    <div
      ref={toolbarRef}
      className={`ta-toolbar ${isCommenting ? 'ta-toolbar--commenting' : ''}`}
      data-placement={toolbar.placement}
      style={{
        left: toolbar.x,
        top: toolbar.y,
      }}
    >
      {!isCommenting ? (
        <button
          className="ta-toolbar__btn"
          onClick={() => setIsCommenting(true)}
        >
          <MessageSquare size={14} />
          <span>评论</span>
        </button>
      ) : (
        <div className="ta-toolbar__input-area">
          <div className="ta-toolbar__selected-text">
            &ldquo;{selection.text.length > 40
              ? selection.text.slice(0, 40) + '…'
              : selection.text}&rdquo;
          </div>
          <div className="ta-toolbar__input-row">
            <textarea
              value={commentInput}
              onChange={(e) => {
                setCommentInput(e.target.value);
                autoGrowTextarea(e.target);
              }}
              placeholder="写下你的评论…"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmitComment();
                if (e.key === 'Escape') {
                  setIsCommenting(false);
                  setCommentInput('');
                }
              }}
              rows={2}
            />
            <button
              onClick={handleSubmitComment}
              disabled={!commentInput.trim() || submitting}
              className="ta-toolbar__send"
            >
              <Send size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );

  const mobileThreadOverlay = mobileThread && (
    <div
      className="ta-mobile-thread-overlay"
      onClick={() => setMobileThread(null)}
    >
      <div
        className="ta-mobile-thread"
        role="dialog"
        aria-modal="true"
        aria-label="划词评论"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ta-mobile-thread__header">
          <div>
            <div className="ta-mobile-thread__title">
              划词评论 ({mobileThread.comments.length})
            </div>
            <div className="ta-mobile-thread__quote">
              &ldquo;{mobileThread.selectedText.length > 48
                ? mobileThread.selectedText.slice(0, 48) + '…'
                : mobileThread.selectedText}&rdquo;
            </div>
          </div>
          <button
            className="ta-mobile-thread__close"
            onClick={() => setMobileThread(null)}
            aria-label="关闭"
          >
            <X size={18} />
          </button>
        </div>
        <div className="ta-mobile-thread__list">
          {mobileThread.comments.map(renderComment)}
        </div>
      </div>
    </div>
  );

  // ================================================================
  // 渲染：inline 模式 —— 作为子元素直接输出一个面板
  // ================================================================
  if (inline) {
    return (
      <div className="ta-inline">
        {floatingToolbar}
        {mobileThreadOverlay}
        <div className="ta-panel ta-panel--inline ta-panel--open">
          <div className="ta-panel__header">
            <h4>
              <MessageSquare size={16} />
              评论 ({comments.length})
            </h4>
          </div>
          {panelBody}
        </div>
      </div>
    );
  }

  // ================================================================
  // 渲染：默认模式 —— 浮动按钮 + 抽屉面板
  // ================================================================
  return (
    <>
      {floatingToolbar}
      {mobileThreadOverlay}

      {/* 评论面板入口按钮 */}
      <button
        className={`ta-toggle ${showPanel ? 'ta-toggle--active' : ''}`}
        onClick={() => setShowPanel(!showPanel)}
        title={showPanel ? '关闭评论面板' : '查看评论'}
      >
        <MessageSquare size={16} />
        {comments.length > 0 && (
          <span className="ta-toggle__count">{comments.length}</span>
        )}
      </button>

      {/* 评论侧面板 */}
      <div className={`ta-panel ${showPanel ? 'ta-panel--open' : ''}`} ref={panelRef}>
        <div className="ta-panel__header">
          <h4>
            <MessageSquare size={16} />
            评论 ({comments.length})
          </h4>
          <button className="ta-panel__close" onClick={() => setShowPanel(false)}>
            <X size={18} />
          </button>
        </div>

        {panelBody}
      </div>

      {/* 遮罩层（手机端） */}
      {showPanel && (
        <div className="ta-overlay" onClick={() => setShowPanel(false)} />
      )}
    </>
  );
}

// ============================================
// 辅助函数：文本高亮
// ============================================
function highlightText(container, searchText, groupKey, count) {
  if (!searchText || !container) return;

  const walker = document.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT,
    null,
  );

  let node;
  let found = false;

  while ((node = walker.nextNode()) && !found) {
    const nodeText = node.textContent;
    const idx = nodeText.indexOf(searchText);

    if (idx !== -1) {
      const range = document.createRange();
      range.setStart(node, idx);
      range.setEnd(node, idx + searchText.length);

      const mark = document.createElement('mark');
      mark.className = 'ta-highlight';
      mark.dataset.commentGroup = groupKey;
      mark.dataset.commentCount = String(count || 1);
      mark.title = `点击查看 ${count || 1} 条评论`;

      range.surroundContents(mark);
      found = true;
    }
  }
}

function getContextBefore(node, len) {
  if (!node) return '';
  const text = node.textContent || '';
  return text.slice(Math.max(0, text.length - len));
}

function getContextAfter(node, len) {
  if (!node) return '';
  const text = node.textContent || '';
  return text.slice(0, len);
}
