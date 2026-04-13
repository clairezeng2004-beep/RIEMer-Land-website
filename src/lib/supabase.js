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

// 全局请求超时：10 秒
const FETCH_TIMEOUT_MS = 10000;

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

export const isSupabaseConfigured = !!supabase;
