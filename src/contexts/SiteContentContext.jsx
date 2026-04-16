import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { clubInfo, taskCategories as defaultTaskCategories, taskStatuses as defaultTaskStatuses, teamMembers as defaultTeamMembers, eventsData as defaultEventsData, timelineData as defaultTimelineData } from '../data/siteData';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { fetchArticles as fetchArticlesFromDb, addArticleToDb, updateArticleInDb, deleteArticleFromDb, migrateLocalArticlesToDb } from '../services/articleDbService';

const SiteContentContext = createContext(null);

const CONTENT_KEY = 'riemer_site_content';
const FILTERS_KEY = 'riemer_filter_options';
const ARTICLES_KEY = 'riemer_user_articles';
const INTERNAL_CONFIG_KEY = 'riemer_internal_config';
const SUGGESTIONS_KEY = 'riemer_site_suggestions';
const EVENTS_KEY = 'riemer_site_events';
const TIMELINE_KEY = 'riemer_site_timeline';

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
    sectionLabelAdmin: '管理',
    labelHome: '快捷导航',
    labelNotifications: '消息通知',
    labelDocuments: '文档管理',
    labelTasks: '事项追踪',
    labelProcessTemplates: '流程模板文件',
    labelMemberSharing: '成员内部分享',
    labelArticles: '公众号历史文章归档',
    labelContributions: '成员贡献',
    labelSuggestions: '建设建议',
    labelGuestbook: '访客留言板',
    labelMemberProfiles: '成员通讯录',
    labelGallery: '活动相册',
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
    pageDesc: '了解每位成员的基本信息、去向与兴趣，促进彼此交流',
  },
  // 公众号历史文章页
  internalArticles: {
    pageTitle: '公众号历史文章归档',
    pageDesc: '浏览公众号历史推送内容，回顾与归档',
  },
  // 个人主页
  profile: {
    pageTitle: '个人主页',
    pageDesc: '设置你的昵称、头像和个性签名',
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

  // 用户添加的文章（初始为空，从 Supabase 加载）
  const [userArticles, setUserArticles] = useState([]);
  const [articlesLoaded, setArticlesLoaded] = useState(false);

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
  useEffect(() => {
    let cancelled = false;
    const loadArticles = async () => {
      try {
        const articles = await fetchArticlesFromDb();
        if (!cancelled) {
          setUserArticles(articles);
          setArticlesLoaded(true);
        }
        // 尝试迁移 localStorage 中的旧文章到 Supabase
        const migrated = await migrateLocalArticlesToDb();
        if (migrated > 0 && !cancelled) {
          // 重新加载以包含迁移的数据
          const refreshed = await fetchArticlesFromDb();
          if (!cancelled) setUserArticles(refreshed);
        }
      } catch {
        if (!cancelled) {
          setArticlesLoaded(true);
        }
      }
    };
    loadArticles();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    localStorage.setItem(INTERNAL_CONFIG_KEY, JSON.stringify(internalConfig));
  }, [internalConfig]);

  useEffect(() => {
    localStorage.setItem(SUGGESTIONS_KEY, JSON.stringify(suggestions));
  }, [suggestions]);

  useEffect(() => {
    localStorage.setItem(EVENTS_KEY, JSON.stringify(events));
  }, [events]);

  useEffect(() => {
    localStorage.setItem(TIMELINE_KEY, JSON.stringify(timeline));
  }, [timeline]);

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

  // 文章管理 CRUD（Supabase 优先，localStorage 回退）
  const addArticle = async (article, userId) => {
    // 乐观更新 UI
    setUserArticles((prev) => [article, ...prev]);
    // 异步写入数据库
    const saved = await addArticleToDb(article, userId);
    if (saved && saved.id !== article.id) {
      // 如果数据库返回了新 ID，更新列表
      setUserArticles((prev) =>
        prev.map((a) => (a.id === article.id ? saved : a))
      );
    }
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
    setEvents((prev) => [event, ...prev]);
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
          dbMembers = profiles.map((p, idx) => ({
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

      if (dbMembers.length > 0) {
        setFilterOptions((prev) => ({
          ...prev,
          teamMembers: dbMembers,
        }));
        return { success: true, count: dbMembers.length };
      }

      return { success: false, message: '未找到已授权的成员数据' };
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
      suggestions, addSuggestion, updateSuggestion, deleteSuggestion,
      events, addEvent, updateEvent, deleteEvent,
      timeline, updateTimeline, addTimelineNode, updateTimelineNode, deleteTimelineNode, resetTimeline,
      syncTeamMembersFromDB,
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
