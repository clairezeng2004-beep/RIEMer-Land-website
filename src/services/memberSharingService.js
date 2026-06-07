// ============================================
// RIEMer Land — 成员内部分享数据库服务（Supabase）
// ============================================
// 对应 Supabase 表：member_sharing / member_sharing_categories
// 当 Supabase 不可用时，回退到 localStorage。
// SQL 迁移：supabase-member-sharing.sql
// ============================================

import { supabase, isSupabaseConfigured } from '../lib/supabase';

// ---- localStorage keys（保持与旧版 MemberSharing 页面一致，作为兜底缓存）----
const LOCAL_SHARINGS_KEY = 'riemer_member_sharing';
const LOCAL_CATEGORIES_KEY = 'riemer_sharing_categories';
const MEMBER_SHARING_BUCKET = 'member-sharing-attachments';
const MEMBER_SHARING_CLOUD_TIMEOUT_MS = 25000;

// 默认分类（与原页面保持一致）
export const DEFAULT_CATEGORIES = [
  { key: 'course', label: '课程资料', color: '#5EAD8C' },
  { key: 'experience', label: '成员经验分享', color: '#EC4899' },
];

// ================================================================
// 数据格式转换
// ================================================================

/** DB 行 → 前端对象 */
function dbToFrontend(row) {
  const attachments = Array.isArray(row.attachments) ? row.attachments : [];
  return {
    id: row.id,
    title: row.title || '',
    summary: row.summary || '',
    category: row.category || 'experience',
    format: row.format || 'word',
    content: row.content || '',
    period: row.period || null,
    attachments,
    author: row.author || 'Unknown',
    authorId: row.author_id || null,
    /* 多贡献者支持：若云端列缺失（旧表结构），回退到 [author_id] */
    contributorIds: Array.isArray(row.contributor_ids)
      ? row.contributor_ids
      : row.author_id
        ? [row.author_id]
        : [],
    createdAt: row.created_at || new Date().toISOString().split('T')[0],
    likes: Array.isArray(row.likes) ? row.likes : [],
    _fromDb: true,
  };
}

/** 前端对象 → DB 行（用于 insert） */
function frontendToDbInsert(post) {
  return {
    id: post.id,
    title: post.title || '',
    summary: post.summary || '',
    category: post.category || 'experience',
    format: post.format || 'word',
    content: post.content || '',
    period: post.period || null,
    attachments: normaliseAttachmentsForDb(post.attachments),
    author: post.author || 'Unknown',
    author_id: post.authorId || null,
    /* 多贡献者：若表未添加该列，后端会报错，此时前端走降级（剥掉该列重试，仅本地保留）。
       升级 SQL 见 supabase-member-sharing.sql。 */
    contributor_ids: Array.isArray(post.contributorIds) && post.contributorIds.length > 0
      ? post.contributorIds
      : post.authorId ? [post.authorId] : [],
    likes: Array.isArray(post.likes) ? post.likes : [],
    created_at: post.createdAt || new Date().toISOString().split('T')[0],
  };
}

/** 前端更新对象 → DB 部分字段（用于 update） */
function frontendToDbUpdate(updates) {
  const u = {};
  if (updates.title !== undefined) u.title = updates.title;
  if (updates.summary !== undefined) u.summary = updates.summary || '';
  if (updates.category !== undefined) u.category = updates.category;
  if (updates.format !== undefined) u.format = updates.format;
  if (updates.content !== undefined) u.content = updates.content;
  if (updates.period !== undefined) u.period = updates.period;
  if (updates.attachments !== undefined) {
    u.attachments = normaliseAttachmentsForDb(updates.attachments);
  }
  if (updates.author !== undefined) u.author = updates.author;
  if (updates.authorId !== undefined) u.author_id = updates.authorId;
  if (updates.contributorIds !== undefined) {
    u.contributor_ids = Array.isArray(updates.contributorIds) ? updates.contributorIds : [];
  }
  if (updates.likes !== undefined) u.likes = Array.isArray(updates.likes) ? updates.likes : [];
  u.updated_at = new Date().toISOString();
  return u;
}

function stripSummaryField(row) {
  const { summary, ...rest } = row;
  return rest;
}

function isMissingSummaryColumnError(error) {
  return /summary/i.test(error?.message || '') && /column|schema|cache/i.test(error?.message || '');
}

function stripContributorIdsField(row) {
  const { contributor_ids, ...rest } = row;
  return rest;
}

function isMissingContributorColumnError(error) {
  return /contributor_ids/i.test(error?.message || '')
    && /column|schema|cache/i.test(error?.message || '');
}

function getFileExt(name = '') {
  const ext = String(name).split('.').pop();
  return ext && ext !== name ? ext.toLowerCase() : 'bin';
}

function safeStorageName(name = 'file') {
  const cleaned = String(name)
    .normalize('NFKD')
    .replace(/[^\w.\-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return cleaned || `file.${getFileExt(name)}`;
}

function dataUrlToBlob(dataUrl) {
  const [meta, body] = String(dataUrl || '').split(',');
  if (!meta || !body) return null;
  const mime = meta.match(/^data:([^;]+);base64$/)?.[1] || 'application/octet-stream';
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function normaliseAttachmentsForDb(attachments) {
  if (!Array.isArray(attachments) || attachments.length === 0) return null;
  return attachments.map(({ dataUrl, blobUrl, file, _file, ...att }) => att);
}

function stripInlineDataUrls(content = '') {
  return String(content).replace(
    /\s(src|href)=["']data:[^"']+["']/gi,
    ' data-local-preview="pending-upload"',
  );
}

function makeLocalPreviewPost(post) {
  return {
    ...post,
    content: stripInlineDataUrls(post.content),
    attachments: normaliseAttachmentsForDb(post.attachments),
    _syncing: true,
  };
}

function withTimeout(promise, ms, label) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} 超时`));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

function mergeSharings(remote = [], local = []) {
  const map = new Map();
  [...local, ...remote].forEach((item) => {
    if (!item?.id) return;
    map.set(String(item.id), item);
  });
  return Array.from(map.values()).sort((a, b) => {
    const at = new Date(a.createdAt || 0).getTime();
    const bt = new Date(b.createdAt || 0).getTime();
    return bt - at;
  });
}

async function uploadAttachmentAsset({ postId, attachment, userId }) {
  // 已经是云端 URL 的附件直接复用；旧数据 dataUrl 只在准备上云时上传。
  if (!attachment?.dataUrl || attachment.url) return attachment;
  const blob = dataUrlToBlob(attachment.dataUrl);
  if (!blob) return attachment;

  const fileName = attachment.name || `attachment.${getFileExt(attachment.type)}`;
  const path = [
    userId || 'unknown-user',
    postId,
    `${attachment.id || Date.now()}-${safeStorageName(fileName)}`,
  ].join('/');

  const { error } = await supabase.storage
    .from(MEMBER_SHARING_BUCKET)
    .upload(path, blob, {
      contentType: attachment.type || blob.type || 'application/octet-stream',
      upsert: true,
    });

  if (error) {
    throw new Error(`附件 "${fileName}" 上传失败：${error.message}`);
  }

  const { data } = supabase.storage.from(MEMBER_SHARING_BUCKET).getPublicUrl(path);
  const { dataUrl, ...rest } = attachment;
  return {
    ...rest,
    url: data.publicUrl,
    storagePath: path,
  };
}

async function prepareSharingForCloud(post) {
  const { data: auth } = await supabase.auth.getUser().catch(() => ({ data: null }));
  const userId = post.authorId || auth?.user?.id || null;
  const attachments = Array.isArray(post.attachments)
    ? await Promise.all(post.attachments.map((att) => uploadAttachmentAsset({
      postId: post.id,
      attachment: att,
      userId,
    })))
    : [];
  return {
    ...post,
    attachments: attachments.length > 0 ? attachments : null,
  };
}

// ================================================================
// Sharings（分享帖）
// ================================================================

/** 同步读取本地缓存的分享。
 * 供列表页首屏作为初始值，先把上次缓存的内容立刻显示出来，
 * 避免手机端云端拉取较慢时出现"先空一下再加载"的空窗。 */
export function getCachedSharings() {
  return getLocalSharings();
}

/** 获取所有分享（按 created_at 降序） */
export async function fetchSharings() {
  const local = getLocalSharings();
  if (!isSupabaseConfigured || !supabase) {
    return local;
  }
  try {
    const { data, error } = await withTimeout(
      supabase
        .from('member_sharing')
        .select('*')
        .order('created_at', { ascending: false }),
      MEMBER_SHARING_CLOUD_TIMEOUT_MS,
      '获取成员分享',
    );
    if (error) {
      console.warn('[MemberSharingDB] 获取分享失败，回退本地:', error.message);
      return local;
    }
    const merged = mergeSharings((data || []).map(dbToFrontend), local);
    // 把云端结果回写本地缓存（best-effort）：下次进入/刷新时 getCachedSharings()
    // 能立刻拿到内容当首屏，规避空窗。saveLocalSharings 内部已处理配额不足，
    // 失败只静默警告、不影响本次返回。
    saveLocalSharings(merged);
    return merged;
  } catch (err) {
    console.warn('[MemberSharingDB] 获取分享异常，回退本地:', err.message);
    return local;
  }
}

/** 按 id 获取单条分享 */
export async function fetchSharingById(id) {
  if (!isSupabaseConfigured || !supabase) {
    return getLocalSharings().find((s) => String(s.id) === String(id)) || null;
  }
  try {
    const { data, error } = await supabase
      .from('member_sharing')
      .select('*')
      .eq('id', String(id))
      .maybeSingle();
    if (error) {
      console.warn('[MemberSharingDB] 获取单条分享失败:', error.message);
      return getLocalSharings().find((s) => String(s.id) === String(id)) || null;
    }
    return data ? dbToFrontend(data) : null;
  } catch (err) {
    console.warn('[MemberSharingDB] 获取单条分享异常:', err.message);
    return getLocalSharings().find((s) => String(s.id) === String(id)) || null;
  }
}

/** 新增分享 */
async function syncSharingToCloud(post) {
  try {
    // 附件必须先进入 Storage，DB 只保存 URL / storagePath 等元数据。
    // 否则 base64 dataUrl 直接塞 JSONB 很容易超过 PostgREST 请求体上限，
    // 且 localStorage 缓存也会迅速爆掉，跨设备同步不稳定。
    const cloudPost = await withTimeout(
      prepareSharingForCloud(post),
      MEMBER_SHARING_CLOUD_TIMEOUT_MS,
      '成员分享附件上传',
    );
    const row = frontendToDbInsert(cloudPost);
    let { data, error } = await withTimeout(
      supabase
        .from('member_sharing')
        .insert(row)
        .select()
        .single(),
      MEMBER_SHARING_CLOUD_TIMEOUT_MS,
      '成员分享云端保存',
    );
    if (error && (isMissingSummaryColumnError(error) || isMissingContributorColumnError(error))) {
      // 旧表结构可能缺 summary 或 contributor_ids 列：剥掉缺失列后重试，
      // 保证云端至少能存下主体内容（缺失列仅本地保留，跑完迁移即恢复）。
      let retryRow = row;
      if (isMissingSummaryColumnError(error)) retryRow = stripSummaryField(retryRow);
      if (isMissingContributorColumnError(error)) retryRow = stripContributorIdsField(retryRow);
      const retry = await withTimeout(
        supabase
          .from('member_sharing')
          .insert(retryRow)
          .select()
          .single(),
        MEMBER_SHARING_CLOUD_TIMEOUT_MS,
        '成员分享云端保存',
      );
      data = retry.data;
      error = retry.error;
    }
    if (error) {
      console.warn('[MemberSharingDB] 新增分享失败（仅保存本地）:', error.message);
      return { ...post, _localOnly: true, _saveError: error.message };
    }
    const saved = dbToFrontend(data);
    addLocalSharing(saved);
    return saved;
  } catch (err) {
    console.warn('[MemberSharingDB] 新增分享异常:', err.message);
    return { ...post, _localOnly: true, _saveError: err.message };
  }
}

export async function addSharing(post) {
  // 先写本地，确保发布按钮不会被 Storage/PostgREST 的慢请求卡住。
  const localResult = addLocalSharing(post);

  if (!isSupabaseConfigured || !supabase) {
    if (!localResult.success) {
      throw new Error(localResult.error || '本地缓存保存失败');
    }
    return { ...post, _localOnly: true };
  }

  if (!localResult.success) {
    // localStorage 可能因为正文内联图片/附件 dataUrl 太大而失败。
    // 这时保存一份轻量预览，完整内容继续后台上云，避免发布按钮卡到上传结束。
    const previewPost = makeLocalPreviewPost(post);
    const previewResult = addLocalSharing(previewPost);
    if (!previewResult.success && (!isSupabaseConfigured || !supabase)) {
      throw new Error(previewResult.error || localResult.error || '成员分享保存失败');
    }
    syncSharingToCloud(post).catch((err) => {
      console.warn('[MemberSharingDB] 后台同步分享失败:', err?.message || err);
    });
    return { ...previewPost, _syncing: true };
  }

  // 本地已保存，可以立即返回列表；云端同步放到后台，成功后会用云端返回值覆盖本地附件 URL 等元数据。
  syncSharingToCloud(post).catch((err) => {
    console.warn('[MemberSharingDB] 后台同步分享失败:', err?.message || err);
  });
  return { ...post, _syncing: true };
}

/** 更新分享（支持部分字段，例如只更新 likes） */
export async function updateSharing(id, updates) {
  // 本地兜底
  updateLocalSharing(id, updates);

  if (!isSupabaseConfigured || !supabase) return;
  try {
    let cloudUpdates = updates;
    if (updates.attachments !== undefined) {
      cloudUpdates = await prepareSharingForCloud({ id, ...updates });
      updateLocalSharing(id, { attachments: cloudUpdates.attachments });
    }
    const dbUpdates = frontendToDbUpdate(cloudUpdates);
    let { error } = await supabase
      .from('member_sharing')
      .update(dbUpdates)
      .eq('id', String(id));
    if (error && (isMissingSummaryColumnError(error) || isMissingContributorColumnError(error))) {
      let retryUpdates = dbUpdates;
      if (isMissingSummaryColumnError(error)) retryUpdates = stripSummaryField(retryUpdates);
      if (isMissingContributorColumnError(error)) retryUpdates = stripContributorIdsField(retryUpdates);
      const retry = await supabase
        .from('member_sharing')
        .update(retryUpdates)
        .eq('id', String(id));
      error = retry.error;
    }
    if (error) {
      console.warn('[MemberSharingDB] 更新分享失败:', error.message);
    }
  } catch (err) {
    console.warn('[MemberSharingDB] 更新分享异常:', err.message);
  }
}

/** 删除分享 */
export async function deleteSharing(id) {
  deleteLocalSharing(id);
  if (!isSupabaseConfigured || !supabase) return;
  try {
    const { error } = await supabase
      .from('member_sharing')
      .delete()
      .eq('id', String(id));
    if (error) {
      console.warn('[MemberSharingDB] 删除分享失败:', error.message);
    }
  } catch (err) {
    console.warn('[MemberSharingDB] 删除分享异常:', err.message);
  }
}

/** 订阅 member_sharing 表的实时变更 */
export function subscribeSharings(onChange) {
  if (!isSupabaseConfigured || !supabase) return () => {};
  const channel = supabase
    .channel('member_sharing_realtime')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'member_sharing' },
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

/** 将 localStorage 中的分享迁移到 Supabase（幂等：以 id 为主键，重复会被跳过） */
export async function migrateLocalSharingsToDb() {
  if (!isSupabaseConfigured || !supabase) return 0;
  const local = getLocalSharings();
  if (local.length === 0) return 0;

  // 过滤掉示例数据（sharing-1/2/3，id 比较固定），避免每个用户都把示例上云
  const SAMPLE_IDS = new Set(['sharing-1', 'sharing-2', 'sharing-3']);
  const toMigrate = local.filter((s) => !SAMPLE_IDS.has(String(s.id)));
  if (toMigrate.length === 0) return 0;

  let migrated = 0;
  for (const post of toMigrate) {
    try {
      const cloudPost = await withTimeout(
        prepareSharingForCloud(post),
        MEMBER_SHARING_CLOUD_TIMEOUT_MS,
        '迁移成员分享附件上传',
      );
      const row = frontendToDbInsert(cloudPost);
      const { error } = await withTimeout(
        supabase
          .from('member_sharing')
          .upsert(row, { onConflict: 'id' }),
        MEMBER_SHARING_CLOUD_TIMEOUT_MS,
        '迁移成员分享云端保存',
      );
      if (!error) migrated++;
      else console.warn('[MemberSharingDB] 迁移分享失败:', post.title, error.message);
    } catch (err) {
      console.warn('[MemberSharingDB] 迁移分享异常:', post.title, err.message);
    }
  }
  if (migrated > 0) {
    console.log(`[MemberSharingDB] 成功迁移 ${migrated}/${toMigrate.length} 条分享到数据库`);
  }
  return migrated;
}

// ================================================================
// Categories（分类）
// ================================================================

/** 获取所有分类（按 sort_order 升序）
 *
 * ⚠️ 空数组语义很重要：
 *   - 云端成功返回 0 行 → 表示"用户把所有分类都删掉了"，必须原样返回 []，
 *     不能兜底成 DEFAULT_CATEGORIES，否则会出现"A 设备把默认分类全删了、
 *     B 设备收到 realtime 重 fetch → 被默认分类填回去"的诡异体验，删除就
 *     等于没做。
 *   - 只有在 supabase 未配置 / 请求出错（无法得知云端真实状态）时，才回退
 *     localStorage 的本地兜底，避免断网 / RLS 拒绝等异常场景下丢数据。
 */
export async function fetchCategories() {
  if (!isSupabaseConfigured || !supabase) {
    return getLocalCategories();
  }
  try {
    const { data, error } = await supabase
      .from('member_sharing_categories')
      .select('*')
      .order('sort_order', { ascending: true });
    if (error) {
      console.warn('[MemberSharingDB] 获取分类失败，回退本地:', error.message);
      return getLocalCategories();
    }
    // 云端真实结果（可能为空数组，空 = 用户清空了所有分类，必须原样返回）
    return (data || []).map((r) => ({ key: r.key, label: r.label, color: r.color }));
  } catch (err) {
    console.warn('[MemberSharingDB] 获取分类异常，回退本地:', err.message);
    return getLocalCategories();
  }
}

/** 新增分类。返回 { success, error } 方便调用方感知云端失败后回滚。 */
export async function addCategory(cat) {
  saveLocalCategories([...getLocalCategories(), cat]);
  if (!isSupabaseConfigured || !supabase) {
    return { success: false, error: 'supabase-not-configured' };
  }
  try {
    const { error } = await supabase
      .from('member_sharing_categories')
      .insert({
        key: cat.key,
        label: cat.label,
        color: cat.color,
        sort_order: Date.now() % 2147483647, // 简单的递增 sort_order
      });
    if (error) {
      console.warn('[MemberSharingDB] 新增分类失败:', error.message);
      return { success: false, error: error.message };
    }
    return { success: true, error: null };
  } catch (err) {
    console.warn('[MemberSharingDB] 新增分类异常:', err.message);
    return { success: false, error: err.message };
  }
}

/** 更新分类。返回 { success, error }。 */
export async function updateCategory(key, updates) {
  const list = getLocalCategories().map((c) => (c.key === key ? { ...c, ...updates } : c));
  saveLocalCategories(list);
  if (!isSupabaseConfigured || !supabase) {
    return { success: false, error: 'supabase-not-configured' };
  }
  try {
    const u = {};
    if (updates.label !== undefined) u.label = updates.label;
    if (updates.color !== undefined) u.color = updates.color;
    u.updated_at = new Date().toISOString();
    const { error } = await supabase
      .from('member_sharing_categories')
      .update(u)
      .eq('key', key);
    if (error) {
      console.warn('[MemberSharingDB] 更新分类失败:', error.message);
      return { success: false, error: error.message };
    }
    return { success: true, error: null };
  } catch (err) {
    console.warn('[MemberSharingDB] 更新分类异常:', err.message);
    return { success: false, error: err.message };
  }
}

/** 删除分类。返回 { success, error }。 */
export async function deleteCategory(key) {
  saveLocalCategories(getLocalCategories().filter((c) => c.key !== key));
  if (!isSupabaseConfigured || !supabase) {
    return { success: false, error: 'supabase-not-configured' };
  }
  try {
    const { error } = await supabase
      .from('member_sharing_categories')
      .delete()
      .eq('key', key);
    if (error) {
      console.warn('[MemberSharingDB] 删除分类失败:', error.message);
      return { success: false, error: error.message };
    }
    return { success: true, error: null };
  } catch (err) {
    console.warn('[MemberSharingDB] 删除分类异常:', err.message);
    return { success: false, error: err.message };
  }
}

/** 订阅 categories 表的实时变更 */
export function subscribeCategories(onChange) {
  if (!isSupabaseConfigured || !supabase) return () => {};
  const channel = supabase
    .channel('member_sharing_categories_realtime')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'member_sharing_categories' },
      () => {
        // 简化处理：收到任意变更时，调用方重新 fetchCategories 即可
        onChange();
      },
    )
    .subscribe();
  return () => {
    try { supabase.removeChannel(channel); } catch { /* ignore */ }
  };
}

// ================================================================
// localStorage 兜底实现
// ================================================================

function getLocalSharings() {
  try {
    const raw = localStorage.getItem(LOCAL_SHARINGS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveLocalSharings(list) {
  try {
    localStorage.setItem(LOCAL_SHARINGS_KEY, JSON.stringify(list));
    return { success: true, error: null };
  } catch (err) {
    console.warn('[MemberSharingDB] 本地分享缓存保存失败:', err?.message || err);
    return {
      success: false,
      error: err?.name === 'QuotaExceededError'
        ? '浏览器本地缓存空间不足，无法保存这篇分享。'
        : (err?.message || '本地缓存保存失败'),
    };
  }
}

function addLocalSharing(post) {
  const list = getLocalSharings();
  // 按 id 去重（防止同 id 重复插入）
  const next = [post, ...list.filter((s) => String(s.id) !== String(post.id))];
  return saveLocalSharings(next);
}

function updateLocalSharing(id, updates) {
  const list = getLocalSharings();
  const next = list.map((s) => (String(s.id) === String(id) ? { ...s, ...updates } : s));
  saveLocalSharings(next);
}

function deleteLocalSharing(id) {
  const next = getLocalSharings().filter((s) => String(s.id) !== String(id));
  saveLocalSharings(next);
}

function getLocalCategories() {
  try {
    const raw = localStorage.getItem(LOCAL_CATEGORIES_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return DEFAULT_CATEGORIES;
}

function saveLocalCategories(list) {
  try {
    localStorage.setItem(LOCAL_CATEGORIES_KEY, JSON.stringify(list));
  } catch { /* ignore */ }
}
