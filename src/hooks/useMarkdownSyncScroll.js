import { useCallback, useRef, useState } from 'react';

/**
 * useMarkdownSyncScroll —— Markdown 双栏编辑器「可开关」的同步滚动 hook。
 *
 * 为什么抽这个 hook：
 *   项目里至少有 3 处 Markdown 左编辑右预览的入口：
 *     1. MemberSharingCreate（内部分享 - 发布页）
 *     2. ProcessTemplateCreate（流程手册 - 发布页）
 *     3. ProcessTemplateDetail（流程手册 - 详情页的内联编辑态）
 *   原先只有前两处自行实现了 syncScroll，第 3 处没做；
 *   于是用户在不同入口打开 Markdown 编辑时，会看到
 *   "有时能同步滚动、有时不能" 的混乱体验。
 *   把状态 / refs / handlers 集中到这一个 hook 后，任何新增的
 *   双栏编辑入口只要复用即可，再也不会漏做。
 *
 * 用法：
 *   const {
 *     syncScroll,             // 当前是否开启
 *     toggleSyncScroll,       // 切换开关
 *     editorRef,              // 绑给 <textarea>
 *     previewRef,             // 绑给 <div class="...__preview">
 *     handleEditorScroll,     // 绑给 textarea 的 onScroll
 *     handlePreviewScroll,    // 绑给 preview div 的 onScroll
 *   } = useMarkdownSyncScroll();
 *
 * 默认值：
 *   - syncScroll 默认 false，两侧独立滚动。
 *   - 用户显式点按钮开启后才会联动。
 *   （默认开启会频繁打扰正在纯写作的用户，所以默认关闭更温和。）
 */
export default function useMarkdownSyncScroll(initial = false) {
  const [syncScroll, setSyncScroll] = useState(Boolean(initial));

  const editorRef = useRef(null);
  const previewRef = useRef(null);

  /* 互斥锁：同步滚动时 A 的程序化滚动会触发 B 的 onScroll，
   * 如果 B 又去反向同步，就会陷入 A->B->A 抖动循环。
   * 用 ref 记录"当前触发源是谁"，对侧短时内忽略。 */
  const lockRef = useRef(null);

  const syncFromTo = useCallback((src, dst) => {
    if (!src || !dst) return;
    const srcMax = src.scrollHeight - src.clientHeight;
    const dstMax = dst.scrollHeight - dst.clientHeight;
    if (srcMax <= 0 || dstMax <= 0) return;
    // 按比例：即使两侧高度不等，也能把 30% 的进度映射到 30%
    dst.scrollTop = (src.scrollTop / srcMax) * dstMax;
  }, []);

  const handleEditorScroll = useCallback(() => {
    if (!syncScroll) return;
    if (lockRef.current === 'preview') return; // 是 preview 触发的，忽略
    lockRef.current = 'editor';
    syncFromTo(editorRef.current, previewRef.current);
    // 下一帧释放锁；requestAnimationFrame 足以等 scroll 事件回弹结束
    requestAnimationFrame(() => {
      lockRef.current = null;
    });
  }, [syncScroll, syncFromTo]);

  const handlePreviewScroll = useCallback(() => {
    if (!syncScroll) return;
    if (lockRef.current === 'editor') return;
    lockRef.current = 'preview';
    syncFromTo(previewRef.current, editorRef.current);
    requestAnimationFrame(() => {
      lockRef.current = null;
    });
  }, [syncScroll, syncFromTo]);

  const toggleSyncScroll = useCallback(() => {
    setSyncScroll((v) => !v);
  }, []);

  return {
    syncScroll,
    setSyncScroll,
    toggleSyncScroll,
    editorRef,
    previewRef,
    handleEditorScroll,
    handlePreviewScroll,
  };
}
