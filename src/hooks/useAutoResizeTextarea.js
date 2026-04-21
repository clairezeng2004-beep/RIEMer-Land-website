import { useEffect } from 'react';

/**
 * 让 <textarea> 的高度随内容自动增长，不出现内部滚动条。
 *
 * 用法：
 *   const ref = useRef(null);
 *   useAutoResizeTextarea(ref, value, { minHeight: 320 });
 *   <textarea ref={ref} value={value} ... />
 *
 * 原理：将 textarea 的 height 临时置为 "auto"，读取 scrollHeight，再写回 px。
 * 这样无论是粘贴长内容、逐行输入还是窗口缩放，textarea 都能贴合内容。
 *
 * 注意：
 *  - value 必须是受控值；依赖数组里会监听它
 *  - minHeight 指定最小高度（px）——即使内容很少，也不会低于这个高度
 *  - 该 hook 不会给 textarea 设置 maxHeight；如果外层希望"无限增高"，不要再
 *    在 CSS 里对这个 textarea 设 `height` / `max-height` / `flex:1` + 滚动
 */
export default function useAutoResizeTextarea(ref, value, options = {}) {
  const { minHeight = 0 } = options;

  useEffect(() => {
    const el = ref?.current;
    if (!el) return;
    // 先重置才能拿到真实 scrollHeight（否则旧高度会限制 scrollHeight）
    el.style.height = 'auto';
    const next = Math.max(el.scrollHeight, minHeight);
    el.style.height = `${next}px`;
  }, [ref, value, minHeight]);
}
