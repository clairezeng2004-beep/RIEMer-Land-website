import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, Type, Heading1, Heading2, Heading3, Quote, List, ListOrdered, Bold, Link as LinkIcon, AlignLeft, AlignCenter, AlignRight } from 'lucide-react';
import './WordBlockHandle.css';

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
  let node = sel.anchorNode;
  if (!node || !editor.contains(node)) return null;
  if (node === editor) return null;
  if (node.nodeType === 3) node = node.parentNode;
  while (node && node.parentNode && node.parentNode !== editor) {
    node = node.parentNode;
  }
  if (node && node.parentNode === editor && node.nodeType === 1) return node;
  return null;
}

export default function WordBlockHandle({ editorRef, onChange }) {
  const [pos, setPos] = useState(null); // { top, left } 视口坐标
  const [menuOpen, setMenuOpen] = useState(false);
  const blockRef = useRef(null); // 当前块 DOM 节点（点菜单时用来恢复光标）
  const rootRef = useRef(null);

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

    const block = getCurrentBlock(editor);
    if (!block) { setPos(null); return; }
    blockRef.current = block; // 仍记录所在块，供格式命令使用

    // 位置以「光标当前所在行」为准：跟随换行、滚动，并与该行垂直居中。
    const lineRect = getCaretLineRect(editor) || block.getBoundingClientRect();
    const editorRect = editor.getBoundingClientRect();
    setPos({
      top: lineRect.top + lineRect.height / 2 - HANDLE_SIZE / 2,
      left: editorRect.left - 30,
    });
  }, [editorRef, menuOpen]);

  useEffect(() => {
    const onSel = () => refresh();
    // 滚动/缩放用 rAF 合批，避免高频触发卡顿；capture=true 让内层滚动容器
    // （若编辑器放在 overflow:auto 的祖先里）的滚动也能被捕获，手柄随之跟随。
    let rafId = null;
    const onScrollResize = () => {
      if (menuOpen) return;
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        refresh();
      });
    };
    document.addEventListener('selectionchange', onSel);
    window.addEventListener('scroll', onScrollResize, true);
    window.addEventListener('resize', onScrollResize);
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
      window.removeEventListener('scroll', onScrollResize, true);
      window.removeEventListener('resize', onScrollResize);
      if (editor) {
        editor.removeEventListener('keyup', onSel);
        editor.removeEventListener('mouseup', onSel);
        editor.removeEventListener('input', onSel);
        editor.removeEventListener('scroll', onScrollResize);
      }
    };
  }, [editorRef, refresh, menuOpen]);

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
      document.execCommand(opt.cmd, false, value);
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

  if (!pos) return null;

  const stop = (e) => e.preventDefault(); // 防止 mousedown 抢走编辑器选区

  return (
    <div ref={rootRef} className="wbh" style={{ top: `${pos.top}px`, left: `${pos.left}px` }}>
      <button
        type="button"
        className="wbh__handle"
        onMouseDown={stop}
        onClick={() => setMenuOpen((v) => !v)}
        title="插入/切换格式（标题层级、引用等）"
      >
        <Plus size={16} />
      </button>

      {menuOpen && (
        <div className="wbh__menu" onMouseDown={stop}>
          {BLOCK_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              type="button"
              className="wbh__menu-item"
              onMouseDown={stop}
              onClick={() => applyOption(opt)}
            >
              <opt.icon size={15} className="wbh__menu-icon" />
              <span>{opt.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
