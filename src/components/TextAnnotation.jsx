import { useState, useEffect, useRef, useCallback } from 'react';
import {
  MessageSquare, X, Send, Check, Trash2, CornerDownRight,
  CheckCircle, Circle, ChevronDown, ChevronUp, User,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  getComments, addComment, replyToComment,
  toggleResolve, deleteComment, deleteReply,
} from '../services/commentService';
import './TextAnnotation.css';

// ---- 头像背景色（统一主题色） ----
const AVATAR_BG = '#5B8C3E';

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

/**
 * TextAnnotation — 划词评论组件
 *
 * Props:
 *   targetType: 'article' | 'document'
 *   targetId: string
 *   contentRef: React.RefObject — 包裹可选中内容的 DOM 容器
 *   disabled?: boolean — 如果为 true 则不显示划词工具栏
 */
export default function TextAnnotation({ targetType, targetId, contentRef, disabled }) {
  const { user } = useAuth();
  const [comments, setComments] = useState([]);
  const [showPanel, setShowPanel] = useState(false);
  const [showResolved, setShowResolved] = useState(false);

  // 浮动工具栏
  const [toolbar, setToolbar] = useState({ visible: false, x: 0, y: 0 });
  const [selection, setSelection] = useState({ text: '', anchorData: null });

  // 评论输入
  const [commentInput, setCommentInput] = useState('');
  const [isCommenting, setIsCommenting] = useState(false);

  // 回复
  const [replyingTo, setReplyingTo] = useState(null);
  const [replyInput, setReplyInput] = useState('');

  // 活跃高亮
  const [activeCommentId, setActiveCommentId] = useState(null);

  const toolbarRef = useRef(null);
  const panelRef = useRef(null);

  // ---- 加载评论 ----
  const loadComments = useCallback(() => {
    setComments(getComments(targetType, targetId));
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

    // 只高亮有选中文本的、未解决的评论
    const activeComments = comments.filter((c) => c.selectedText && !c.resolved);

    activeComments.forEach((comment) => {
      try {
        highlightText(container, comment.selectedText, comment.id);
      } catch {
        // 文本可能已变化，忽略
      }
    });
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
            setToolbar({ visible: false, x: 0, y: 0 });
          }
          return;
        }

        // 检查选区是否在 contentRef 内
        if (!contentRef.current.contains(sel.anchorNode)) return;

        const range = sel.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        const containerRect = contentRef.current.getBoundingClientRect();

        setSelection({
          text,
          anchorData: {
            contextBefore: getContextBefore(sel.anchorNode, 30),
            contextAfter: getContextAfter(sel.focusNode, 30),
          },
        });

        setToolbar({
          visible: true,
          x: rect.left + rect.width / 2 - containerRect.left,
          y: rect.top - containerRect.top - 8,
        });
      }, 10);
    };

    const container = contentRef.current;
    container.addEventListener('mouseup', handleMouseUp);
    return () => container.removeEventListener('mouseup', handleMouseUp);
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
          setToolbar({ visible: false, x: 0, y: 0 });
          setIsCommenting(false);
          setCommentInput('');
        }
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [toolbar.visible]);

  // ---- 提交评论 ----
  const handleSubmitComment = () => {
    if (!commentInput.trim() || !user) return;
    addComment({
      targetType,
      targetId,
      selectedText: selection.text,
      content: commentInput.trim(),
      user,
      anchorData: selection.anchorData,
    });
    setCommentInput('');
    setIsCommenting(false);
    setToolbar({ visible: false, x: 0, y: 0 });
    window.getSelection()?.removeAllRanges();
    loadComments();
    setShowPanel(true);
  };

  // ---- 提交整体评论（无选中文本） ----
  const handleSubmitGeneralComment = () => {
    if (!commentInput.trim() || !user) return;
    addComment({
      targetType,
      targetId,
      selectedText: '',
      content: commentInput.trim(),
      user,
      anchorData: null,
    });
    setCommentInput('');
    loadComments();
  };

  // ---- 提交回复 ----
  const handleSubmitReply = (commentId) => {
    if (!replyInput.trim() || !user) return;
    replyToComment(commentId, { content: replyInput.trim(), user });
    setReplyInput('');
    setReplyingTo(null);
    loadComments();
  };

  // ---- 解决 / 删除 ----
  const handleResolve = (id) => {
    toggleResolve(id);
    loadComments();
  };

  const handleDelete = (id) => {
    if (window.confirm('确定要删除这条评论吗？')) {
      deleteComment(id);
      loadComments();
    }
  };

  const handleDeleteReply = (commentId, replyId) => {
    deleteReply(commentId, replyId);
    loadComments();
  };

  // ---- 分组 ----
  const unresolvedComments = comments.filter((c) => !c.resolved);
  const resolvedComments = comments.filter((c) => c.resolved);

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
            <span className="ta-comment__quote-mark">"</span>
            <span className="ta-comment__quote-text">
              {comment.selectedText.length > 80
                ? comment.selectedText.slice(0, 80) + '…'
                : comment.selectedText}
            </span>
            <span className="ta-comment__quote-mark">"</span>
          </div>
        )}

        {/* 评论头部 */}
        <div className="ta-comment__header">
          {renderAvatar(comment.userName, comment.userAvatar, 26)}
          <span className="ta-comment__author">{comment.userName}</span>
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
        {comment.replies.length > 0 && (
          <div className="ta-comment__replies">
            {comment.replies.map((reply) => (
              <div key={reply.id} className="ta-reply">
                <div className="ta-reply__header">
                  {renderAvatar(reply.userName, reply.userAvatar, 22)}
                  <span className="ta-reply__author">{reply.userName}</span>
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
            ))}
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

  if (!user) return null;

  return (
    <>
      {/* 浮动工具栏 */}
      {toolbar.visible && (
        <div
          ref={toolbarRef}
          className="ta-toolbar"
          style={{
            left: toolbar.x,
            top: toolbar.y,
            transform: 'translate(-50%, -100%)',
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
                "{selection.text.length > 40 ? selection.text.slice(0, 40) + '…' : selection.text}"
              </div>
              <div className="ta-toolbar__input-row">
                <input
                  type="text"
                  value={commentInput}
                  onChange={(e) => setCommentInput(e.target.value)}
                  placeholder="写下你的评论…"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSubmitComment();
                    if (e.key === 'Escape') {
                      setIsCommenting(false);
                      setCommentInput('');
                    }
                  }}
                />
                <button
                  onClick={handleSubmitComment}
                  disabled={!commentInput.trim()}
                  className="ta-toolbar__send"
                >
                  <Send size={14} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

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

        {/* 整体评论输入 */}
        <div className="ta-panel__new-comment">
          <div className="ta-panel__new-input-row">
            <input
              type="text"
              value={!isCommenting ? commentInput : ''}
              onChange={(e) => {
                if (!isCommenting) setCommentInput(e.target.value);
              }}
              placeholder="添加整体评论…（或划选文字精准评论）"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSubmitGeneralComment();
              }}
            />
            <button
              onClick={handleSubmitGeneralComment}
              disabled={isCommenting || !commentInput.trim()}
            >
              <Send size={14} />
            </button>
          </div>
        </div>

        {/* 评论列表 */}
        <div className="ta-panel__list">
          {unresolvedComments.length === 0 && resolvedComments.length === 0 && (
            <div className="ta-panel__empty">
              <MessageSquare size={32} />
              <p>暂无评论</p>
              <span>选中文字后点击「评论」，或在上方输入整体评论</span>
            </div>
          )}

          {unresolvedComments.map(renderComment)}

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
function highlightText(container, searchText, commentId) {
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
      mark.dataset.commentId = commentId;
      mark.title = '点击查看评论';

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
