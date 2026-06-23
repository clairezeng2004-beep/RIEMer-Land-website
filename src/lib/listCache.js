// ============================================
// 通用「列表数据」本地缓存
// ============================================
// 背景：
//   多个内部 TAB（用户管理、成员名册、文档…）都是「进页面 → 空列表 → 异步拉取」。
//   首屏拿到什么数据，取决于拉取那一刻 Supabase session / 健康检查是否就绪：
//   - 初次登录：session 可能还没完全就绪 → getXxx 可能回退到本地/旧数据；
//   - 刷新页面：session 已就绪 → 拿到最新的完整数据。
//   于是「初次登录」和「刷新后」看到的数据不一致。
//
// 方案（与相册列表一致）：
//   把「上一次成功加载到的列表」写进 localStorage；下次进页面先用缓存渲染，
//   保证首屏稳定一致，再在后台拉取最新数据覆盖。这样：
//   - 首屏永远显示「上次看到的内容」，不会忽多忽少；
//   - 后台拉到最新后无缝更新，不会一直停留在旧数据。
//
// 只缓存成功结果，失败不写；private 模式 / 配额异常静默忽略。

export const readListCache = (key) => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

export const writeListCache = (key, list) => {
  try {
    if (Array.isArray(list)) {
      localStorage.setItem(key, JSON.stringify(list));
    }
  } catch {
    /* quota / private mode 忽略 */
  }
};
