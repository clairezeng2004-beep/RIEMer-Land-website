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
//   - purgeItem：管理员检查引用，清理受管文件，成功后才移除回收站记录。
// ============================================

import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { addSharing } from './memberSharingService';
import { addArticleToDb } from './articleDbService';
import { collectRecycledStorageAssets, RECYCLE_SOURCE_TABLES, RECYCLE_DEFAULT_BUCKETS } from '../utils/recycledStorageAssets';
import { removeStorageObjects } from './storageCleanupService';
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
  // 列表可能没有加载正文和附件，先从源表补齐快照，再允许调用方删除源记录。
  if (isSupabaseConfigured && supabase && RECYCLE_SOURCE_TABLES[itemType]) {
    try {
      const { data, error } = await supabase.from(RECYCLE_SOURCE_TABLES[itemType])
        .select('*').eq('id', item.id).maybeSingle();
      if (error) throw error;
      if (data) item = { ...item, ...data,
        ...(data.file_url !== undefined ? { fileUrl: data.file_url } : {}),
        ...(data.cover_image !== undefined ? { coverImage: data.cover_image } : {}),
      };
    } catch (err) {
      return { success: false, error: `无法备份完整资料：${err.message}` };
    }
  }
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
    await removeEntryRow(entry.id);
  } catch (err) {
    console.warn('[RecycleBin] 恢复失败:', err.message);
    return { success: false, error: err.message || '恢复失败' };
  }
  return { success: true, error: null };
}

// ================================================================
// 彻底删除
// ================================================================
async function readCleanupRows(table) {
  const rows = [];
  const key = table === 'site_settings' ? 'key' : 'id';
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase.from(table).select('*')
      .order(key, { ascending: true }).range(offset, offset + 499);
    if (error) throw new Error(`无法检查 ${table} 的文件引用：${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < 500) return rows;
  }
}

export async function purgeItem(entry) {
  if (!entry) return { success: false, error: '条目不存在' };
  try {
    if (!isSupabaseConfigured || !supabase) throw new Error('请连接 Supabase 后再彻底删除。');
    // 必须能检查全部回收站引用；普通成员的 RLS 只能读取自己的条目。
    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError || !auth?.user) throw new Error('登录已失效，请重新登录。');
    const { data: profile, error: profileError } = await supabase.from('profiles')
      .select('role').eq('id', auth.user.id).single();
    if (profileError) throw profileError;
    if (!['admin', 'owner'].includes(profile?.role)) throw new Error('只有管理员可以彻底删除。');
    const { data: remote, error: entryError } = await supabase.from('recycle_bin')
      .select('*').eq('id', String(entry.id)).maybeSingle();
    if (entryError) throw entryError;
    const current = remote ? dbToFrontend(remote) : entry;
    const base = supabase.storage.from('documents').getPublicUrl('').data.publicUrl;
    const candidates = collectRecycledStorageAssets(current.payload, base, RECYCLE_DEFAULT_BUCKETS[current.itemType]);
    const referenced = new Set();
    if (candidates.length) {
      // 任一读取失败就停止，不在引用不明时清理文件。
      for (const table of ['documents', 'member_sharing', 'articles', 'site_settings', 'internal_files', 'album_photos', 'recycle_bin']) {
        const rows = await readCleanupRows(table);
        const defaultBucket = table === 'documents' ? 'documents'
          : table === 'member_sharing' ? 'member-sharing-attachments' : undefined;
        for (const row of rows) {
          if (table === 'recycle_bin' && String(row.id) === String(entry.id)) continue;
          const bucket = table === 'recycle_bin' ? RECYCLE_DEFAULT_BUCKETS[row.item_type] : defaultBucket;
          for (const asset of collectRecycledStorageAssets(row, base, bucket)) referenced.add(`${asset.bucket}/${asset.path}`);
        }
      }
      for (const local of getLocalEntries()) {
        if (String(local.id) === String(entry.id)) continue;
        for (const asset of collectRecycledStorageAssets(local.payload, base, RECYCLE_DEFAULT_BUCKETS[local.itemType])) {
          referenced.add(`${asset.bucket}/${asset.path}`);
        }
      }
    }
    const groups = new Map();
    let shared = 0;
    for (const asset of candidates) {
      if (referenced.has(`${asset.bucket}/${asset.path}`)) { shared++; continue; }
      if (!groups.has(asset.bucket)) groups.set(asset.bucket, []);
      groups.get(asset.bucket).push(asset.path);
    }
    for (const [bucket, paths] of groups) await removeStorageObjects(bucket, paths);
    if (remote) await removeEntryRow(entry.id);
    else deleteLocalEntry(entry.id);
    return { success: true, error: null, shared };
  } catch (err) {
    return { success: false, error: err.message || '彻底删除失败，请重试。' };
  }
}

/** 远端确认删除成功后才移除本地副本，失败抛错供恢复/清理界面提示。 */
async function removeEntryRow(id) {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.from('recycle_bin').delete().eq('id', String(id)).select('id');
    if (error) throw error;
    if (!data?.length) throw new Error('回收站记录未删除，请检查权限后重试。');
  }
  deleteLocalEntry(id);
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
