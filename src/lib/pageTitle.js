/**
 * 根据当前路由（+ 内部空间侧栏 label 配置）计算浏览器 tab 的标题。
 *
 * 设计原则：
 * - 公共站（/）以 `RIEMer Land` 为站点名，具体板块通过 `— XXX` 附在其后。
 * - 内部空间（/internal/**）以 `内部空间` 为前缀，后面接当前所在 Tab 的名称；
 *   独立文档编辑页面再加一级 `— 文档编辑`。
 * - Tab 名称尽量读取 `internalConfig.sidebar.labelXxx`，保证用户在站点内改名后
 *   浏览器标签名也会跟着变；若拿不到 sidebar 配置则回退到硬编码默认值。
 */

const SEP = ' — ';

// 侧栏默认文案（fallback，与 SiteContentContext.jsx 的默认值保持一致）
const SIDEBAR_FALLBACK = {
  labelHome: '快捷导航',
  labelNotifications: '消息通知',
  labelDocuments: '文档管理',
  labelTasks: '事项追踪',
  labelProcessTemplates: '流程模板文件',
  labelMemberSharing: '成员内部分享',
  labelArticles: '公众号长文分享归档',
  labelEventPublish: '活动发布',
  labelContributions: '成员贡献度',
  labelSuggestions: '建设建议',
  labelGuestbook: '访客留言板',
  labelMemberProfiles: '成员通讯录',
  labelGallery: '相册',
  labelProfile: '个人资料',
  labelUsers: '用户管理',
  labelContent: '内容管理',
  labelNotificationMgmt: '通知管理',
};

const pickLabel = (sidebar, key) =>
  (sidebar && sidebar[key]) || SIDEBAR_FALLBACK[key] || '';

/**
 * 路径 → 对应的 sidebar labelKey，以及是否属于"新建"页面。
 * 命中规则：按顺序用 startsWith 匹配；create 判定优先级更高。
 */
function resolveInternalSegment(pathname) {
  // /internal 或 /internal/
  if (pathname === '/internal' || pathname === '/internal/') {
    return { labelKey: 'labelNotifications', isCreate: false };
  }

  // 有专门"新建"入口的两个模块
  if (pathname.startsWith('/internal/process-templates/create')) {
    return { labelKey: 'labelProcessTemplates', isCreate: true };
  }
  if (pathname.startsWith('/internal/process-templates')) {
    return { labelKey: 'labelProcessTemplates', isCreate: false };
  }
  if (pathname.startsWith('/internal/member-sharing/create')) {
    return { labelKey: 'labelMemberSharing', isCreate: true };
  }
  if (pathname.startsWith('/internal/member-sharing')) {
    return { labelKey: 'labelMemberSharing', isCreate: false };
  }

  // 其它模块，一一对应
  const simpleMap = [
    ['/internal/notifications', 'labelNotifications'],
    ['/internal/tasks', 'labelTasks'],
    ['/internal/articles', 'labelArticles'],
    ['/internal/article/', 'labelArticles'],
    ['/internal/event-publish', 'labelEventPublish'],
    ['/internal/contributions', 'labelContributions'],
    ['/internal/suggestions', 'labelSuggestions'],
    ['/internal/guestbook', 'labelGuestbook'],
    ['/internal/member-profiles', 'labelMemberProfiles'],
    ['/internal/gallery', 'labelGallery'],
    ['/internal/profile', 'labelProfile'],
    ['/internal/users', 'labelUsers'],
    ['/internal/content', 'labelContent'],
    ['/internal/notification-management', 'labelNotificationMgmt'],
    ['/internal/documents', 'labelDocuments'],
  ];
  for (const [prefix, labelKey] of simpleMap) {
    if (pathname.startsWith(prefix)) {
      return { labelKey, isCreate: false };
    }
  }

  // 兜底：未知的 /internal/** 子路径
  return { labelKey: 'labelNotifications', isCreate: false };
}

/**
 * 公共站路径 → 后缀文案。
 * 首页返回空串（表示只显示站点名 `RIEMer Land`）。
 */
function resolvePublicSuffix(pathname) {
  if (pathname === '/' || pathname === '') return '';
  if (pathname.startsWith('/articles') || pathname.startsWith('/article/')) {
    return '分享回顾';
  }
  if (pathname.startsWith('/timeline')) return '关于我们';
  if (pathname.startsWith('/login')) return '登录';
  if (pathname.startsWith('/reset-password')) return '重置密码';
  return '';
}

/**
 * 组装标题主体（不含未读消息前缀）。
 *
 * @param {string} pathname - 当前路由路径（来自 react-router-dom 的 location.pathname）
 * @param {object} sidebar  - internalConfig.sidebar 对象（可为 undefined）
 * @returns {string}
 */
export function buildBaseTitle(pathname, sidebar) {
  const isInternal = pathname.startsWith('/internal');

  if (!isInternal) {
    // 登录 / 重置密码也归为公共站外观
    const suffix = resolvePublicSuffix(pathname);
    return suffix ? `RIEMer Land${SEP}${suffix}` : 'RIEMer Land';
  }

  const { labelKey, isCreate } = resolveInternalSegment(pathname);
  const tabName = pickLabel(sidebar, labelKey);

  const parts = ['内部空间'];
  if (tabName) parts.push(tabName);
  if (isCreate) parts.push('文档编辑');
  return parts.join(SEP);
}

/**
 * 组装最终标题。未读消息数大于 0 时，前面加 `(N条未读消息) `。
 */
export function buildDocumentTitle(pathname, sidebar, unreadCount = 0) {
  const base = buildBaseTitle(pathname, sidebar);
  return unreadCount > 0 ? `(${unreadCount}条未读消息) ${base}` : base;
}
