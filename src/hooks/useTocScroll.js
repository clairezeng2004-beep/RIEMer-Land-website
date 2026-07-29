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
 *        b) 全局 document.getElementById，但必须仍属于 contentRef 子树
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
 * @param {'auto'|'window'} [params.scrollContainer='auto'] - 滚动容器策略
 */
export default function useTocScroll({
  contentRef,
  renderedContent,
  headingSelector = 'h1, h2, h3',
  anchorClassName,
  scrollOffset = 80,
  scrollContainer = 'auto',
}) {
  const [toc, setToc] = useState([]); // [{ id, text, level }]
  const [activeTocId, setActiveTocId] = useState('');
  const [tocOpenMobile, setTocOpenMobile] = useState(false);

  const findHeadingInRoot = useCallback((tocId, root = contentRef.current) => {
    if (!tocId) return null;
    let el = null;
    try {
      el = root?.querySelector?.(`#${CSS.escape(tocId)}`) || null;
    } catch {
      el = null;
    }
    if (el) return el;

    const globalEl = document.getElementById(tocId);
    return root && globalEl && root.contains(globalEl) ? globalEl : null;
  }, [contentRef]);

  const findScrollParent = useCallback((node) => {
    if (scrollContainer === 'window') return null;
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
  }, [scrollContainer]);

  const getHeadingTop = useCallback((heading, scrollParent) => {
    if (scrollParent) {
      const containerRect = scrollParent.getBoundingClientRect();
      const headingRect = heading.getBoundingClientRect();
      return scrollParent.scrollTop + (headingRect.top - containerRect.top);
    }
    return heading.getBoundingClientRect().top + window.pageYOffset;
  }, []);

  const pickActiveHeading = useCallback((headings, scrollParent) => {
    if (!headings.length) return null;
    const markerViewportY = scrollParent
      ? scrollParent.getBoundingClientRect().top + scrollOffset + 8
      : scrollOffset + 8;

    const visibleHeadings = headings
      .map((heading) => ({ heading, rect: heading.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width > 0 || rect.height > 0)
      .sort((a, b) => a.rect.top - b.rect.top);

    if (!visibleHeadings.length) return null;

    const viewportHeight = scrollParent?.clientHeight || window.innerHeight || 0;
    const markerBottom = scrollParent
      ? scrollParent.getBoundingClientRect().bottom
      : viewportHeight;
    const readableTop = Math.min(markerViewportY, markerBottom - 1);

    let active = visibleHeadings[0].heading;
    for (const { heading, rect } of visibleHeadings) {
      if (rect.top <= readableTop) active = heading;
      else break;
    }
    return active;
  }, [scrollOffset]);

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
    const root = contentRef.current;
    const headings = toc
      .map((t) => findHeadingInRoot(t.id, root))
      .filter(Boolean);
    if (!headings.length) return;

    let ticking = false;

    const updateActive = () => {
      ticking = false;
      const scrollParent = findScrollParent(root);
      const rootRect = root.getBoundingClientRect();
      const viewportBottom = scrollParent
        ? scrollParent.getBoundingClientRect().bottom
        : window.innerHeight || 0;
      if (rootRect.height <= 0 || rootRect.top >= viewportBottom) return;
      const active = pickActiveHeading(headings, scrollParent);
      if (active?.id) setActiveTocId(active.id);
    };

    const requestUpdate = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(updateActive);
    };

    const scrollTarget = findScrollParent(root) || window;
    updateActive();
    const timers = [120, 360, 900].map((ms) => window.setTimeout(requestUpdate, ms));
    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(requestUpdate)
      : null;
    try { resizeObserver?.observe(root); } catch { /* ignore */ }
    const imgs = Array.from(root.querySelectorAll('img'));
    imgs.forEach((img) => {
      img.addEventListener('load', requestUpdate, { once: true });
      img.addEventListener('error', requestUpdate, { once: true });
    });
    // 直接监听实际滚动目标，避免部分浏览器不向 window 捕获阶段分发元素滚动事件。
    scrollTarget.addEventListener('scroll', requestUpdate, { passive: true });
    if (scrollTarget !== window) {
      window.addEventListener('scroll', requestUpdate, { passive: true });
    }
    window.addEventListener('resize', requestUpdate);
    return () => {
      timers.forEach((id) => window.clearTimeout(id));
      resizeObserver?.disconnect();
      imgs.forEach((img) => {
        img.removeEventListener('load', requestUpdate);
        img.removeEventListener('error', requestUpdate);
      });
      scrollTarget.removeEventListener('scroll', requestUpdate);
      if (scrollTarget !== window) {
        window.removeEventListener('scroll', requestUpdate);
      }
      window.removeEventListener('resize', requestUpdate);
    };
  }, [toc, contentRef, findHeadingInRoot, findScrollParent, pickActiveHeading]);

  /* 3) 点击目录跳转 —— 强鲁棒版本 */
  const handleTocClick = useCallback(
    (tocId) => {
      const root = contentRef.current;

      /* ========== 3.1 找标题元素（三级兜底） ========== */
      let el = findHeadingInRoot(tocId, root);
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

      const wasMobileDrawerOpen = tocOpenMobile;
      setActiveTocId(tocId);

      const syncActiveToCurrentPosition = () => {
        const scrollParent = findScrollParent(contentRef.current);
        const root = contentRef.current;
        const headings = toc
          .map((t) => findHeadingInRoot(t.id, root))
          .filter(Boolean);
        if (!headings.length) return;
        const active = pickActiveHeading(headings, scrollParent);
        if (active?.id) setActiveTocId(active.id);
      };

      const scrollInstantly = (targetTop, scrollParent) => {
        const top = Math.max(0, targetTop);
        if (scrollParent) {
          const previous = scrollParent.style.scrollBehavior;
          scrollParent.style.scrollBehavior = 'auto';
          scrollParent.scrollTo({ top, behavior: 'instant' });
          scrollParent.style.scrollBehavior = previous;
          return;
        }

        const previousHtml = document.documentElement.style.scrollBehavior;
        const previousBody = document.body.style.scrollBehavior;
        document.documentElement.style.scrollBehavior = 'auto';
        document.body.style.scrollBehavior = 'auto';
        window.scrollTo({ top, behavior: 'instant' });
        document.documentElement.style.scrollBehavior = previousHtml;
        document.body.style.scrollBehavior = previousBody;
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
            scrollInstantly(target, scrollParent);
          } else {
            const top =
              el.getBoundingClientRect().top + window.pageYOffset - scrollOffset;
            scrollInstantly(top, null);
          }
        } catch {
          // 极老浏览器兜底
          const top =
            el.getBoundingClientRect().top + window.pageYOffset - scrollOffset;
          window.scrollTo(0, Math.max(0, top));
        }

        syncActiveToCurrentPosition();
        requestAnimationFrame(syncActiveToCurrentPosition);
      };

      const scheduleScroll = () => {
        const rect = el.getBoundingClientRect();
        // 还没布局完成（例如内容区图片正在撑开高度），下一帧再跳一次
        if (rect.top === 0 && rect.height === 0) {
          requestAnimationFrame(() => {
            doScroll();
            if (wasMobileDrawerOpen) setTocOpenMobile(false);
          });
        } else {
          doScroll();
          if (wasMobileDrawerOpen) setTocOpenMobile(false);
        }
      };

      /* ========== 3.4 移动端单次跳转 ==========
       * 先滚动，再关闭 fixed 抽屉，避免抽屉卸载重排和页面滚动拆成两次视觉变化。
       * 之前"先关抽屉，再等两帧滚动"在手机端会让 sticky 顶栏明显闪一下。 */
      scheduleScroll();

      try {
        document.activeElement?.blur?.();
      } catch {
        /* ignore */
      }
    },
    [
      toc,
      contentRef,
      headingSelector,
      anchorClassName,
      scrollOffset,
      tocOpenMobile,
      findHeadingInRoot,
      findScrollParent,
      getHeadingTop,
      pickActiveHeading,
    ],
  );

  return {
    toc,
    activeTocId,
    tocOpenMobile,
    setTocOpenMobile,
    handleTocClick,
  };
}
