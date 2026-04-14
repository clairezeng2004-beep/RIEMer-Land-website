import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

export default function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    // 使用 instant 行为，覆盖 CSS 的 scroll-behavior: smooth
    // 确保页面跳转时直接定位到顶部，而非平滑滚动上去
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [pathname]);

  return null;
}
