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

// 全局请求超时：30 秒
// 之前 10 秒在以下场景会误伤：
//   1) Supabase 免费层冷启动（首次请求 5~12s 很常见）；
//   2) 单行 update 字段较多且含长文本（比如成员信息里自我介绍 / 分享内容）；
//   3) token 刷新与业务请求串行时叠加耗时；
// 一旦 fetch 被 AbortController 提前掐掉，上层所有 withTimeout(25s) 都无效，
// 用户侧表现就是"保存按钮 loading 很久后失败"。30s 留足余量；
// 真正的"网络离线"场景由 checkSupabaseHealth() 判定，不靠这里的超时兜底。
const FETCH_TIMEOUT_MS = 30000;
const STORAGE_UPLOAD_TIMEOUT_MS = 180000;

function getSupabaseFetchTimeout(url, options = {}) {
  const rawUrl = typeof url === 'string' ? url : url?.url || '';
  const method = String(options.method || 'GET').toUpperCase();
  const isStorageUpload =
    rawUrl.includes('/storage/v1/object/') &&
    method !== 'GET' &&
    method !== 'HEAD';

  return isStorageUpload ? STORAGE_UPLOAD_TIMEOUT_MS : FETCH_TIMEOUT_MS;
}

// ============================================
// 带硬超时的 auth 锁（修复 getSession / 所有查询整体卡死）
// ============================================
// supabase-js v2 默认用浏览器 Web Locks（navigator.locks）跨标签页协调 token 刷新。
// 已知坑：某个标签页拿了锁却没释放（刷新卡住 / 标签页崩溃 / 同时开很多标签页），
// 后续标签页会永远抢不到锁 —— 由于每个数据请求在拼 Authorization 头时都要先经过
// 这把锁拿 token，结果就是 getSession() 和所有 supabase.from(...) 查询全部冻住、
// 直到上层超时。本站大量用 target="_blank" 开新标签页，极易触发。
//
// 这里换一把"最多等 LOCK_ACQUIRE_TIMEOUT_MS 就放行"的锁：
//   - 正常无争用时瞬间拿到锁，行为与默认一致；
//   - 一旦遇到卡死的锁，抢占超时后直接执行（放弃跨标签页协调），
//     保证 getSession / 查询永远不会被一把僵尸锁无限期冻住。
// 代价仅是极端并发下两个标签页可能各刷新一次 token（supabase 自身可容忍），
// 远好过当前"整站请求全部超时"。
const LOCK_ACQUIRE_TIMEOUT_MS = 3000;

async function timeoutAuthLock(name, _acquireTimeout, fn) {
  // 没有 Web Locks API（老浏览器 / 部分 WebView）→ 直接执行，不做跨标签页协调
  if (typeof navigator === 'undefined' || !navigator.locks || !navigator.locks.request) {
    return await fn();
  }

  const controller = new AbortController();
  // 无论 supabase 传入的 acquireTimeout 是多少（常见为 -1=无限等待），
  // 一律用我们自己的上限封顶，杜绝"无限期等待"导致的死锁。
  const timer = setTimeout(() => controller.abort(), LOCK_ACQUIRE_TIMEOUT_MS);

  try {
    return await navigator.locks.request(
      name,
      { signal: controller.signal },
      async () => {
        // 抢到锁，取消超时定时器；后续 fn 执行多久都不受 acquire 超时影响
        clearTimeout(timer);
        return await fn();
      },
    );
  } catch (err) {
    // 抢锁被超时 abort（说明锁被别的标签页卡住了）→ 不再等待，直接执行，避免冻住
    if (err && err.name === 'AbortError') {
      console.warn(
        `[Supabase] auth 锁 "${name}" 抢占超过 ${LOCK_ACQUIRE_TIMEOUT_MS}ms，` +
        '跳过跨标签页协调直接执行（防止整站请求卡死）',
      );
      return await fn();
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        // 用带硬超时的锁替换默认 navigatorLock，根治 getSession/查询整体卡死
        lock: timeoutAuthLock,
      },
      global: {
        fetch: (url, options = {}) => {
          const controller = new AbortController();
          const timeoutId = setTimeout(
            () => controller.abort(),
            getSupabaseFetchTimeout(url, options),
          );
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
 * 快速检测 Supabase 是否可达（6 秒超时，失败后自动重试一次）
 * 使用 REST health endpoint 而非 auth API，更轻量
 * 手机端网络可能较慢，给更多时间和重试机会
 */
export async function checkSupabaseHealth() {
  if (!supabase || !supabaseUrl) {
    setReachable(false);
    return false;
  }

  const tryOnce = async (timeoutMs) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${supabaseUrl}/rest/v1/`, {
        method: 'HEAD',
        headers: { apikey: supabaseAnonKey },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return res.ok || res.status === 400 || res.status === 401; // 400/401 也表示服务在线
    } catch {
      clearTimeout(timeoutId);
      return false;
    }
  };

  // 第一次尝试：6 秒超时（手机端网络需要更多时间）
  let ok = await tryOnce(6000);
  if (!ok) {
    // 重试一次：再给 4 秒（总共 ~10 秒内完成）
    console.warn('[Supabase] 第一次健康检查失败，重试中...');
    ok = await tryOnce(4000);
  }

  if (ok) {
    setReachable(true);
  } else {
    console.warn('[Supabase] 健康检查失败（含重试），服务不可达');
    setReachable(false);
  }
  return ok;
}

/**
 * 后台重新检测 Supabase 可达性（用于从离线模式恢复）
 * 不改变 state，仅返回结果
 */
export async function recheckSupabaseHealth() {
  if (!supabase || !supabaseUrl) return false;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${supabaseUrl}/rest/v1/`, {
      method: 'HEAD',
      headers: { apikey: supabaseAnonKey },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const ok = res.ok || res.status === 400 || res.status === 401;
    if (ok) setReachable(true);
    return ok;
  } catch {
    return false;
  }
}

/** 是否已配置 Supabase 环境变量（不代表可达） */
export const isSupabaseConfigured = !!supabase;
