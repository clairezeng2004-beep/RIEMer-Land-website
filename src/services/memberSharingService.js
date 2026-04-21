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

// 默认分类（与原页面保持一致）
export const DEFAULT_CATEGORIES = [
  { key: 'course', label: '课程资料', color: '#5EAD8C' },
  { key: 'history', label: '历史会议', color: '#4FBFC4' },
  { key: 'experience', label: '成员经验分享', color: '#EC4899' },
];

// ================================================================
// 数据格式转换
// ================================================================

/** DB 行 → 前端对象 */
function dbToFrontend(row) {
  return {
    id: row.id,
    title: row.title || '',
    category: row.category || 'experience',
    format: row.format || 'word',
    content: row.content || '',
    period: row.period || null,
    attachments: Array.isArray(row.attachments) ? row.attachments : (row.attachments || null),
    author: row.author || 'Unknown',
    authorId: row.author_id || null,
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
    category: post.category || 'experience',
    format: post.format || 'word',
    content: post.content || '',
    period: post.period || null,
    attachments: post.attachments && post.attachments.length > 0 ? post.attachments : null,
    author: post.author || 'Unknown',
    author_id: post.authorId || null,
    likes: Array.isArray(post.likes) ? post.likes : [],
    created_at: post.createdAt || new Date().toISOString().split('T')[0],
  };
}

/** 前端更新对象 → DB 部分字段（用于 update） */
function frontendToDbUpdate(updates) {
  const u = {};
  if (updates.title !== undefined) u.title = updates.title;
  if (updates.category !== undefined) u.category = updates.category;
  if (updates.format !== undefined) u.format = updates.format;
  if (updates.content !== undefined) u.content = updates.content;
  if (updates.period !== undefined) u.period = updates.period;
  if (updates.attachments !== undefined) {
    u.attachments = updates.attachments && updates.attachments.length > 0 ? updates.attachments : null;
  }
  if (updates.author !== undefined) u.author = updates.author;
  if (updates.authorId !== undefined) u.author_id = updates.authorId;
  if (updates.likes !== undefined) u.likes = Array.isArray(updates.likes) ? updates.likes : [];
  u.updated_at = new Date().toISOString();
  return u;
}

// ================================================================
// Sharings（分享帖）
// ================================================================

/** 获取所有分享（按 created_at 降序） */
export async function fetchSharings() {
  if (!isSupabaseConfigured || !supabase) {
    return getLocalSharings();
  }
  try {
    const { data, error } = await supabase
      .from('member_sharing')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) {
      console.warn('[MemberSharingDB] 获取分享失败，回退本地:', error.message);
      return getLocalSharings();
    }
    return (data || []).map(dbToFrontend);
  } catch (err) {
    console.warn('[MemberSharingDB] 获取分享异常，回退本地:', err.message);
    return getLocalSharings();
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
export async function addSharing(post) {
  // 本地兜底先写（即使云端失败也能即时显示）
  addLocalSharing(post);

  if (!isSupabaseConfigured || !supabase) {
    return post;
  }
  try {
    const row = frontendToDbInsert(post);
    const { data, error } = await supabase
      .from('member_sharing')
      .insert(row)
      .select()
      .single();
    if (error) {
      console.warn('[MemberSharingDB] 新增分享失败（仅保存本地）:', error.message);
      return post;
    }
    return dbToFrontend(data);
  } catch (err) {
    console.warn('[MemberSharingDB] 新增分享异常:', err.message);
    return post;
  }
}

/** 更新分享（支持部分字段，例如只更新 likes） */
export async function updateSharing(id, updates) {
  // 本地兜底
  updateLocalSharing(id, updates);

  if (!isSupabaseConfigured || !supabase) return;
  try {
    const dbUpdates = frontendToDbUpdate(updates);
    const { error } = await supabase
      .from('member_sharing')
      .update(dbUpdates)
      .eq('id', String(id));
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
      const row = frontendToDbInsert(post);
      const { error } = await supabase
        .from('member_sharing')
        .upsert(row, { onConflict: 'id' });
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

/** 获取所有分类（按 sort_order 升序） */
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
    const list = (data || []).map((r) => ({ key: r.key, label: r.label, color: r.color }));
    return list.length > 0 ? list : DEFAULT_CATEGORIES;
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
  } catch { /* ignore quota */ }
}

function addLocalSharing(post) {
  const list = getLocalSharings();
  // 按 id 去重（防止同 id 重复插入）
  const next = [post, ...list.filter((s) => String(s.id) !== String(post.id))];
  saveLocalSharings(next);
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
