import { createContext, useContext, useState, useEffect } from 'react';
import { clubInfo, taskCategories as defaultTaskCategories, taskStatuses as defaultTaskStatuses, teamMembers as defaultTeamMembers } from '../data/siteData';

const SiteContentContext = createContext(null);

const CONTENT_KEY = 'riemer_site_content';
const FILTERS_KEY = 'riemer_filter_options';
const ARTICLES_KEY = 'riemer_user_articles';
const INTERNAL_CONFIG_KEY = 'riemer_internal_config';
const SUGGESTIONS_KEY = 'riemer_site_suggestions';

// 网站建设建议初始模拟数据
const getDefaultSuggestions = () => [
  {
    id: 'sug-1',
    content: '首页 Hero 区域增加轮播背景图，展示校园风光',
    proposer: '陈思雨',
    status: '修复中',
    statusUpdatedAt: '2025-04-10',
    statusUpdatedBy: '林子墨',
    statusUpdatedByAvatar: null,
    createdAt: '2025-03-20',
    resolver: '王诗涵',
    skipReason: '',
  },
  {
    id: 'sug-2',
    content: '文章详情页添加目录导航（TOC），方便长文阅读',
    proposer: '周悦然',
    status: '暂时不做',
    statusUpdatedAt: '2025-04-08',
    statusUpdatedBy: '陈思雨',
    statusUpdatedByAvatar: null,
    createdAt: '2025-03-25',
    resolver: '',
    skipReason: '当前文章篇幅较短，暂不需要目录导航功能',
  },
  {
    id: 'sug-3',
    content: '移动端侧边栏增加汉堡菜单按钮，改善手机端导航体验',
    proposer: '张一帆',
    status: '已修复',
    statusUpdatedAt: '2025-04-05',
    statusUpdatedBy: '王诗涵',
    statusUpdatedByAvatar: null,
    createdAt: '2025-03-15',
    resolver: '王诗涵',
    skipReason: '',
  },
  {
    id: 'sug-4',
    content: '「关于我们」页面增加团队成员个人主页链接',
    proposer: '李明远',
    status: '已修复',
    statusUpdatedAt: '2025-04-12',
    statusUpdatedBy: '林子墨',
    statusUpdatedByAvatar: null,
    createdAt: '2025-04-01',
    resolver: '林子墨',
    skipReason: '',
  },
  {
    id: 'sug-5',
    content: '内部空间首页增加最近编辑的文章快捷入口',
    proposer: '林子墨',
    status: '修复中',
    statusUpdatedAt: '2025-04-11',
    statusUpdatedBy: '张一帆',
    statusUpdatedByAvatar: null,
    createdAt: '2025-04-05',
    resolver: '张一帆',
    skipReason: '',
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
    sectionLabelNav: '导航',
    sectionLabelAdmin: '管理',
    labelHome: '首页',
    labelNotifications: '消息通知',
    labelDocuments: '文档管理',
    labelTasks: '事项追踪',
    labelGallery: '成员相册',
    labelUsers: '用户管理',
    labelContent: '内容管理',
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
    moduleGallery: '成员相册',
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
  // 成员相册页
  gallery: {
    pageTitle: '成员相册',
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
});

// 筛选选项默认值
const getDefaultFilters = () => ({
  taskCategories: [...defaultTaskCategories],
  taskStatuses: [...defaultTaskStatuses],
  teamMembers: defaultTeamMembers.map((m) => ({ ...m })),
});

export function SiteContentProvider({ children }) {
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
  const [userArticles, setUserArticles] = useState(() => {
    const stored = localStorage.getItem(ARTICLES_KEY);
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch {
        return [];
      }
    }
    return [];
  });

  // 内部空间配置
  const [internalConfig, setInternalConfig] = useState(() => {
    const stored = localStorage.getItem(INTERNAL_CONFIG_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        // 深度合并，确保新增的字段有默认值
        const defaults = getDefaultInternalConfig();
        const merged = {};
        for (const key of Object.keys(defaults)) {
          merged[key] = { ...defaults[key], ...(parsed[key] || {}) };
        }
        return merged;
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

  useEffect(() => {
    localStorage.setItem(CONTENT_KEY, JSON.stringify(content));
  }, [content]);

  useEffect(() => {
    localStorage.setItem(FILTERS_KEY, JSON.stringify(filterOptions));
  }, [filterOptions]);

  useEffect(() => {
    localStorage.setItem(ARTICLES_KEY, JSON.stringify(userArticles));
  }, [userArticles]);

  useEffect(() => {
    localStorage.setItem(INTERNAL_CONFIG_KEY, JSON.stringify(internalConfig));
  }, [internalConfig]);

  useEffect(() => {
    localStorage.setItem(SUGGESTIONS_KEY, JSON.stringify(suggestions));
  }, [suggestions]);

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

  const resetInternalConfig = () => {
    const defaults = getDefaultInternalConfig();
    setInternalConfig(defaults);
    localStorage.setItem(INTERNAL_CONFIG_KEY, JSON.stringify(defaults));
  };

  // 文章管理 CRUD
  const addArticle = (article) => {
    setUserArticles((prev) => [article, ...prev]);
  };

  const updateArticle = (id, updates) => {
    setUserArticles((prev) =>
      prev.map((a) => (a.id === id ? { ...a, ...updates } : a))
    );
  };

  const deleteArticle = (id) => {
    setUserArticles((prev) => prev.filter((a) => a.id !== id));
  };

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

  return (
    <SiteContentContext.Provider value={{
      content, updateContent, resetContent,
      filterOptions, updateFilterOptions, resetFilterOptions,
      userArticles, addArticle, updateArticle, deleteArticle,
      internalConfig, updateInternalConfig, resetInternalConfig,
      suggestions, addSuggestion, updateSuggestion, deleteSuggestion,
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
