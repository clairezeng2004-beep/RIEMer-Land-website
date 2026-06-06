import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Type, Heading1, Heading2, Heading3, Quote, Bold, Link as LinkIcon, List, ListOrdered } from 'lucide-react';
import './FloatingTextToolbar.css';

/**
 * FloatingTextToolbar
 * 两种模式：
 *   - mode="rich" (默认)：在 contentEditable 编辑器上根据选区弹工具栏，走 document.execCommand
 *   - mode="markdown"：在 <textarea> 上根据选区弹工具栏，对选中区间插入 Markdown 语法
 *
 * 仅保留以下六个格式化能力：
 *   一级标题 / 二级标题 / 三级标题 / 引用 / 加粗 / 插入超链接
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
      paragraph: false,
      h1: false,
      h2: false,
      h3: false,
      blockquote: false,
      link: false,
      linkHref: '',
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
    // 检测选区是否落在 <a> 内部，用于链接按钮的 active 态和编辑时预填 URL
    {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        let n =
          sel.anchorNode && sel.anchorNode.nodeType === 1
            ? sel.anchorNode
            : sel.anchorNode?.parentElement;
        const editor = editorRef.current;
        while (n && n !== editor) {
          if (n.tagName === 'A') {
            next.link = true;
            next.linkHref = n.getAttribute('href') || '';
            break;
          }
          n = n.parentElement;
        }
      }
    }
    // 正文：既不是标题也不是引用时视为正文（用于"正文 T"按钮的高亮态）
    next.paragraph = !next.h1 && !next.h2 && !next.h3 && !next.blockquote;
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
    const sel = window.getSelection();
    const savedRange = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null;
    document.execCommand(cmd, false, val);
    if (cmd === 'bold' && savedRange && !savedRange.collapsed) {
      const after = savedRange.cloneRange();
      after.collapse(false);
      sel?.removeAllRanges();
      sel?.addRange(after);
      if (document.queryCommandState('bold')) {
        document.execCommand('bold', false, null);
      }
    }
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

  // 列表（富文本）：有序 insertOrderedList / 无序 insertUnorderedList。
  // 再次点击同类型可取消列表（execCommand 自带切换）。生成的 <ul>/<ol> 支持
  // 在编辑器里用 Tab / Shift+Tab 缩进到多级（见 utils/editorTabIndent.js）。
  const applyListRich = useCallback((cmd) => {
    document.execCommand(cmd, false, null);
    detectActiveRich();
    fireChangeRich();
  }, [detectActiveRich, fireChangeRich]);

  /* -----------------------------------------------------------------
   * 链接：富文本模式
   *   - 当选中已是 <a>：弹框预填当前 href；用户留空 → 解除链接（unlink）；
   *     用户改了 URL → 解除旧链接后再 createLink 包新 href。
   *   - 当选中不是链接：弹框输入 URL，execCommand('createLink') 包 <a>。
   * 为了保持选区在 prompt 弹出后不丢失，先把选区存好再恢复。
   * ----------------------------------------------------------------- */
  const normalizeUrl = (raw) => {
    const v = (raw || '').trim();
    if (!v) return '';
    // 允许 mailto: / tel: / # 锚点 / 协议开头；否则默认补 https://
    if (/^(https?:|mailto:|tel:|ftp:|\/|#)/i.test(v)) return v;
    return `https://${v}`;
  };

  const applyLinkRich = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    // 保存选区，prompt 弹出后再恢复（避免 blur 掉丢掉选中范围）
    const savedRange = sel.getRangeAt(0).cloneRange();

    const existingHref = active.linkHref || '';
    // eslint-disable-next-line no-alert
    const input = window.prompt(
      existingHref ? '编辑链接（留空可解除链接）' : '插入链接 URL',
      existingHref
    );
    if (input === null) return; // 用户点了取消
    const url = normalizeUrl(input);

    // 恢复选区，让 execCommand 作用在原本选中的文字上
    sel.removeAllRanges();
    sel.addRange(savedRange);

    if (!url) {
      // 空字符串 → 解除链接
      document.execCommand('unlink');
    } else {
      if (active.link) {
        // 已是链接：先解除再创建，实现"改地址"
        document.execCommand('unlink');
      }
      document.execCommand('createLink', false, url);
      // 新增：给 <a> 打上 target="_blank" + rel="noopener" 更安全
      // execCommand 本身不支持加 target，这里补一刀：找刚创建的那个 <a>
      try {
        const sel2 = window.getSelection();
        if (sel2 && sel2.rangeCount > 0) {
          const r = sel2.getRangeAt(0);
          let n =
            r.commonAncestorContainer.nodeType === 1
              ? r.commonAncestorContainer
              : r.commonAncestorContainer.parentElement;
          while (n && n !== editor) {
            if (n.tagName === 'A' && n.getAttribute('href') === url) {
              n.setAttribute('target', '_blank');
              n.setAttribute('rel', 'noopener noreferrer');
              break;
            }
            n = n.parentElement;
          }
        }
      } catch { /* 忽略：target 是锦上添花 */ }
    }
    detectActiveRich();
    fireChangeRich();
  }, [active.link, active.linkHref, detectActiveRich, editorRef, fireChangeRich]);

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

  // Markdown 模式：插入链接 [text](url)
  //   - 选区非空：把选中的文字作为链接 text，弹 URL 弹框；
  //   - 已是 Markdown 链接 [text](url) 形式：不做形态识别（代价高且易误判），
  //     用户可手动调整。
  const applyLinkMarkdown = useCallback(() => {
    const ta = editorRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    if (start === end) return;
    // eslint-disable-next-line no-alert
    const raw = window.prompt('插入链接 URL', 'https://');
    if (raw === null) return;
    const url = normalizeUrl(raw);
    if (!url) return;
    const before = ta.value.substring(0, start);
    const selected = ta.value.substring(start, end);
    const after = ta.value.substring(end);
    const next = `${before}[${selected}](${url})${after}`;
    const nextStart = start + 1;
    const nextEnd = nextStart + selected.length;
    if (onChange) onChange(next, { start: nextStart, end: nextEnd });
    requestAnimationFrame(() => {
      ta.focus();
      try { ta.setSelectionRange(nextStart, nextEnd); } catch { /* noop */ }
    });
  }, [editorRef, onChange]);

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
        case 'p':
          // 正文：去掉任意标题/引用/列表前缀，回到纯文本
          return stripMd(line);
        case 'h1':
          return line.startsWith('# ') ? line.substring(2) : `# ${stripMd(line)}`;
        case 'h2':
          return line.startsWith('## ') ? line.substring(3) : `## ${stripMd(line)}`;
        case 'h3':
          return line.startsWith('### ') ? line.substring(4) : `### ${stripMd(line)}`;
        case 'quote':
          return line.startsWith('> ') ? line.substring(2) : `> ${stripMd(line)}`;
        case 'ul':
          return /^[-*+]\s/.test(line) ? line.replace(/^[-*+]\s/, '') : `- ${stripMd(line)}`;
        case 'ol':
          return /^\d+\.\s/.test(line) ? line.replace(/^\d+\.\s/, '') : `1. ${stripMd(line)}`;
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
  const onParagraph = isMarkdown ? () => applyLinePrefixV2('p') : () => applyBlockRich('p');
  const onH1 = isMarkdown ? () => applyLinePrefixV2('h1') : () => applyBlockRich('h1');
  const onH2 = isMarkdown ? () => applyLinePrefixV2('h2') : () => applyBlockRich('h2');
  const onH3 = isMarkdown ? () => applyLinePrefixV2('h3') : () => applyBlockRich('h3');
  const onQuote = isMarkdown ? () => applyLinePrefixV2('quote') : () => applyBlockRich('blockquote');
  const onBold = isMarkdown
    ? () => applyMarkdown(wrap('**', '**'))
    : () => applyInlineRich('bold');
  const onLink = isMarkdown ? applyLinkMarkdown : applyLinkRich;
  const onUL = isMarkdown ? () => applyLinePrefixV2('ul') : () => applyListRich('insertUnorderedList');
  const onOL = isMarkdown ? () => applyLinePrefixV2('ol') : () => applyListRich('insertOrderedList');

  return (
    <div
      ref={toolbarRef}
      className="ftt"
      style={{ top: `${pos.top}px`, left: `${pos.left}px` }}
      onMouseDown={stop}
    >
      {/* 正文：把当前块转回普通段落 <p>（去掉标题/引用等块级格式） */}
      <Btn onClick={onParagraph} title="正文" activeFlag={active.paragraph}>
        <Type size={18} />
      </Btn>
      {/* Heading1/2/3 图标里的「H1/H2/H3」字形在 24×24 画布里占比偏小，
          同样 size=16 时视觉上比实心的「加粗 B」小一圈，这里放大到 19 视觉对齐。 */}
      <Btn onClick={onH1} title="一级标题" activeFlag={active.h1}>
        <Heading1 size={19} />
      </Btn>
      <Btn onClick={onH2} title="二级标题" activeFlag={active.h2}>
        <Heading2 size={19} />
      </Btn>
      <Btn onClick={onH3} title="三级标题" activeFlag={active.h3}>
        <Heading3 size={19} />
      </Btn>
      <span className="ftt__sep" />

      <Btn onClick={onQuote} title="引用" activeFlag={active.blockquote}>
        <Quote size={16} />
      </Btn>
      <Btn onClick={onUL} title="无序列表（Tab 缩进多级）">
        <List size={16} />
      </Btn>
      <Btn onClick={onOL} title="有序列表（Tab 缩进多级）">
        <ListOrdered size={16} />
      </Btn>
      <Btn onClick={onBold} title="加粗 (Ctrl/Cmd+B)" activeFlag={active.bold}>
        <Bold size={16} />
      </Btn>
      <Btn
        onClick={onLink}
        title={active.link ? '编辑 / 移除链接' : '插入超链接'}
        activeFlag={active.link}
      >
        <LinkIcon size={16} />
      </Btn>
    </div>
  );
}
