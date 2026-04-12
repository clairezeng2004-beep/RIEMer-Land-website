import { createContext, useContext, useState, useEffect } from 'react';
import { clubInfo, taskCategories as defaultTaskCategories, taskStatuses as defaultTaskStatuses, teamMembers as defaultTeamMembers } from '../data/siteData';

const SiteContentContext = createContext(null);

const CONTENT_KEY = 'riemer_site_content';
const FILTERS_KEY = 'riemer_filter_options';

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

  useEffect(() => {
    localStorage.setItem(CONTENT_KEY, JSON.stringify(content));
  }, [content]);

  useEffect(() => {
    localStorage.setItem(FILTERS_KEY, JSON.stringify(filterOptions));
  }, [filterOptions]);

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

  return (
    <SiteContentContext.Provider value={{
      content, updateContent, resetContent,
      filterOptions, updateFilterOptions, resetFilterOptions,
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
