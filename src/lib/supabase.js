// ============================================
// RIEMer Land — Supabase Client
// ============================================
// 在 Supabase 控制台创建项目后，将以下值填入 .env 文件：
// VITE_SUPABASE_URL=https://your-project.supabase.co
// VITE_SUPABASE_ANON_KEY=your-anon-key

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    '[RIEMer Land] Supabase 未配置。请在 .env 文件中设置 VITE_SUPABASE_URL 和 VITE_SUPABASE_ANON_KEY。\n' +
    '当前将使用本地 localStorage 模拟模式。'
  );
}

// 全局请求超时：5 秒（缩短，让失败更快暴露）
const FETCH_TIMEOUT_MS = 5000;

export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
      },
      global: {
        fetch: (url, options = {}) => {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
          return fetch(url, {
            ...options,
            signal: controller.signal,
          }).finally(() => clearTimeout(timeoutId));
        },
      },
    })
  : null;

// ---- Supabase 连接健康状态 ----
// supabaseReachable: true=可达, false=不可达, null=未检测
let supabaseReachable = null;
const reachableListeners = new Set();

/** 订阅可达性变化 */
export function onReachableChange(fn) {
  reachableListeners.add(fn);
  return () => reachableListeners.delete(fn);
}

function setReachable(val) {
  if (supabaseReachable !== val) {
    supabaseReachable = val;
    reachableListeners.forEach((fn) => fn(val));
  }
}

export function getReachable() {
  return supabaseReachable;
}

/**
 * 快速检测 Supabase 是否可达（3 秒超时）
 * 使用 REST health endpoint 而非 auth API，更轻量
 */
export async function checkSupabaseHealth() {
  if (!supabase || !supabaseUrl) {
    setReachable(false);
    return false;
  }
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${supabaseUrl}/rest/v1/`, {
      method: 'HEAD',
      headers: { apikey: supabaseAnonKey },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const ok = res.ok || res.status === 400 || res.status === 401; // 400/401 也表示服务在线
    setReachable(ok);
    return ok;
  } catch {
    console.warn('[Supabase] 健康检查失败，服务不可达');
    setReachable(false);
    return false;
  }
}

/** 是否已配置 Supabase 环境变量（不代表可达） */
export const isSupabaseConfigured = !!supabase;
