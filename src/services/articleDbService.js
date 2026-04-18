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
    return article;
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
      return article;
    }

    return dbToFrontend(data);
  } catch (err) {
    console.warn('[ArticleDB] 添加文章异常，保存本地:', err.message);
    addLocalArticle(article);
    return article;
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
 */
export async function migrateLocalArticlesToDb(userId) {
  if (!isSupabaseConfigured || !supabase) return 0;

  const localArticles = getLocalArticles();
  if (localArticles.length === 0) return 0;

  let migrated = 0;
  for (const article of localArticles) {
    try {
      const row = frontendToDb(article, userId);
      const { error } = await supabase
        .from('articles')
        .insert(row);

      if (!error) {
        migrated++;
      } else {
        console.warn('[ArticleDB] 迁移文章失败:', article.title, error.message);
      }
    } catch (err) {
      console.warn('[ArticleDB] 迁移文章异常:', article.title, err.message);
    }
  }

  if (migrated > 0) {
    // 清除已迁移的 localStorage 数据
    localStorage.removeItem(LOCAL_ARTICLES_KEY);
    console.log(`[ArticleDB] 成功迁移 ${migrated}/${localArticles.length} 篇文章到数据库`);
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
    category: row.category || '经验分享',
    tags: Array.isArray(row.tags) ? row.tags : [],
    excerpt: row.excerpt || '',
    outline: Array.isArray(row.outline) ? row.outline : [],
    url: row.url || '',
    content: row.content || '',
    readNum: typeof row.read_num === 'number' ? row.read_num : Number(row.read_num) || 0,
    archivedBy: row.archived_by || '未知',
    archivedAt: row.created_at || new Date().toISOString(),
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
    category: article.category || '经验分享',
    tags: Array.isArray(article.tags) ? article.tags : [],
    excerpt: article.excerpt || '',
    outline: Array.isArray(article.outline) ? article.outline : [],
    url: article.url || '',
    content: article.content || '',
    cover_image: article.coverImage || article.cover_image || null,
    read_num: Number(article.readNum ?? article.read_num ?? 0) || 0,
    archived_by: article.archivedBy || article.archived_by || '未知',
    archived_by_id: userId || null,
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
