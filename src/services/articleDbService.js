// ============================================
// RIEMer Land — 文章数据库服务（Supabase）
// ============================================
// 提供文章的 CRUD 操作，存储到 Supabase articles 表
// 当 Supabase 不可用时，回退到 localStorage

import { fetchPublicRows, supabase, isSupabaseConfigured } from '../lib/supabase';
import {
  getManagedArticleCoverPath,
  isImageDataUrl,
  removeArticleCover,
  uploadArticleCover,
} from './articleCoverService';

const LOCAL_ARTICLES_KEY = 'riemer_user_articles';
const ARTICLE_LIST_COLUMNS = [
  'id',
  'title',
  'raw_title',
  'author',
  'date',
  'category',
  'tags',
  'excerpt',
  'url',
  'cover_image',
  'read_num',
  'archived_by',
  'archived_by_id',
  'created_at',
  'updated_at',
  'work_item_id',
].join(', ');

// cover_image 保持为兼容字段：历史 Base64、Storage URL、外部 URL 和 null 均可读取。
// 只有用户新选择的 Base64 封面会上传 Storage；编辑其他字段不会改写旧封面。

/**
 * 从 Supabase 获取所有文章（按日期倒序）
 */
export async function fetchArticles() {
  if (!isSupabaseConfigured) {
    return getLocalArticles();
  }

  try {
    const params = new URLSearchParams({
      select: ARTICLE_LIST_COLUMNS,
      order: 'date.desc',
    });
    const data = await fetchPublicRows('articles', params);

    // 将数据库格式转为前端格式
    return (data || []).map(dbToFrontend);
  } catch (err) {
    console.warn('[ArticleDB] 获取文章异常，回退本地:', err.message);
    return getLocalArticles();
  }
}

/**
 * 按 id 获取单篇文章详情。列表页不拉正文，详情/站内阅读时再按需补齐。
 */
export async function fetchArticleById(id) {
  if (!id) return null;
  if (!isSupabaseConfigured) {
    return getLocalArticles().find((article) => String(article.id) === String(id)) || null;
  }

  try {
    const params = new URLSearchParams({
      select: '*',
      id: `eq.${id}`,
      limit: '1',
    });
    const [data] = await fetchPublicRows('articles', params);

    return data ? dbToFrontend(data) : null;
  } catch (err) {
    console.warn('[ArticleDB] 获取文章详情异常，回退本地:', err.message);
    return getLocalArticles().find((article) => String(article.id) === String(id)) || null;
  }
}

/**
 * 添加文章到 Supabase
 */
export async function addArticleToDb(article, userId) {
  if (!isSupabaseConfigured || !supabase) {
    addLocalArticle(article);
    return { ...article, _localOnly: true, _saveError: 'Supabase 未配置，文章仅保存到本机缓存。' };
  }

  let uploadedCoverPath = null;
  try {
    let coverImage = article.coverImage || article.cover_image || null;
    if (isImageDataUrl(coverImage)) {
      const uploaded = await uploadArticleCover(coverImage, userId);
      coverImage = uploaded.publicUrl;
      uploadedCoverPath = uploaded.path;
    }

    const row = frontendToDb({ ...article, coverImage }, userId);
    const { data, error } = await supabase
      .from('articles')
      .insert(row)
      .select()
      .single();

    if (error) {
      if (uploadedCoverPath) await removeArticleCover(uploadedCoverPath);
      console.warn('[ArticleDB] 添加文章失败:', error.message);
      return { ...article, _saveFailed: true, _saveError: error.message };
    }

    return dbToFrontend(data);
  } catch (err) {
    if (uploadedCoverPath) await removeArticleCover(uploadedCoverPath);
    console.warn('[ArticleDB] 添加文章异常:', err.message);
    return { ...article, _saveFailed: true, _saveError: err.message };
  }
}

/**
 * 更新文章
 * @returns {Promise<{success:boolean, article:object|null, error:string|null, localOnly?:boolean}>}
 */
export async function updateArticleInDb(id, updates, options = {}) {
  if (!id) {
    return { success: false, article: null, error: '缺少文章 ID，无法保存。' };
  }

  if (!isSupabaseConfigured || !supabase) {
    updateLocalArticle(id, updates);
    return {
      success: true,
      article: { id, ...updates },
      error: null,
      localOnly: true,
    };
  }

  let uploadedCoverPath = null;
  try {
    const dbUpdates = {};
    if (updates.title !== undefined) dbUpdates.title = updates.title;
    if (updates.rawTitle !== undefined) dbUpdates.raw_title = updates.rawTitle;
    if (updates.category !== undefined) dbUpdates.category = updates.category;
    if (updates.tags !== undefined) dbUpdates.tags = updates.tags;
    if (updates.excerpt !== undefined) dbUpdates.excerpt = updates.excerpt;
    if (updates.outline !== undefined) dbUpdates.outline = updates.outline;
    if (updates.content !== undefined) dbUpdates.content = updates.content;
    if (updates.url !== undefined) dbUpdates.url = updates.url;
    if (updates.date !== undefined) dbUpdates.date = updates.date;
    if (updates.author !== undefined) dbUpdates.author = updates.author;
    const coverChanged = updates.coverImage !== undefined
      && updates.coverImage !== options.previousCoverImage;
    if (coverChanged) {
      if (isImageDataUrl(updates.coverImage)) {
        const uploaded = await uploadArticleCover(updates.coverImage, options.userId);
        dbUpdates.cover_image = uploaded.publicUrl;
        uploadedCoverPath = uploaded.path;
      } else {
        dbUpdates.cover_image = updates.coverImage || null;
      }
    }
    if (updates.readNum !== undefined) dbUpdates.read_num = Number(updates.readNum) || 0;
    // 工作项关联（见 supabase-work-item-link.sql / src/utils/workItem.js）：
    // 允许把 null 写回数据库以解除关联；undefined 则表示调用方没打算改这个字段。
    if (updates.workItemId !== undefined) dbUpdates.work_item_id = updates.workItemId || null;
    dbUpdates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('articles')
      .update(dbUpdates)
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      if (uploadedCoverPath) await removeArticleCover(uploadedCoverPath);
      console.warn('[ArticleDB] 更新文章失败:', error.message);
      return { success: false, article: null, error: error.message };
    }

    if (!data) {
      if (uploadedCoverPath) await removeArticleCover(uploadedCoverPath);
      const error = '数据库没有返回已更新的文章，可能是记录不存在或当前账号没有更新权限。';
      console.warn('[ArticleDB] 更新文章失败:', error);
      return { success: false, article: null, error };
    }

    const previousPath = coverChanged
      ? getManagedArticleCoverPath(options.previousCoverImage)
      : null;
    if (previousPath && previousPath !== uploadedCoverPath) {
      const cleanup = await removeArticleCover(previousPath);
      if (!cleanup.success) {
        console.warn('[ArticleDB] 旧封面清理失败:', cleanup.error);
      }
    }

    return { success: true, article: dbToFrontend(data), error: null };
  } catch (err) {
    if (uploadedCoverPath) await removeArticleCover(uploadedCoverPath);
    console.warn('[ArticleDB] 更新文章异常:', err.message);
    return { success: false, article: null, error: err.message || '更新文章时发生异常。' };
  }
}

/**
 * 删除文章
 */
export async function deleteArticleFromDb(id) {
  if (!id) {
    return { success: false, deletedId: null, error: '缺少文章 ID，无法删除。' };
  }

  if (!isSupabaseConfigured || !supabase) {
    deleteLocalArticle(id);
    return { success: true, deletedId: id, error: null, localOnly: true };
  }

  try {
    const { data, error } = await supabase
      .from('articles')
      .delete()
      .eq('id', id)
      .select('id')
      .single();

    if (error) {
      console.warn('[ArticleDB] 删除文章失败:', error.message);
      return { success: false, deletedId: null, error: error.message };
    }

    if (!data?.id) {
      const error = '数据库没有返回被删除的文章，可能是记录不存在或当前账号没有删除权限。';
      console.warn('[ArticleDB] 删除文章失败:', error);
      return { success: false, deletedId: null, error };
    }

    return { success: true, deletedId: data.id, error: null };
  } catch (err) {
    console.warn('[ArticleDB] 删除文章异常:', err.message);
    return { success: false, deletedId: null, error: err.message || '删除文章时发生异常。' };
  }
}

const BATCH_ARTICLE_FIELDS = new Set(['category', 'tags', 'readNum']);

function buildBatchPayload(changes, { requireVersion = true } = {}) {
  if (!Array.isArray(changes)) {
    return { payload: null, error: '批量更新参数格式不正确。' };
  }

  const payload = [];
  const ids = new Set();
  for (const change of changes) {
    const id = change?.id;
    const updates = change?.updates || {};
    if (!id) return { payload: null, error: '批量更新中存在缺少 ID 的文章。' };
    if (ids.has(String(id))) return { payload: null, error: `批量更新中存在重复文章 ID：${id}` };
    ids.add(String(id));

    if (requireVersion && !change.expectedUpdatedAt) {
      return { payload: null, error: '文章数据缺少版本信息，请刷新页面后重试。' };
    }

    const fields = Object.keys(updates);
    const unsupportedField = fields.find((field) => !BATCH_ARTICLE_FIELDS.has(field));
    if (unsupportedField) {
      return { payload: null, error: `批量更新包含不支持的字段：${unsupportedField}` };
    }
    if (fields.length === 0) {
      return { payload: null, error: `文章 ${id} 的更新内容为空。` };
    }
    if (updates.category !== undefined && typeof updates.category !== 'string') {
      return { payload: null, error: `文章 ${id} 的系列格式不正确。` };
    }
    if (
      updates.tags !== undefined
      && (!Array.isArray(updates.tags) || updates.tags.some((tag) => typeof tag !== 'string'))
    ) {
      return { payload: null, error: `文章 ${id} 的标签格式不正确。` };
    }
    if (
      updates.readNum !== undefined
      && (!Number.isInteger(Number(updates.readNum)) || Number(updates.readNum) < 0)
    ) {
      return { payload: null, error: `文章 ${id} 的阅读量必须是非负整数。` };
    }

    const row = {
      id,
    };
    if (requireVersion) row.expected_updated_at = change.expectedUpdatedAt;
    if (updates.category !== undefined) row.category = updates.category;
    if (updates.tags !== undefined) row.tags = updates.tags;
    if (updates.readNum !== undefined) row.read_num = Number(updates.readNum);
    payload.push(row);
  }

  return { payload, error: null };
}

function updateLocalArticlesBatch(changes) {
  const articles = getLocalArticles();
  const byId = new Map(articles.map((article) => [String(article.id), article]));
  const missing = changes.find((change) => !byId.has(String(change.id)));
  if (missing) {
    return { success: false, articles: [], error: `本地缓存中找不到文章：${missing.id}` };
  }

  const now = new Date().toISOString();
  const updatesById = new Map(changes.map((change) => [String(change.id), change.updates || {}]));
  const nextArticles = articles.map((article) => {
    const updates = updatesById.get(String(article.id));
    return updates ? { ...article, ...updates, updatedAt: now } : article;
  });
  saveLocalArticles(nextArticles);

  return {
    success: true,
    articles: nextArticles.filter((article) => updatesById.has(String(article.id))),
    error: null,
    localOnly: true,
  };
}

/**
 * 原子批量更新文章。生产环境通过单次 RPC 在同一数据库事务内完成；
 * 任一文章版本冲突、无权限或不存在时，整批回滚。
 */
export async function batchUpdateArticlesInDb(changes) {
  if (!Array.isArray(changes) || changes.length === 0) {
    return { success: true, articles: [], error: null };
  }

  const cloudEnabled = isSupabaseConfigured && Boolean(supabase);
  const { payload, error: payloadError } = buildBatchPayload(changes, {
    requireVersion: cloudEnabled,
  });
  if (payloadError) return { success: false, articles: [], error: payloadError };
  if (!cloudEnabled) return updateLocalArticlesBatch(changes);

  try {
    const { data, error } = await supabase.rpc('apply_article_batch_updates', {
      p_changes: payload,
    });
    if (error) return { success: false, articles: [], error: error.message };

    const rows = Array.isArray(data?.articles) ? data.articles : [];
    if (rows.length !== changes.length) {
      return { success: false, articles: [], error: '数据库返回的文章数量与提交数量不一致。' };
    }
    return { success: true, articles: rows.map(dbToFrontend), error: null };
  } catch (err) {
    return { success: false, articles: [], error: err.message || '批量更新文章时发生异常。' };
  }
}

/**
 * 原子更新文章系列及 site_settings.article_categories。
 * SQL 函数只在事务成功后返回，避免文章和系列配置分步成功。
 */
export async function batchUpdateArticleCategoriesInDb(
  changes,
  categories,
  expectedSettingUpdatedAt,
) {
  if (!Array.isArray(changes) || !Array.isArray(categories)) {
    return { success: false, articles: [], error: '系列批量更新参数格式不正确。' };
  }

  const cloudEnabled = isSupabaseConfigured && Boolean(supabase);
  const { payload, error: payloadError } = buildBatchPayload(changes, {
    requireVersion: cloudEnabled,
  });
  if (payloadError) return { success: false, articles: [], error: payloadError };

  if (!cloudEnabled) {
    const localResult = changes.length > 0
      ? updateLocalArticlesBatch(changes)
      : { success: true, articles: [], error: null, localOnly: true };
    return { ...localResult, settingUpdatedAt: null };
  }

  try {
    const { data, error } = await supabase.rpc('apply_article_category_batch', {
      p_changes: payload,
      p_categories: categories,
      p_expected_setting_updated_at: expectedSettingUpdatedAt || null,
    });
    if (error) return { success: false, articles: [], error: error.message };

    const rows = Array.isArray(data?.articles) ? data.articles : [];
    if (rows.length !== changes.length) {
      return { success: false, articles: [], error: '数据库返回的文章数量与提交数量不一致。' };
    }
    return {
      success: true,
      articles: rows.map(dbToFrontend),
      settingUpdatedAt: data?.setting_updated_at || null,
      error: null,
    };
  } catch (err) {
    return { success: false, articles: [], error: err.message || '批量更新文章系列时发生异常。' };
  }
}

/**
 * 将 localStorage 中的文章迁移到 Supabase
 * 迁移成功后清除 localStorage 中的文章数据
 *
 * ⚠️ 安全性说明（历史 bug 教训）：
 *   曾经这里是"粗暴地把 localStorage 里所有条目都 insert 一遍回 Supabase"。
 *   但 ARTICLES_KEY 既是"云端 → 本地缓存"的落盘 key，也是这里读取的迁移源 key，
 *   会导致：云端数据被写进 localStorage → 下一次挂载时 migrate 又把它当"本地旧文章"
 *   上传 → articles 表里每刷新一次就翻倍。
 *
 *   现在的防御策略：
 *   (a) 只迁移"看起来确实是旧版临时本地条目"的数据：
 *       - 有 _fromDb: true 的（云端数据回写到本地缓存）直接跳过
 *       - id 是 UUID（明显是数据库生成过的）直接跳过
 *   (b) 迁移前先查一次云端 (title, date) 做重复检测
 *   (c) 迁移成功后强制清掉 localStorage，避免反复迁移
 */
export async function migrateLocalArticlesToDb(userId) {
  if (!isSupabaseConfigured || !supabase) return 0;

  const localArticles = getLocalArticles();
  if (localArticles.length === 0) return 0;

  // (a) 过滤：只保留"真正的本地临时文章"
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const candidates = localArticles.filter((a) => {
    if (a && a._fromDb) return false; // 云端回写的，坚决不迁移
    if (a && typeof a.id === 'string' && UUID_RE.test(a.id)) return false;
    return true;
  });

  if (candidates.length === 0) {
    // 没什么需要迁移 —— 但本地缓存里若全是 _fromDb 数据，保留不动，后续仍可作为启动缓存
    return 0;
  }

  // (b) 查一次云端已有 (title, date) 集合，防重
  let existing = new Set();
  try {
    const { data: existingRows } = await supabase
      .from('articles')
      .select('title,date');
    if (Array.isArray(existingRows)) {
      existing = new Set(existingRows.map((r) => `${r.title || ''}|${r.date || ''}`));
    }
  } catch {
    // 查询失败就保守放行，但仍会靠后面的 insert 失败兜底
  }

  let migrated = 0;
  let skippedDup = 0;
  for (const article of candidates) {
    const key = `${article.title || ''}|${article.date || ''}`;
    if (existing.has(key)) {
      skippedDup++;
      continue;
    }
    try {
      const row = frontendToDb(article, userId);
      const { error } = await supabase
        .from('articles')
        .insert(row);

      if (!error) {
        migrated++;
        existing.add(key);
      } else {
        console.warn('[ArticleDB] 迁移文章失败:', article.title, error.message);
      }
    } catch (err) {
      console.warn('[ArticleDB] 迁移文章异常:', article.title, err.message);
    }
  }

  // (c) 无论迁移了几条，只要候选集非空就清掉本地 —— 避免下次挂载再跑
  try {
    localStorage.removeItem(LOCAL_ARTICLES_KEY);
  } catch { /* ignore */ }
  if (migrated > 0 || skippedDup > 0) {
    console.log(
      `[ArticleDB] 迁移完成：成功 ${migrated}/${candidates.length}，去重跳过 ${skippedDup}`
    );
  }

  return migrated;
}

/**
 * 把单篇文章的历史 Base64 封面迁移到 Storage。
 *
 * 背景：历史封面以 Base64 内联存在 articles.cover_image，57 张≈7.5MB 全部挤在
 * 同一个列表响应里，导致公开页"文字秒出、封面要等一大包下载完"，且超过 5MB 的
 * localStorage 缓存上限根本写不进，每次打开都要重下。迁移成 Storage 公开 URL 后，
 * 列表响应缩到 ~50KB，封面各自从 CDN 懒加载并被浏览器缓存。
 *
 * 只处理 Base64 封面；已是 URL / 空封面直接跳过（skipped:true），不会误伤。
 * DB 更新失败会回收刚上传的 Storage 文件，保证不产生孤儿文件。
 */
export async function migrateArticleCoverToStorage(article, userId) {
  if (!isSupabaseConfigured || !supabase) {
    return { success: false, error: 'Supabase 未配置，无法迁移封面。' };
  }
  const cover = article?.coverImage || article?.cover_image || null;
  if (!isImageDataUrl(cover)) {
    // 非 Base64（已迁移的 URL、外部链接、空封面）无需处理
    return { success: true, skipped: true, article };
  }

  let uploadedPath = null;
  try {
    const uploaded = await uploadArticleCover(cover, userId);
    uploadedPath = uploaded.path;
    const { data, error } = await supabase
      .from('articles')
      .update({ cover_image: uploaded.publicUrl, updated_at: new Date().toISOString() })
      .eq('id', article.id)
      .select('*')
      .single();

    if (error || !data) {
      if (uploadedPath) await removeArticleCover(uploadedPath);
      return {
        success: false,
        error: error?.message || '数据库没有返回更新后的文章，可能是记录不存在或没有更新权限。',
      };
    }

    return { success: true, article: dbToFrontend(data) };
  } catch (err) {
    if (uploadedPath) await removeArticleCover(uploadedPath);
    return { success: false, error: err.message || '迁移封面时发生异常。' };
  }
}

// ========== 数据格式转换 ==========

/** 数据库行 → 前端对象 */
function dbToFrontend(row) {
  return {
    id: row.id,
    title: row.title || '',
    rawTitle: row.raw_title || '',
    author: row.author || 'RIEMer Land',
    avatar: null,
    coverImage: row.cover_image || null,
    date: row.date || '',
    category: row.category || '',
    tags: Array.isArray(row.tags) ? row.tags : [],
    excerpt: row.excerpt || '',
    outline: Array.isArray(row.outline) ? row.outline : [],
    url: row.url || '',
    content: row.content || '',
    readNum: typeof row.read_num === 'number' ? row.read_num : Number(row.read_num) || 0,
    archivedBy: row.archived_by || '未知',
    archivedById: row.archived_by_id || null,
    archivedAt: row.created_at || new Date().toISOString(),
    updatedAt: row.updated_at || row.created_at || null,
    // 工作项关联（WorkItem）：用于和 tasks / events 之间串"同一件工作"
    // 的闭环。老数据无此列 → 读出来是 undefined → 统一归一成 null。
    workItemId: row.work_item_id || null,
    _fromDb: true, // 标记来自数据库
  };
}

/** 前端对象 → 数据库行 */
function frontendToDb(article, userId) {
  return {
    title: article.title || '',
    raw_title: article.rawTitle || article.raw_title || '',
    author: article.author || 'RIEMer Land',
    date: article.date || new Date().toISOString().split('T')[0],
    category: article.category || '',
    tags: Array.isArray(article.tags) ? article.tags : [],
    excerpt: article.excerpt || '',
    outline: Array.isArray(article.outline) ? article.outline : [],
    url: article.url || '',
    content: article.content || '',
    cover_image: article.coverImage || article.cover_image || null,
    read_num: Number(article.readNum ?? article.read_num ?? 0) || 0,
    archived_by: article.archivedBy || article.archived_by || '未知',
    archived_by_id: userId || null,
    // 工作项关联：若前端传了 workItemId，写入数据库新增的 work_item_id 列。
    work_item_id: article.workItemId || null,
  };
}

// ========== localStorage 回退方法 ==========

function getLocalArticles() {
  try {
    const stored = localStorage.getItem(LOCAL_ARTICLES_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveLocalArticles(articles) {
  localStorage.setItem(LOCAL_ARTICLES_KEY, JSON.stringify(articles));
}

function addLocalArticle(article) {
  const articles = getLocalArticles();
  articles.unshift(article);
  saveLocalArticles(articles);
}

function updateLocalArticle(id, updates) {
  const articles = getLocalArticles();
  const idx = articles.findIndex((a) => a.id === id);
  if (idx >= 0) {
    articles[idx] = { ...articles[idx], ...updates };
    saveLocalArticles(articles);
  }
}

function deleteLocalArticle(id) {
  const articles = getLocalArticles().filter((a) => a.id !== id);
  saveLocalArticles(articles);
}

// ========== Realtime 订阅 ==========
/**
 * 订阅 articles 表变更：任一设备新增/更新/删除文章时，其它设备会收到通知。
 * @param {(payload:{type:'INSERT'|'UPDATE'|'DELETE', newItem:any|null, oldItem:any|null})=>void} onChange
 * @returns {()=>void} 解除订阅
 */
export function subscribeArticles(onChange) {
  if (!isSupabaseConfigured || !supabase) return () => {};
  const channel = supabase
    .channel('articles_realtime')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'articles' },
      (payload) => {
        const type = payload.eventType || payload.type;
        const newItem = payload.new ? dbToFrontend(payload.new) : null;
        const oldItem = payload.old ? { id: payload.old.id } : null;
        onChange({ type, newItem, oldItem });
      }
    )
    .subscribe();
  return () => {
    try { supabase.removeChannel(channel); } catch { /* ignore */ }
  };
}
