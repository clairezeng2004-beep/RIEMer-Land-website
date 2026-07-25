import { useRef, useState, useEffect } from 'react';
import { List, X } from 'lucide-react';
import useTocScroll from '../hooks/useTocScroll';
import './EditorToc.css';

const TOC_POSITION_KEY = 'riemer_editor_toc_position';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * EditorToc —— 文档编辑器里的「可点击目录」
 *
 * 复用阅读页同款的 useTocScroll：扫描编辑器里的 h1/h2/h3，生成目录，
 * 点击平滑滚动到对应标题并高亮当前章节。与阅读页（MemberSharingDetail /
 * ProcessTemplateDetail）的目录行为保持一致。
 *
 * 编辑页是居中全屏布局，不像阅读页有左侧栏，这里做成固定侧边、可折叠的面板，
 * 不改动编辑区版面；窄屏自动收成一个小按钮。
 *
 * Props:
 *   editorRef    — 目标 contentEditable 容器 ref
 *   content      — 编辑器当前 HTML（内容变化时重新扫描标题）
 *   scrollOffset — 顶部 sticky 顶栏的高度补偿，默认 64
 */
export default function EditorToc({ editorRef, content, scrollOffset = 144, defaultOpen = true }) {
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
    scrollContainer: 'window',
  });
  const [open, setOpen] = useState(defaultOpen);
  const rootRef = useRef(null);
  const dragRef = useRef(null);
  const [dragPos, setDragPos] = useState(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(TOC_POSITION_KEY) || 'null');
      if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) return saved;
    } catch {
      /* ignore */
    }
    return null;
  });
  const [dragging, setDragging] = useState(false);

  const persistPosition = (next) => {
    setDragPos(next);
    try {
      window.localStorage.setItem(TOC_POSITION_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  const startDrag = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    if (e.target?.closest?.('button:not(.etoc__fab)')) return;
    const root = rootRef.current;
    if (!root) return;
    const rect = root.getBoundingClientRect();
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startLeft: rect.left,
      startTop: rect.top,
      width: rect.width,
      height: rect.height,
      moved: false,
    };
    setDragging(true);
    root.setPointerCapture?.(e.pointerId);
  };

  const moveDrag = (e) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (Math.abs(dx) + Math.abs(dy) > 8) drag.moved = true;
    const margin = 8;
    const next = {
      left: clamp(drag.startLeft + dx, margin, window.innerWidth - drag.width - margin),
      top: clamp(drag.startTop + dy, margin, window.innerHeight - drag.height - margin),
    };
    setDragPos(next);
  };

  const endDrag = (e) => {
    const drag = dragRef.current;
    if (!drag) return;
    const root = rootRef.current;
    root?.releasePointerCapture?.(e.pointerId);
    const rect = root?.getBoundingClientRect();
    if (rect) persistPosition({
      left: clamp(rect.left, 8, window.innerWidth - rect.width - 8),
      top: clamp(rect.top, 8, window.innerHeight - rect.height - 8),
    });
    if (!open && !drag.moved) setOpen(true);
    window.setTimeout(() => {
      dragRef.current = null;
      setDragging(false);
    }, 0);
  };

  useEffect(() => {
    if (!dragPos || !rootRef.current) return;
    const rect = rootRef.current.getBoundingClientRect();
    const next = {
      left: clamp(dragPos.left, 8, window.innerWidth - rect.width - 8),
      top: clamp(dragPos.top, 8, window.innerHeight - rect.height - 8),
    };
    if (next.left !== dragPos.left || next.top !== dragPos.top) setDragPos(next);
  }, [dragPos, open]);

  if (!toc.length) return null;

  return (
    <div
      ref={rootRef}
      className={`etoc ${open ? 'etoc--open' : 'etoc--collapsed'} ${dragging ? 'etoc--dragging' : ''}`}
      style={dragPos ? { left: `${dragPos.left}px`, top: `${dragPos.top}px`, right: 'auto', bottom: 'auto' } : undefined}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {open ? (
        <nav className="etoc__panel" aria-label="文档目录">
          <div className="etoc__header" onPointerDown={startDrag} title="拖动目录">
            <button
              type="button"
              className="etoc__title-toggle"
              onClick={() => setOpen(false)}
              title="收起目录"
              aria-label="收起目录"
            >
              <List size={14} />
              <span className="etoc__title">目录</span>
            </button>
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
                {item.level > 1 && <span className="etoc__dot" />}
                <span className="etoc__text">{item.text}</span>
              </button>
            ))}
          </div>
        </nav>
      ) : (
        <button
          type="button"
          className="etoc__fab"
          onPointerDown={startDrag}
          onClick={() => {
            if (dragRef.current?.moved || open) return;
            setOpen(true);
          }}
          title="展开文档目录"
          aria-label="展开文档目录"
        >
          <List size={18} />
        </button>
      )}
    </div>
  );
}
