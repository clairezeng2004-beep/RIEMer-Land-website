// ============================================
// 文档（流程模板）数据服务
// ============================================
// 负责 Supabase 和 localStorage 的统一 CRUD，保证 Documents.jsx /
// ProcessTemplateCreate.jsx / ProcessTemplateDetail.jsx 三处共用相同的持久化逻辑。
//
// 持久化策略：
// - Supabase 可用 → 优先读写云端 `documents` 表；本地同时写一份缓存
//   （加速首屏、离线兜底）。
// - Supabase 不可用 / 未登录 → 读写 localStorage。
//
// 默认模拟数据的"已删除 id 列表"也走云端的 documents_deleted_defaults 表，
// 避免一台设备删了默认数据、另一台设备又看到。
// 跨设备浏览计数走 document_views 表。

import { supabase, isSupabaseConfigured } from './supabase';
import {
  hasUnstableExternalImages,
  stampInlineImageStorageRef,
} from '../utils/inlineImageRecovery';

export const DOCUMENTS_KEY = 'riemer_documents';
export const DELETED_DEFAULT_IDS_KEY = 'riemer_documents_deleted_default_ids';
export const DOC_VIEWS_KEY = 'riemer_process_template_views';
const DOCUMENTS_BUCKET = 'documents';
const DOCUMENTS_CLOUD_TIMEOUT_MS = 25000;
const VIEW_COUNT_TIMEOUT_MS = 8000;
const VIEW_LOG_TIMEOUT_MS = 8000;
const DEFAULT_VIEW_TARGET_TYPE = 'process-template';

/**
 * 判断当前是否可以使用 Supabase（已配置 + 健康检测通过）
 */
export function canUseSupabase() {
  // 文档数据必须以云端为权威。健康检查可能被移动端网络/CDN/浏览器策略误判，
  // 不能因此直接切到 localStorage，否则会出现跨设备只看到本地旧数据。
  // 只要 Supabase 已配置，就让真实的 documents 查询自己决定成功或失败。
  return Boolean(isSupabaseConfigured && supabase);
}

function withTimeout(promise, ms, label) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} 超时`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

function makeViewTargetKey(documentId, targetType = DEFAULT_VIEW_TARGET_TYPE) {
  const type = String(targetType || DEFAULT_VIEW_TARGET_TYPE).trim();
  return `${type}:${String(documentId)}`;
}

function parseViewTargetKey(key, targetType = DEFAULT_VIEW_TARGET_TYPE) {
  const prefix = `${String(targetType || DEFAULT_VIEW_TARGET_TYPE).trim()}:`;
  const str = String(key || '');
  return str.startsWith(prefix) ? str.slice(prefix.length) : null;
}

/* ============ Row ↔ Doc 对象互转 ============ */
// 数据库列名（snake_case）与前端字段（camelCase）互转

function rowToDoc(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title || '',
    type: row.type || 'process',
    description: row.description || '',
    format: row.format || 'word',
    content: row.content || '',
    attachments: Array.isArray(row.attachments) ? row.attachments : [],
    fileType: row.file_type || null,
    fileUrl: row.file_url || null,
    size: row.size_text || '—',
    uploadedBy: row.uploaded_by || 'Unknown',
    uploadedById: row.uploaded_by_id || null,
    /* 多贡献者支持：若云端列缺失（旧表结构），回退到 [uploaded_by_id] */
    contributorIds: Array.isArray(row.contributor_ids)
      ? row.contributor_ids
      : row.uploaded_by_id
        ? [row.uploaded_by_id]
        : [],
    date: row.date || '',
    viewCount: row.view_count || 0,
    likes: Array.isArray(row.likes) ? row.likes : [],
    lastEditedAt: row.last_edited_at || null,
    lastEditedBy: row.last_edited_by || null,
    _remote: true, // 标记此记录来自云端，便于调试
  };
}

function docToRow(doc) {
  return {
    id: doc.id,
    title: doc.title || '',
    type: doc.type || 'process',
    description: doc.description || '',
    format: doc.format || 'word',
    content: doc.content || '',
    attachments: Array.isArray(doc.attachments)
      ? doc.attachments.map(({ dataUrl, blobUrl, file, _file, ...att }) => att)
      : [],
    file_type: doc.fileType || null,
    file_url: doc.fileUrl || null,
    size_text: doc.size || '—',
    uploaded_by: doc.uploadedBy || 'Unknown',
    uploaded_by_id: doc.uploadedById || null,
    /* 多贡献者：若表未添加该列，后端会报错，此时前端会走降级
       （云端插入失败 → 本地仍保留，跨设备不同步）。
       升级 SQL 见 supabase-fix.sql。 */
    contributor_ids: Array.isArray(doc.contributorIds) && doc.contributorIds.length > 0
      ? doc.contributorIds
      : doc.uploadedById ? [doc.uploadedById] : [],
    date: doc.date || new Date().toISOString().split('T')[0],
    view_count: doc.viewCount || 0,
    likes: Array.isArray(doc.likes) ? doc.likes : [],
    last_edited_at: doc.lastEditedAt || null,
    last_edited_by: doc.lastEditedBy || null,
  };
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

async function uploadAttachmentAsset({ docId, attachment, userId }) {
  if (!attachment?.dataUrl || attachment.url) return attachment;
  const blob = dataUrlToBlob(attachment.dataUrl);
  if (!blob) return attachment;

  const fileName = attachment.name || `attachment.${getFileExt(attachment.type)}`;
  const path = [
    userId || 'unknown-user',
    docId,
    `${attachment.id || Date.now()}-${safeStorageName(fileName)}`,
  ].join('/');

  const { error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .upload(path, blob, {
      contentType: attachment.type || blob.type || 'application/octet-stream',
      upsert: true,
    });

  if (error) {
    throw new Error(`附件 "${fileName}" 上传失败：${error.message}`);
  }

  const { data } = supabase.storage.from(DOCUMENTS_BUCKET).getPublicUrl(path);
  const { dataUrl, ...rest } = attachment;
  return {
    ...rest,
    url: data.publicUrl,
    storagePath: path,
  };
}

// 图片 MIME → 文件后缀
const INLINE_IMG_EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
};

/**
 * 把正文里内嵌的 base64 图片上传到 Storage，并把 src 换成公开 URL。
 * 避免多张大图把内容撑爆（localStorage 配额 / PostgREST 请求体上限），
 * 解决"刷新后除第一张外图片都变成破图"的问题。上传失败的图片保留原 base64。
 */
async function uploadInlineContentImages(content, { docId, userId }) {
  if (!content || typeof content !== 'string' || !supabase) return content;
  const re = /(?:src|href)=["']((?:data:image\/|blob:)[^"']+)["']/gi;
  const localUrls = new Set();
  let m;
  while ((m = re.exec(content)) !== null) localUrls.add(m[1]);
  if (localUrls.size === 0) return content;

  let out = content;
  let idx = 0;
  for (const localUrl of localUrls) {
    idx += 1;
    let blob = null;
    if (localUrl.startsWith('data:')) {
      blob = dataUrlToBlob(localUrl);
    } else if (localUrl.startsWith('blob:')) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const res = await fetch(localUrl);
        // eslint-disable-next-line no-await-in-loop
        blob = res.ok ? await res.blob() : null;
      } catch (err) {
        console.warn('[DocumentsDB] 正文 blob 图片读取失败:', err.message);
      }
    }
    if (!blob) {
      console.warn('[DocumentsDB] 正文本地图片读取失败，保留原地址');
      continue;
    }
    const mime = blob.type || (localUrl.match(/^data:([^;]+);/) || [])[1] || 'image/png';
    const ext = INLINE_IMG_EXT[mime] || 'png';
    const path = [userId || 'unknown-user', docId || 'no-doc', `inline-${Date.now()}-${idx}.${ext}`].join('/');
    try {
      // eslint-disable-next-line no-await-in-loop
      const { error } = await supabase.storage
        .from(DOCUMENTS_BUCKET)
        .upload(path, blob, { contentType: mime, upsert: true });
      if (error) {
        throw new Error(`正文图片保存失败：${error.message}`);
      }
      const { data } = supabase.storage.from(DOCUMENTS_BUCKET).getPublicUrl(path);
      if (data?.publicUrl) {
        out = stampInlineImageStorageRef(out, localUrl, {
          bucket: DOCUMENTS_BUCKET,
          path,
          publicUrl: data.publicUrl,
        });
      }
    } catch (err) {
      throw new Error(`正文图片保存失败：${err.message}`);
    }
  }
  return out;
}

function hasInlineLocalImages(content = '') {
  return /(?:src|href)=["'](?:data:image\/|blob:)[^"']+["']/i.test(String(content || ''));
}

async function prepareDocForCloud(doc) {
  const { data: auth } = await supabase.auth.getUser().catch(() => ({ data: null }));
  const userId = doc.uploadedById || auth?.user?.id || null;
  const attachments = Array.isArray(doc.attachments)
    ? await Promise.all(doc.attachments.map((att) => uploadAttachmentAsset({
      docId: doc.id,
      attachment: att,
      userId,
    })))
    : [];
  const primary = attachments[0] || null;
  const fileUrl =
    doc.fileUrl && !String(doc.fileUrl).startsWith('data:')
      ? doc.fileUrl
      : primary?.url || doc.fileUrl || null;
  // 正文内嵌图片：上传到 Storage，src 换成 URL（避免 base64 撑爆内容）
  const content = doc.content !== undefined
    ? await uploadInlineContentImages(doc.content, { docId: doc.id, userId })
    : doc.content;
  if (doc.content !== undefined && hasInlineLocalImages(content)) {
    throw new Error('正文图片尚未成功上传，请检查网络后重试。');
  }
  if (doc.content !== undefined && hasUnstableExternalImages(content)) {
    throw new Error('正文中包含飞书临时图片链接，链接会过期导致破图。请重新上传这些图片后再保存。');
  }
  return { ...doc, content, attachments, fileUrl };
}

/* ============ 本地 localStorage 读写 ============ */

export function loadLocalDocs() {
  try {
    const stored = localStorage.getItem(DOCUMENTS_KEY);
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return [];
}

export function saveLocalDocs(data) {
  try {
    localStorage.setItem(DOCUMENTS_KEY, JSON.stringify(data));
  } catch (err) {
    console.error('[documentsService] localStorage 保存失败（空间不足？）', err);
    throw err;
  }
}

export function loadLocalDeletedIds() {
  try {
    const stored = localStorage.getItem(DELETED_DEFAULT_IDS_KEY);
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return [];
}

export function saveLocalDeletedIds(ids) {
  try {
    localStorage.setItem(DELETED_DEFAULT_IDS_KEY, JSON.stringify(ids));
  } catch (err) {
    console.error('[documentsService] localStorage 保存已删除列表失败', err);
  }
}

/* ============ Supabase 云端读写 ============ */

/**
 * 从云端拉取所有用户发布的文档 + 已删除默认 id 列表。
 * 失败（表不存在 / 网络异常 / 未登录）时返回 null，调用方退回本地。
 */
export async function fetchAllFromCloud() {
  if (!canUseSupabase() || !supabase) return null;
  try {
    const [docsRes, deletedRes] = await withTimeout(
      Promise.all([
        supabase
          .from('documents')
          .select('*')
          .order('created_at', { ascending: false }),
        supabase.from('documents_deleted_defaults').select('default_id'),
      ]),
      DOCUMENTS_CLOUD_TIMEOUT_MS,
      '拉取流程模板文件',
    );

    if (docsRes.error) {
      console.warn('[documentsService] 云端拉取 documents 失败:', docsRes.error.message);
      return null;
    }

    const docs = (docsRes.data || []).map(rowToDoc);
    const deletedIds = deletedRes.error
      ? []
      : (deletedRes.data || []).map((r) => String(r.default_id));

    // 写入本地缓存，用于下次首屏快速渲染
    // 注意：本地缓存同时持有"用户发布的新文档"与"内置示例被覆盖后的最新版"，
    // 两类都以 id 为键落到 localStorage 的 DOCUMENTS_KEY，Documents / ProcessTemplateDetail
    // 渲染时会按 id 去重保证同一文档只显示一份。
    try {
      saveLocalDocs(docs);
      saveLocalDeletedIds(deletedIds);
    } catch { /* ignore */ }

    return { docs, deletedIds };
  } catch (err) {
    console.warn('[documentsService] fetchAllFromCloud 异常:', err.message);
    return null;
  }
}

export async function fetchDocFromCloud(id) {
  if (!canUseSupabase() || !supabase || !id) return null;
  try {
    const [docRes, deletedRes] = await withTimeout(
      Promise.all([
        supabase
          .from('documents')
          .select('*')
          .eq('id', String(id))
          .maybeSingle(),
        supabase.from('documents_deleted_defaults').select('default_id'),
      ]),
      DOCUMENTS_CLOUD_TIMEOUT_MS,
      '拉取流程模板文件详情',
    );

    if (docRes.error) {
      console.warn('[documentsService] 云端拉取单篇文档失败:', docRes.error.message);
      return null;
    }

    const doc = docRes.data ? rowToDoc(docRes.data) : null;
    const deletedIds = deletedRes.error
      ? []
      : (deletedRes.data || []).map((r) => String(r.default_id));

    if (doc) {
      try {
        const existing = loadLocalDocs().filter((d) => String(d.id) !== String(doc.id));
        saveLocalDocs([doc, ...existing]);
        saveLocalDeletedIds(deletedIds);
      } catch { /* ignore */ }
    }

    return { doc, deletedIds };
  } catch (err) {
    console.warn('[documentsService] fetchDocFromCloud 异常:', err.message);
    return null;
  }
}

/**
 * 把 Supabase 返回的 error 对象拼成一段对排错有帮助的提示。
 *
 * Supabase / PostgREST 的 error 通常长这样:
 *   { message: '...', code: '23505' | 'PGRST116' | '42703' ..., details: '...', hint: '...' }
 * 之前只透传 `error.message` 会丢掉最关键的 code / details / hint,
 * 把它们一起串成多行字符串,UI alert 里就能直接看出是 schema 不对 / RLS 被拦
 * / payload 太大 / 唯一键冲突。
 */
function describeSupabaseError(prefix, error) {
  const code = error?.code ? `[${error.code}] ` : '';
  const msg = error?.message || '未知错误';
  const detail = error?.details ? `\n详细: ${error.details}` : '';
  const hint = error?.hint ? `\n提示: ${error.hint}` : '';
  // 常见 code → 中文友好提示。便于看到弹窗就知道下一步该做什么。
  const knownHints = {
    '42703': '\n（很可能是数据库缺列，比如 contributor_ids；请在 Supabase SQL Editor 跑 supabase-fix.sql）',
    '42P01': '\n（表不存在；请先跑 supabase-setup.sql）',
    '23505': '\n（主键/唯一键冲突，同 id 已存在；前端 id 是 doc-Date.now()，理论上不应出现）',
    '23503': '\n（外键约束失败，uploaded_by_id 引用的 auth.users 没找到；可能登录态异常）',
    '42501': '\n（RLS 拒绝写入。检查是否已认证登录，或 policy 是否允许 INSERT）',
    'PGRST301': '\n（JWT 过期或失效，请重新登录）',
    'PGRST116': '\n（Supabase 没找到符合条件的行）',
    '413': '\n（请求体过大。附件 / 富文本里嵌的图片可能超过 PostgREST 单次请求上限，需要把附件改用 Supabase Storage 存而不是 base64 直传）',
  };
  const known = knownHints[error?.code] || '';
  return `${prefix}：${code}${msg}${detail}${hint}${known}`;
}

/**
 * 新增一条文档。正式发布必须写入云端成功；本地只作为成功后的缓存。
 */
export async function createDoc(doc) {
  if (!canUseSupabase() || !supabase) {
    throw new Error('云端暂时不可用，请检查网络后重新发布。');
  }

  let cloudResp;
  let cloudDoc;
  try {
    cloudDoc = await prepareDocForCloud(doc);
    const row = docToRow(cloudDoc);
    cloudResp = await supabase.from('documents').insert(row);
  } catch (err) {
    // fetch 层面的异常（超时、断网、被 AbortController 切断）
    console.error('[documentsService] 云端 insert 网络异常:', err);
    throw new Error(
      '云端上传失败（网络异常 / 超时）：' + (err?.message || '未知错误')
    );
  }

  if (cloudResp?.error) {
    // Supabase 返回了显式错误（schema 不对 / RLS 拒绝 / payload 太大等）
    console.error('[documentsService] 云端 insert 失败:', cloudResp.error);
    throw new Error(describeSupabaseError('云端上传失败', cloudResp.error));
  }

  // 云端 OK → 写一份本地缓存。失败仅警告，不阻塞发布结果。
  try {
    const existing = loadLocalDocs();
    saveLocalDocs([cloudDoc, ...existing]);
  } catch (cacheErr) {
    console.warn('[documentsService] 云端已发布，本地缓存写入失败:', cacheErr);
  }

  console.log('[documentsService] 云端插入成功, id:', doc.id);
  return { doc: cloudDoc, remote: true };
}

/**
 * 更新一条用户发布的文档（内容、标题、likes 等）。
 * 会同时写云端和本地缓存；云端失败不致命，只是跨设备不同步。
 */
export async function updateDoc(id, patch) {
  const needsAssetUpload = Boolean(
    ('attachments' in patch && Array.isArray(patch.attachments)) ||
    ('fileUrl' in patch && String(patch.fileUrl || '').startsWith('data:')) ||
    ('content' in patch && (
      hasInlineLocalImages(patch.content) || hasUnstableExternalImages(patch.content)
    ))
  );
  let localPatch = patch;
  try {
    if (needsAssetUpload && canUseSupabase() && supabase) {
      const prepared = await prepareDocForCloud({ id, ...patch });
      patch = {
        ...patch,
        ...('attachments' in patch ? { attachments: prepared.attachments } : {}),
        ...('fileUrl' in patch ? { fileUrl: prepared.fileUrl } : {}),
        ...('content' in patch ? { content: prepared.content } : {}),
      };
    }
    localPatch = patch;
  } catch (err) {
    console.warn('[documentsService] 正文图片上传失败，跳过本地临时图片缓存:', err.message);
    if (needsAssetUpload) return { remote: false, error: err };
  }

  // 图片上传完成后再更新本地缓存，避免把 blob: / data: 这类临时地址持久化成破图。
  try {
    const all = loadLocalDocs();
    const idx = all.findIndex((d) => String(d.id) === String(id));
    if (idx !== -1) {
      all[idx] = { ...all[idx], ...localPatch };
      saveLocalDocs(all);
    }
  } catch { /* ignore */ }

  if (!canUseSupabase() || !supabase) {
    return { remote: false };
  }

  try {
    // 把 camelCase patch 转成 snake_case（只转已知字段，避免污染数据库列）
    const update = {};
    if ('title' in patch) update.title = patch.title;
    if ('description' in patch) update.description = patch.description;
    if ('content' in patch) update.content = patch.content;
    if ('format' in patch) update.format = patch.format;
    if ('type' in patch) update.type = patch.type;
    if ('attachments' in patch) update.attachments = patch.attachments;
    if ('fileType' in patch) update.file_type = patch.fileType;
    if ('fileUrl' in patch) update.file_url = patch.fileUrl;
    if ('likes' in patch) update.likes = patch.likes;
    if ('contributorIds' in patch) update.contributor_ids = patch.contributorIds;
    if ('uploadedBy' in patch) update.uploaded_by = patch.uploadedBy;
    if ('uploadedById' in patch) update.uploaded_by_id = patch.uploadedById;
    if ('lastEditedAt' in patch) update.last_edited_at = patch.lastEditedAt;
    if ('lastEditedBy' in patch) update.last_edited_by = patch.lastEditedBy;
    update.updated_at = new Date().toISOString();

    const { error } = await withTimeout(
      supabase.from('documents').update(update).eq('id', id),
      DOCUMENTS_CLOUD_TIMEOUT_MS,
      '流程模板云端更新',
    );
    if (error) {
      // updateDoc 故意保留"return 而非 throw"——调用方（点赞、编辑保存）已经
      // 用 result.remote / .catch 各自处理云端失败，不希望编辑中断 UI 流程。
      // 但 error 信息透传得更完整一些，便于 console / 顶部 hint 看清原因。
      console.warn('[documentsService] 云端更新失败:', describeSupabaseError('updateDoc 云端失败', error));
      return { remote: false, error };
    }
    return { remote: true };
  } catch (err) {
    console.warn('[documentsService] updateDoc 异常:', err.message);
    return { remote: false, error: err };
  }
}

/**
 * 删除一条用户发布的文档。
 */
export async function deleteUserDoc(id) {
  // 本地
  try {
    const all = loadLocalDocs().filter((d) => String(d.id) !== String(id));
    saveLocalDocs(all);
  } catch { /* ignore */ }

  if (!canUseSupabase() || !supabase) return { remote: false };

  try {
    const { error } = await supabase.from('documents').delete().eq('id', id);
    if (error) {
      console.warn('[documentsService] 云端删除失败:', error.message, error.code);
      return { remote: false, error };
    }
    return { remote: true };
  } catch (err) {
    console.warn('[documentsService] deleteUserDoc 异常:', err.message);
    return { remote: false, error: err };
  }
}

/**
 * 标记默认模拟文档为已删除（跨设备生效）。
 */
export async function markDefaultDeleted(defaultId) {
  const sid = String(defaultId);
  // 本地
  try {
    const ids = loadLocalDeletedIds();
    if (!ids.includes(sid)) {
      ids.push(sid);
      saveLocalDeletedIds(ids);
    }
  } catch { /* ignore */ }

  if (!canUseSupabase() || !supabase) return { remote: false };

  try {
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase
      .from('documents_deleted_defaults')
      .upsert(
        { default_id: sid, deleted_by: user?.id || null },
        { onConflict: 'default_id' }
      );
    if (error) {
      console.warn('[documentsService] 标记默认文档删除失败:', error.message);
      return { remote: false, error };
    }
    return { remote: true };
  } catch (err) {
    console.warn('[documentsService] markDefaultDeleted 异常:', err.message);
    return { remote: false, error: err };
  }
}

/* ============ 浏览计数（document_views） ============ */

function loadStoredViews() {
  try {
    const stored = localStorage.getItem(DOC_VIEWS_KEY);
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return {};
}

export function loadLocalViews(targetType = DEFAULT_VIEW_TARGET_TYPE) {
  const stored = loadStoredViews();
  const localLogs = loadLocalViewLogs();
  const scoped = {};
  Object.entries(stored).forEach(([key, value]) => {
    const id = parseViewTargetKey(key, targetType);
    if (id) scoped[id] = value;
  });
  Object.entries(localLogs).forEach(([key, list]) => {
    const id = parseViewTargetKey(key, targetType);
    if (!id || !Array.isArray(list)) return;
    scoped[id] = Math.max(Number(scoped[id]) || 0, list.length);
  });
  return scoped;
}

export function saveLocalViews(map) {
  try {
    localStorage.setItem(DOC_VIEWS_KEY, JSON.stringify(map));
  } catch { /* ignore */ }
}

/**
 * 从云端拉取所有文档的浏览计数，合并到本地视图。
 * 合并策略：取两边较大值，避免掉线期间本地累计的数据被云端旧数据覆盖。
 */
export async function fetchViewsFromCloud(targetType = DEFAULT_VIEW_TARGET_TYPE) {
  if (!canUseSupabase() || !supabase) return null;
  try {
    // 只拉需要的两个字段（document_id + view_count）——避免被新加列或大字段
    // （比如后续若加 metadata jsonb）拖慢全表扫描。
    const prefix = `${String(targetType || DEFAULT_VIEW_TARGET_TYPE).trim()}:%`;
    const { data, error } = await withTimeout(
      supabase
        .from('document_views')
        .select('document_id,view_count')
        .like('document_id', prefix),
      VIEW_COUNT_TIMEOUT_MS,
      '加载浏览计数',
    );
    if (error) {
      console.warn('[documentsService] 拉取浏览计数失败:', error.message);
      return null;
    }
    const cloudMap = {};
    (data || []).forEach((r) => {
      const id = parseViewTargetKey(r.document_id, targetType);
      if (id) cloudMap[id] = r.view_count || 0;
    });
    try {
      const logCounts = await fetchViewLogCountsFromCloud(targetType);
      Object.entries(logCounts).forEach(([id, count]) => {
        cloudMap[id] = Math.max(Number(cloudMap[id]) || 0, Number(count) || 0);
      });
    } catch (err) {
      console.warn('[documentsService] 拉取访问明细计数失败:', err.message);
    }
    const localMap = loadStoredViews();
    const merged = { ...localMap };
    Object.entries(cloudMap).forEach(([k, v]) => {
      const localKey = makeViewTargetKey(k, targetType);
      merged[localKey] = Math.max(Number(merged[localKey]) || 0, Number(v) || 0);
    });
    saveLocalViews(merged);
    return loadLocalViews(targetType);
  } catch (err) {
    console.warn('[documentsService] fetchViewsFromCloud 异常:', err.message);
    return null;
  }
}

async function fetchViewLogCountsFromCloud(targetType = DEFAULT_VIEW_TARGET_TYPE) {
  const prefix = `${String(targetType || DEFAULT_VIEW_TARGET_TYPE).trim()}:%`;
  const counts = {};
  const pageSize = 1000;
  let from = 0;

  while (true) {
    const { data, error } = await withTimeout(
      supabase
        .from('document_view_logs')
        .select('document_id')
        .like('document_id', prefix)
        .range(from, from + pageSize - 1),
      VIEW_LOG_TIMEOUT_MS,
      '加载访问明细计数',
    );
    if (error) throw error;
    if (!Array.isArray(data) || data.length === 0) break;
    data.forEach((r) => {
      const id = parseViewTargetKey(r.document_id, targetType);
      if (!id) return;
      counts[id] = (counts[id] || 0) + 1;
    });
    if (data.length < pageSize) break;
    from += pageSize;
  }

  return counts;
}

/**
 * 浏览计数 +1。
 * 云端用 upsert 增量更新；本地缓存同步 +1。
 */
export async function incrementView(documentId, targetType = DEFAULT_VIEW_TARGET_TYPE) {
  const targetKey = makeViewTargetKey(documentId, targetType);

  // 本地 +1
  try {
    const map = loadStoredViews();
    map[targetKey] = (map[targetKey] || 0) + 1;
    saveLocalViews(map);
  } catch { /* ignore */ }

  if (!canUseSupabase() || !supabase) return { remote: false };

  try {
    // ① 优先用 Postgres 原子 RPC（见 supabase-performance-indexes.sql 中的
    //    increment_document_view）——一次网络往返、原子 +1，避免经典的
    //    "select → upsert" 两次 RT 并发覆盖问题。
    //    如果数据库里还没部署这个 RPC，Supabase 会返回函数不存在错误，
    //    自动降级到下面的 select + upsert 路径，保持向后兼容。
    const rpc = await withTimeout(
      supabase.rpc('increment_document_view', {
        p_document_id: targetKey,
      }),
      VIEW_COUNT_TIMEOUT_MS,
      '更新浏览计数',
    );
    if (!rpc.error) {
      const nextCount = Number(rpc.data) || 0;
      return { remote: true, count: nextCount };
    }
    // RPC 不可用（未部署 / 权限问题）— 走兜底路径
    if (rpc.error.code !== '42883' /* undefined_function */) {
      // 非"函数不存在"错误只在开发环境提示，避免污染用户控制台
      console.debug('[documentsService] increment_document_view RPC 失败，降级:', rpc.error.message);
    }

    // ② 兜底：先读当前云端值，再 upsert 新值（非原子，并发冲突对于浏览计数可接受）
    const { data: existing } = await withTimeout(
      supabase
        .from('document_views')
        .select('view_count')
        .eq('document_id', targetKey)
        .maybeSingle(),
      VIEW_COUNT_TIMEOUT_MS,
      '读取浏览计数',
    );
    const nextCount = (existing?.view_count || 0) + 1;
    const { error } = await withTimeout(
      supabase
        .from('document_views')
        .upsert(
          { document_id: targetKey, view_count: nextCount, updated_at: new Date().toISOString() },
          { onConflict: 'document_id' }
        ),
      VIEW_COUNT_TIMEOUT_MS,
      '写入浏览计数',
    );
    if (error) {
      console.warn('[documentsService] 浏览计数写入失败:', error.message);
      return { remote: false, error };
    }
    return { remote: true, count: nextCount };
  } catch (err) {
    console.warn('[documentsService] incrementView 异常:', err.message);
    return { remote: false, error: err };
  }
}

/* ============ 浏览记录详表（document_view_logs） ============ */
// 说明：
// document_views 表只存"总浏览数"，无法展示"谁什么时候看过"。
// 新增 document_view_logs 表，每次访问（按 session+文档去重）写入一条：
//   { document_id, user_id, user_name, viewed_at }
// 需要先在 Supabase 执行 supabase-fix.sql 中的对应建表语句。
//
// 本地降级：同时把访问记录按 documentId 分组存到 localStorage，
// 在 Supabase 不可用 / 未登录 / 表不存在时也能展示本设备的访问者。

export const DOC_VIEW_LOGS_KEY = 'riemer_document_view_logs'; // { [documentId]: [{userId,userName,viewedAt}] }

function loadLocalViewLogs() {
  try {
    const stored = localStorage.getItem(DOC_VIEW_LOGS_KEY);
    if (stored) return JSON.parse(stored) || {};
  } catch { /* ignore */ }
  return {};
}

function saveLocalViewLogs(map) {
  try {
    localStorage.setItem(DOC_VIEW_LOGS_KEY, JSON.stringify(map));
  } catch { /* ignore */ }
}

/**
 * 记录一次访问日志（与 incrementView 配套调用）。
 * @param {string} documentId
 * @param {{id?:string,name?:string,nickname?:string}|null} user 当前登录用户（可为空）
 */
export async function recordViewLog(documentId, user, targetType = DEFAULT_VIEW_TARGET_TYPE) {
  const targetKey = makeViewTargetKey(documentId, targetType);
  const userId = user?.id || null;
  const userName = user?.name || user?.nickname || user?.email || '访客';
  const viewedAt = new Date().toISOString();

  // 本地写一条
  try {
    const all = loadLocalViewLogs();
    const list = Array.isArray(all[targetKey]) ? all[targetKey] : [];
    list.push({ userId, userName, viewedAt });
    all[targetKey] = list;
    saveLocalViewLogs(all);
  } catch { /* ignore */ }

  if (!canUseSupabase() || !supabase) return { remote: false };

  try {
    const { error } = await supabase.from('document_view_logs').insert({
      document_id: targetKey,
      user_id: userId,
      user_name: userName,
      viewed_at: viewedAt,
    });
    if (error) {
      // 表不存在 / 无权限 → 静默降级
      console.warn('[documentsService] 访问日志写入失败:', error.message);
      return { remote: false, error };
    }
    return { remote: true };
  } catch (err) {
    console.warn('[documentsService] recordViewLog 异常:', err.message);
    return { remote: false, error: err };
  }
}

/**
 * 拉取某篇文档的访问日志（最近在前）。
 * 云端不可用时回退本地。
 * @param {string} documentId
 * @returns {Promise<Array<{userId:string|null,userName:string,viewedAt:string}>>}
 */
export async function fetchViewLog(documentId, targetType = DEFAULT_VIEW_TARGET_TYPE) {
  const targetKey = makeViewTargetKey(documentId, targetType);

  if (canUseSupabase() && supabase) {
    try {
      const rows = [];
      const pageSize = 1000;
      let from = 0;

      while (true) {
        const { data, error } = await withTimeout(
          supabase
            .from('document_view_logs')
            .select('user_id,user_name,viewed_at')
            .eq('document_id', targetKey)
            .order('viewed_at', { ascending: false })
            .range(from, from + pageSize - 1),
          VIEW_LOG_TIMEOUT_MS,
          '加载访问记录',
        );
        if (error) {
          console.warn('[documentsService] fetchViewLog 云端失败，回退本地:', error.message);
          rows.length = 0;
          break;
        }
        if (!Array.isArray(data) || data.length === 0) break;
        rows.push(...data);
        if (data.length < pageSize) break;
        from += pageSize;
      }

      if (rows.length > 0) {
        return rows.map((r) => ({
          userId: r.user_id || null,
          userName: r.user_name || '访客',
          viewedAt: r.viewed_at,
        }));
      }
    } catch (err) {
      console.warn('[documentsService] fetchViewLog 异常，回退本地:', err.message);
    }
  }
  // 本地兜底：按时间倒序
  const all = loadLocalViewLogs();
  const list = Array.isArray(all[targetKey]) ? [...all[targetKey]] : [];
  list.sort((a, b) => new Date(b.viewedAt || 0) - new Date(a.viewedAt || 0));
  return list;
}

/* ============ 编辑历史（document_edit_logs） ============ */
// 说明：
// 每次用户点"保存"时写一条编辑记录：{ document_id, editor_id, editor_name,
//   edited_at, changes }。
// changes 是一个数组，逐字段描述改了什么：
//   [{ field: 'title'|'description'|'content', before: '...', after: '...',
//      summary: '标题由 X 改为 Y' }]
// 为避免数据库膨胀，content 字段只保存截断摘要（前后各最多 120 字）
// 与字数变化，完整正文仍然沉淀在 documents.content。
//
// 本地降级：Supabase 不可用时写 localStorage，同一设备仍能看到历史；
// 登录后且 Supabase 可用则写云端，跨设备可见。

export const DOC_EDIT_LOGS_KEY = 'riemer_document_edit_logs'; // { [documentId]: [{ editorId, editorName, editedAt, changes }] }

function loadLocalEditLogs() {
  try {
    const stored = localStorage.getItem(DOC_EDIT_LOGS_KEY);
    if (stored) return JSON.parse(stored) || {};
  } catch { /* ignore */ }
  return {};
}

function saveLocalEditLogs(map) {
  try {
    localStorage.setItem(DOC_EDIT_LOGS_KEY, JSON.stringify(map));
  } catch (err) {
    // 容量不够时保留最近 50 条（每文档）后重试
    try {
      const trimmed = {};
      for (const [k, v] of Object.entries(map || {})) {
        trimmed[k] = Array.isArray(v) ? v.slice(-50) : v;
      }
      localStorage.setItem(DOC_EDIT_LOGS_KEY, JSON.stringify(trimmed));
    } catch {
      console.warn('[documentsService] 编辑日志本地缓存写入失败', err);
    }
  }
}

/**
 * 记录一次编辑日志（与 saveEdit 配套调用）。
 * @param {string} documentId
 * @param {{id?:string,name?:string,nickname?:string,email?:string}|null} user 当前编辑者
 * @param {Array<{field:string,before:any,after:any,summary:string}>} changes 字段级改动
 */
export async function recordEditLog(documentId, user, changes) {
  if (!Array.isArray(changes) || changes.length === 0) return { remote: false, skipped: true };
  const editorId = user?.id || null;
  const editorName = user?.name || user?.nickname || user?.email || 'Unknown';
  const editedAt = new Date().toISOString();

  // 本地
  try {
    const all = loadLocalEditLogs();
    const list = Array.isArray(all[documentId]) ? all[documentId] : [];
    list.push({ editorId, editorName, editedAt, changes });
    all[documentId] = list;
    saveLocalEditLogs(all);
  } catch { /* ignore */ }

  if (!canUseSupabase() || !supabase) return { remote: false };

  try {
    const { error } = await supabase.from('document_edit_logs').insert({
      document_id: documentId,
      editor_id: editorId,
      editor_name: editorName,
      edited_at: editedAt,
      changes,
    });
    if (error) {
      console.warn('[documentsService] 编辑日志写入失败:', error.message);
      return { remote: false, error };
    }
    return { remote: true };
  } catch (err) {
    console.warn('[documentsService] recordEditLog 异常:', err.message);
    return { remote: false, error: err };
  }
}

/**
 * 拉取某篇文档的编辑历史（最近在前）。
 * 云端不可用或查询失败时回退本地。
 * @param {string} documentId
 * @returns {Promise<Array<{editorId:string|null,editorName:string,editedAt:string,changes:Array}>>}
 */
export async function fetchEditLog(documentId) {
  if (canUseSupabase() && supabase) {
    try {
      const { data, error } = await supabase
        .from('document_edit_logs')
        .select('editor_id,editor_name,edited_at,changes')
        .eq('document_id', documentId)
        .order('edited_at', { ascending: false })
        .limit(200);
      if (!error && Array.isArray(data)) {
        return data.map((r) => ({
          editorId: r.editor_id || null,
          editorName: r.editor_name || 'Unknown',
          editedAt: r.edited_at,
          changes: Array.isArray(r.changes) ? r.changes : [],
        }));
      }
      if (error) {
        console.warn('[documentsService] fetchEditLog 云端失败，回退本地:', error.message);
      }
    } catch (err) {
      console.warn('[documentsService] fetchEditLog 异常，回退本地:', err.message);
    }
  }
  const all = loadLocalEditLogs();
  const list = Array.isArray(all[documentId]) ? [...all[documentId]] : [];
  list.sort((a, b) => new Date(b.editedAt || 0) - new Date(a.editedAt || 0));
  return list;
}

/**
 * 订阅某篇文档的编辑历史新增事件（realtime）。
 * @param {string} documentId
 * @param {(entry:{editorId:string|null,editorName:string,editedAt:string,changes:Array})=>void} onInsert
 * @returns {()=>void} 解除订阅
 */
export function subscribeEditLog(documentId, onInsert) {
  if (!isSupabaseConfigured || !supabase) return () => {};
  const channel = supabase
    .channel(`document_edit_logs_${documentId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'document_edit_logs',
        filter: `document_id=eq.${documentId}`,
      },
      (payload) => {
        const r = payload.new || {};
        onInsert({
          editorId: r.editor_id || null,
          editorName: r.editor_name || 'Unknown',
          editedAt: r.edited_at,
          changes: Array.isArray(r.changes) ? r.changes : [],
        });
      }
    )
    .subscribe();
  return () => {
    try { supabase.removeChannel(channel); } catch { /* ignore */ }
  };
}

/* ============ 判断工具 ============ */

export function isUserDoc(doc) {
  return String(doc?.id || '').startsWith('doc-');
}

/* ============ Realtime 订阅 ============ */
/**
 * 订阅 documents 表的实时变更（跨设备同步）
 * @param {(payload:{type:'INSERT'|'UPDATE'|'DELETE', newItem:any|null, oldItem:any|null})=>void} onChange
 * @returns {()=>void} 解除订阅
 */
export function subscribeDocuments(onChange) {
  if (!isSupabaseConfigured || !supabase) return () => {};
  const channel = supabase
    .channel('documents_realtime')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'documents' },
      (payload) => {
        const type = payload.eventType || payload.type;
        const newItem = payload.new ? rowToDoc(payload.new) : null;
        const oldItem = payload.old ? { id: payload.old.id } : null;
        onChange({ type, newItem, oldItem });
      }
    )
    .subscribe();
  return () => {
    try { supabase.removeChannel(channel); } catch { /* ignore */ }
  };
}

/**
 * 订阅 documents_deleted_defaults 表（管理员删除了默认数据时，其它设备同步隐藏）
 * @param {(payload:{type:'INSERT'|'DELETE', defaultId:string|null})=>void} onChange
 * @returns {()=>void} 解除订阅
 */
export function subscribeDeletedDefaults(onChange) {
  if (!isSupabaseConfigured || !supabase) return () => {};
  const channel = supabase
    .channel('documents_deleted_defaults_realtime')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'documents_deleted_defaults' },
      (payload) => {
        const type = payload.eventType || payload.type;
        const defaultId = payload.new?.default_id || payload.old?.default_id || null;
        onChange({ type, defaultId });
      }
    )
    .subscribe();
  return () => {
    try { supabase.removeChannel(channel); } catch { /* ignore */ }
  };
}
