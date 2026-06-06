import { useState, useEffect } from 'react';
import { List, X } from 'lucide-react';
import useTocScroll from '../hooks/useTocScroll';
import './EditorToc.css';

/**
 * EditorToc —— 文档编辑器里的「可点击目录」
 *
 * 复用阅读页同款的 useTocScroll：扫描编辑器里的 h1/h2/h3，生成目录，
 * 点击平滑滚动到对应标题并高亮当前章节。与阅读页（MemberSharingDetail /
 * ProcessTemplateDetail）的目录行为保持一致。
 *
 * 编辑页是居中全屏布局，不像阅读页有左侧栏，这里做成右侧浮动、可折叠的面板，
 * 不改动编辑区版面；窄屏自动收成一个小按钮。
 *
 * Props:
 *   editorRef    — 目标 contentEditable 容器 ref
 *   content      — 编辑器当前 HTML（内容变化时重新扫描标题）
 *   scrollOffset — 顶部 sticky 顶栏的高度补偿，默认 64
 */
export default function EditorToc({ editorRef, content, scrollOffset = 64, defaultOpen = true }) {
  // 防抖：编辑过程中不要每个按键都重新扫描标题并往编辑器 DOM 写 id，
  // 否则在 contentEditable 里会扰动光标/滚动，表现为"每次输入窗口往上跳一下"。
  // 停止输入 ~400ms 后再扫描一次目录即可。
  const [debouncedContent, setDebouncedContent] = useState(content);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedContent(content), 400);
    return () => clearTimeout(t);
  }, [content]);

  const { toc, activeTocId, handleTocClick } = useTocScroll({
    contentRef: editorRef,
    renderedContent: debouncedContent,
    headingSelector: 'h1, h2, h3',
    anchorClassName: 'msc-doc-anchor',
    scrollOffset,
  });
  const [open, setOpen] = useState(defaultOpen);

  if (!toc.length) return null;

  return (
    <div className={`etoc ${open ? 'etoc--open' : 'etoc--collapsed'}`}>
      {open ? (
        <nav className="etoc__panel" aria-label="文档目录">
          <div className="etoc__header">
            <List size={14} />
            <span className="etoc__title">目录</span>
            <button
              type="button"
              className="etoc__close"
              onClick={() => setOpen(false)}
              title="收起目录"
              aria-label="收起目录"
            >
              <X size={14} />
            </button>
          </div>
          <div className="etoc__list">
            {toc.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`etoc__item etoc__item--l${item.level} ${activeTocId === item.id ? 'etoc__item--active' : ''}`}
                onClick={() => handleTocClick(item.id)}
                title={item.text}
              >
                <span className="etoc__dot" />
                <span className="etoc__text">{item.text}</span>
              </button>
            ))}
          </div>
        </nav>
      ) : (
        <button
          type="button"
          className="etoc__fab"
          onClick={() => setOpen(true)}
          title="展开文档目录"
          aria-label="展开文档目录"
        >
          <List size={18} />
        </button>
      )}
    </div>
  );
}
