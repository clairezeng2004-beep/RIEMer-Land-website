import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { clubInfo, taskCategories as defaultTaskCategories, taskStatuses as defaultTaskStatuses, teamMembers as defaultTeamMembers, eventsData as defaultEventsData, timelineData as defaultTimelineData } from '../data/siteData';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { fetchArticles as fetchArticlesFromDb, addArticleToDb, updateArticleInDb, deleteArticleFromDb, migrateLocalArticlesToDb, subscribeArticles } from '../services/articleDbService';
import { fetchInternalConfig, saveInternalConfig, subscribeInternalConfig, fetchSettings, saveSetting, subscribeSettings, SITE_KEYS } from '../services/siteSettingsService';

const SiteContentContext = createContext(null);

const CONTENT_KEY = 'riemer_site_content';
const FILTERS_KEY = 'riemer_filter_options';
const ARTICLES_KEY = 'riemer_user_articles';
const INTERNAL_CONFIG_KEY = 'riemer_internal_config';
const SUGGESTIONS_KEY = 'riemer_site_suggestions';
const EVENTS_KEY = 'riemer_site_events';
const TIMELINE_KEY = 'riemer_site_timeline';
const PUBLIC_REFRESH_INTERVAL_MS = 60 * 1000;

const getCurrentPathname = () => (
  typeof window === 'undefined' ? '/' : window.location.pathname
);

const isInternalPath = (pathname) => String(pathname || '').startsWith('/internal');

// 历史上为了防止"旧 fetch 回包覆盖刚 flush 的新值"，曾经把每个 key 本地最近一次
// 成功推云的 updated_at 写进 localStorage，挂载时读出填进 lastPushedUpdatedAtRef。
// 问题：这份持久化是"本设备的墓碑"，并不代表云端当前权威版本。B 设备之前某次
// 自己推过云（留下 lastPushed=Tb），之后云端被 A 继续编辑、B 本地再也没推过，
// 下次 B 挂载时 fetchSetting 拿回的 updated_at 只要满足 "Tb 在 A 所有推送的最晚
// 时间之后"，B 就会把云端真实最新的 A 版本判定为"比我旧的事件，丢弃"，结果
// 本地 state 继续用 localStorage 里的老 filterOptions，整设备再也拿不到 A 的
// 更新 —— 用户视角就是"跨设备不同步"。
//
// 修复策略：lastPushedUpdatedAtRef 改为纯内存、纯会话级。挂载时清零 → 本设备
// 还没推过任何东西之前，任何 fetch/订阅回包都应当如实覆盖本地，这才是正确的
// "跨设备可见"语义。只有当 **当前会话内** 本设备已经推过云，才需要防御"旧事件
// 晚到冲掉刚保存的新值"这种窄竞态。跨会话的持久化因此不再需要。
//
// LAST_PUSHED_AT_KEY 的历史值需要清理，否则老设备上残留的那份 localStorage 会
// 继续污染本次挂载（如果后续代码又读回来）。这里保留 key 常量仅供一次性清理。
const LAST_PUSHED_AT_KEY = 'riemer_site_settings_last_pushed_at';
const purgeLegacyLastPushedAt = () => {
  try { localStorage.removeItem(LAST_PUSHED_AT_KEY); } catch { /* ignore */ }
};

// 建设建议初始模拟数据（包含网站改进与组织建设两类）
const getDefaultSuggestions = () => [
  {
    id: 'sug-1',
    content: '首页 Hero 区域增加轮播背景图，展示校园风光和活动精彩瞬间',
    proposer: '陈思雨',
    status: '处理中',
    statusUpdatedAt: '2025-04-10',
    statusUpdatedBy: '林子墨',
    statusUpdatedByAvatar: null,
    createdAt: '2025-03-20',
    resolver: '王诗涵',
    skipReason: '',
  },
  {
    id: 'sug-2',
    content: '建议每学期初举办一次"破冰茶话会"，帮助新成员融入团队、了解组织文化',
    proposer: '周悦然',
    status: '处理中',
    statusUpdatedAt: '2025-04-08',
    statusUpdatedBy: '陈思雨',
    statusUpdatedByAvatar: null,
    createdAt: '2025-03-25',
    resolver: '周悦然',
    skipReason: '',
  },
  {
    id: 'sug-3',
    content: '移动端侧边栏增加汉堡菜单按钮，改善手机端导航体验',
    proposer: '张一帆',
    status: '已完成',
    statusUpdatedAt: '2025-04-05',
    statusUpdatedBy: '王诗涵',
    statusUpdatedByAvatar: null,
    createdAt: '2025-03-15',
    resolver: '王诗涵',
    skipReason: '',
  },
  {
    id: 'sug-4',
    content: '建立"学长学姐经验库"，收集往届成员的学业规划、实习求职和留学申请经验供新成员参考',
    proposer: '李明远',
    status: '处理中',
    statusUpdatedAt: '2025-04-12',
    statusUpdatedBy: '林子墨',
    statusUpdatedByAvatar: null,
    createdAt: '2025-04-01',
    resolver: '林子墨',
    skipReason: '',
  },
  {
    id: 'sug-5',
    content: '优化组织内部分工机制，明确各小组职责范围，减少任务重叠和沟通成本',
    proposer: '林子墨',
    status: '暂时搁置',
    statusUpdatedAt: '2025-04-11',
    statusUpdatedBy: '张一帆',
    statusUpdatedByAvatar: null,
    createdAt: '2025-04-05',
    resolver: '',
    skipReason: '需要等下学期换届后根据新团队架构再统一规划',
  },
];

// 可编辑的内容字段及其默认值
const getDefaultContent = () => ({
  // Hero 区域
  heroTagline: '交流 · 互助 · 成长',
  heroTitle: 'RIEMer Land',
  heroDescription: clubInfo.description,

  // 统计数字
  stats: [...clubInfo.stats],

  // 使命区域
  missionSectionTitle: '我们的使命',
  missions: clubInfo.mission.map((desc, i) => ({
    title: ['经验交流', '心得共享', '朋辈互助', '多元可能'][i],
    desc,
  })),

  // 文章区域
  articlesSectionTitle: '历史文章',

  // Footer
  footerDescription: clubInfo.description,
  footerEmail: clubInfo.contact.email,
  footerLocation: clubInfo.contact.location,
});

// 内部空间可自定义配置
const getDefaultInternalConfig = () => ({
  // 侧边栏
  sidebar: {
    sectionLabelNav: '',
    sectionLabelDaily: '日常管理',
    sectionLabelMembers: '成员信息',
    sectionLabelAdmin: '网站管理',
    labelHome: '快捷导航',
    labelNotifications: '消息通知',
    labelDocuments: '文档管理',
    labelTasks: '事项追踪',
    labelProcessTemplates: '流程模板文件',
    labelMemberSharing: '成员内部分享',
    labelArticles: '公众号长文分享归档',
    labelContributions: '成员贡献',
    labelSuggestions: '建设建议',
    labelGuestbook: '访客留言板',
    labelMemberProfiles: '成员通讯录',
    labelGallery: '活动相册',
    labelEventPublish: '活动发布',
    labelProfile: '个人主页',
    labelUsers: '用户管理',
    labelContent: '内容管理',
    labelNotificationMgmt: '通知管理',
  },
  // 内部首页
  home: {
    greeting: 'RIEMer Land',
    welcomeSuffix: '欢迎回到内部空间 ✨',
    sectionModules: '功能模块',
    sectionRecentMessages: '最近消息',
    tipTitle: '💡 小贴士',
    tipContent: '你可以通过顶部导航栏的「内部空间」随时回到这里。有新的消息或待办事项时，导航栏会显示提醒标记。',
    moduleNotifications: '消息通知',
    moduleNotificationsDesc: '查看团队通知、系统提醒和重要消息',
    moduleDocuments: '文档管理',
    moduleDocumentsDesc: '上传、查看和管理团队内部文档资料',
    moduleTasks: '事项追踪',
    moduleTasksDesc: '跟踪待办事项、分配任务和查看进度',
    moduleGallery: '活动相册',
    moduleGalleryDesc: '浏览和上传活动照片，记录每次相聚的美好瞬间',
    moduleUsers: '用户管理',
    moduleUsersDesc: '管理成员账号、授权与角色分配',
    moduleContent: '内容管理',
    moduleContentDesc: '编辑网站首页、时间线等公开内容',
  },
  // 文档管理页
  documents: {
    pageTitle: '文档管理',
    pageDesc: '管理和浏览社团内部文档与资料',
    uploadBtn: '上传文档',
  },
  // 事项追踪页
  tasks: {
    pageTitle: '事项追踪',
    pageDesc: '管理和追踪社团各项工作任务的进展',
    newTaskBtn: '新建事项',
  },
  // 活动相册页
  gallery: {
    pageTitle: '活动相册',
    pageDesc: '记录每一次相聚的美好瞬间',
    newAlbumBtn: '新建相册',
  },
  // 消息通知页
  notifications: {
    pageTitle: '消息通知',
    markAllReadBtn: '全部已读',
  },
  // 用户管理页
  users: {
    pageTitle: '用户管理',
    pageDesc: '管理成员账户、访问权限和角色分配',
  },
  // 成员贡献页
  contributions: {
    pageTitle: '成员贡献',
    pageDesc: '自动统计每位成员的贡献数据，以半年度为单位或查看历史全部数据',
    labelShareEvents: '线上分享会',
    labelArticleCount: '公众号文章',
    labelHelpCount: '协作帮助',
    labelUploadCount: '内部分享',
    labelTotal: '贡献总计',
    noteTitle: '数据说明',
    noteShareEvents: '统计事项追踪中分类为「线上分享」且该成员为负责人的事项数量',
    noteArticleCount: '统计文章浏览中该成员为负责人（leaderId）的文章数量',
    noteHelpCount: '统计事项追踪中该成员作为协助人参与的事项数量',
    noteUploadCount: '统计文档管理中该成员上传的文档数量',
    noteCustom: '手动输入的自定义贡献项，保存在本地',
  },
  // 建设建议页
  suggestions: {
    pageTitle: '建设建议',
    pageDesc: '收集和追踪网站改进与组织建设相关建议的进度',
    addBtn: '添加建议',
  },
  // 成员通讯录页
  memberProfiles: {
    pageTitle: '成员通讯录',
    pageDesc: '了解每位成员的基本信息、去向与兴趣，促进彼此交流。可以直接在养老院校友群内添加具体校友',
  },
  // 公众号历史文章页
  internalArticles: {
    pageTitle: '公众号长文分享归档',
    pageDesc: '浏览公众号历史推送内容，回顾与归档',
  },
  // 个人主页
  profile: {
    pageTitle: '个人主页',
    pageDesc: '设置你的昵称、头像和个性签名',
  },
  // 活动发布页（与首页「最新活动」共享 events 数据源，CRUD 入口之一）
  eventPublish: {
    pageTitle: '活动发布',
    pageDesc: '发布与维护团队活动，数据与首页「最新活动」实时同步',
    btnNew: '新建活动',
  },
  // 流程模板文件页（Documents 组件以 configSection="processTemplates" 复用）
  // 这里的 pageTitle/pageDesc 由 ProcessTemplates.jsx 用 customTitle/customDesc
  // 写死，不走 EditableText，所以默认文案留空即可；关键是下面两个数组：
  // - extraTypeKeys：本页新增的自定义 documentType 的 key 列表（custom_*）
  // - hiddenBuiltinKeys：本页"隐藏"的白名单内置 key（如隐藏 'process'）
  // 必须把 processTemplates 登记进 defaults，否则 hydrate / subscribe /
  // flushInternalConfig 的合并逻辑（只遍历 Object.keys(defaults)）会把云端
  // 回包里真实存在的 processTemplates 字段整段扔掉，导致"刷新后就地新增
  // 的筛选分类消失、跨设备同步不上"。
  processTemplates: {
    extraTypeKeys: [],
    hiddenBuiltinKeys: [],
  },
  // 成员内部分享页（MemberSharing.jsx 使用 internalConfig.memberSharing.pageTitle/pageDesc）
  // 同样必须登记进 defaults，否则云端的 pageTitle/pageDesc 会被合并逻辑丢弃。
  memberSharing: {
    pageTitle: '成员内部分享',
    pageDesc: '浏览课程资料及成员经验分享，支持 Word 与 Markdown 格式',
  },
});

// 默认文档类型定义
const defaultDocumentTypes = [
  { key: 'course', label: '课程及考试资料', color: '#5EAD8C' },
  { key: 'history', label: '历史会议', color: '#4FBFC4' },
  { key: 'process', label: '流程手册及模版文件', color: '#D4A44C' },
  { key: 'regulation', label: '规章制度', color: '#8B5CF6' },
  { key: 'experience', label: '成员经验分享', color: '#EC4899' },
];

// 筛选选项默认值
const getDefaultFilters = () => ({
  taskCategories: [...defaultTaskCategories],
  taskStatuses: [...defaultTaskStatuses],
  teamMembers: defaultTeamMembers.map((m) => ({ ...m })),
  documentTypes: defaultDocumentTypes.map((t) => ({ ...t })),
});

// 侧边栏旧默认值 → 新默认值迁移表
// 历史版本默认 sectionLabelMembers='成员' / sectionLabelAdmin='管理'，
// 新版本改为 '成员信息' / '网站管理'。
// 对于已经把旧默认值落盘到 localStorage / Supabase 的设备，
// 这里做一次"字段级"自动迁移：仅当持久化值恰好等于旧默认值时才升级，
// 用户若已自定义成其它文案（例如改成 "Members"）则保持不变。
const SIDEBAR_LEGACY_LABEL_MIGRATION = {
  sectionLabelMembers: { from: ['成员'], to: '成员信息' },
  sectionLabelAdmin: { from: ['管理'], to: '网站管理' },
  labelArticles: {
    from: ['公众号历史文章归档', '公众号文字分享归档'],
    to: '公众号长文分享归档',
  },
};

function migrateSidebarLegacyLabels(sidebar) {
  if (!sidebar || typeof sidebar !== 'object') return sidebar;
  const next = { ...sidebar };
  for (const [key, { from, to }] of Object.entries(SIDEBAR_LEGACY_LABEL_MIGRATION)) {
    if (from.includes(next[key])) next[key] = to;
  }
  return next;
}

/**
 * 合并云端/本地持久化的 internalConfig 与 defaults。
 *
 * ⚠️ 历史坑（已修复）：原先的实现是 `for (const key of Object.keys(defaults))`，
 *   即"只合并 defaults 中显式声明的 section"。结果任何新增 section（如
 *   processTemplates / memberSharing）如果忘了登记到 getDefaultInternalConfig，
 *   云端 site_settings.internal_config 里真实存在的这些字段每次 hydrate /
 *   realtime 回包时都会被静默丢掉。用户的典型报错就是：
 *     "流程模板文件新增筛选分类后刷新就没了 / 跨设备同步不上"
 *   因为 Documents.jsx 把 extraTypeKeys / hiddenBuiltinKeys 存在
 *   internalConfig.processTemplates 下，而 processTemplates 没出现在 defaults，
 *   整段被丢 → 本地 state 不含新 key → push-effect 把"不含 processTemplates 的
 *   值"反推云端 → 云端也被擦。
 *
 * 现在改为遍历 defaults ∪ value 的并集：
 *   - 即便后续新增 section 忘了登记 defaults，也能正确保留云端的真实值；
 *   - 同时对每个 section 依然合并 defaults 的基础字段，保证 UI 有默认文案。
 */
function mergeInternalConfig(value) {
  const defaults = getDefaultInternalConfig();
  const safeValue = value && typeof value === 'object' ? value : {};
  const allKeys = new Set([...Object.keys(defaults), ...Object.keys(safeValue)]);
  const merged = {};
  for (const key of allKeys) {
    const d = defaults[key];
    const v = safeValue[key];
    if (d && typeof d === 'object' && !Array.isArray(d)) {
      // defaults 有定义且是对象：走字段级浅合并
      merged[key] = { ...d, ...(v && typeof v === 'object' && !Array.isArray(v) ? v : {}) };
    } else if (v !== undefined) {
      // defaults 没定义（新增 section）：原样保留云端/本地值
      merged[key] = v;
    } else if (d !== undefined) {
      merged[key] = d;
    }
  }
  // 侧边栏旧标签一次性迁移
  if (merged.sidebar) merged.sidebar = migrateSidebarLegacyLabels(merged.sidebar);
  // 公众号长文分享归档：页面标题旧默认值 → 新默认值（仅当用户未自定义时升级），
  // 与侧边栏 Tab 名保持一致。
  if (merged.internalArticles && typeof merged.internalArticles === 'object') {
    const legacyTitles = ['公众号历史文章归档', '公众号文字分享归档'];
    if (legacyTitles.includes(merged.internalArticles.pageTitle)) {
      merged.internalArticles = {
        ...merged.internalArticles,
        pageTitle: '公众号长文分享归档',
      };
    }
  }
  return merged;
}

export function SiteContentProvider({ children }) {
  const [pathname, setPathname] = useState(getCurrentPathname);
  const isInternalRoute = isInternalPath(pathname);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const notifyRouteChange = () => setPathname(getCurrentPathname());
    const wrapHistoryMethod = (method) => {
      const original = window.history[method];
      return function patchedHistoryMethod(...args) {
        const result = original.apply(this, args);
        window.dispatchEvent(new Event('riemer-route-change'));
        return result;
      };
    };

    const originalPushState = window.history.pushState;
    const originalReplaceState = window.history.replaceState;
    window.history.pushState = wrapHistoryMethod('pushState');
    window.history.replaceState = wrapHistoryMethod('replaceState');

    window.addEventListener('popstate', notifyRouteChange);
    window.addEventListener('riemer-route-change', notifyRouteChange);
    notifyRouteChange();

    return () => {
      window.history.pushState = originalPushState;
      window.history.replaceState = originalReplaceState;
      window.removeEventListener('popstate', notifyRouteChange);
      window.removeEventListener('riemer-route-change', notifyRouteChange);
    };
  }, []);

  const [content, setContent] = useState(() => {
    const stored = localStorage.getItem(CONTENT_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        // stats 始终使用最新默认值，避免旧缓存残留
        delete parsed.stats;
        return { ...getDefaultContent(), ...parsed };
      } catch {
        return getDefaultContent();
      }
    }
    return getDefaultContent();
  });

  // 筛选选项状态
  const [filterOptions, setFilterOptions] = useState(() => {
    const stored = localStorage.getItem(FILTERS_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        return { ...getDefaultFilters(), ...parsed };
      } catch {
        return getDefaultFilters();
      }
    }
    return getDefaultFilters();
  });

  // 用户添加的文章
  // 策略：先从 localStorage 的缓存 key 恢复（SWR 模式），
  //      打开页面立刻显示上一次的数据；后台再向 Supabase 拉取最新覆盖。
  const [userArticles, setUserArticles] = useState(() => {
    try {
      const raw = localStorage.getItem(ARTICLES_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch { /* ignore */ }
    return [];
  });
  const [articlesLoaded, setArticlesLoaded] = useState(false);
  const lastArticlesFetchAtRef = useRef(0);

  // 内部空间配置持久化开关：true 时暂停自动写 localStorage（编辑模式下使用）
  const [internalConfigPersistPaused, setInternalConfigPersistPaused] = useState(false);
  // 记录本设备最后一次成功写云端的时间戳，用于避免实时回流重复覆盖
  const lastSyncedAtRef = useRef(null);
  // 用 ref 镜像 persistPaused，供 realtime 回调内部判断最新值（避免闭包陷阱）
  const persistPausedRef = useRef(false);
  useEffect(() => {
    persistPausedRef.current = internalConfigPersistPaused;
  }, [internalConfigPersistPaused]);

  // 内部空间配置
  const [internalConfig, setInternalConfig] = useState(() => {
    const stored = localStorage.getItem(INTERNAL_CONFIG_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        // 深度合并（并集，保留云端/本地新增 section 的值，侧边栏旧标签自动迁移）
        return mergeInternalConfig(parsed);
      } catch {
        return getDefaultInternalConfig();
      }
    }
    return getDefaultInternalConfig();
  });

  // 网站建设建议
  const [suggestions, setSuggestions] = useState(() => {
    const stored = localStorage.getItem(SUGGESTIONS_KEY);
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch {
        return getDefaultSuggestions();
      }
    }
    return getDefaultSuggestions();
  });

  // 活动管理
  const [events, setEvents] = useState(() => {
    const stored = localStorage.getItem(EVENTS_KEY);
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch {
        return [...defaultEventsData];
      }
    }
    return [...defaultEventsData];
  });

  // 时间轴管理
  const [timeline, setTimeline] = useState(() => {
    const stored = localStorage.getItem(TIMELINE_KEY);
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch {
        return [...defaultTimelineData];
      }
    }
    return [...defaultTimelineData];
  });

  useEffect(() => {
    localStorage.setItem(CONTENT_KEY, JSON.stringify(content));
  }, [content]);

  useEffect(() => {
    localStorage.setItem(FILTERS_KEY, JSON.stringify(filterOptions));
  }, [filterOptions]);

  // 从 Supabase 加载文章（初始化 + 迁移本地数据）
  //
  // ⚠️ 关键历史 bug（已修复）：
  //   之前的流程是：
  //     1) fetchArticlesFromDb()  → 从云端拿到 N 条文章
  //     2) localStorage.setItem(ARTICLES_KEY, ...)  → 把云端文章写进 localStorage
  //     3) migrateLocalArticlesToDb()  → 把 localStorage 里的 N 条当作"待迁移的旧本地文章"
  //                                      逐条 INSERT 回 articles 表（没有去重、没有 upsert）
  //     → 每次刷新 DB 里就多出 N 条重复，下次刷新再 2N 条… 指数放大。
  //   ARTICLES_KEY === LOCAL_ARTICLES_KEY（都是 'riemer_user_articles'），所以 2) 和 3) 吃的是同一个 key。
  //   这就是"数据库只有 1 条，却冒出非常多文章"的根因。
  //
  // 现在的修复策略：
  //   - migrate 只在 sessionStorage 里做"本会话至多跑一次"的标记
  //   - migrate 仅迁移明显带"本地临时 id"的旧文章（非 UUID、没有 _fromDb 标志）
  //   - 并且：先 migrate，再 fetch + 写入本地缓存；顺序反过来，杜绝"先把云端数据塞进 localStorage、
  //     下一步又把它当作'本地旧文章'上传"的闭环。
  const loadArticlesFromCloud = useCallback(async ({ migrate = false } = {}) => {
    let migrated = 0;
    if (migrate) {
      const MIGRATE_DONE_KEY = 'riemer_articles_migration_done_v2';
      try {
        const done = localStorage.getItem(MIGRATE_DONE_KEY);
        if (!done) {
          migrated = await migrateLocalArticlesToDb();
          localStorage.setItem(MIGRATE_DONE_KEY, '1');
        }
      } catch {
        // localStorage 不可用就跳过迁移
      }
    }

    const articles = await fetchArticlesFromDb();
    lastArticlesFetchAtRef.current = Date.now();
    return { articles, migrated };
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadArticlesFromCloud({ migrate: true }).then(({ articles, migrated }) => {
      if (cancelled) return;
      setUserArticles(articles);
      setArticlesLoaded(true);
      try {
        localStorage.setItem(ARTICLES_KEY, JSON.stringify(articles));
      } catch { /* ignore quota/private mode */ }
      if (migrated > 0) {
        console.log(`[SiteContent] 迁移本地文章到云端：${migrated} 条`);
      }
    }).catch(() => {
      if (!cancelled) setArticlesLoaded(true);
    });
    return () => { cancelled = true; };
  }, [loadArticlesFromCloud]);

  // ---- 订阅 articles 表实时变更：任一设备归档/编辑/删除文章后，所有设备立即同步 ----
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    if (!isInternalRoute) return;
    const unsubscribe = subscribeArticles(({ type, newItem, oldItem }) => {
      if (type === 'INSERT' && newItem) {
        setUserArticles((prev) => {
          // 避免本设备刚 insert 的条目重复（按 id 去重）
          if (prev.some((a) => String(a.id) === String(newItem.id))) return prev;
          const next = [newItem, ...prev];
          // 按日期倒序维持一致顺序
          return next.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
        });
      } else if (type === 'UPDATE' && newItem) {
        setUserArticles((prev) =>
          prev.map((a) => (String(a.id) === String(newItem.id) ? { ...a, ...newItem } : a))
        );
      } else if (type === 'DELETE' && oldItem) {
        setUserArticles((prev) => prev.filter((a) => String(a.id) !== String(oldItem.id)));
      }
    });
    return () => unsubscribe();
  }, [isInternalRoute]);

  // 公开访客页不保持 Realtime 连接：重新打开/切回页面时，超过 60 秒才后台刷新一次。
  useEffect(() => {
    if (isInternalRoute) return undefined;

    const refreshIfStale = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastArticlesFetchAtRef.current < PUBLIC_REFRESH_INTERVAL_MS) return;
      loadArticlesFromCloud().then(({ articles }) => {
        setUserArticles(articles);
        setArticlesLoaded(true);
      }).catch(() => { /* 保留现有缓存 */ });
    };

    document.addEventListener('visibilitychange', refreshIfStale);
    window.addEventListener('focus', refreshIfStale);
    return () => {
      document.removeEventListener('visibilitychange', refreshIfStale);
      window.removeEventListener('focus', refreshIfStale);
    };
  }, [isInternalRoute, loadArticlesFromCloud]);

  // ---- userArticles 变化时同步写本地缓存，供下次打开即时显示 ----
  // 等首批数据已加载完成（articlesLoaded=true）后再开始写回，
  // 避免初始化 state 为空（云端还没拉回）时误把缓存清空。
  useEffect(() => {
    if (!articlesLoaded) return;
    try {
      localStorage.setItem(ARTICLES_KEY, JSON.stringify(userArticles));
    } catch { /* ignore */ }
  }, [userArticles, articlesLoaded]);

  useEffect(() => {
    if (internalConfigPersistPaused) return;
    localStorage.setItem(INTERNAL_CONFIG_KEY, JSON.stringify(internalConfig));
  }, [internalConfig, internalConfigPersistPaused]);

  // ---- 启动时从云端拉取 internalConfig，并订阅实时变更 ----
  // 作用：管理员在 A 设备保存的 Tab 名称等站点配置，其它设备也能看到
  //
  // 与下面 pushToCloud 路径的对接（重要）：
  // internalConfig 的云端读/订阅走本独立 effect，但"写回云端"统一通过
  // pushToCloud(SITE_KEYS.INTERNAL_CONFIG, internalConfig) 走去抖+pagehide 兜底路径。
  // 由于 pushToCloud 里有 hydratedKeysRef 守卫（未 hydrate 前禁止写云，防止初始化
  // 阶段本地 mock 覆盖云端真实数据），我们必须在 hydrate 完成后（无论成功/失败/
  // 云端暂无数据）都把 INTERNAL_CONFIG 标记为 hydrated，否则后续用户的真实编辑会
  // 被 pushToCloud 静默丢弃 —— 表现为"流程模板/内部分享就地改分类，本设备刷新
  // 就消失"的典型症状。
  useEffect(() => {
    if (!isSupabaseConfigured) {
      // 未配置 Supabase：同样要标 hydrated，否则 pushToCloud 永远跳过，
      // 虽然没有 Supabase 写不进云端，但至少不会把 cloudSyncStatus 卡在 syncing。
      hydratedKeysRef.current[SITE_KEYS.INTERNAL_CONFIG] = true;
      return;
    }
    let cancelled = false;

    // 1) 初始化拉取云端配置，覆盖本地（编辑模式下不覆盖）
    const hydrate = async () => {
      const { value, updatedAt, error } = await fetchInternalConfig();
      if (cancelled) return;
      if (error) {
        // 表不存在或权限拒绝：安静降级，只用本地；但仍要开闸允许后续 push
        console.warn('[SiteContent] 云端 internalConfig 不可用，使用本地:', error);
        hydratedKeysRef.current[SITE_KEYS.INTERNAL_CONFIG] = true;
        return;
      }
      if (!value) {
        // 云端暂无数据：首次本地变更就要允许推上去
        hydratedKeysRef.current[SITE_KEYS.INTERNAL_CONFIG] = true;
        return;
      }
      // 竞态防御：hydrate 返回前，用户可能已经点过保存 / 就地改过分类
      // （走 pushToCloud 或 flushSettingToCloud），此时 lastPushedUpdatedAtRef
      // 可能已经比云端返回的 updatedAt 新，不应被覆盖。
      const lastPushed = lastPushedUpdatedAtRef.current[SITE_KEYS.INTERNAL_CONFIG];
      if (lastPushed && updatedAt && lastPushed >= updatedAt) {
        hydratedKeysRef.current[SITE_KEYS.INTERNAL_CONFIG] = true;
        return;
      }
      if (localDirtyRef.current[SITE_KEYS.INTERNAL_CONFIG]) {
        // 本地已被用户改过但还没推云成功：保留本地值
        hydratedKeysRef.current[SITE_KEYS.INTERNAL_CONFIG] = true;
        return;
      }
      lastSyncedAtRef.current = updatedAt;
      siteSyncRefs.current[SITE_KEYS.INTERNAL_CONFIG] = updatedAt;
      // 深度合并：遍历 defaults ∪ value 的并集，保证云端新增 section
      // (processTemplates / memberSharing 等) 不会被 defaults 白名单过滤丢弃。
      const merged = mergeInternalConfig(value);
      // 一次性抑制：下面 internalConfig state 的 push-effect 消费后跳过，
      // 防止"hydrate 回包 setState → effect push → 订阅回流 → 覆盖本地"的乒乓。
      suppressNextPushRef.current[SITE_KEYS.INTERNAL_CONFIG] = true;
      setInternalConfig((prev) => {
        // 编辑模式下不要打断用户的修改
        if (persistPausedRef.current) return prev;
        return merged;
      });
      hydratedKeysRef.current[SITE_KEYS.INTERNAL_CONFIG] = true;
    };
    hydrate();

    // 2) 订阅实时变更：其它设备保存后当前设备自动刷新
    const unsubscribe = subscribeInternalConfig((value, updatedAt) => {
      if (cancelled) return;
      // 若本地刚刚是写入源，则跳过回流，避免闪烁
      if (updatedAt && lastSyncedAtRef.current === updatedAt) return;
      // 防竞态：只接受比本地最新推云更新的事件；否则可能是之前的旧版本晚到
      const lastPushed = lastPushedUpdatedAtRef.current[SITE_KEYS.INTERNAL_CONFIG];
      if (lastPushed && updatedAt && lastPushed >= updatedAt) return;
      lastSyncedAtRef.current = updatedAt;
      siteSyncRefs.current[SITE_KEYS.INTERNAL_CONFIG] = updatedAt;
      // 深度合并：遍历 defaults ∪ value 的并集（理由见 mergeInternalConfig 注释）
      const merged = mergeInternalConfig(value);
      // 一次性抑制：订阅 setState 后紧跟的 push-effect 跳过回推，避免乒乓
      suppressNextPushRef.current[SITE_KEYS.INTERNAL_CONFIG] = true;
      setInternalConfig((prev) => {
        // 正在编辑时不覆盖，等用户保存/取消后再同步
        if (persistPausedRef.current) return prev;
        return merged;
      });
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
    // 只在挂载时订阅一次；persistPaused 通过读函数内闭包最新值即可
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    localStorage.setItem(SUGGESTIONS_KEY, JSON.stringify(suggestions));
  }, [suggestions]);

  useEffect(() => {
    localStorage.setItem(EVENTS_KEY, JSON.stringify(events));
  }, [events]);

  useEffect(() => {
    localStorage.setItem(TIMELINE_KEY, JSON.stringify(timeline));
  }, [timeline]);

  // ============================================
  // 通用：把"仅存在本地"的站点 state 也统一同步到 Supabase site_settings
  // 这样 content / filterOptions / suggestions / events / timeline 等管理员编辑
  // 全部可以跨设备可见，A 设备改完 B 设备实时刷新
  // ============================================
  // 为每条 state 维护一个 lastSyncedAt，用于避免 realtime 回流被自己覆盖
  const siteSyncRefs = useRef({});
  const lastSettingsFetchAtRef = useRef(0);
  // 标记该 key 是否已完成首次云端拉取（hydrated）。只有 hydrated 后的本地变更才允许 push 回云端，
  // 否则初始化阶段的本地 mock 会把云端真实数据覆盖掉。
  const hydratedKeysRef = useRef({});
  // 本地是否在 hydrate 完成前就被用户改过（含保存按钮触发 flushSettingToCloud）。
  // 若 true，则 hydrate 返回来的云端值即使非空也不能再覆盖本地 state——否则会出现：
  //   保存 → flush 成功 → 稍后的 fetchSetting 回包带着 flush 之前的旧值 → 覆盖本地 →
  //   触发 effect push → 把旧值写回云端（刷新后就看不到刚才的编辑）。
  const localDirtyRef = useRef({});
  // 最近一次我们成功推到云端的 updatedAt（包含去抖 push 和 flush 两种路径）。
  // hydrate 和订阅回来的数据，只有 updatedAt 比这个值新，才允许覆盖本地。
  // ⚠️ 只保留**本会话**语义，挂载时清零。跨会话持久化会导致另一台设备把云端真实
  //    最新的值误判为"旧事件"拒绝覆盖，这正是"跨设备不同步"的典型根因。
  const lastPushedUpdatedAtRef = useRef({});
  // 本设备刚从 hydrate / 订阅回调把云端值 setState 进本地时，紧接着 state 变化
  // 会触发 useEffect 调 pushToCloud —— 我们刚刚接收的就是云端最新值，不应当再回推。
  // 否则会产生 A 改 → B 订阅收到 → B 回推 → A 订阅收到 → A 回推 的乒乓循环，
  // 把 updated_at 不断推晚，拉爆频次并且可能让双方都判定"别人的修改比我旧"。
  // 这里用一次性抑制标志：hydrate/subscribe 覆盖前置位，紧随其后的 push 消费它并跳过。
  const suppressNextPushRef = useRef({});
  // 每条 state 的 setter + 默认值生成器 + 是否为合并型（对象）或替换型（数组）
  const syncDefs = [
    { key: SITE_KEYS.PUBLIC_CONTENT, setter: setContent,        fallback: getDefaultContent,  kind: 'object' },
    { key: SITE_KEYS.FILTER_OPTIONS, setter: setFilterOptions,  fallback: getDefaultFilters,  kind: 'object' },
    { key: SITE_KEYS.SUGGESTIONS,    setter: setSuggestions,    fallback: getDefaultSuggestions, kind: 'array'  },
    { key: SITE_KEYS.EVENTS,         setter: setEvents,         fallback: () => [...defaultEventsData],   kind: 'array'  },
    { key: SITE_KEYS.TIMELINE,       setter: setTimeline,       fallback: () => [...defaultTimelineData], kind: 'array'  },
  ];

  // 初始化拉云 + 订阅（挂载一次）
  useEffect(() => {
    if (!isSupabaseConfigured) {
      // 未配置 Supabase：所有 key 立刻标记 hydrated，避免后续 push 等待无意义
      syncDefs.forEach(({ key }) => { hydratedKeysRef.current[key] = true; });
      return;
    }
    // 注意：lastPushedUpdatedAtRef 只保留会话内语义，挂载时一定是空的。
    // 这里顺手把历史版本遗留在 localStorage 的 LAST_PUSHED_AT_KEY 清掉，
    // 防止"老设备残留的本地时间戳 ≥ 云端当前 updated_at → hydrate 拒绝覆盖"
    // 这类陈旧墓碑把真实新值挡在外面（即用户报的"跨设备不同步"根因）。
    purgeLegacyLastPushedAt();
    let cancelled = false;
    const syncDefByKey = new Map(syncDefs.map((def) => [def.key, def]));
    const syncKeys = syncDefs.map(({ key }) => key);

    const applyCloudSetting = (key, value, updatedAt, source) => {
      const def = syncDefByKey.get(key);
      if (!def) return;
      const { setter, fallback, kind } = def;

      if (value == null) {
        if (source === 'hydrate') {
          console.log(`[SiteContent] ${key} 云端暂无数据，首次本地变更将推上云`);
          hydratedKeysRef.current[key] = true;
        }
        return;
      }

      const lastPushed = lastPushedUpdatedAtRef.current[key];
      if (lastPushed && updatedAt && lastPushed >= updatedAt) {
        if (source === 'hydrate') hydratedKeysRef.current[key] = true;
        if (source === 'hydrate') {
          console.log(
            `[SiteContent] ${key} hydrate 跳过覆盖：本地最近推云 updatedAt=${lastPushed} ≥ 云端返回 ${updatedAt}`
          );
        }
        return;
      }

      if (source === 'hydrate' && localDirtyRef.current[key]) {
        hydratedKeysRef.current[key] = true;
        console.log(
          `[SiteContent] ${key} hydrate 跳过覆盖：本地已 dirty，保留用户正在编辑的值`
        );
        return;
      }

      if (source !== 'hydrate' && updatedAt && siteSyncRefs.current[key] === updatedAt) return;
      siteSyncRefs.current[key] = updatedAt;
      delete localDirtyRef.current[key];
      suppressNextPushRef.current[key] = true;
      setter((prev) => {
        if (kind === 'object') return { ...fallback(), ...value };
        if (Array.isArray(value)) return value;
        return prev;
      });
      if (source === 'hydrate') {
        hydratedKeysRef.current[key] = true;
        console.log(`[SiteContent] ${key} 已从云端 hydrate，updatedAt=${updatedAt}`);
      }
    };

    const hydrateSiteSettings = ({ force = false } = {}) => {
      if (!force && Date.now() - lastSettingsFetchAtRef.current < PUBLIC_REFRESH_INTERVAL_MS) {
        return;
      }

      fetchSettings(syncKeys).then(({ settings, error }) => {
        if (cancelled) return;
        if (error) {
          console.warn('[SiteContent] 首次批量拉取站点设置失败（走本地）:', error);
          syncKeys.forEach((key) => { hydratedKeysRef.current[key] = true; });
          return;
        }

        syncKeys.forEach((key) => {
          const row = settings[key];
          if (!row) {
            console.log(`[SiteContent] ${key} 云端暂无数据，首次本地变更将推上云`);
            hydratedKeysRef.current[key] = true;
            return;
          }
          applyCloudSetting(key, row.value, row.updatedAt, 'hydrate');
        });
        lastSettingsFetchAtRef.current = Date.now();
      });
    };

    // 首次拉云：合并为一次请求，减少公开页跨境往返
    hydrateSiteSettings({ force: true });

    let unsubscribe = () => {};
    let cleanupPublicRefresh = () => {};

    if (isInternalRoute) {
      // 内部空间保留实时同步，方便管理员多设备协作编辑。
      unsubscribe = subscribeSettings(syncKeys, (key, value, updatedAt) => {
        if (cancelled) return;
        applyCloudSetting(key, value, updatedAt, 'subscribe');
      });
    } else {
      // 公开访客页不保持 Realtime 连接：页面重新可见时，超过 60 秒才后台刷新。
      const refreshIfStale = () => {
        if (document.visibilityState !== 'visible') return;
        hydrateSiteSettings();
      };
      document.addEventListener('visibilitychange', refreshIfStale);
      window.addEventListener('focus', refreshIfStale);
      cleanupPublicRefresh = () => {
        document.removeEventListener('visibilitychange', refreshIfStale);
        window.removeEventListener('focus', refreshIfStale);
      };
    }

    return () => {
      cancelled = true;
      unsubscribe();
      cleanupPublicRefresh();
    };

    // 挂载时建立一次，数据流由订阅驱动
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isInternalRoute]);

  // ============================================
  // 云端同步状态（让上层 UI 能真实知道"保存到云"成功还是失败）
  // ============================================
  // 形状：{ [key]: { status: 'idle'|'syncing'|'ok'|'error', error?: string, updatedAt?: string, at: number } }
  // - 初始 idle；每次 push 开始 → syncing；成功 → ok；失败 → error（携带 error message）
  // 用这个 state 替代原先只往 console.warn 吞错的策略，避免"跨设备不同步"时用户无感。
  const [cloudSyncStatus, setCloudSyncStatus] = useState({});

  // 去抖写云端：state 变化后 400ms 再 upsert，避免连续编辑刷爆 DB
  const pushDebouncedRef = useRef({});
  // 保存每个 key 最近一次 pending 的"值快照"，用于页面卸载前同步 flush。
  // 否则用户编辑筛选项后 400ms 内刷新页面，去抖的 setTimeout 随页面卸载丢失，
  // 云端从来没写入新值；刷新后 hydrate 拉回旧值覆盖本地，表现为"刷新就丢"。
  const pendingPushValueRef = useRef({});
  const pushToCloud = useCallback((key, value) => {
    if (!isSupabaseConfigured) {
      // 未配置 Supabase：明确标记，上层可据此提示用户"当前无云端，仅本设备生效"
      setCloudSyncStatus((prev) => ({
        ...prev,
        [key]: { status: 'error', error: 'supabase-not-configured', at: Date.now() },
      }));
      return;
    }
    // 必须等该 key 从云端 hydrate 完成后才允许回写，否则初始化阶段的本地 mock 会覆盖云端真实数据
    if (!hydratedKeysRef.current[key]) return;
    // 如果本次 state 变化是"hydrate / 订阅 刚把云端值塞进来"触发的，就不要再回推云端。
    // 消费一次性抑制标志即可继续处理用户后续的真实编辑。
    if (suppressNextPushRef.current[key]) {
      suppressNextPushRef.current[key] = false;
      return;
    }
    // 只要 push 被真正排队，就把 dirty 标记置为 true，让可能晚到的 fetch 回包不要覆盖本地
    localDirtyRef.current[key] = true;
    // 记录 pending 值，便于 beforeunload/visibilitychange 时同步 flush
    pendingPushValueRef.current[key] = value;
    if (pushDebouncedRef.current[key]) clearTimeout(pushDebouncedRef.current[key]);
    setCloudSyncStatus((prev) => ({ ...prev, [key]: { status: 'syncing', at: Date.now() } }));
    pushDebouncedRef.current[key] = setTimeout(async () => {
      const res = await saveSetting(key, value);
      if (res.success) {
        siteSyncRefs.current[key] = res.updatedAt;
        // 记录本次推云的 updatedAt（仅本会话内存语义）：
        // 用于让"同一条 updatedAt 的 realtime 自回流"被识别后跳过；
        // 以及让 fetch/订阅晚到的旧版本值被拒绝覆盖。绝不持久化到 localStorage，
        // 避免成为另一台设备上的"时间戳墓碑"导致跨设备不同步。
        if (res.updatedAt) lastPushedUpdatedAtRef.current[key] = res.updatedAt;
        // pending 已成功写入，清掉快照
        delete pendingPushValueRef.current[key];
        delete localDirtyRef.current[key];
        setCloudSyncStatus((prev) => ({
          ...prev,
          [key]: { status: 'ok', updatedAt: res.updatedAt, at: Date.now() },
        }));
      } else {
        console.warn(`[SiteContent] ${key} 云端同步失败:`, res.error);
        setCloudSyncStatus((prev) => ({
          ...prev,
          [key]: { status: 'error', error: res.error || '未知错误', at: Date.now() },
        }));
      }
    }, 400);
  }, []);

  /**
   * 立即（不去抖）把某个 key 的当前值推到云端，等待返回。
   * 适用于"用户点了保存按钮，需要立刻知道成不成"的场景。
   * 返回：{ success, error, updatedAt }
   */
  const flushSettingToCloud = useCallback(async (key, value) => {
    if (!isSupabaseConfigured) {
      setCloudSyncStatus((prev) => ({
        ...prev,
        [key]: { status: 'error', error: 'supabase-not-configured', at: Date.now() },
      }));
      return { success: false, error: 'supabase-not-configured' };
    }
    // 用户点了保存 = 本地权威，必须把 dirty 标起来；同时把 hydrated 强制置 true，
    // 保证即使 fetchSetting 回包还没到（hydrate 尚未完成），也不会被吞掉后续 push。
    localDirtyRef.current[key] = true;
    hydratedKeysRef.current[key] = true;
    // 取消掉可能正在排队的去抖 push，避免它覆盖我们立即推的结果
    if (pushDebouncedRef.current[key]) {
      clearTimeout(pushDebouncedRef.current[key]);
      pushDebouncedRef.current[key] = null;
    }
      // flush 已经立即推送，清掉对应的 pending 值，避免卸载 hook 重复再写一次
      delete pendingPushValueRef.current[key];
    setCloudSyncStatus((prev) => ({ ...prev, [key]: { status: 'syncing', at: Date.now() } }));
    const res = await saveSetting(key, value);
    if (res.success) {
      siteSyncRefs.current[key] = res.updatedAt;
      // 仅更新会话内存，不再写 localStorage —— 跨会话持久化会把
      // "本设备某次推云时间戳"带给下次挂载，造成另一台设备拿到云端
      // 最新值反被判定为"旧事件"拒绝覆盖，即跨设备不同步的根因。
      if (res.updatedAt) lastPushedUpdatedAtRef.current[key] = res.updatedAt;
      delete localDirtyRef.current[key];
      setCloudSyncStatus((prev) => ({
        ...prev,
        [key]: { status: 'ok', updatedAt: res.updatedAt, at: Date.now() },
      }));
    } else {
      setCloudSyncStatus((prev) => ({
        ...prev,
        [key]: { status: 'error', error: res.error || '未知错误', at: Date.now() },
      }));
    }
    return res;
  }, []);

  // ============================================
  // 页面卸载前立即 flush 所有 pending 去抖 push
  // ============================================
  // 问题场景：用户在"流程模板 / 内部文档"页点"+ 添加分类"、删分类、改分类名
  // 这三个入口背后走的都是 updateFilterOptions → pushToCloud 的 400ms 去抖路径。
  // 如果用户编辑完立刻刷新页面（或切换路由/关闭 tab），400ms 还没到，去抖的
  // setTimeout 会随页面卸载被抛弃，云端从未写入新值。下次挂载时 hydrate 拉回
  // 的还是旧值，表现为"刷新后筛选项就丢了，跨设备更看不到"。
  //
  // 这里监听 visibilitychange(hidden) + pagehide + beforeunload 三个时机，
  // 把所有 pending 的值同步调用一次 saveSetting。注意：
  //   - 用 document.visibilitychange hidden 能覆盖"切 tab / 手机熄屏"等场景；
  //   - pagehide 覆盖"关闭 tab / 返回上一页"；
  //   - beforeunload 覆盖"刷新 / 导航到别的站"。
  //   三个事件在不同浏览器/平台上互有缺失，叠加监听保证至少触发一次。
  // saveSetting 本身是异步的，浏览器在 unload 阶段通常会允许 pending fetch
  // 跑完（Chrome/Edge 会尝试，Safari 最保守）。即便 flush 真的没跑完，下次
  // 挂载时 fetchSetting 拿回的云端 updated_at 是服务端权威时间，hydrate
  // 逻辑会如实覆盖本地，不会因为本地"陈旧时间戳兜底"而阻塞新值（此前那个
  // localStorage updatedAt 兜底已移除，因为它在跨设备场景下反而会把另一台
  // 设备的真实最新值误判为"旧事件"拒绝覆盖）。
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const flushAll = () => {
      const pending = pendingPushValueRef.current;
      const keys = Object.keys(pending);
      if (keys.length === 0) return;
      keys.forEach((key) => {
        const value = pending[key];
        // 先取消对应的去抖定时器，避免 setTimeout 稍后在一个已经不存在的上下文里再打一次
        if (pushDebouncedRef.current[key]) {
          clearTimeout(pushDebouncedRef.current[key]);
          pushDebouncedRef.current[key] = null;
        }
        // 直接调用 saveSetting，不 await——unload 阶段 await 也没意义
        try {
          saveSetting(key, value).then((res) => {
            if (res && res.success && res.updatedAt) {
              lastPushedUpdatedAtRef.current[key] = res.updatedAt;
              siteSyncRefs.current[key] = res.updatedAt;
              // 不再 writeLastPushedAt：下次挂载若从 localStorage 读回旧时间戳，
              // 会错误拒绝云端真实最新值（跨设备不同步根因）。unload 阶段能跑完
              // saveSetting 的情况下，云端本身就是权威，下次挂载走 fetchSetting
              // 拿到的 updated_at 自然是最新的，无需本地兜底时间戳。
            }
          }).catch(() => { /* 卸载阶段错误无意义 */ });
        } catch { /* 同上 */ }
        delete pending[key];
      });
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flushAll();
    };
    window.addEventListener('pagehide', flushAll);
    window.addEventListener('beforeunload', flushAll);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flushAll);
      window.removeEventListener('beforeunload', flushAll);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  // state 变化 → 去抖 push 云端
  useEffect(() => { pushToCloud(SITE_KEYS.PUBLIC_CONTENT, content);       }, [content, pushToCloud]);
  useEffect(() => { pushToCloud(SITE_KEYS.FILTER_OPTIONS, filterOptions); }, [filterOptions, pushToCloud]);
  useEffect(() => { pushToCloud(SITE_KEYS.SUGGESTIONS, suggestions);      }, [suggestions, pushToCloud]);
  useEffect(() => { pushToCloud(SITE_KEYS.EVENTS, events);                }, [events, pushToCloud]);
  useEffect(() => { pushToCloud(SITE_KEYS.TIMELINE, timeline);            }, [timeline, pushToCloud]);
  // internalConfig 也自动推云：Documents/ProcessTemplates/Tasks 的就地改分类会
  // 经由 updateInternalConfig 改 state；没有这个 effect，它们的改动仅停留在内存+
  // localStorage，被 realtime 回流覆盖后"同设备刷新就消失"。
  // 编辑模式下（internalConfigPersistPaused）不推云：让 ContentManagement 的
  // "取消编辑"能回滚，避免中间态被写入云端。
  useEffect(() => {
    if (internalConfigPersistPaused) return;
    pushToCloud(SITE_KEYS.INTERNAL_CONFIG, internalConfig);
  }, [internalConfig, internalConfigPersistPaused, pushToCloud]);

  const updateContent = (updates) => {
    setContent((prev) => ({ ...prev, ...updates }));
  };

  const resetContent = () => {
    const defaults = getDefaultContent();
    setContent(defaults);
    localStorage.setItem(CONTENT_KEY, JSON.stringify(defaults));
  };

  const updateFilterOptions = (updates) => {
    setFilterOptions((prev) => ({ ...prev, ...updates }));
  };

  const resetFilterOptions = () => {
    const defaults = getDefaultFilters();
    setFilterOptions(defaults);
    localStorage.setItem(FILTERS_KEY, JSON.stringify(defaults));
  };

  // 内部空间配置管理
  const updateInternalConfig = (updates) => {
    setInternalConfig((prev) => {
      const next = { ...prev };
      for (const key of Object.keys(updates)) {
        next[key] = { ...(prev[key] || {}), ...updates[key] };
      }
      return next;
    });
  };

  /**
   * 直接用整个 config 替换当前 internalConfig（用于"取消编辑"回滚到快照）
   */
  const replaceInternalConfig = (cfg) => {
    setInternalConfig(cfg);
  };

  /**
   * 手动将当前 internalConfig 写入 localStorage（用于"保存编辑"显式落盘）
   * 同时异步同步到 Supabase `site_settings`，实现跨设备共享
   */
  const flushInternalConfig = () => {
    setInternalConfig((cur) => {
      localStorage.setItem(INTERNAL_CONFIG_KEY, JSON.stringify(cur));
      // 云端同步（后台异步，不阻塞 UI）
      saveInternalConfig(cur).then((res) => {
        if (!res.success) {
          console.warn('[SiteContent] internalConfig 云端同步失败:', res.error);
        } else {
          // 记录本次保存的时间戳，避免实时订阅回流导致覆盖
          lastSyncedAtRef.current = res.updatedAt;
        }
      });
      return cur;
    });
  };

  const resetInternalConfig = () => {
    const defaults = getDefaultInternalConfig();
    setInternalConfig(defaults);
    localStorage.setItem(INTERNAL_CONFIG_KEY, JSON.stringify(defaults));
    // 同步到云端（不阻塞）
    saveInternalConfig(defaults).then((res) => {
      if (!res.success) {
        console.warn('[SiteContent] 重置后云端同步失败:', res.error);
      } else {
        lastSyncedAtRef.current = res.updatedAt;
      }
    });
  };

  // 文章管理 CRUD（Supabase 优先，localStorage 回退）
  const addArticle = async (article, userId) => {
    // 乐观更新 UI
    setUserArticles((prev) => [article, ...prev]);
    // 异步写入数据库
    const saved = await addArticleToDb(article, userId);
    if (saved?._localOnly) {
      setUserArticles((prev) => prev.filter((a) => a.id !== article.id));
      return saved;
    }
    if (saved && saved.id !== article.id) {
      // 如果数据库返回了新 ID，更新列表
      setUserArticles((prev) =>
        prev.map((a) => (a.id === article.id ? saved : a))
      );
    }
    return saved;
  };

  const updateArticle = async (id, updates) => {
    setUserArticles((prev) =>
      prev.map((a) => (a.id === id ? { ...a, ...updates } : a))
    );
    await updateArticleInDb(id, updates);
  };

  const deleteArticle = async (id) => {
    setUserArticles((prev) => prev.filter((a) => a.id !== id));
    await deleteArticleFromDb(id);
  };

  // 刷新文章列表（从数据库重新加载）
  const refreshArticles = useCallback(async () => {
    const articles = await fetchArticlesFromDb();
    setUserArticles(articles);
  }, []);

  // 网站建设建议 CRUD
  const addSuggestion = (suggestion) => {
    setSuggestions((prev) => [suggestion, ...prev]);
  };

  const updateSuggestion = (id, updates) => {
    setSuggestions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...updates } : s))
    );
  };

  const deleteSuggestion = (id) => {
    setSuggestions((prev) => prev.filter((s) => s.id !== id));
  };

  // 活动管理 CRUD
  const addEvent = (event) => {
    setEvents((prev) => {
      if (prev.some((item) => String(item.id) === String(event.id))) return prev;
      return [event, ...prev];
    });
  };

  const updateEvent = (id, updates) => {
    setEvents((prev) =>
      prev.map((e) => (e.id === id ? { ...e, ...updates } : e))
    );
  };

  const deleteEvent = (id) => {
    setEvents((prev) => prev.filter((e) => e.id !== id));
  };

  // 时间轴管理
  const updateTimeline = (newTimeline) => {
    setTimeline(newTimeline);
  };

  const addTimelineNode = (node) => {
    setTimeline((prev) => [...prev, node]);
  };

  const updateTimelineNode = (index, updates) => {
    setTimeline((prev) =>
      prev.map((item, i) => (i === index ? { ...item, ...updates } : item))
    );
  };

  const deleteTimelineNode = (index) => {
    setTimeline((prev) => prev.filter((_, i) => i !== index));
  };

  const resetTimeline = () => {
    const defaults = [...defaultTimelineData];
    setTimeline(defaults);
    localStorage.setItem(TIMELINE_KEY, JSON.stringify(defaults));
  };

  // ---- 从数据库同步团队成员到 filterOptions.teamMembers ----
  //
  // 跨设备同步关键坑（事项追踪新增分类"推不上去"的真正根因）：
  //
  //   这个函数本质上是把 profiles 表的"权威成员列表"注入到 filterOptions.teamMembers
  //   （一个对象字段），它会触发 filterOptions 的 push-effect → pushToCloud →
  //   把整对象（含 taskCategories/taskStatuses/teamMembers）重新 upsert 回 site_settings。
  //
  //   危险时序：
  //     1. A 设备新增了 taskCategory="新分类" → 立即 flush 到云端 site_settings.filterOptions
  //     2. B 设备打开 MemberContributions / ContentManagement 页（两页都在 mount 时
  //        调 syncTeamMembersFromDB）
  //     3. B 的 fetchSetting(FILTER_OPTIONS) 和 profiles 查询是并行的；如果 profiles
  //        先回，且 fetchSetting 回包稍晚或还没触发 suppressNextPushRef 消费周期，
  //        setFilterOptions((prev) => ...) 里的 prev 可能是"仅从 localStorage 恢复的
  //        旧 filterOptions"（不含 A 的新分类）
  //     4. push-effect 触发 → pushToCloud(FILTER_OPTIONS, 旧值+新 teamMembers)
  //        → 400ms 后 upsert 覆盖云端 → **A 的新分类被 B 用自己的派生值整体擦掉**
  //     5. A 的订阅收到 B 的覆盖事件 → A 本地 filterOptions 也被冲掉新分类
  //
  //   现象就是用户说的"新增分类跨设备同步不了" —— 不是推不出去，而是被 B 设备
  //   挂载页面时"顺手拿旧值 + 新 teamMembers 回推"给硬覆盖了，两边最终都看不到。
  //
  //   修复策略：
  //     a) 等待 FILTER_OPTIONS 完成 hydrate 再 setState，保证 prev 一定是云端最新值，
  //        永远不会把 localStorage 旧快照回推；
  //     b) 同时置位 suppressNextPushRef[FILTER_OPTIONS] = true，让这次"派生自 profiles
  //        表的注入"本身不再触发 pushToCloud。teamMembers 本来就是 profiles 表的投影，
  //        把它和用户真实编辑的 taskCategories 合在一起回推是浪费一次冲突机会；
  //     c) dbMembers 和现有 teamMembers 一致时直接跳过，避免无谓的 setState。
  const syncTeamMembersFromDB = useCallback(async (getAllUsers, supabaseOk) => {
    try {
      let dbMembers = [];

      // 先尝试 Supabase
      if (isSupabaseConfigured && supabaseOk === true && supabase) {
        const { data: profiles, error } = await supabase
          .from('profiles')
          .select('id, name, authorized')
          .eq('authorized', true)
          .order('created_at', { ascending: true });

        if (!error && profiles && profiles.length > 0) {
          dbMembers = profiles.map((p) => ({
            id: p.id,
            name: p.name || '未知用户',
            role: '',
            avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(p.name || '用户')}&background=5B8C3E&color=fff&size=80&font-size=0.4&rounded=true`,
            profileUrl: '/timeline#team',
          }));
        }
      }

      // Supabase 不可用或没有数据时，尝试从 getAllUsers 获取
      if (dbMembers.length === 0 && getAllUsers) {
        const allUsers = await getAllUsers();
        const authorized = allUsers.filter((u) => u.authorized);
        if (authorized.length > 0) {
          dbMembers = authorized.map((u) => ({
            id: u.id,
            name: u.name || '未知用户',
            role: '',
            avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(u.name || '用户')}&background=5B8C3E&color=fff&size=80&font-size=0.4&rounded=true`,
            profileUrl: '/timeline#team',
          }));
        }
      }

      if (dbMembers.length === 0) {
        return { success: false, message: '未找到已授权的成员数据' };
      }

      // --- 跨设备同步修复：等 FILTER_OPTIONS 完成 hydrate 再注入 ---
      // 若云端 hydrate 还没完成，这里直接 setState 会基于 localStorage 旧快照
      // 生成新值，紧随其后的 push-effect 会把旧 taskCategories 整体推回云端，
      // 覆盖其它设备刚写入的新分类。这里轮询等 hydrated，最多等 5s，超时则退让
      // （超时只会让这次 teamMembers 同步延后生效，不会造成跨设备数据丢失）。
      if (isSupabaseConfigured && !hydratedKeysRef.current[SITE_KEYS.FILTER_OPTIONS]) {
        const start = Date.now();
        while (!hydratedKeysRef.current[SITE_KEYS.FILTER_OPTIONS]) {
          if (Date.now() - start > 5000) {
            console.warn(
              '[SiteContent] syncTeamMembersFromDB: 等待 FILTER_OPTIONS hydrate 超时，放弃本次注入'
            );
            return { success: false, message: 'filter-options-hydrate-timeout' };
          }
          // eslint-disable-next-line no-await-in-loop
          await new Promise((r) => setTimeout(r, 50));
        }
      }

      setFilterOptions((prev) => {
        const prevMembers = Array.isArray(prev.teamMembers) ? prev.teamMembers : [];
        // 如果和现有完全一致，直接返回原引用避免 push-effect 触发
        const sameLength = prevMembers.length === dbMembers.length;
        const sameContent =
          sameLength &&
          prevMembers.every((m, i) => {
            const n = dbMembers[i];
            return m && n && m.id === n.id && m.name === n.name && m.avatar === n.avatar;
          });
        if (sameContent) return prev;
        // 标记此次 setState 是"派生自 profiles 的权威注入"，不应再触发 pushToCloud 回推；
        // 否则会把"云端当前 filterOptions + 新 teamMembers"原样写回云端，增加并发覆盖
        // 其它设备刚写入字段（如 taskCategories）的风险。
        suppressNextPushRef.current[SITE_KEYS.FILTER_OPTIONS] = true;
        return { ...prev, teamMembers: dbMembers };
      });
      return { success: true, count: dbMembers.length };
    } catch (err) {
      console.error('[SiteContent] syncTeamMembersFromDB 失败:', err);
      return { success: false, message: err.message };
    }
  }, []);

  return (
    <SiteContentContext.Provider value={{
      content, updateContent, resetContent,
      filterOptions, updateFilterOptions, resetFilterOptions,
      userArticles, addArticle, updateArticle, deleteArticle, refreshArticles, articlesLoaded,
      internalConfig, updateInternalConfig, resetInternalConfig,
      replaceInternalConfig, flushInternalConfig,
      internalConfigPersistPaused, setInternalConfigPersistPaused,
      suggestions, addSuggestion, updateSuggestion, deleteSuggestion,
      events, addEvent, updateEvent, deleteEvent,
      timeline, updateTimeline, addTimelineNode, updateTimelineNode, deleteTimelineNode, resetTimeline,
      syncTeamMembersFromDB,
      // 云端同步状态暴露
      // cloudSyncStatus：{ [key]: { status, error?, updatedAt?, at } }，上层可据此展示"已同步/同步失败"提示
      // flushSettingToCloud(key, value)：立即推送某个 key 的值到云端，返回 { success, error, updatedAt }
      // SITE_KEYS：所有可同步的 key 常量（避免硬编码）
      cloudSyncStatus, flushSettingToCloud, SITE_KEYS,
    }}>
      {children}
    </SiteContentContext.Provider>
  );
}

export const useSiteContent = () => {
  const context = useContext(SiteContentContext);
  if (!context) {
    throw new Error('useSiteContent must be used within a SiteContentProvider');
  }
  return context;
};
