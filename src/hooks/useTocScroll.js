import { useCallback, useEffect, useState } from 'react';

/**
 * useTocScroll —— 文章 / 文档详情页的「目录导航」公共逻辑。
 *
 * 此前 MemberSharingDetail / ProcessTemplateDetail 各自实现了一份，
 * 行为逐渐漂移：一个有「按文本内容匹配」的兜底，另一个没有；
 * 结果：某些情况下点目录没反应（"仍然不能跳转对应位置"）。
 * 下沉到公共 hook 后，任何详情页都走同一套强鲁棒实现。
 *
 * 这里的"强鲁棒"包括：
 *   1. 标题 id 查找三级兜底：
 *        a) contentRef 子树里 querySelector（用 CSS.escape 处理数字/中文开头）
 *        b) 全局 document.getElementById
 *        c) 按 toc 里的 text 在子树里按文本内容重找；找到后把 id 补回去
 *   2. getBoundingClientRect().top === 0 时（元素尚未布局/图片还在撑开高度）
 *      用 requestAnimationFrame 再取一次 rect，避免跳到 0
 *   3. 滚动容器自动探测（overflow-y: auto/scroll 的最近祖先）；
 *      探测不到就退回 window。兼容"内部 overflow 容器"和"window 滚动"两种布局。
 *
 * 约定 CSS 类名由调用方决定（因为现有样式表用的是 msd-xxx / ptd-xxx 不同前缀），
 * hook 只负责：状态管理 + 跳转逻辑。
 *
 * @param {object} params
 * @param {React.RefObject<HTMLElement>} params.contentRef - 文章正文 DOM 根
 * @param {string} params.renderedContent - 已渲染的 HTML（用于触发标题重扫描）
 * @param {string} params.headingSelector - 提取哪些标题，默认 'h1, h2, h3'
 * @param {string} [params.anchorClassName] - 给标题元素加的 class（便于 CSS 设
 *                                            scroll-margin-top），可选
 * @param {number} [params.scrollOffset=80] - 顶部 sticky topbar 的高度补偿
 */
export default function useTocScroll({
  contentRef,
  renderedContent,
  headingSelector = 'h1, h2, h3',
  anchorClassName,
  scrollOffset = 80,
}) {
  const [toc, setToc] = useState([]); // [{ id, text, level }]
  const [activeTocId, setActiveTocId] = useState('');
  const [tocOpenMobile, setTocOpenMobile] = useState(false);

  /* 1) 提取标题并打 id */
  useEffect(() => {
    if (!contentRef.current) return;
    const root = contentRef.current;
    const headings = root.querySelectorAll(headingSelector);
    const items = [];
    const slugCount = {};
    headings.forEach((el, idx) => {
      const raw = (el.textContent || '').trim();
      if (!raw) return;
      let slug = raw
        .toLowerCase()
        .replace(/[\s\u3000]+/g, '-')
        .replace(/[^\w\u4e00-\u9fa5-]/g, '')
        .slice(0, 50) || `heading-${idx}`;
      if (slugCount[slug]) {
        slugCount[slug] += 1;
        slug = `${slug}-${slugCount[slug]}`;
      } else {
        slugCount[slug] = 1;
      }
      // 只在确有变化时才写 DOM：在编辑器（contentEditable）里反复改写
      // id 会扰动光标/滚动；read 页静态内容也无谓重复写。
      if (el.id !== slug) el.id = slug;
      if (anchorClassName && !el.classList.contains(anchorClassName)) {
        el.classList.add(anchorClassName);
      }
      items.push({ id: slug, text: raw, level: Number(el.tagName.substring(1)) });
    });
    setToc(items);
    setActiveTocId(items[0]?.id || '');
  }, [renderedContent, contentRef, headingSelector, anchorClassName]);

  /* 2) 滚动时高亮当前章节 */
  useEffect(() => {
    if (!toc.length || !contentRef.current) return;
    const headings = toc
      .map((t) => document.getElementById(t.id))
      .filter(Boolean);
    if (!headings.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort(
            (a, b) =>
              a.target.getBoundingClientRect().top - b.target.getBoundingClientRect().top,
          );
        if (visible[0]) setActiveTocId(visible[0].target.id);
      },
      { rootMargin: '-80px 0px -70% 0px', threshold: 0 },
    );
    headings.forEach((h) => observer.observe(h));
    return () => observer.disconnect();
  }, [toc, contentRef]);

  /* 3) 点击目录跳转 —— 强鲁棒版本 */
  const handleTocClick = useCallback(
    (tocId) => {
      const root = contentRef.current;

      /* ========== 3.1 找标题元素（三级兜底） ========== */
      let el = null;
      // (a) 子树内 querySelector，CSS.escape 处理数字/中文开头 id
      try {
        el = root && root.querySelector(`#${CSS.escape(tocId)}`);
      } catch {
        el = null;
      }
      // (b) 全局 getElementById（即使子树没挂上也能找）
      if (!el) el = document.getElementById(tocId);
      // (c) 按文本内容重找：React 重渲染 dangerouslySetInnerHTML 时 id 会被清掉
      if (!el && root) {
        const item = toc.find((t) => t.id === tocId);
        if (item) {
          const headings = Array.from(root.querySelectorAll(headingSelector));
          el =
            headings.find((h) => (h.textContent || '').trim() === item.text) || null;
          if (el && !el.id) el.id = tocId;
          if (el && anchorClassName) el.classList.add(anchorClassName);
        }
      }
      if (!el) {
        // 开发环境下给一条日志，便于定位
        if (typeof import.meta !== 'undefined' && import.meta?.env?.DEV) {
          // eslint-disable-next-line no-console
          console.warn('[useTocScroll] 未找到对应标题元素：', tocId);
        }
        return;
      }

      /* ========== 3.2 探测真实滚动容器 ========== */
      const findScrollParent = (node) => {
        let p = node?.parentElement;
        while (p && p !== document.body) {
          const style = window.getComputedStyle(p);
          const oy = style.overflowY;
          if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight) {
            return p;
          }
          p = p.parentElement;
        }
        return null;
      };

      /* ========== 3.3 执行滚动；rect 为 0 时用 rAF 再试一次 ========== */
      const doScroll = () => {
        const scrollParent = findScrollParent(el);
        try {
          if (scrollParent) {
            const containerRect = scrollParent.getBoundingClientRect();
            const elRect = el.getBoundingClientRect();
            const target =
              scrollParent.scrollTop + (elRect.top - containerRect.top) - scrollOffset;
            scrollParent.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
          } else {
            const top =
              el.getBoundingClientRect().top + window.pageYOffset - scrollOffset;
            window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
          }
        } catch {
          // 极老浏览器兜底
          const top =
            el.getBoundingClientRect().top + window.pageYOffset - scrollOffset;
          window.scrollTo(0, Math.max(0, top));
        }
      };

      const rect = el.getBoundingClientRect();
      // 还没布局完成（例如内容区图片正在撑开高度），下一帧再跳一次
      if (rect.top === 0 && rect.height === 0) {
        requestAnimationFrame(doScroll);
      } else {
        doScroll();
      }

      /* ========== 3.4 写 hash + 更新状态 ========== */
      try {
        window.history.replaceState(null, '', `#${tocId}`);
      } catch {
        /* ignore */
      }
      setActiveTocId(tocId);
      setTocOpenMobile(false);
    },
    [toc, contentRef, headingSelector, anchorClassName, scrollOffset],
  );

  return {
    toc,
    activeTocId,
    tocOpenMobile,
    setTocOpenMobile,
    handleTocClick,
  };
}
