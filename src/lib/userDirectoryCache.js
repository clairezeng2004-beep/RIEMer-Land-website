// ============================================
// 用户目录缓存（模块级单例）
// ============================================
// 背景：
//   AuthContext.getAllUsers 的实现里会做 session 预检 + profiles 全表拉取，
//   单次调用至少 1 次 auth 请求 + 1 次 profiles 查询（session 过期时会翻倍）。
//   而打开一篇文档时，TextAnnotation.jsx 与 ProcessTemplateDetail.jsx 都会
//   各自调一次 getAllUsers 来把 user_id → 真名，导致同一页面至少重复打 2 次
//   相同的全量请求。更糟的是 getAllUsers 因为 useCallback 的依赖 (user) 不
//   稳定，在 auth 状态任何抖动下还会重新触发依赖它的 useEffect。
//
// 方案：
//   给 getAllUsers 加一个纯前端的、非常轻的模块级缓存层：
//   - getCachedAllUsers(getAllUsers): 成功结果缓存 30s；命中即同步返回，
//     不命中时只发起一次 in-flight 请求，所有并发调用共享同一个 Promise；
//   - 提供 invalidateUserDirectoryCache() 在用户管理页面增删改后主动失效，
//     避免数据不同步。
//
// 只缓存"成功结果"，失败路径仍然会穿透到底层 getAllUsers，不影响错误处理。
// 也不把任何东西写到 localStorage：这只是一份内存层 TTL 缓存，刷新页面即失效。

/** TTL 毫秒数：默认 30 秒。对"用户列表变动频率"来说够新鲜；同时足够
 *  覆盖一篇文档从进入到评论/编辑历史都加载完的时间窗口，让二次调用秒回。 */
const CACHE_TTL_MS = 30 * 1000;

let cachedResult = null;
let cachedAt = 0;
let inflight = null; // 正在进行中的请求 Promise，用于并发去重

/**
 * 以缓存方式调用 getAllUsers。
 * @param {() => Promise<Array>} getAllUsers AuthContext 暴露的原始方法
 * @returns {Promise<Array>}
 */
export async function getCachedAllUsers(getAllUsers) {
  if (typeof getAllUsers !== 'function') return [];

  // 1) 命中新鲜缓存：直接返回，不发起请求
  const now = Date.now();
  if (cachedResult && now - cachedAt < CACHE_TTL_MS) {
    return cachedResult;
  }

  // 2) 已有 in-flight 请求：复用它，避免并发打两次
  if (inflight) {
    return inflight;
  }

  // 3) 发起新请求，成功后写缓存；失败穿透，不缓存失败结果
  inflight = (async () => {
    try {
      const list = await getAllUsers();
      const arr = Array.isArray(list) ? list : [];
      cachedResult = arr;
      cachedAt = Date.now();
      return arr;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/**
 * 主动失效缓存。
 * 建议场景：用户管理页对 profiles 做了写操作之后 / 注销登录之后。
 */
export function invalidateUserDirectoryCache() {
  cachedResult = null;
  cachedAt = 0;
  // 注意：不取消正在进行的 inflight（回写本身不依赖缓存，能拿到就拿到）。
}
