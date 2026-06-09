// 通知规则 DSL（Domain Specific Language）
// ---------------------------------------------------------------
// 目的：让非技术背景的管理员可以用"偏自然语言"的方式来定义
//      "什么时候/对谁/发什么样的通知"，同时后台以结构化 JSON
//      存储，规则引擎按 JSON 执行，前端页面可以把 JSON 翻译
//      成一句人话呈现。这是"代码⇄自然语言"的翻译层。
//
// 核心思想：
//   - 所有业务代码只派发"事件"（event）：doc.upload / task.status_change / ...
//   - 每条事件会自带一批"变量"（payload）：operator, title, from, to, ...
//   - 管理员通过下拉菜单组合出一条"规则"，每个下拉选项对应一段
//     可直接执行的配置片段。这样不需要 LLM，也不会出错。
//
// 一条"规则"的结构：
//   {
//     id: 'uuid',
//     enabled: true,                 // 开关
//     event: 'doc.upload',           // 触发事件 key
//     title: '新内部分享',            // 通知标题（可含 {变量}）
//     messageTemplate: '{operator} 上传了文档「{title}」（{typeLabel}）',
//     type: 'sharing',               // progress | sharing | other
//     audience: 'all',               // all | admin | member | operator_exclude
//     autoReadForOperator: true,     // 操作者自己是否自动已读
//     conditions: [                  // 额外条件过滤（AND）
//       { field: 'typeLabel', op: 'equals', value: '流程手册' }
//     ],
//     throttle: { maxPerDay: 0 },    // 0 = 不限
//     description: '每当有人上传新文档时…'  // 自然语言描述（缓存，便于展示）
//   }
// ---------------------------------------------------------------

// ====== 事件目录（所有业务代码只能派发这里声明过的事件）======
// 每个事件声明它可用的变量（variables），UI 里用于让管理员选择占位符
export const EVENT_CATALOG = [
  {
    key: 'doc.upload',
    label: '有人上传了新文档',
    source: '文档管理',
    defaults: {
      title: '新内部分享',
      messageTemplate: '{operator} 上传了文档「{title}」（{typeLabel}）',
      type: 'sharing',
      autoReadForOperator: true,
    },
    variables: [
      { key: 'operator', label: '上传者昵称' },
      { key: 'title', label: '文档标题' },
      { key: 'typeLabel', label: '文档类型（如"流程手册"）' },
    ],
  },
  {
    key: 'doc.delete',
    label: '有人删除了文档',
    source: '文档管理',
    defaults: {
      title: '文档已删除',
      messageTemplate: '文档「{title}」已被 {operator} 删除',
      type: 'other',
      autoReadForOperator: true,
    },
    variables: [
      { key: 'operator', label: '操作者昵称' },
      { key: 'title', label: '文档标题' },
    ],
  },
  {
    key: 'suggestion.new',
    label: '有人提交了新的建设建议',
    source: '建设建议',
    defaults: {
      title: '新建设建议',
      messageTemplate: '{operator} 提出了建议：{summary}',
      type: 'progress',
      autoReadForOperator: true,
    },
    variables: [
      { key: 'operator', label: '提交者昵称' },
      { key: 'summary', label: '建议摘要（前 40 字）' },
    ],
  },
  {
    key: 'suggestion.status_change',
    label: '建议的处理状态发生了变化',
    source: '建设建议',
    defaults: {
      title: '建设建议状态变更',
      messageTemplate: '建议「{summary}」状态：{from} → {to}',
      type: 'progress',
      autoReadForOperator: true,
    },
    variables: [
      { key: 'operator', label: '操作者昵称' },
      { key: 'summary', label: '建议摘要（前 30 字）' },
      { key: 'from', label: '变更前状态' },
      { key: 'to', label: '变更后状态' },
    ],
  },
  {
    key: 'task.new',
    label: '有人新建了事项',
    source: '事项追踪',
    defaults: {
      title: '新事项创建',
      messageTemplate: '{operator} 新建了事项「{title}」（{category}）',
      type: 'progress',
      autoReadForOperator: true,
    },
    variables: [
      { key: 'operator', label: '创建者昵称' },
      { key: 'title', label: '事项标题' },
      { key: 'category', label: '事项分类' },
      { key: 'status', label: '初始状态' },
    ],
  },
  {
    key: 'task.status_change',
    label: '有人改变了事项的状态',
    source: '事项追踪',
    defaults: {
      title: '事项状态变更',
      messageTemplate: '{operator} 将事项「{title}」状态：{from} → {to}',
      type: 'progress',
      autoReadForOperator: true,
    },
    variables: [
      { key: 'operator', label: '操作者昵称' },
      { key: 'title', label: '事项标题' },
      { key: 'from', label: '变更前状态' },
      { key: 'to', label: '变更后状态' },
    ],
  },
  {
    key: 'sharing.new',
    label: '有人发布了新的成员分享',
    source: '成员内部分享',
    defaults: {
      title: '新成员分享',
      messageTemplate: '{operator} 发布了新分享「{title}」（{categoryLabel}）',
      type: 'sharing',
      autoReadForOperator: true,
    },
    variables: [
      { key: 'operator', label: '发布者昵称' },
      { key: 'title', label: '分享标题' },
      { key: 'categoryLabel', label: '分享分类' },
    ],
  },
  {
    key: 'article.archive',
    label: '有人归档了公众号文章',
    source: '公众号归档',
    defaults: {
      title: '公众号文章归档',
      messageTemplate: '{operator} 归档了公众号文章「{title}」（{category}）',
      type: 'sharing',
      autoReadForOperator: true,
    },
    variables: [
      { key: 'operator', label: '归档者昵称' },
      { key: 'title', label: '文章标题' },
      { key: 'category', label: '文章分类' },
    ],
  },
  {
    key: 'gallery.upload',
    label: '有人向相册上传了新照片',
    source: '相册',
    defaults: {
      title: '相册新增照片',
      messageTemplate: '{operator} 向相册「{albumTitle}」上传了 {count} 张照片',
      type: 'sharing',
      autoReadForOperator: true,
    },
    variables: [
      { key: 'operator', label: '上传者昵称' },
      { key: 'albumTitle', label: '相册标题' },
      { key: 'count', label: '本次上传的照片数' },
    ],
  },
];

// 按 key 查事件
export function getEventMeta(eventKey) {
  return EVENT_CATALOG.find((e) => e.key === eventKey) || null;
}

// ====== 可选项字典 ======
export const AUDIENCE_OPTIONS = [
  { value: 'all', label: '所有人（包括操作者）' },
  { value: 'operator_exclude', label: '所有人（操作者不打扰）' },
  { value: 'admin', label: '仅管理员' },
  { value: 'member', label: '仅普通成员' },
];

export const TYPE_OPTIONS = [
  { value: 'progress', label: '事项进度', color: '#5EAD8C' },
  { value: 'sharing', label: '内部分享', color: '#5B8C3E' },
  { value: 'other', label: '其他', color: '#8B5CF6' },
];

export const CONDITION_OPS = [
  { value: 'equals', label: '等于' },
  { value: 'not_equals', label: '不等于' },
  { value: 'contains', label: '包含' },
  { value: 'not_contains', label: '不包含' },
  { value: 'gt', label: '大于（数字）' },
  { value: 'lt', label: '小于（数字）' },
];

// ====== 模板渲染：把 "{operator} 上传了「{title}」" 渲染成真实消息 ======
export function renderTemplate(tpl, variables) {
  if (!tpl) return '';
  return String(tpl).replace(/\{(\w+)\}/g, (_m, key) => {
    const v = variables?.[key];
    return v === undefined || v === null || v === '' ? '' : String(v);
  });
}

export function renderTemplateLabels(tpl, eventMeta) {
  if (!tpl) return '';
  const variables = eventMeta?.variables || [];
  return String(tpl).replace(/\{(\w+)\}/g, (match, key) => {
    const variable = variables.find((v) => v.key === key);
    return variable ? `「${variable.label}」` : match;
  });
}

// ====== 条件判断：rule.conditions 全部满足才触发 ======
export function evaluateConditions(conditions, variables) {
  if (!Array.isArray(conditions) || conditions.length === 0) return true;
  return conditions.every((c) => {
    const val = variables?.[c.field];
    const target = c.value;
    switch (c.op) {
      case 'equals':
        return String(val ?? '') === String(target ?? '');
      case 'not_equals':
        return String(val ?? '') !== String(target ?? '');
      case 'contains':
        return String(val ?? '').includes(String(target ?? ''));
      case 'not_contains':
        return !String(val ?? '').includes(String(target ?? ''));
      case 'gt':
        return Number(val) > Number(target);
      case 'lt':
        return Number(val) < Number(target);
      default:
        return true;
    }
  });
}

// ====== 结构化 → 自然语言：describeRule ======
// 例："每当【有人上传了新文档】时，向【所有人（操作者不打扰）】发送
//      标题为【新内部分享】的通知；附加条件：当 文档类型 等于 流程手册；
//      每天最多 10 条。当前状态：已启用。"
export function describeRule(rule) {
  if (!rule) return '';
  const ev = getEventMeta(rule.event);
  const eventLabel = ev?.label || rule.event || '（未选择触发事件）';
  const audience = AUDIENCE_OPTIONS.find((a) => a.value === rule.audience)?.label
    || '所有人（操作者不打扰）';
  const typeLabel = TYPE_OPTIONS.find((t) => t.value === rule.type)?.label || '其他';
  const parts = [];
  parts.push(`每当【${eventLabel}】时`);
  parts.push(`向【${audience}】发送一条【${typeLabel}】类型的通知`);
  if (rule.title) parts.push(`标题：「${renderTemplateLabels(rule.title, ev)}」`);
  if (rule.messageTemplate) parts.push(`内容：「${renderTemplateLabels(rule.messageTemplate, ev)}」`);
  if (Array.isArray(rule.conditions) && rule.conditions.length > 0) {
    const condTxt = rule.conditions
      .map((c) => {
        const opLabel = CONDITION_OPS.find((o) => o.value === c.op)?.label || c.op;
        const fieldLabel = ev?.variables?.find((v) => v.key === c.field)?.label || c.field;
        return `${fieldLabel} ${opLabel} "${c.value}"`;
      })
      .join('；且 ');
    parts.push(`附加条件：当 ${condTxt}`);
  }
  if (rule.throttle?.maxPerDay > 0) {
    parts.push(`每天最多 ${rule.throttle.maxPerDay} 条`);
  }
  parts.push(rule.enabled === false ? '当前状态：已停用' : '当前状态：已启用');
  return parts.join('，') + '。';
}

// ====== 给一条规则填默认值（新增时调用）======
export function createEmptyRule(eventKey = 'doc.upload') {
  const ev = getEventMeta(eventKey) || EVENT_CATALOG[0];
  return {
    id: null,
    enabled: true,
    event: ev.key,
    title: ev.defaults.title,
    messageTemplate: ev.defaults.messageTemplate,
    type: ev.defaults.type,
    audience: 'all', // 默认通知范围：所有人
    autoReadForOperator: ev.defaults.autoReadForOperator,
    conditions: [],
    throttle: { maxPerDay: 0 },
    description: '',
  };
}

// ====== 基本合法性校验 ======
export function validateRule(rule) {
  const errs = [];
  if (!rule.event) errs.push('请选择触发事件');
  if (!rule.title || !rule.title.trim()) errs.push('请填写通知标题');
  if (!rule.type) errs.push('请选择通知类型');
  if (!rule.audience) errs.push('请选择通知范围');
  if (rule.throttle && rule.throttle.maxPerDay < 0) {
    errs.push('每日最大条数不能为负数');
  }
  return errs;
}
