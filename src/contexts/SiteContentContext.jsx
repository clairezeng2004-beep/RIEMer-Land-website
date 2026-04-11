import { createContext, useContext, useState, useEffect } from 'react';
import { clubInfo } from '../data/siteData';

const SiteContentContext = createContext(null);

const CONTENT_KEY = 'riemer_site_content';

// 可编辑的内容字段及其默认值
const getDefaultContent = () => ({
  // Hero 区域
  heroTagline: '探索 · 研究 · 交流',
  heroTitle: 'RIEMer Land',
  heroDescription: clubInfo.description,

  // 统计数字
  stats: [...clubInfo.stats],

  // 使命区域
  missionSectionTitle: '我们的使命',
  missions: clubInfo.mission.map((desc, i) => ({
    title: ['学术研究', '知识共享', '创新思维', '社区建设'][i],
    desc,
  })),

  // 文章区域
  articlesSectionTitle: '历史文章',

  // Footer
  footerDescription: clubInfo.description,
  footerEmail: clubInfo.contact.email,
  footerLocation: clubInfo.contact.location,
});

export function SiteContentProvider({ children }) {
  const [content, setContent] = useState(() => {
    const stored = localStorage.getItem(CONTENT_KEY);
    if (stored) {
      try {
        return { ...getDefaultContent(), ...JSON.parse(stored) };
      } catch {
        return getDefaultContent();
      }
    }
    return getDefaultContent();
  });

  useEffect(() => {
    localStorage.setItem(CONTENT_KEY, JSON.stringify(content));
  }, [content]);

  const updateContent = (updates) => {
    setContent((prev) => ({ ...prev, ...updates }));
  };

  const resetContent = () => {
    const defaults = getDefaultContent();
    setContent(defaults);
    localStorage.setItem(CONTENT_KEY, JSON.stringify(defaults));
  };

  return (
    <SiteContentContext.Provider value={{ content, updateContent, resetContent }}>
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
