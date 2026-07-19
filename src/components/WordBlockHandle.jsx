import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Type, Heading1, Heading2, Heading3, Quote, List, ListOrdered, Bold, Link as LinkIcon, AlignLeft, AlignCenter, AlignRight, Captions, RotateCcw, Check } from 'lucide-react';
import './WordBlockHandle.css';
import {
  getCurrentOrderedList,
  isOrderedListRestarted,
  normalizeOrderedListNumbering,
  setOrderedListRestart,
} from '../utils/orderedListNumbering';

/** 四个点（正方形四顶点）图标 —— 块手柄的抓取标识 */
function FourDotsIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="5" r="1.6" />
      <circle cx="11" cy="5" r="1.6" />
      <circle cx="5" cy="11" r="1.6" />
      <circle cx="11" cy="11" r="1.6" />
    </svg>
  );
}

/**
 * WordBlockHandle —— 飞书式「块手柄」
 *
 * 在 contentEditable（Word 富文本）编辑器里，光标所在的那一块（段落/标题等）
 * 左侧会浮出一个小图标；点击展开格式菜单。
 * 菜单提供的格式与「选中文字后上方的浮动工具栏」保持一致：
 *   正文 / 一级~三级标题 / 引用 / 无序列表 / 有序列表 / 加粗 / 链接
 * 复用编辑器既有的 document.execCommand 能力。
 *
 * Props:
 *   editorRef — 目标 contentEditable 容器 ref
 *   onChange  — (html) => void，应用格式后把最新 innerHTML 回写
 */

// cmd：execCommand 命令；value：命令参数；selectAll：是否需要先选中整块文字
//（加粗/链接这类行内格式要作用在整块文字上，而不是仅一个折叠光标）；
// prompt：是否需要先弹框输入（链接 URL）。
const BLOCK_OPTIONS = [
  { key: 'p', label: '正文', icon: Type, cmd: 'formatBlock', value: '<p>' },
  { key: 'h1', label: '一级标题', icon: Heading1, cmd: 'formatBlock', value: '<h1>' },
  { key: 'h2', label: '二级标题', icon: Heading2, cmd: 'formatBlock', value: '<h2>' },
  { key: 'h3', label: '三级标题', icon: Heading3, cmd: 'formatBlock', value: '<h3>' },
  { key: 'blockquote', label: '引用', icon: Quote, cmd: 'formatBlock', value: '<blockquote>' },
  { key: 'ul', label: '无序列表', icon: List, cmd: 'insertUnorderedList' },
  { key: 'ol', label: '有序列表', icon: ListOrdered, cmd: 'insertOrderedList' },
  { key: 'bold', label: '加粗', icon: Bold, cmd: 'bold', selectAll: true },
  { key: 'link', label: '链接', icon: LinkIcon, cmd: 'createLink', selectAll: true, prompt: true },
  // 对齐：作用在整块上，折叠光标即可生效，无需 selectAll
  { key: 'alignLeft', label: '左对齐', icon: AlignLeft, cmd: 'justifyLeft' },
  { key: 'alignCenter', label: '居中', icon: AlignCenter, cmd: 'justifyCenter' },
  { key: 'alignRight', label: '右对齐', icon: AlignRight, cmd: 'justifyRight' },
];

function normalizeUrl(raw) {
  const v = (raw || '').trim();
  if (!v) return '';
  if (/^(https?:|mailto:|tel:|ftp:|\/|#)/i.test(v)) return v;
  return `https://${v}`;
}

const HANDLE_SIZE = 22; // 与 .wbh__handle 的宽高一致，用于垂直居中

/** 取「光标所在那一行」的矩形（视口坐标）。
 *  用选区的 rect 而不是整块 rect：这样即使一个块里用 <br> 多行换行，
 *  手柄也能精确跟到光标当前所在的视觉行，并能据此做行内垂直居中。 */
function getCaretLineRect(editor) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0).cloneRange();
  let rect = range.getBoundingClientRect();
  // 折叠光标在空行/段首时，getBoundingClientRect 可能全 0 → 退回所在元素的行矩形
  if (!rect || (rect.top === 0 && rect.height === 0)) {
    let node = range.startContainer;
    if (node && node.nodeType === 3) node = node.parentElement;
    if (node && node.getClientRects) {
      const rects = node.getClientRects();
      rect = rects.length ? rects[0] : node.getBoundingClientRect();
    }
  }
  if (!rect || (!rect.height && !rect.width)) return null;
  return rect;
}

/** 从当前选区往上找「编辑器的直接子块」 */
function getCurrentBlock(editor) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  let node = sel.anchorNode;
  if (range.startContainer === editor && editor.childNodes[range.startOffset]) {
    node = editor.childNodes[range.startOffset];
  }
  if (!node || !editor.contains(node)) return null;
  if (node === editor) return null;
  if (node.nodeType === 3) node = node.parentNode;
  while (node && node.parentNode && node.parentNode !== editor) {
    node = node.parentNode;
  }
  if (node && node.parentNode === editor && node.nodeType === 1) return node;
  return null;
}

function applyTextAlignToBlock(block, key) {
  if (!block) return;
  if (key === 'alignCenter') {
    block.style.textAlign = 'center';
    block.setAttribute('align', 'center');
  } else if (key === 'alignRight') {
    block.style.textAlign = 'right';
    block.setAttribute('align', 'right');
  } else if (key === 'alignLeft') {
    block.style.textAlign = 'left';
    block.setAttribute('align', 'left');
  }
}

function getCurrentListItem(editor) {
  const sel = window.getSelection();
  if (!editor || !sel || sel.rangeCount === 0) return null;
  const anchor = sel.anchorNode?.nodeType === Node.ELEMENT_NODE
    ? sel.anchorNode
    : sel.anchorNode?.parentElement;
  const li = anchor?.closest?.('li');
  return li && editor.contains(li) ? li : null;
}

function replaceListItemWithBlock(li, tag) {
  const list = li?.parentElement;
  if (!li || !list || !['ul', 'ol'].includes(list.tagName?.toLowerCase())) return null;
  const next = document.createElement(tag);
  Array.from(li.childNodes).forEach((child) => {
    if (child.nodeType === Node.ELEMENT_NODE && ['ul', 'ol'].includes(child.tagName?.toLowerCase())) return;
    next.appendChild(child);
  });
  if (!String(next.textContent || '').replace(/\u200B/g, '').trim() && !next.querySelector('img, video, table, iframe')) {
    next.innerHTML = '<br />';
  }
  list.parentNode?.insertBefore(next, list.nextSibling);
  li.remove();
  if (!list.querySelector('li')) list.remove();
  return next;
}

function replaceBlockTag(block, tag) {
  if (!block || block.tagName?.toLowerCase() === tag) return block;
  if (!['p', 'h1', 'h2', 'h3', 'blockquote', 'div'].includes(block.tagName?.toLowerCase())) return null;
  const next = document.createElement(tag);
  Array.from(block.attributes || []).forEach((attr) => {
    next.setAttribute(attr.name, attr.value);
  });
  while (block.firstChild) next.appendChild(block.firstChild);
  block.parentNode?.replaceChild(next, block);
  return next;
}

function placeCaretAtEnd(node) {
  try {
    const range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  } catch {
    /* ignore */
  }
}

function getBlockFormatKey(block) {
  if (!block) return '';
  const tag = String(block.tagName || '').toLowerCase();
  if (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'blockquote') return tag;
  if (tag === 'ul') return 'ul';
  if (tag === 'ol') return 'ol';
  if (block.closest?.('ul')) return 'ul';
  if (block.closest?.('ol')) return 'ol';
  return 'p';
}

function getBlockAlignKey(block) {
  if (!block) return '';
  const align = String(block.style?.textAlign || block.getAttribute?.('align') || '').toLowerCase();
  if (align === 'center') return 'alignCenter';
  if (align === 'right' || align === 'end') return 'alignRight';
  if (align === 'left' || align === 'start') return 'alignLeft';
  return '';
}

export default function WordBlockHandle({ editorRef, onChange }) {
  const [pos, setPos] = useState(null); // { top, left } 视口坐标
  const [menuOpen, setMenuOpen] = useState(false);
  const [blockHasImage, setBlockHasImage] = useState(false); // 当前块是否含图片（决定是否显示"添加注释"）
  const [currentOlRestarted, setCurrentOlRestarted] = useState(null); // null = 当前不在有序列表里
  const [activeFormatKey, setActiveFormatKey] = useState('p');
  const [activeAlignKey, setActiveAlignKey] = useState('');
  const blockRef = useRef(null); // 当前块 DOM 节点（点菜单时用来恢复光标）
  const rootRef = useRef(null);
  const closeTimerRef = useRef(null); // 悬浮离开后的延时关闭计时器

  const fireChange = useCallback(() => {
    const editor = editorRef?.current;
    if (editor && onChange) onChange(editor.innerHTML);
  }, [editorRef, onChange]);

  /** 重新计算手柄位置（跟随光标所在块） */
  const refresh = useCallback(() => {
    const editor = editorRef?.current;
    if (!editor) { setPos(null); return; }
    // 菜单打开时不重算（避免点菜单时手柄乱跳）
    if (menuOpen) return;
    // 是否仍在编辑这篇文档：焦点在编辑器内 ——或—— 选区仍落在编辑器内。
    // 仅靠 activeElement 在滚动时可能短暂失焦（拖滚动条/滚轮），导致手柄消失或不更新；
    // 这里再用选区兜底，保证滚动过程中只要光标还在文中，手柄就持续跟随。
    const active = document.activeElement;
    let selInEditor = false;
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const n = sel.anchorNode;
      selInEditor = !!n && editor.contains(n);
    }
    if (active !== editor && !editor.contains(active) && !selInEditor) { setPos(null); return; }

    const block = getCurrentBlock(editor) || blockRef.current;
    if (!block) { setPos(null); return; }
    if (!editor.contains(block)) { setPos(null); blockRef.current = null; return; }
    blockRef.current = block; // 仍记录所在块，供格式命令使用
    setBlockHasImage(!!(block.querySelector && block.querySelector('img')));
    setActiveFormatKey(getBlockFormatKey(block));
    setActiveAlignKey(getBlockAlignKey(block));
    const currentOl = getCurrentOrderedList(editor);
    setCurrentOlRestarted(currentOl ? isOrderedListRestarted(currentOl) : null);

    // 位置以「光标当前所在行」为准：跟随换行、滚动，并与该行垂直居中。
    const lineRect = getCaretLineRect(editor) || block.getBoundingClientRect();
    const editorRect = editor.getBoundingClientRect();
    setPos({
      top: lineRect.top + lineRect.height / 2 - HANDLE_SIZE / 2,
      left: editorRect.left - 30,
    });
  }, [editorRef, menuOpen]);

  /** 轻量「只挪位置」：滚动/缩放时把手柄（及其菜单）贴回光标当前所在行。
   *  不重算所在块、不隐藏，因此菜单打开时也能跟随滚动，不会卡在原处。 */
  const reposition = useCallback(() => {
    const editor = editorRef?.current;
    if (!editor) return;
    const block = blockRef.current;
    if (!block || !editor.contains(block)) return;
    const lineRect = getCaretLineRect(editor) || block.getBoundingClientRect();
    if (!lineRect) return;
    const editorRect = editor.getBoundingClientRect();
    setPos({
      top: lineRect.top + lineRect.height / 2 - HANDLE_SIZE / 2,
      left: editorRect.left - 30,
    });
  }, [editorRef]);

  useEffect(() => {
    const onSel = () => refresh();
    // 滚动/缩放用 rAF 合批，避免高频触发卡顿；capture=true 让内层滚动容器
    // （若编辑器放在 overflow:auto 的祖先里）的滚动也能被捕获，手柄随之跟随。
    // 注意：滚动用 reposition（不受 menuOpen 限制），保证菜单展开时也跟随光标行。
    let rafId = null;
    const onScrollResize = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        reposition();
      });
    };
    document.addEventListener('selectionchange', onSel);
    document.addEventListener('scroll', onScrollResize, true);
    window.addEventListener('scroll', onScrollResize, true);
    window.addEventListener('resize', onScrollResize);
    window.visualViewport?.addEventListener('scroll', onScrollResize);
    window.visualViewport?.addEventListener('resize', onScrollResize);
    const editor = editorRef?.current;
    if (editor) {
      editor.addEventListener('keyup', onSel);
      editor.addEventListener('mouseup', onSel);
      editor.addEventListener('input', onSel);
      editor.addEventListener('scroll', onScrollResize);
    }
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      document.removeEventListener('selectionchange', onSel);
      document.removeEventListener('scroll', onScrollResize, true);
      window.removeEventListener('scroll', onScrollResize, true);
      window.removeEventListener('resize', onScrollResize);
      window.visualViewport?.removeEventListener('scroll', onScrollResize);
      window.visualViewport?.removeEventListener('resize', onScrollResize);
      if (editor) {
        editor.removeEventListener('keyup', onSel);
        editor.removeEventListener('mouseup', onSel);
        editor.removeEventListener('input', onSel);
        editor.removeEventListener('scroll', onScrollResize);
      }
    };
  }, [editorRef, refresh, reposition]);

  // 点击外部关闭菜单
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onDoc = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [menuOpen]);

  // 卸载时清掉悬浮关闭计时器
  useEffect(() => () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
  }, []);

  /** 把光标放回当前块（点菜单会让编辑器失焦，先恢复光标再执行命令）。
   *  selectAll=true 时选中整块文字（加粗/链接等行内格式需要选区）；
   *  否则收到块末尾（formatBlock / 列表命令对折叠光标即可生效）。 */
  const restoreCaret = useCallback((selectAll) => {
    const block = blockRef.current;
    const editor = editorRef?.current;
    if (!block || !editor || !editor.contains(block)) return false;
    try {
      const range = document.createRange();
      range.selectNodeContents(block);
      if (!selectAll) range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      editor.focus();
      return true;
    } catch {
      return false;
    }
  }, [editorRef]);

  const applyOption = useCallback((opt) => {
    if (!restoreCaret(opt.selectAll)) { setMenuOpen(false); return; }
    let value = opt.value || null;
    if (opt.prompt) {
      // 链接：弹框输入 URL
      // eslint-disable-next-line no-alert
      const input = window.prompt('插入链接 URL', 'https://');
      if (input === null) { setMenuOpen(false); return; }
      value = normalizeUrl(input);
      if (!value) { setMenuOpen(false); return; }
    }
    try {
      const shouldExitListForBlock = ['p', 'h1', 'h2', 'h3', 'blockquote'].includes(opt.key);
      const listItem = shouldExitListForBlock ? getCurrentListItem(editorRef?.current) : null;
      if (listItem) {
        blockRef.current = replaceListItemWithBlock(listItem, opt.key);
        if (blockRef.current) placeCaretAtEnd(blockRef.current);
      } else if (shouldExitListForBlock) {
        const nextBlock = replaceBlockTag(blockRef.current, opt.key);
        if (nextBlock) {
          blockRef.current = nextBlock;
          placeCaretAtEnd(nextBlock);
        } else {
          document.execCommand(opt.cmd, false, value);
        }
      } else {
        document.execCommand(opt.cmd, false, value);
      }
      if (opt.key === 'ol') normalizeOrderedListNumbering(editorRef?.current);
      if (opt.key === 'alignLeft' || opt.key === 'alignCenter' || opt.key === 'alignRight') {
        applyTextAlignToBlock(blockRef.current, opt.key);
      }
      if (opt.key === 'alignLeft' || opt.key === 'alignCenter' || opt.key === 'alignRight') {
        setActiveAlignKey(opt.key);
      } else if (['p', 'h1', 'h2', 'h3', 'blockquote', 'ul', 'ol'].includes(opt.key)) {
        setActiveFormatKey(opt.key);
      }
      // 链接补 target，安全打开
      if (opt.key === 'link' && value) {
        const editor = editorRef?.current;
        const sel = window.getSelection();
        let n = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).commonAncestorContainer : null;
        n = n && n.nodeType === 1 ? n : n?.parentElement;
        while (n && editor && n !== editor) {
          if (n.tagName === 'A') {
            n.setAttribute('target', '_blank');
            n.setAttribute('rel', 'noopener noreferrer');
            break;
          }
          n = n.parentElement;
        }
      }
    } catch { /* 个别浏览器不支持，忽略 */ }
    fireChange();
    setMenuOpen(false);
    // 下一帧重算手柄位置（块标签变了，高度可能变化）
    requestAnimationFrame(() => refresh());
  }, [restoreCaret, fireChange, refresh, editorRef]);

  const toggleOrderedListRestart = useCallback(() => {
    const editor = editorRef?.current;
    if (!editor) { setMenuOpen(false); return; }
    const list = getCurrentOrderedList(editor);
    if (!list) { setMenuOpen(false); return; }
    const nextRestart = !isOrderedListRestarted(list);
    setOrderedListRestart(list, nextRestart);
    normalizeOrderedListNumbering(editor);
    setCurrentOlRestarted(nextRestart);
    fireChange();
    setMenuOpen(false);
    requestAnimationFrame(() => refresh());
  }, [editorRef, fireChange, refresh]);

  // 给图片添加/聚焦注释：在图片所在段落下方插入一行更小的说明文字
  const addCaption = useCallback(() => {
    const editor = editorRef?.current;
    const block = blockRef.current;
    if (!editor || !block || !editor.contains(block)) { setMenuOpen(false); return; }
    const img = block.querySelector('img');
    const wrap = (img && img.closest('.msc-img-wrap')) || block;
    let caption = wrap.nextElementSibling;
    if (!caption || !caption.classList || !caption.classList.contains('msc-img-caption')) {
      caption = document.createElement('p');
      caption.className = 'msc-img-caption';
      caption.textContent = '图片注释';
      wrap.parentNode.insertBefore(caption, wrap.nextSibling);
    }
    // 注释跟随图片所在段落的对齐方式
    caption.style.textAlign = wrap.style.textAlign || 'center';
    // 选中注释文字，输入即替换
    try {
      const range = document.createRange();
      range.selectNodeContents(caption);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      editor.focus();
    } catch { /* ignore */ }
    fireChange();
    setMenuOpen(false);
    requestAnimationFrame(() => refresh());
  }, [editorRef, fireChange, refresh]);

  if (!pos) return null;

  const stop = (e) => e.preventDefault(); // 防止 mousedown 抢走编辑器选区

  // 悬浮展开：鼠标移到手柄/菜单上即展开，移开后短暂延时关闭（延时用于跨过
  // 图标与菜单之间的小间隙，避免一移动就闪退）。
  const openMenu = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setMenuOpen(true);
  };
  const scheduleClose = () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => setMenuOpen(false), 160);
  };

  // 用 portal 渲染到 body：避免被带 transform/filter 的祖先元素改变 position:fixed
  // 的包含块，从而保证手柄能按视口坐标随光标行滚动跟随，而不是停在原处。
  return createPortal(
    <div
      ref={rootRef}
      className="wbh"
      style={{ top: `${pos.top}px`, left: `${pos.left}px` }}
      onMouseEnter={openMenu}
      onMouseLeave={scheduleClose}
    >
      <button
        type="button"
        className={`wbh__handle ${menuOpen ? 'wbh__handle--active' : ''}`}
        onMouseDown={stop}
        onClick={openMenu}
        title="插入/切换格式（标题层级、引用等）"
      >
        <FourDotsIcon size={14} />
      </button>

      {menuOpen && (
        <div className="wbh__menu" onMouseDown={stop}>
          {BLOCK_OPTIONS.map((opt) => {
            const isActive = opt.key === activeFormatKey || opt.key === activeAlignKey;
            return (
              <button
                key={opt.key}
                type="button"
                className={`wbh__menu-item ${isActive ? 'wbh__menu-item--active' : ''}`}
                aria-pressed={isActive}
                onMouseDown={stop}
                onClick={() => applyOption(opt)}
              >
                <opt.icon size={15} className="wbh__menu-icon" />
                <span>{opt.label}</span>
                {isActive && <Check size={14} className="wbh__menu-check" />}
              </button>
            );
          })}
          {blockHasImage && (
            <button
              type="button"
              className="wbh__menu-item"
              onMouseDown={stop}
              onClick={addCaption}
            >
              <Captions size={15} className="wbh__menu-icon" />
              <span>图片注释</span>
            </button>
          )}
          {currentOlRestarted !== null && (
            <button
              type="button"
              className="wbh__menu-item"
              onMouseDown={stop}
              onClick={toggleOrderedListRestart}
            >
              <RotateCcw size={15} className="wbh__menu-icon" />
              <span>{currentOlRestarted ? '继续前序编号' : '重新开始编号'}</span>
            </button>
          )}
        </div>
      )}
    </div>,
    document.body
  );
}
