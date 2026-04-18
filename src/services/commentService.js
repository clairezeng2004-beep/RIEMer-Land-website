// ============================================
// RIEMer Land — 划词评论服务
// ============================================
// 评论（annotations）+ 回复（annotation_replies）是全站共享数据：
//   · 已登录且已授权用户可以查看所有评论。
//   · 作者本人或管理员可以删除 / 解决自己的评论。
//
// 存储策略：
//   1. 优先走 Supabase（annotations / annotation_replies 两张表）；
//   2. 如果 Supabase 未配置或不可达，回退到 localStorage，
//      保证离线编辑或本地开发时仍能使用。
//
// 对外暴露的 API 全部是 **异步函数**，调用方需使用 await/then。
// ============================================

import { supabase, isSupabaseConfigured } from '../lib/supabase';

const COMMENTS_KEY = 'riemer_annotations';

// ------------------------------------------------------------------
// 本地存储（降级路径）
// ------------------------------------------------------------------
function getLocalAll() {
  try {
    const stored = localStorage.getItem(COMMENTS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveLocalAll(comments) {
  try {
    localStorage.setItem(COMMENTS_KEY, JSON.stringify(comments));
  } catch {
    /* storage 满 / 隐私模式等错误忽略 */
  }
}

// ------------------------------------------------------------------
// DB 行 -> 前端对象
// ------------------------------------------------------------------
function rowToComment(row, replies = []) {
  return {
    id: row.id,
    targetType: row.target_type,
    targetId: row.target_id,
    selectedText: row.selected_text || '',
    anchorData: row.anchor_data || null,
    content: row.content,
    userId: row.user_id,
    userName: row.user_name || '',
    userAvatar: row.user_avatar || null,
    resolved: !!row.resolved,
    createdAt: row.created_at,
    replies: replies.map(rowToReply),
  };
}

function rowToReply(row) {
  return {
    id: row.id,
    content: row.content,
    userId: row.user_id,
    userName: row.user_name || '',
    userAvatar: row.user_avatar || null,
    createdAt: row.created_at,
  };
}

function shouldUseRemote() {
  return isSupabaseConfigured && !!supabase;
}

// ==================================================================
// 获取评论列表
// ==================================================================
export async function getComments(targetType, targetId) {
  if (shouldUseRemote()) {
    try {
      const { data: annotations, error } = await supabase
        .from('annotations')
        .select('*')
        .eq('target_type', targetType)
        .eq('target_id', String(targetId))
        .order('created_at', { ascending: false });

      if (error) throw error;
      if (!annotations || annotations.length === 0) return [];

      const ids = annotations.map((a) => a.id);
      const { data: replies } = await supabase
        .from('annotation_replies')
        .select('*')
        .in('annotation_id', ids)
        .order('created_at', { ascending: true });

      const repliesByAnn = {};
      (replies || []).forEach((r) => {
        (repliesByAnn[r.annotation_id] = repliesByAnn[r.annotation_id] || []).push(r);
      });

      return annotations.map((a) => rowToComment(a, repliesByAnn[a.id] || []));
    } catch (err) {
      console.warn('[commentService] Supabase 读取失败，降级到 localStorage：', err);
      // 继续走本地
    }
  }

  // 本地降级
  const all = getLocalAll();
  return all
    .filter((c) => c.targetType === targetType && String(c.targetId) === String(targetId))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

// ==================================================================
// 新增评论（支持划中文本 or 整体评论）
// ==================================================================
export async function addComment({
  targetType,
  targetId,
  selectedText,
  content,
  user,
  anchorData,
}) {
  if (!user?.id) throw new Error('addComment: missing user');

  if (shouldUseRemote()) {
    // 远端优先：写失败时直接抛错，让 UI 能感知并提示用户。
    // 不再静默降级到 localStorage —— 因为读路径只从 Supabase 取，
    // 写本地但读远端会导致"点发送没反应"的错觉。
    const { data, error } = await supabase
      .from('annotations')
      .insert({
        target_type: targetType,
        target_id: String(targetId),
        selected_text: selectedText || '',
        anchor_data: anchorData || null,
        content,
        user_id: user.id,
        // 评论作者统一显示真名（user.name），缺失时回退到昵称
        user_name: user.name || user.nickname || '',
        user_avatar: user.avatar || null,
      })
      .select()
      .single();

    if (error) {
      console.error('[commentService] Supabase 写入评论失败:', error);
      throw new Error(error.message || '评论写入失败');
    }
    return rowToComment(data, []);
  }

  // Supabase 未配置时才走本地降级
  const all = getLocalAll();
  const comment = {
    id: 'comment_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    targetType,
    targetId: String(targetId),
    selectedText: selectedText || '',
    content,
    anchorData: anchorData || null,
    userId: user.id,
    userName: user.name || user.nickname || '',
    userAvatar: user.avatar || null,
    createdAt: new Date().toISOString(),
    resolved: false,
    replies: [],
  };
  all.push(comment);
  saveLocalAll(all);
  return comment;
}

// ==================================================================
// 回复评论
// ==================================================================
export async function replyToComment(commentId, { content, user }) {
  if (!user?.id) throw new Error('replyToComment: missing user');

  if (shouldUseRemote()) {
    const { data, error } = await supabase
      .from('annotation_replies')
      .insert({
        annotation_id: commentId,
        content,
        user_id: user.id,
        user_name: user.name || user.nickname || '',
        user_avatar: user.avatar || null,
      })
      .select()
      .single();

    if (error) {
      console.error('[commentService] Supabase 写入回复失败:', error);
      throw new Error(error.message || '回复写入失败');
    }
    return rowToReply(data);
  }

  const all = getLocalAll();
  const idx = all.findIndex((c) => c.id === commentId);
  if (idx === -1) return null;

  const reply = {
    id: 'reply_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    content,
    userId: user.id,
    userName: user.name || user.nickname || '',
    userAvatar: user.avatar || null,
    createdAt: new Date().toISOString(),
  };
  all[idx].replies = all[idx].replies || [];
  all[idx].replies.push(reply);
  saveLocalAll(all);
  return reply;
}

// ==================================================================
// 切换「已解决」状态
// ==================================================================
export async function toggleResolve(commentId, nextResolved) {
  if (shouldUseRemote()) {
    try {
      // 未传明确值时，先 fetch 再切换
      let resolved = nextResolved;
      if (typeof resolved !== 'boolean') {
        const { data, error } = await supabase
          .from('annotations')
          .select('resolved')
          .eq('id', commentId)
          .single();
        if (error) throw error;
        resolved = !data.resolved;
      }

      const { data, error } = await supabase
        .from('annotations')
        .update({ resolved, updated_at: new Date().toISOString() })
        .eq('id', commentId)
        .select()
        .single();

      if (error) throw error;
      return rowToComment(data, []);
    } catch (err) {
      console.warn('[commentService] Supabase 状态更新失败，降级 localStorage：', err);
    }
  }

  const all = getLocalAll();
  const idx = all.findIndex((c) => c.id === commentId);
  if (idx === -1) return null;
  all[idx].resolved = !all[idx].resolved;
  saveLocalAll(all);
  return all[idx];
}

// ==================================================================
// 删除评论
// ==================================================================
export async function deleteComment(commentId) {
  if (shouldUseRemote()) {
    try {
      const { error } = await supabase.from('annotations').delete().eq('id', commentId);
      if (error) throw error;
      return true;
    } catch (err) {
      console.warn('[commentService] Supabase 删除失败，降级 localStorage：', err);
    }
  }

  const all = getLocalAll();
  saveLocalAll(all.filter((c) => c.id !== commentId));
  return true;
}

// ==================================================================
// 删除回复
// ==================================================================
export async function deleteReply(commentId, replyId) {
  if (shouldUseRemote()) {
    try {
      const { error } = await supabase.from('annotation_replies').delete().eq('id', replyId);
      if (error) throw error;
      return true;
    } catch (err) {
      console.warn('[commentService] Supabase 删除回复失败，降级 localStorage：', err);
    }
  }

  const all = getLocalAll();
  const idx = all.findIndex((c) => c.id === commentId);
  if (idx === -1) return false;
  all[idx].replies = (all[idx].replies || []).filter((r) => r.id !== replyId);
  saveLocalAll(all);
  return true;
}

// ==================================================================
// 计数
// ==================================================================
export async function getCommentCount(targetType, targetId) {
  if (shouldUseRemote()) {
    try {
      const { count, error } = await supabase
        .from('annotations')
        .select('*', { count: 'exact', head: true })
        .eq('target_type', targetType)
        .eq('target_id', String(targetId));
      if (error) throw error;
      return count || 0;
    } catch (err) {
      console.warn('[commentService] Supabase 计数失败，降级 localStorage：', err);
    }
  }

  const all = getLocalAll();
  return all.filter(
    (c) => c.targetType === targetType && String(c.targetId) === String(targetId),
  ).length;
}
