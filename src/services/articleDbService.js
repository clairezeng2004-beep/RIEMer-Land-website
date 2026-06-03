// ============================================
// RIEMer Land — 文章数据库服务（Supabase）
// ============================================
// 提供文章的 CRUD 操作，存储到 Supabase articles 表
// 当 Supabase 不可用时，回退到 localStorage

import { supabase, isSupabaseConfigured } from '../lib/supabase';

const LOCAL_ARTICLES_KEY = 'riemer_user_articles';

/**
 * 从 Supabase 获取所有文章（按日期倒序）
 */
export async function fetchArticles() {
  if (!isSupabaseConfigured || !supabase) {
    return getLocalArticles();
  }

  try {
    const { data, error } = await supabase
      .from('articles')
      .select('*')
      .order('date', { ascending: false });

    if (error) {
      console.warn('[ArticleDB] 获取文章失败，回退本地:', error.message);
      return getLocalArticles();
    }

    // 将数据库格式转为前端格式
    return (data || []).map(dbToFrontend);
  } catch (err) {
    console.warn('[ArticleDB] 获取文章异常，回退本地:', err.message);
    return getLocalArticles();
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

  try {
    const row = frontendToDb(article, userId);
    const { data, error } = await supabase
      .from('articles')
      .insert(row)
      .select()
      .single();

    if (error) {
      console.warn('[ArticleDB] 添加文章失败，保存本地:', error.message);
      addLocalArticle(article);
      return { ...article, _localOnly: true, _saveError: error.message };
    }

    return dbToFrontend(data);
  } catch (err) {
    console.warn('[ArticleDB] 添加文章异常，保存本地:', err.message);
    addLocalArticle(article);
    return { ...article, _localOnly: true, _saveError: err.message };
  }
}

/**
 * 更新文章
 */
export async function updateArticleInDb(id, updates) {
  if (!isSupabaseConfigured || !supabase) {
    updateLocalArticle(id, updates);
    return;
  }

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
    if (updates.coverImage !== undefined) dbUpdates.cover_image = updates.coverImage;
    if (updates.readNum !== undefined) dbUpdates.read_num = Number(updates.readNum) || 0;
    // 工作项关联（见 supabase-work-item-link.sql / src/utils/workItem.js）：
    // 允许把 null 写回数据库以解除关联；undefined 则表示调用方没打算改这个字段。
    if (updates.workItemId !== undefined) dbUpdates.work_item_id = updates.workItemId || null;
    dbUpdates.updated_at = new Date().toISOString();

    const { error } = await supabase
      .from('articles')
      .update(dbUpdates)
      .eq('id', id);

    if (error) {
      console.warn('[ArticleDB] 更新文章失败:', error.message);
      updateLocalArticle(id, updates);
    }
  } catch (err) {
    console.warn('[ArticleDB] 更新文章异常:', err.message);
    updateLocalArticle(id, updates);
  }
}

/**
 * 删除文章
 */
export async function deleteArticleFromDb(id) {
  if (!isSupabaseConfigured || !supabase) {
    deleteLocalArticle(id);
    return;
  }

  try {
    const { error } = await supabase
      .from('articles')
      .delete()
      .eq('id', id);

    if (error) {
      console.warn('[ArticleDB] 删除文章失败:', error.message);
      deleteLocalArticle(id);
    }
  } catch (err) {
    console.warn('[ArticleDB] 删除文章异常:', err.message);
    deleteLocalArticle(id);
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
