import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { trackPageView } from '../lib/analytics';

/**
 * 自动追踪 React Router 路由变化，向 GA4 发送页面浏览事件。
 * 在 Router 内部组件（如 AppShell）中调用一次即可。
 */
export default function usePageTracking() {
  const location = useLocation();

  useEffect(() => {
    // 每次路由变化时发送 page_view
    trackPageView(location.pathname + location.search);
  }, [location]);
}
