// ============================================
// 工作项（WorkItem）关联工具
// ============================================
// 用途：把"事项追踪（task）/ 公众号文章归档（article）/ 活动发布（event）"
// 这三件本来独立的事情，用一个共享的 workItemId 串起来，形成"一件工作"的
// 完整闭环视图。
//
// 设计约定（详见对话记录里的 P0 方案）：
//   - workItemId: string | null    三者共享同一个值 = 同一件工作；null = 不关联。
//   - workItemKind: 'article' | 'event' | null
//       仅在 task 上有意义，表示"这个事项最终产出什么"：
//         - 'article' → 期望有一条 article 与之对应（产出公众号推文）
//         - 'event'   → 期望有一条 event 与之对应（落地一场活动）
//         - null      → 纯内部事项，不关联到归档/活动
//       在 article / event 上我们只存 workItemId，不再存 kind（自身类型即是 kind）。
//   - 关联基数：1 task ↔ 1 article / 1 event（一对一，见用户决策）。
//
// 兼容性：老数据 workItemId = undefined/null，不影响任何已有功能——
// 只有当字段存在且非空时才参与闭环校验。
//
// ⚠️ 命名保持 camelCase，因为本项目的 tasks / events / userArticles 都在前端内存
// 层使用 camelCase（Tasks.jsx 里 rowToTask 已做数据库 snake_case ↔ camelCase 转换）。

/**
 * 生成一个新的 workItemId。
 * 结构："wi-" + 时间戳 + 随机段，足以保证业务量级的唯一性。
 * 不用 UUID 是因为这个值只在前端三侧对齐，不作为数据库主键。
 */
export function genWorkItemId() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `wi-${Date.now().toString(36)}-${rand}`;
}

/**
 * 给定一个 task，判断它是否"期望产出归档"（workItemKind === 'article'）。
 * @param {object} task
 * @returns {boolean}
 */
export function taskExpectsArticle(task) {
  return task && task.workItemKind === 'article' && !!task.workItemId;
}

/**
 * 给定一个 task，判断它是否"期望产出活动"（workItemKind === 'event'）。
 */
export function taskExpectsEvent(task) {
  return task && task.workItemKind === 'event' && !!task.workItemId;
}

/**
 * 给一批数据建立 workItemId → 单项的索引。
 * @param {Array} list
 * @returns {Map<string, any>}
 */
export function indexByWorkItemId(list) {
  const map = new Map();
  if (!Array.isArray(list)) return map;
  for (const item of list) {
    const wid = item?.workItemId;
    if (wid) map.set(wid, item);
  }
  return map;
}

/**
 * 计算某个工作项目前的"闭环状态"。
 *
 * 参数：
 *   - task    当前 task（包含 workItemKind / workItemId）
 *   - article 可选，与 task.workItemId 匹配到的 article
 *   - event   可选，与 task.workItemId 匹配到的 event
 *
 * 返回字段说明：
 *   - isClosed        是否已闭环（task 已完成 且 对应产出已落地）
 *   - missingKind     若未闭环，缺失的那一侧是 'task' | 'article' | 'event' | null
 *   - kind            期望产出的类型 'article' | 'event' | null
 *
 * 注意：这个函数只判断"根据 task.workItemKind 期望的产出是否齐"，
 * 不负责判断"是否超时"。超时提醒由调用方基于时间差另行计算。
 */
export function computeWorkItemClosure({ task, article, event }) {
  if (!task || !task.workItemId) {
    return { isClosed: false, missingKind: null, kind: null };
  }
  const kind = task.workItemKind || null;
  const taskDone = task.status === '已完成';

  if (kind === 'article') {
    const hasArticle = !!article;
    return {
      isClosed: taskDone && hasArticle,
      missingKind: !taskDone ? 'task' : (!hasArticle ? 'article' : null),
      kind,
    };
  }
  if (kind === 'event') {
    const hasEvent = !!event;
    return {
      isClosed: taskDone && hasEvent,
      missingKind: !taskDone ? 'task' : (!hasEvent ? 'event' : null),
      kind,
    };
  }
  // 没声明 kind 就只看 task 本身是否完成
  return {
    isClosed: taskDone,
    missingKind: taskDone ? null : 'task',
    kind: null,
  };
}

/**
 * 汇总所有"未闭环"的工作项，供 Tasks 页面顶部的"未闭环清单"卡片使用。
 *
 * 权限切分（按用户决策）：
 *   - isAdmin = true  → 全量返回；
 *   - isAdmin = false → 只返回和 currentUserId 相关的（task 的 assignee/helpers 包含
 *                       该用户，或 article.archivedBy/_id、event 由该用户参与的）。
 *
 * 当前版本"相关"的简单判定：
 *   task.assignee 或 task.helpers 含 currentUserId。
 *   article 与 event 没有稳定的"谁创建"的 userId 字段（articles 有 archived_by_id
 *   但一对一关系下以 task 的所有权为准更合理），所以仅按 task 侧过滤。
 *
 * @param {object} params
 * @param {Array} params.tasks
 * @param {Array} params.articles         userArticles
 * @param {Array} params.events
 * @param {boolean} params.isAdmin
 * @param {string|null} params.currentUserId
 * @returns {Array<{
 *   workItemId: string,
 *   kind: 'article' | 'event' | null,
 *   task: object,
 *   article: object | null,
 *   event: object | null,
 *   missingKind: 'task' | 'article' | 'event',
 *   title: string,
 * }>}
 */
export function collectOpenWorkItems({ tasks, articles, events, isAdmin, currentUserId }) {
  if (!Array.isArray(tasks)) return [];

  const articleByWid = indexByWorkItemId(articles);
  const eventByWid = indexByWorkItemId(events);

  const list = [];
  for (const task of tasks) {
    if (!task || !task.workItemId) continue;
    const article = articleByWid.get(task.workItemId) || null;
    const event = eventByWid.get(task.workItemId) || null;
    const { isClosed, missingKind, kind } = computeWorkItemClosure({ task, article, event });
    if (isClosed || !missingKind) continue;

    // 权限过滤：普通成员只看自己相关的
    if (!isAdmin) {
      const ids = [
        ...(Array.isArray(task.assignee) ? task.assignee : []),
        ...(Array.isArray(task.helpers) ? task.helpers : []),
      ];
      if (!currentUserId || !ids.includes(currentUserId)) continue;
    }

    list.push({
      workItemId: task.workItemId,
      kind,
      task,
      article,
      event,
      missingKind,
      title: task.title || article?.title || event?.title || '未命名工作项',
    });
  }
  return list;
}
