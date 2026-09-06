// ============================================
// RIEMer Land — 回收站数据库服务（Supabase）
// ============================================
// 统一收纳内部空间各模块删除的内容，支持恢复 / 彻底删除。
// 对应 Supabase 表：recycle_bin（SQL：supabase-recycle-bin.sql）
// Supabase 不可用时回退 localStorage。
//
// 设计要点：
//   - moveToRecycleBin：删除时把整条记录的“前端对象快照”存进回收站；
//   - restoreItem：按 item_type 把快照回写到各自的源服务（成员分享 / 文档 /
//     文章 / 活动），成功后删掉回收站这条；
//   - purgeItem：彻底删除，只删回收站这条（源数据早已从源表移除）。
// ============================================

import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { addSharing } from './memberSharingService';
import { addArticleToDb } from './articleDbService';
import { getManagedArticleCoverPath, removeArticleCover } from './articleCoverService';
import { createDoc } from '../lib/documentsService';
import { SITE_KEYS, fetchSetting, saveSetting } from './siteSettingsService';

const LOCAL_KEY = 'riemer_recycle_bin';
const CLOUD_TIMEOUT_MS = 20000;

// 各类型的中文标签（页面筛选 / 卡片徽标用）
export const RECYCLE_TYPE_LABELS = {
  member_sharing: '成员内部分享',
  document: '流程模板文件',
  article: '公众号文章归档',
  event: '活动发布',
};

export const RECYCLE_TYPES = Object.keys(RECYCLE_TYPE_LABELS);

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} 超时`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// ---- 从不同来源的前端对象里抽取统一展示元信息 ----
function extractMeta(itemType, item = {}) {
  const title = item.title || '未命名';
  let author = '';
  let authorId = null;
  let excerpt = '';
  switch (itemType) {
    case 'member_sharing':
      author = item.author || '';
      authorId = item.authorId || null;
      break;
    case 'document':
      author = item.uploadedBy || item.uploaded_by || item.author || '';
      authorId = item.uploadedById || item.uploaded_by_id || null;
      excerpt = item.description || '';
      break;
    case 'article':
      author = item.archivedBy || item.author || '';
      authorId = item.archivedById || null;
      excerpt = item.excerpt || '';
      break;
    case 'event':
      author = item.createdByName || item.createdBy || item.author || '';
      authorId = item.createdById || null;
      excerpt = item.excerpt || '';
      break;
    default:
      break;
  }
  return { title, author, authorId: authorId ? String(authorId) : null, excerpt };
}

/** DB 行 → 前端条目 */
function dbToFrontend(row) {
  return {
    id: row.id,
    itemType: row.item_type,
    originalId: row.original_id,
    title: row.title || '未命名',
    excerpt: row.excerpt || '',
    author: row.author || '',
    authorId: row.author_id || null,
    deletedBy: row.deleted_by || '',
    deletedById: row.deleted_by_id || null,
    payload: row.payload || {},
    deletedAt: row.deleted_at || new Date().toISOString(),
    _fromDb: true,
  };
}

// ================================================================
// 写入：删除时挪进回收站
// ================================================================
/**
 * 把一条被删除的记录存进回收站。
 * @param {object} args
 * @param {string} args.itemType  member_sharing | document | article | event
 * @param {object} args.item      被删除内容的前端对象（完整快照）
 * @param {object} [args.user]    当前操作者 { id, name, nickname }
 * @returns {Promise<{success:boolean,error?:string}>}
 */
export async function moveToRecycleBin({ itemType, item, user }) {
  if (!itemType || !item) return { success: false, error: '参数不完整' };
  const { title, author, authorId, excerpt } = extractMeta(itemType, item);
  const entry = {
    id: `rb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    item_type: itemType,
    original_id: item.id != null ? String(item.id) : '',
    title,
    excerpt,
    author,
    author_id: authorId,
    deleted_by: user?.name || user?.nickname || '未知',
    deleted_by_id: user?.id ? String(user.id) : null,
    payload: item,
    deleted_at: new Date().toISOString(),
  };

  // 先写本地兜底（即使云端失败也能恢复）
  addLocalEntry(dbToFrontend(entry));

  if (!isSupabaseConfigured || !supabase) {
    return { success: true, error: null };
  }
  try {
    const { error } = await withTimeout(
      supabase.from('recycle_bin').insert(entry),
      CLOUD_TIMEOUT_MS,
      '回收站写入',
    );
    if (error) {
      console.warn('[RecycleBin] 写入云端失败（已存本地）:', error.message);
      return { success: false, error: error.message };
    }
    return { success: true, error: null };
  } catch (err) {
    console.warn('[RecycleBin] 写入异常（已存本地）:', err.message);
    return { success: false, error: err.message };
  }
}

// ================================================================
// 读取
// ================================================================
export async function fetchRecycleBin() {
  const local = getLocalEntries();
  if (!isSupabaseConfigured || !supabase) return local;
  try {
    const { data, error } = await withTimeout(
      supabase.from('recycle_bin').select('*').order('deleted_at', { ascending: false }),
      CLOUD_TIMEOUT_MS,
      '获取回收站',
    );
    if (error) {
      console.warn('[RecycleBin] 获取失败，回退本地:', error.message);
      return local;
    }
    return mergeEntries((data || []).map(dbToFrontend), local);
  } catch (err) {
    console.warn('[RecycleBin] 获取异常，回退本地:', err.message);
    return local;
  }
}

function mergeEntries(remote = [], local = []) {
  const map = new Map();
  [...local, ...remote].forEach((e) => {
    if (e?.id) map.set(String(e.id), e);
  });
  return Array.from(map.values()).sort(
    (a, b) => new Date(b.deletedAt || 0) - new Date(a.deletedAt || 0),
  );
}

// ================================================================
// 恢复：按类型把快照回写源服务
// ================================================================
async function restorePayload(entry) {
  const payload = entry?.payload || {};
  switch (entry.itemType) {
    case 'member_sharing':
      await addSharing(payload);
      return;
    case 'document':
      // createDoc 在云端不可用时会抛错 —— 让上层捕获并保留回收站条目
      await createDoc(payload);
      return;
    case 'article':
      await addArticleToDb(payload, payload.archivedById || entry.authorId || null);
      return;
    case 'event': {
      const { value } = await fetchSetting(SITE_KEYS.EVENTS);
      const list = Array.isArray(value) ? value : [];
      const exists = list.some((e) => String(e?.id) === String(payload?.id));
      const next = exists ? list : [payload, ...list];
      const res = await saveSetting(SITE_KEYS.EVENTS, next);
      if (res && res.success === false) {
        throw new Error(res.error || '活动恢复写入失败');
      }
      return;
    }
    default:
      throw new Error(`未知的回收站类型：${entry.itemType}`);
  }
}

/**
 * 恢复一条回收站记录。
 * 成功回写源数据后，删除回收站这条；任一步失败则保留条目并返回错误。
 */
export async function restoreItem(entry) {
  if (!entry) return { success: false, error: '条目不存在' };
  try {
    await restorePayload(entry);
  } catch (err) {
    console.warn('[RecycleBin] 恢复失败:', err.message);
    return { success: false, error: err.message || '恢复失败' };
  }
  // 回写成功 → 删除回收站这条
  await removeEntryRow(entry.id);
  return { success: true, error: null };
}

// ================================================================
// 彻底删除
// ================================================================
export async function purgeItem(entry) {
  if (!entry) return { success: false, error: '条目不存在' };
  await removeEntryRow(entry.id);
  // 文章彻底删除时顺带回收 Storage 封面，避免孤儿文件长期堆积。
  // 时机说明：只在 purge（彻底删除）而非 moveToRecycleBin（删入回收站）时清理——
  // 回收站期间文章仍可「恢复」，而 restore 直接复用 payload 里的封面 URL
  // （见 restorePayload → addArticleToDb），提前删文件会让恢复后的封面 404。
  // 仅处理受管的 Storage 封面（getManagedArticleCoverPath 命中才删）；
  // 历史 Base64 / 外链封面返回 null，天然跳过。失败只告警，不影响彻底删除结果。
  if (entry.itemType === 'article') {
    try {
      const cover = entry.payload?.coverImage || entry.payload?.cover_image || null;
      const path = getManagedArticleCoverPath(cover);
      if (path) {
        const res = await removeArticleCover(path);
        if (!res.success) console.warn('[RecycleBin] 文章封面回收失败:', res.error);
      }
    } catch (err) {
      console.warn('[RecycleBin] 文章封面回收异常:', err?.message || err);
    }
  }
  return { success: true, error: null };
}

/** 删除回收站表里的一行（本地 + 云端） */
async function removeEntryRow(id) {
  deleteLocalEntry(id);
  if (!isSupabaseConfigured || !supabase) return;
  try {
    const { error } = await supabase.from('recycle_bin').delete().eq('id', String(id));
    if (error) console.warn('[RecycleBin] 删除条目失败:', error.message);
  } catch (err) {
    console.warn('[RecycleBin] 删除条目异常:', err.message);
  }
}

// ================================================================
// Realtime 订阅
// ================================================================
export function subscribeRecycleBin(onChange) {
  if (!isSupabaseConfigured || !supabase) return () => {};
  const channel = supabase
    .channel('recycle_bin_realtime')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'recycle_bin' },
      (payload) => {
        const type = payload.eventType || payload.type;
        const newItem = payload.new ? dbToFrontend(payload.new) : null;
        const oldItem = payload.old ? { id: payload.old.id } : null;
        onChange({ type, newItem, oldItem });
      },
    )
    .subscribe();
  return () => {
    try { supabase.removeChannel(channel); } catch { /* ignore */ }
  };
}

// ================================================================
// localStorage 兜底
// ================================================================
function getLocalEntries() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveLocalEntries(list) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(list));
    return true;
  } catch (err) {
    console.warn('[RecycleBin] 本地缓存写入失败:', err?.message || err);
    return false;
  }
}

function addLocalEntry(entry) {
  const list = getLocalEntries();
  saveLocalEntries([entry, ...list.filter((e) => String(e.id) !== String(entry.id))]);
}

function deleteLocalEntry(id) {
  saveLocalEntries(getLocalEntries().filter((e) => String(e.id) !== String(id)));
}
