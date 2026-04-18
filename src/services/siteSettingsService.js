// ============================================
// RIEMer Land — 站点设置服务（Supabase）
// ============================================
// 把 internalConfig（侧边栏 Tab 名、各页面标题等管理者可编辑的站点级配置）
// 持久化到 Supabase `site_settings` 表，实现跨设备同步。
//
// 设计：
// - 站点级全局配置按 key 存储（key 唯一），value 为 JSONB
// - 本服务只暴露一个固定 key: INTERNAL_CONFIG_KEY
// - 未配置 Supabase 或失败时，由调用方回退到 localStorage

import { supabase, isSupabaseConfigured } from '../lib/supabase';

// 表名与固定 key（如日后要再放首页 content，可以用不同 key 共用同表）
export const SITE_SETTINGS_TABLE = 'site_settings';
export const INTERNAL_CONFIG_KEY = 'internal_config';

// 所有"站点级可编辑配置"统一 key 常量，避免各处硬编码
// 新增 key 时在这里登记一下即可
export const SITE_KEYS = {
  INTERNAL_CONFIG: 'internal_config', // 内部空间配置（侧边栏 Tab 名称等）
  PUBLIC_CONTENT: 'public_content',   // 首页 Hero / Footer / 使命等公开内容
  FILTER_OPTIONS: 'filter_options',   // 筛选分类选项
  SUGGESTIONS: 'suggestions',         // 网站建设建议列表
  EVENTS: 'events',                   // 活动管理
  TIMELINE: 'timeline',               // 时间轴
  ARTICLE_CATEGORIES: 'article_categories', // 公众号归档的筛选分类（所有成员可新增）
};

/**
 * 从云端拉取 internalConfig。
 * 返回：{ value: object|null, updatedAt: string|null, error: string|null }
 */
export async function fetchInternalConfig() {
  if (!isSupabaseConfigured || !supabase) {
    return { value: null, updatedAt: null, error: 'supabase-not-configured' };
  }
  try {
    const { data, error } = await supabase
      .from(SITE_SETTINGS_TABLE)
      .select('value, updated_at')
      .eq('key', INTERNAL_CONFIG_KEY)
      .maybeSingle();
    if (error) {
      // 表不存在、权限不足等 —— 交给调用方决定是否兜底
      return { value: null, updatedAt: null, error: error.message };
    }
    return {
      value: data?.value ?? null,
      updatedAt: data?.updated_at ?? null,
      error: null,
    };
  } catch (err) {
    return { value: null, updatedAt: null, error: err.message };
  }
}

/**
 * 把 internalConfig upsert 到云端。
 * 返回：{ success: boolean, updatedAt: string|null, error: string|null }
 */
export async function saveInternalConfig(config) {
  if (!isSupabaseConfigured || !supabase) {
    return { success: false, updatedAt: null, error: 'supabase-not-configured' };
  }
  try {
    const payload = {
      key: INTERNAL_CONFIG_KEY,
      value: config,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await supabase
      .from(SITE_SETTINGS_TABLE)
      .upsert(payload, { onConflict: 'key' })
      .select('updated_at')
      .maybeSingle();
    if (error) {
      return { success: false, updatedAt: null, error: error.message };
    }
    return { success: true, updatedAt: data?.updated_at ?? null, error: null };
  } catch (err) {
    return { success: false, updatedAt: null, error: err.message };
  }
}

/**
 * 订阅 internal_config 行的变更（管理员在其它设备保存后，当前设备实时刷新）
 * 返回一个解除订阅函数。
 *
 * 注意：Supabase Realtime 需在 dashboard 为 site_settings 表开启 Replication
 * （或执行 ALTER PUBLICATION supabase_realtime ADD TABLE site_settings;）
 */
export function subscribeInternalConfig(onChange) {
  return subscribeSetting(INTERNAL_CONFIG_KEY, onChange);
}

// ============================================
// 通用版：按任意 key 读/写/订阅 site_settings
// ============================================

/**
 * 读取某个 key 的 value + updated_at
 * @param {string} key
 * @returns {{value: any|null, updatedAt: string|null, error: string|null}}
 */
export async function fetchSetting(key) {
  if (!isSupabaseConfigured || !supabase) {
    return { value: null, updatedAt: null, error: 'supabase-not-configured' };
  }
  try {
    const { data, error } = await supabase
      .from(SITE_SETTINGS_TABLE)
      .select('value, updated_at')
      .eq('key', key)
      .maybeSingle();
    if (error) return { value: null, updatedAt: null, error: error.message };
    return {
      value: data?.value ?? null,
      updatedAt: data?.updated_at ?? null,
      error: null,
    };
  } catch (err) {
    return { value: null, updatedAt: null, error: err.message };
  }
}

/**
 * upsert 任意 key 的 value
 * @param {string} key
 * @param {any} value
 * @returns {{success: boolean, updatedAt: string|null, error: string|null}}
 */
export async function saveSetting(key, value) {
  if (!isSupabaseConfigured || !supabase) {
    return { success: false, updatedAt: null, error: 'supabase-not-configured' };
  }
  try {
    const payload = {
      key,
      value,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await supabase
      .from(SITE_SETTINGS_TABLE)
      .upsert(payload, { onConflict: 'key' })
      .select('updated_at')
      .maybeSingle();
    if (error) return { success: false, updatedAt: null, error: error.message };
    return { success: true, updatedAt: data?.updated_at ?? null, error: null };
  } catch (err) {
    return { success: false, updatedAt: null, error: err.message };
  }
}

/**
 * 订阅任意 key 的变更
 * @param {string} key
 * @param {(value:any, updatedAt:string)=>void} onChange
 * @returns {()=>void} 解除订阅
 */
export function subscribeSetting(key, onChange) {
  if (!isSupabaseConfigured || !supabase) return () => {};
  const channel = supabase
    .channel(`site_settings_${key}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: SITE_SETTINGS_TABLE,
        filter: `key=eq.${key}`,
      },
      (payload) => {
        const newValue = payload?.new?.value;
        if (newValue !== undefined) onChange(newValue, payload?.new?.updated_at);
      }
    )
    .subscribe();
  return () => {
    try { supabase.removeChannel(channel); } catch { /* ignore */ }
  };
}
