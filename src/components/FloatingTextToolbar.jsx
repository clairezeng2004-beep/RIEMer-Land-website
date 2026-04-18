import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Heading1,
  Heading2,
  Heading3,
  Quote,
  Bold,
  Italic,
  Underline,
  Eraser,
} from 'lucide-react';
import './FloatingTextToolbar.css';

/**
 * FloatingTextToolbar
 * 在指定的 contentEditable 元素上监听文字选区，选中非空文字时
 * 在选区上方弹出一个悬浮工具栏，支持：
 *   H1 / H2 / H3 / 引用 / 加粗 / 斜体 / 下划线 / 清除格式
 *
 * Props:
 *   editorRef  — ref 指向 contentEditable 容器（必填）
 *   onChange   — 应用格式后回调，参数为最新 innerHTML（可选）
 */
export default function FloatingTextToolbar({ editorRef, onChange }) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [active, setActive] = useState({}); // { bold, italic, underline, h1, h2, h3, blockquote }
  const toolbarRef = useRef(null);

  /* ---- 判断选区是否在编辑器内 ---- */
  const selectionInsideEditor = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return false;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return false;
    const range = sel.getRangeAt(0);
    const { commonAncestorContainer } = range;
    const node =
      commonAncestorContainer.nodeType === 1
        ? commonAncestorContainer
        : commonAncestorContainer.parentElement;
    return !!node && editor.contains(node);
  }, [editorRef]);

  /* ---- 计算激活状态（H1/H2/H3/引用/加粗/...） ---- */
  const detectActive = useCallback(() => {
    const next = {
      bold: document.queryCommandState('bold'),
      italic: document.queryCommandState('italic'),
      underline: document.queryCommandState('underline'),
      h1: false,
      h2: false,
      h3: false,
      blockquote: false,
    };
    try {
      const blockTag = (document.queryCommandValue('formatBlock') || '').toLowerCase();
      if (blockTag === 'h1') next.h1 = true;
      else if (blockTag === 'h2') next.h2 = true;
      else if (blockTag === 'h3') next.h3 = true;
      else if (blockTag === 'blockquote') next.blockquote = true;
    } catch {
      /* 部分浏览器不支持 formatBlock value，跳过 */
    }
    // blockquote 兼容检测：往上找最近的 blockquote 祖先
    if (!next.blockquote) {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        let n =
          sel.anchorNode && sel.anchorNode.nodeType === 1
            ? sel.anchorNode
            : sel.anchorNode?.parentElement;
        const editor = editorRef.current;
        while (n && n !== editor) {
          if (n.tagName === 'BLOCKQUOTE') {
            next.blockquote = true;
            break;
          }
          n = n.parentElement;
        }
      }
    }
    setActive(next);
  }, [editorRef]);

  /* ---- 根据选区矩形更新工具栏位置 ---- */
  const updatePosition = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const rects = range.getClientRects();
    const rect = rects.length > 0 ? rects[0] : range.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) return;

    // 工具栏默认宽度估计 (实际由内容决定)
    const tbWidth = toolbarRef.current?.offsetWidth || 360;
    const tbHeight = toolbarRef.current?.offsetHeight || 40;
    const gap = 8;

    // fixed 定位直接用 viewport 坐标
    // 默认放选区上方；若离顶部太近则放下方
    let top = rect.top - tbHeight - gap;
    if (top < 8) {
      top = rect.bottom + gap;
    }
    let left = rect.left + rect.width / 2 - tbWidth / 2;
    const minLeft = 8;
    const maxLeft = window.innerWidth - tbWidth - 8;
    if (left < minLeft) left = minLeft;
    if (left > maxLeft) left = maxLeft;

    setPos({ top, left });
  }, []);

  /* ---- 选区变化时重新评估显隐/位置/激活态 ---- */
  const refresh = useCallback(() => {
    if (!selectionInsideEditor()) {
      setVisible(false);
      return;
    }
    setVisible(true);
    detectActive();
    // 位置需要等 DOM 渲染后获得宽高，用 rAF
    requestAnimationFrame(updatePosition);
  }, [detectActive, selectionInsideEditor, updatePosition]);

  useEffect(() => {
    const onSelectionChange = () => refresh();
    const onScrollOrResize = () => {
      if (visible) updatePosition();
    };
    document.addEventListener('selectionchange', onSelectionChange);
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [refresh, updatePosition, visible]);

  // 工具栏首次渲染后再矫正一次位置（拿到真实宽度）
  useLayoutEffect(() => {
    if (visible) updatePosition();
  }, [visible, updatePosition]);

  /* ---- 应用命令 ---- */
  const fireChange = useCallback(() => {
    const editor = editorRef.current;
    if (editor && onChange) onChange(editor.innerHTML);
  }, [editorRef, onChange]);

  const applyInline = useCallback(
    (cmd) => {
      document.execCommand(cmd, false);
      detectActive();
      fireChange();
    },
    [detectActive, fireChange],
  );

  const applyBlock = useCallback(
    (tag) => {
      // 点同一个已激活块级格式 → 切回普通段落
      const isActive =
        (tag === 'h1' && active.h1) ||
        (tag === 'h2' && active.h2) ||
        (tag === 'h3' && active.h3) ||
        (tag === 'blockquote' && active.blockquote);
      const target = isActive ? 'p' : tag;
      // 大多数浏览器要求用尖括号写法
      document.execCommand('formatBlock', false, `<${target}>`);
      // Firefox 老版本需要不带尖括号——兼容一下
      detectActive();
      fireChange();
    },
    [active, detectActive, fireChange],
  );

  const clearFormat = useCallback(() => {
    document.execCommand('removeFormat', false);
    // removeFormat 不处理块级，块级手动降回 p
    document.execCommand('formatBlock', false, '<p>');
    detectActive();
    fireChange();
  }, [detectActive, fireChange]);

  if (!visible) return null;

  // 点击按钮时阻止默认，避免选区丢失
  const stop = (e) => e.preventDefault();

  const Btn = ({ onClick, title, activeFlag, children }) => (
    <button
      type="button"
      className={`ftt__btn${activeFlag ? ' ftt__btn--active' : ''}`}
      onMouseDown={stop}
      onClick={onClick}
      title={title}
    >
      {children}
    </button>
  );

  return (
    <div
      ref={toolbarRef}
      className="ftt"
      style={{ top: `${pos.top}px`, left: `${pos.left}px` }}
      onMouseDown={stop}
    >
      <Btn onClick={() => applyBlock('h1')} title="一级标题" activeFlag={active.h1}>
        <Heading1 size={16} />
      </Btn>
      <Btn onClick={() => applyBlock('h2')} title="二级标题" activeFlag={active.h2}>
        <Heading2 size={16} />
      </Btn>
      <Btn onClick={() => applyBlock('h3')} title="三级标题" activeFlag={active.h3}>
        <Heading3 size={16} />
      </Btn>
      <span className="ftt__sep" />
      <Btn
        onClick={() => applyBlock('blockquote')}
        title="引用"
        activeFlag={active.blockquote}
      >
        <Quote size={16} />
      </Btn>
      <span className="ftt__sep" />
      <Btn onClick={() => applyInline('bold')} title="加粗 (Ctrl/Cmd+B)" activeFlag={active.bold}>
        <Bold size={16} />
      </Btn>
      <Btn
        onClick={() => applyInline('italic')}
        title="斜体 (Ctrl/Cmd+I)"
        activeFlag={active.italic}
      >
        <Italic size={16} />
      </Btn>
      <Btn
        onClick={() => applyInline('underline')}
        title="下划线 (Ctrl/Cmd+U)"
        activeFlag={active.underline}
      >
        <Underline size={16} />
      </Btn>
      <span className="ftt__sep" />
      <Btn onClick={clearFormat} title="清除格式">
        <Eraser size={16} />
      </Btn>
    </div>
  );
}
