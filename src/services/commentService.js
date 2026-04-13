// ============================================
// RIEMer Land — 划词评论服务
// ============================================
// 为文章详情和文档预览提供统一的评论数据管理
// 数据存储在 localStorage，与项目现有架构一致

const COMMENTS_KEY = 'riemer_annotations';

// ---- 获取所有评论 ----
function getAllComments() {
  try {
    const stored = localStorage.getItem(COMMENTS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

// ---- 保存所有评论 ----
function saveAllComments(comments) {
  localStorage.setItem(COMMENTS_KEY, JSON.stringify(comments));
}

// ---- 获取某个目标（文章/文档）的评论 ----
export function getComments(targetType, targetId) {
  const all = getAllComments();
  return all
    .filter((c) => c.targetType === targetType && c.targetId === targetId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

// ---- 添加评论 ----
export function addComment({
  targetType,   // 'article' | 'document'
  targetId,     // 文章或文档的 id
  selectedText, // 选中的文本（可为空，表示整体评论）
  content,      // 评论内容
  user,         // { id, name, nickname, avatar }
  // 用于定位高亮的锚点信息
  anchorData,   // { startOffset, endOffset, contextBefore, contextAfter, blockIndex }
}) {
  const all = getAllComments();
  const comment = {
    id: 'comment_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    targetType,
    targetId,
    selectedText: selectedText || '',
    content,
    anchorData: anchorData || null,
    userId: user.id,
    userName: user.nickname || user.name,
    userAvatar: user.avatar || null,
    createdAt: new Date().toISOString(),
    resolved: false,
    replies: [],
  };
  all.push(comment);
  saveAllComments(all);
  return comment;
}

// ---- 回复评论 ----
export function replyToComment(commentId, { content, user }) {
  const all = getAllComments();
  const idx = all.findIndex((c) => c.id === commentId);
  if (idx === -1) return null;

  const reply = {
    id: 'reply_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    content,
    userId: user.id,
    userName: user.nickname || user.name,
    userAvatar: user.avatar || null,
    createdAt: new Date().toISOString(),
  };
  all[idx].replies.push(reply);
  saveAllComments(all);
  return reply;
}

// ---- 标记为已解决 / 取消解决 ----
export function toggleResolve(commentId) {
  const all = getAllComments();
  const idx = all.findIndex((c) => c.id === commentId);
  if (idx === -1) return null;
  all[idx].resolved = !all[idx].resolved;
  saveAllComments(all);
  return all[idx];
}

// ---- 删除评论 ----
export function deleteComment(commentId) {
  const all = getAllComments();
  const filtered = all.filter((c) => c.id !== commentId);
  saveAllComments(filtered);
}

// ---- 删除回复 ----
export function deleteReply(commentId, replyId) {
  const all = getAllComments();
  const idx = all.findIndex((c) => c.id === commentId);
  if (idx === -1) return;
  all[idx].replies = all[idx].replies.filter((r) => r.id !== replyId);
  saveAllComments(all);
}

// ---- 获取某个目标的评论数量 ----
export function getCommentCount(targetType, targetId) {
  const all = getAllComments();
  return all.filter((c) => c.targetType === targetType && c.targetId === targetId).length;
}
