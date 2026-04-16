/**
 * Google Analytics (GA4) 工具模块
 *
 * 使用方法：
 *   import { trackPageView, trackEvent } from '../lib/analytics';
 *
 * 部署前请将 G-XXXXXXXXXX 替换为你的真实 Measurement ID。
 * 同时替换 index.html 中的对应值。
 */

const GA_MEASUREMENT_ID = 'G-XXXXXXXXXX';

/**
 * 安全调用 gtag（防止 gtag 未加载时报错）
 */
function gtag(...args) {
  if (typeof window !== 'undefined' && window.gtag) {
    window.gtag(...args);
  }
}

/**
 * 追踪页面浏览
 * @param {string} path - 页面路径，如 '/articles'
 * @param {string} [title] - 页面标题
 */
export function trackPageView(path, title) {
  gtag('config', GA_MEASUREMENT_ID, {
    page_path: path,
    page_title: title || document.title,
  });
}

/**
 * 追踪自定义事件
 * @param {string} eventName - 事件名称（GA4 推荐使用 snake_case）
 * @param {Object} [params] - 事件参数
 *
 * 常用事件示例：
 *   trackEvent('article_click', { article_id: '1', article_title: '...' })
 *   trackEvent('event_click', { event_id: '1', event_title: '...' })
 *   trackEvent('nav_click', { link: '/articles' })
 *   trackEvent('login', { method: 'email' })
 */
export function trackEvent(eventName, params = {}) {
  gtag('event', eventName, params);
}

/**
 * 追踪外链点击
 * @param {string} url - 外链地址
 * @param {string} [label] - 链接描述
 */
export function trackOutboundLink(url, label) {
  trackEvent('outbound_click', {
    link_url: url,
    link_label: label || url,
  });
}
