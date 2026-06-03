import { useLayoutEffect } from 'react';

/**
 * 让同一视觉行内的标题（或任意元素）高度对齐，并随屏幕宽度变化按行重新计算。
 *
 * 解决的问题：CSS 网格里，若用固定 min-height 给所有卡片预留两行标题，
 * 当列数变化（如 3 列缩到 2 列）时，单行标题的卡片会仍然占两行高度。
 * 这里改为「按当前实际所在行分组，取该行最高的标题作为该行统一高度」，
 * 因此只有当同一行里确有换行标题时，其它卡片才跟着多留行高。
 *
 * @param {React.RefObject<HTMLElement>} containerRef 网格容器
 * @param {string} selector 需要对齐的子元素选择器（如 '.featured__title'）
 * @param {Array} deps 数据依赖（卡片数量变化时重新计算）
 */
export function useEqualTitleHeights(containerRef, selector, deps = []) {
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let lastWidth = -1;

    const equalize = () => {
      const els = Array.from(container.querySelectorAll(selector));
      if (!els.length) return;

      // 先清掉旧的内联高度，按自然高度测量
      els.forEach((el) => { el.style.minHeight = '0px'; });

      // 按 offsetTop 分组（同一行的元素顶部对齐）
      const rows = new Map();
      els.forEach((el) => {
        const key = Math.round(el.offsetTop);
        if (!rows.has(key)) rows.set(key, []);
        rows.get(key).push(el);
      });

      // 每行取最高，统一设置
      rows.forEach((group) => {
        const max = Math.max(...group.map((el) => el.offsetHeight));
        group.forEach((el) => { el.style.minHeight = `${max}px`; });
      });
    };

    equalize();

    // 仅在容器宽度变化时重算（避免设置 min-height 触发的高度变化造成死循环）
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0].contentRect.width);
      if (w !== lastWidth) {
        lastWidth = w;
        equalize();
      }
    });
    ro.observe(container);

    // 网络字体加载完成后高度可能变化，再校准一次
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(equalize).catch(() => {});
    }

    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
