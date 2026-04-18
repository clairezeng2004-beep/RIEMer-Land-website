import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Heading1, Heading2, Heading3, Quote, Bold } from 'lucide-react';
import './FloatingTextToolbar.css';

/**
 * FloatingTextToolbar
 * 两种模式：
 *   - mode="rich" (默认)：在 contentEditable 编辑器上根据选区弹工具栏，走 document.execCommand
 *   - mode="markdown"：在 <textarea> 上根据选区弹工具栏，对选中区间插入 Markdown 语法
 *
 * 仅保留以下五个格式化能力：
 *   一级标题 / 二级标题 / 三级标题 / 引用 / 加粗
 *
 * Props:
 *   mode        — 'rich' | 'markdown'，默认 'rich'
 *   editorRef   — rich: contentEditable 容器 ref；markdown: textarea ref
 *   value       — markdown 模式下 textarea 当前值（仅用于 applyMarkdown 读取，可省略）
 *   onChange    — rich: (html) => void；markdown: (nextValue, selection) => void
 */

export default function FloatingTextToolbar({
  editorRef,
  onChange,
  mode = 'rich',
}) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [active, setActive] = useState({});
  const toolbarRef = useRef(null);
  const isMarkdown = mode === 'markdown';

  /* =================================================================
   * 共用：位置计算（从一个矩形算出工具栏坐标）
   * ================================================================= */
  const placeAt = useCallback((rect) => {
    if (!rect || (rect.width === 0 && rect.height === 0)) return;
    const tbWidth = toolbarRef.current?.offsetWidth || 240;
    const tbHeight = toolbarRef.current?.offsetHeight || 40;
    const gap = 8;
    let top = rect.top - tbHeight - gap;
    if (top < 8) top = rect.bottom + gap;
    let left = rect.left + rect.width / 2 - tbWidth / 2;
    const minLeft = 8;
    const maxLeft = window.innerWidth - tbWidth - 8;
    if (left < minLeft) left = minLeft;
    if (left > maxLeft) left = maxLeft;
    setPos({ top, left });
  }, []);

  /* =================================================================
   * 富文本模式的选区检测与位置
   * ================================================================= */
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

  const detectActiveRich = useCallback(() => {
    const next = {
      bold: document.queryCommandState('bold'),
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
      /* 部分浏览器不支持 formatBlock value */
    }
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

  const updatePositionRich = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const rects = range.getClientRects();
    const rect = rects.length > 0 ? rects[0] : range.getBoundingClientRect();
    placeAt(rect);
  }, [placeAt]);

  /* =================================================================
   * Markdown 模式：textarea 选区检测 + 位置
   * 通过隐藏的"镜像 div"定位选区起点的屏幕坐标
   * ================================================================= */
  const textareaHasSelection = useCallback(() => {
    const ta = editorRef.current;
    if (!ta) return false;
    const activeEl = document.activeElement;
    const isFocused = activeEl === ta;
    if (!isFocused) return false;
    return ta.selectionStart !== ta.selectionEnd;
  }, [editorRef]);

  const getTextareaSelectionRect = useCallback(() => {
    const ta = editorRef.current;
    if (!ta) return null;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    if (start === end) return null;

    const style = window.getComputedStyle(ta);
    const mirror = document.createElement('div');
    const propsToCopy = [
      'boxSizing', 'width', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
      'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
      'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing',
      'lineHeight', 'textTransform', 'textIndent', 'whiteSpace', 'wordWrap',
      'wordBreak', 'tabSize',
    ];
    propsToCopy.forEach((p) => { mirror.style[p] = style[p]; });
    mirror.style.position = 'absolute';
    mirror.style.top = '0';
    mirror.style.left = '-9999px';
    mirror.style.visibility = 'hidden';
    mirror.style.overflow = 'hidden';
    mirror.style.whiteSpace = 'pre-wrap';
    mirror.style.wordWrap = 'break-word';

    const before = ta.value.substring(0, start);
    const middle = ta.value.substring(start, end);

    const beforeNode = document.createTextNode(before);
    const midSpan = document.createElement('span');
    midSpan.textContent = middle || '\u200b';
    const afterNode = document.createTextNode(ta.value.substring(end) || '\u200b');

    mirror.appendChild(beforeNode);
    mirror.appendChild(midSpan);
    mirror.appendChild(afterNode);
    document.body.appendChild(mirror);

    const taRect = ta.getBoundingClientRect();
    const spanRect = midSpan.getBoundingClientRect();
    const mirrorRect = mirror.getBoundingClientRect();

    const top = taRect.top + (spanRect.top - mirrorRect.top) - ta.scrollTop;
    const left = taRect.left + (spanRect.left - mirrorRect.left) - ta.scrollLeft;
    const width = spanRect.width;
    const height = spanRect.height;

    document.body.removeChild(mirror);

    return { top, left, width, height, right: left + width, bottom: top + height };
  }, [editorRef]);

  const detectActiveMarkdown = useCallback(() => {
    setActive({});
  }, []);

  const updatePositionMarkdown = useCallback(() => {
    const rect = getTextareaSelectionRect();
    if (rect) placeAt(rect);
  }, [getTextareaSelectionRect, placeAt]);

  /* =================================================================
   * 统一 refresh
   * ================================================================= */
  const refresh = useCallback(() => {
    if (isMarkdown) {
      if (!textareaHasSelection()) {
        setVisible(false);
        return;
      }
      setVisible(true);
      detectActiveMarkdown();
      requestAnimationFrame(updatePositionMarkdown);
    } else {
      if (!selectionInsideEditor()) {
        setVisible(false);
        return;
      }
      setVisible(true);
      detectActiveRich();
      requestAnimationFrame(updatePositionRich);
    }
  }, [
    isMarkdown,
    selectionInsideEditor, detectActiveRich, updatePositionRich,
    textareaHasSelection, detectActiveMarkdown, updatePositionMarkdown,
  ]);

  useEffect(() => {
    const onSelectionChange = () => refresh();
    const onScrollOrResize = () => {
      if (visible) {
        if (isMarkdown) updatePositionMarkdown();
        else updatePositionRich();
      }
    };
    document.addEventListener('selectionchange', onSelectionChange);
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);

    const ta = isMarkdown ? editorRef.current : null;
    if (ta) {
      ta.addEventListener('select', onSelectionChange);
      ta.addEventListener('keyup', onSelectionChange);
      ta.addEventListener('mouseup', onSelectionChange);
      ta.addEventListener('blur', () => {
        setTimeout(() => {
          const act = document.activeElement;
          if (!toolbarRef.current || !toolbarRef.current.contains(act)) {
            if (ta.selectionStart === ta.selectionEnd) setVisible(false);
          }
        }, 50);
      });
    }

    return () => {
      document.removeEventListener('selectionchange', onSelectionChange);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
      if (ta) {
        ta.removeEventListener('select', onSelectionChange);
        ta.removeEventListener('keyup', onSelectionChange);
        ta.removeEventListener('mouseup', onSelectionChange);
      }
    };
  }, [refresh, updatePositionMarkdown, updatePositionRich, visible, isMarkdown, editorRef]);

  useLayoutEffect(() => {
    if (!visible) return;
    if (isMarkdown) updatePositionMarkdown();
    else updatePositionRich();
  }, [visible, isMarkdown, updatePositionMarkdown, updatePositionRich]);

  /* =================================================================
   * 富文本命令
   * ================================================================= */
  const fireChangeRich = useCallback(() => {
    const editor = editorRef.current;
    if (editor && onChange) onChange(editor.innerHTML);
  }, [editorRef, onChange]);

  const applyInlineRich = useCallback((cmd, val) => {
    document.execCommand(cmd, false, val);
    detectActiveRich();
    fireChangeRich();
  }, [detectActiveRich, fireChangeRich]);

  const applyBlockRich = useCallback((tag) => {
    const isActive =
      (tag === 'h1' && active.h1) ||
      (tag === 'h2' && active.h2) ||
      (tag === 'h3' && active.h3) ||
      (tag === 'blockquote' && active.blockquote);
    const target = isActive ? 'p' : tag;
    document.execCommand('formatBlock', false, `<${target}>`);
    detectActiveRich();
    fireChangeRich();
  }, [active, detectActiveRich, fireChangeRich]);

  /* =================================================================
   * Markdown 模式命令：对 textarea 的选区做文本变换
   * ================================================================= */
  const applyMarkdown = useCallback((transform) => {
    const ta = editorRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const before = ta.value.substring(0, start);
    const selected = ta.value.substring(start, end);
    const after = ta.value.substring(end);

    const { text: nextSel, prefix = '', suffix = '' } = transform(selected, { before, after });
    const nextValue = before + prefix + nextSel + suffix + after;
    const nextStart = start + prefix.length;
    const nextEnd = nextStart + nextSel.length;

    if (onChange) onChange(nextValue, { start: nextStart, end: nextEnd });

    requestAnimationFrame(() => {
      ta.focus();
      try { ta.setSelectionRange(nextStart, nextEnd); } catch { /* noop */ }
    });
  }, [editorRef, onChange]);

  // 包裹型：**x**
  const wrap = (pre, post) => (text) => ({ text, prefix: pre, suffix: post });

  // 行首添加/切换 Markdown 前缀（支持多行）
  const applyLinePrefixV2 = useCallback((kind) => {
    const ta = editorRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const value = ta.value;
    const lineStart = value.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
    const lineEndRaw = value.indexOf('\n', end);
    const lineEnd = lineEndRaw === -1 ? value.length : lineEndRaw;

    const block = value.substring(lineStart, lineEnd);
    const before = value.substring(0, lineStart);
    const after = value.substring(lineEnd);

    const lines = block.split('\n');
    const stripMd = (line) => line.replace(/^(#{1,6}\s|>\s|[-*+]\s|\d+\.\s)/, '');

    const nextLines = lines.map((line) => {
      switch (kind) {
        case 'h1':
          return line.startsWith('# ') ? line.substring(2) : `# ${stripMd(line)}`;
        case 'h2':
          return line.startsWith('## ') ? line.substring(3) : `## ${stripMd(line)}`;
        case 'h3':
          return line.startsWith('### ') ? line.substring(4) : `### ${stripMd(line)}`;
        case 'quote':
          return line.startsWith('> ') ? line.substring(2) : `> ${stripMd(line)}`;
        default:
          return line;
      }
    });
    const nextBlock = nextLines.join('\n');
    const nextValue = before + nextBlock + after;
    const nextStart = lineStart;
    const nextEnd = lineStart + nextBlock.length;
    if (onChange) onChange(nextValue, { start: nextStart, end: nextEnd });
    requestAnimationFrame(() => {
      ta.focus();
      try { ta.setSelectionRange(nextStart, nextEnd); } catch { /* noop */ }
    });
  }, [editorRef, onChange]);

  /* =================================================================
   * 渲染
   * ================================================================= */
  if (!visible) return null;

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

  // —— 操作分发 ——
  const onH1 = isMarkdown ? () => applyLinePrefixV2('h1') : () => applyBlockRich('h1');
  const onH2 = isMarkdown ? () => applyLinePrefixV2('h2') : () => applyBlockRich('h2');
  const onH3 = isMarkdown ? () => applyLinePrefixV2('h3') : () => applyBlockRich('h3');
  const onQuote = isMarkdown ? () => applyLinePrefixV2('quote') : () => applyBlockRich('blockquote');
  const onBold = isMarkdown
    ? () => applyMarkdown(wrap('**', '**'))
    : () => applyInlineRich('bold');

  return (
    <div
      ref={toolbarRef}
      className="ftt"
      style={{ top: `${pos.top}px`, left: `${pos.left}px` }}
      onMouseDown={stop}
    >
      <Btn onClick={onH1} title="一级标题" activeFlag={active.h1}>
        <Heading1 size={16} />
      </Btn>
      <Btn onClick={onH2} title="二级标题" activeFlag={active.h2}>
        <Heading2 size={16} />
      </Btn>
      <Btn onClick={onH3} title="三级标题" activeFlag={active.h3}>
        <Heading3 size={16} />
      </Btn>
      <span className="ftt__sep" />

      <Btn onClick={onQuote} title="引用" activeFlag={active.blockquote}>
        <Quote size={16} />
      </Btn>
      <Btn onClick={onBold} title="加粗 (Ctrl/Cmd+B)" activeFlag={active.bold}>
        <Bold size={16} />
      </Btn>
    </div>
  );
}
