// 通知规则引擎 & 事件总线
// ---------------------------------------------------------------
// 作用：
//   - 业务代码不再手写 addNotification({...})，改为派发语义事件：
//       emitNotificationEvent('doc.upload', { operator, title, typeLabel })
//   - 规则引擎订阅事件，按"用户在管理页面里配置的规则"来决定：
//       · 本次事件是否要产生通知（规则 enabled + conditions + 节流）
//       · 通知的标题 / 内容模板（支持 {变量} 占位符）
//       · 通知的类型 / 范围 / 是否对操作者自己自动已读
//   - 所有改动对业务代码只是一次文案无关的重构，不会破坏原有通知逻辑。
// ---------------------------------------------------------------

import {
  getEventMeta,
  renderTemplate,
  evaluateConditions,
} from './notificationRuleDSL';

// ====== 事件总线：非常轻量，只为把"业务派发事件"和"规则引擎消费事件"解耦 ======
const listeners = new Set();
let cachedRules = [];            // 规则引擎订阅了 Context 后，会把最新规则塞进来
let cachedAddNotification = null; // 从 NotificationContext 注入的 addNotification
let cachedCurrentUser = null;     // 当前登录用户（用于 operator_exclude 判定）

// 节流：记录每条规则今天已经触发过多少次
// 结构： { [ruleId]: { date: 'YYYY-MM-DD', count: N } }
const throttleState = {};

function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function canPassThrottle(rule) {
  const max = rule?.throttle?.maxPerDay;
  if (!max || max <= 0) return true; // 0 或未设置 = 不限
  const st = throttleState[rule.id];
  const today = todayStr();
  if (!st || st.date !== today) {
    throttleState[rule.id] = { date: today, count: 0 };
    return true;
  }
  return st.count < max;
}

function bumpThrottle(rule) {
  const max = rule?.throttle?.maxPerDay;
  if (!max || max <= 0) return;
  const today = todayStr();
  const st = throttleState[rule.id] || { date: today, count: 0 };
  if (st.date !== today) {
    throttleState[rule.id] = { date: today, count: 1 };
  } else {
    throttleState[rule.id] = { date: today, count: st.count + 1 };
  }
}

// ====== 由 NotificationRulesContext 调用：把最新规则注入引擎 ======
export function registerRuleEngine({ rules, addNotification, currentUser }) {
  if (Array.isArray(rules)) cachedRules = rules;
  if (typeof addNotification === 'function') cachedAddNotification = addNotification;
  if (currentUser !== undefined) cachedCurrentUser = currentUser;
}

// ====== 业务代码调用：派发一个语义事件 ======
// 例：emitNotificationEvent('doc.upload', { operator: '小明', title: '会议纪要', typeLabel: '流程手册' })
export function emitNotificationEvent(eventKey, payload = {}) {
  try {
    const meta = getEventMeta(eventKey);
    if (!meta) {
      console.warn('[NotificationEngine] 未知事件:', eventKey);
      return;
    }

    // 找到所有监听该事件、且启用的规则
    const rules = (cachedRules || []).filter(
      (r) => r.enabled !== false && r.event === eventKey
    );
    if (rules.length === 0) {
      // 没有启用的规则 —— 静默忽略即可。这让管理员在 UI 上"关掉"某类通知时立即生效。
      return;
    }

    if (!cachedAddNotification) {
      console.warn('[NotificationEngine] addNotification 尚未注入，事件丢弃:', eventKey);
      return;
    }

    for (const rule of rules) {
      // 附加条件过滤
      if (!evaluateConditions(rule.conditions, payload)) continue;

      // 节流
      if (!canPassThrottle(rule)) {
        console.log('[NotificationEngine] 规则触发节流，本次跳过:', rule.title);
        continue;
      }

      // 渲染模板
      const title = renderTemplate(rule.title, payload) || rule.title;
      const message = renderTemplate(rule.messageTemplate, payload);

      // 目标范围 → target_role
      //   audience 是一个比 target_role 更友好的字段，这里做一次翻译：
      //   all                -> null（所有人）
      //   operator_exclude   -> null（所有人，但操作者自动已读）
      //   admin              -> 'admin'
      //   member             -> 'member'
      let target_role = null;
      if (rule.audience === 'admin') target_role = 'admin';
      else if (rule.audience === 'member') target_role = 'member';
      else target_role = null;

      // 是否对操作者自己自动已读：
      //   · operator_exclude 语义就是"别打扰自己"，所以 read=true
      //   · 或规则显式勾选 autoReadForOperator=true
      //   注意：这里依赖了老的 addNotification 语义——当调用方传 read:true 时，
      //   会把该条通知对"当前登录用户"自动标为已读。对其他人仍是未读。
      const selfAutoRead =
        rule.audience === 'operator_exclude' || rule.autoReadForOperator === true;

      // 如果 audience=operator_exclude 但当前用户不是事件的发起者（比如管理员
      // 派发的一次批量事件），则不应标自动已读。我们用 payload.operatorUserId
      // 来精确判定；若业务没提供，则退化为"只要当前登录的是谁就当 TA 是操作者"，
      // 与原代码行为保持一致（原来就是 read:true，谁发谁已读）。
      let finalRead = false;
      if (selfAutoRead) {
        const opId = payload.operatorUserId;
        if (!opId || !cachedCurrentUser?.id || opId === cachedCurrentUser.id) {
          finalRead = true;
        }
      }

      bumpThrottle(rule);

      try {
        cachedAddNotification({
          title,
          message,
          type: rule.type || 'other',
          target_role,
          read: finalRead,
        });
      } catch (err) {
        console.warn('[NotificationEngine] addNotification 失败:', err?.message || err);
      }
    }
  } catch (err) {
    console.warn('[NotificationEngine] 派发事件异常:', err?.message || err);
  }

  // 广播给订阅者（预留扩展点，比如日志/审计面板）
  listeners.forEach((fn) => {
    try { fn(eventKey, payload); } catch { /* ignore */ }
  });
}

export function subscribeNotificationEvents(handler) {
  listeners.add(handler);
  return () => listeners.delete(handler);
}
