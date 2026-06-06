import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, Type, Heading1, Heading2, Heading3, Quote } from 'lucide-react';
import './WordBlockHandle.css';

/**
 * WordBlockHandle —— 飞书式「块手柄」
 *
 * 在 contentEditable（Word 富文本）编辑器里，光标所在的那一块（段落/标题等）
 * 左侧会浮出一个小图标；点击展开格式菜单，把当前块切换成：
 *   正文 / 一级标题 / 二级标题 / 三级标题 / 引用
 * 复用编辑器既有的 document.execCommand('formatBlock', ...) 能力，
 * 与 FloatingTextToolbar 的块级格式保持一致。
 *
 * Props:
 *   editorRef — 目标 contentEditable 容器 ref
 *   onChange  — (html) => void，应用格式后把最新 innerHTML 回写
 */

const BLOCK_OPTIONS = [
  { key: 'p', label: '正文', icon: Type, tag: '<p>' },
  { key: 'h1', label: '一级标题', icon: Heading1, tag: '<h1>' },
  { key: 'h2', label: '二级标题', icon: Heading2, tag: '<h2>' },
  { key: 'h3', label: '三级标题', icon: Heading3, tag: '<h3>' },
  { key: 'blockquote', label: '引用', icon: Quote, tag: '<blockquote>' },
];

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
    // 焦点不在编辑器里、或菜单打开时不重算（避免点菜单时手柄乱跳）
    if (menuOpen) return;
    const active = document.activeElement;
    if (active !== editor && !editor.contains(active)) { setPos(null); return; }

    const block = getCurrentBlock(editor);
    if (!block) { setPos(null); return; }
    blockRef.current = block;

    const blockRect = block.getBoundingClientRect();
    const editorRect = editor.getBoundingClientRect();
    // 手柄放在编辑器左内边距外侧的「行首左边」，与块顶部大致对齐
    setPos({
      top: blockRect.top + 2,
      left: editorRect.left - 30,
    });
  }, [editorRef, menuOpen]);

  useEffect(() => {
    const onSel = () => refresh();
    const onScrollResize = () => { if (!menuOpen) refresh(); };
    document.addEventListener('selectionchange', onSel);
    window.addEventListener('scroll', onScrollResize, true);
    window.addEventListener('resize', onScrollResize);
    const editor = editorRef?.current;
    if (editor) {
      editor.addEventListener('keyup', onSel);
      editor.addEventListener('mouseup', onSel);
      editor.addEventListener('input', onSel);
    }
    return () => {
      document.removeEventListener('selectionchange', onSel);
      window.removeEventListener('scroll', onScrollResize, true);
      window.removeEventListener('resize', onScrollResize);
      if (editor) {
        editor.removeEventListener('keyup', onSel);
        editor.removeEventListener('mouseup', onSel);
        editor.removeEventListener('input', onSel);
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

  /** 把光标放回当前块（点菜单会让编辑器失焦，先恢复光标再执行命令） */
  const restoreCaret = useCallback(() => {
    const block = blockRef.current;
    const editor = editorRef?.current;
    if (!block || !editor || !editor.contains(block)) return false;
    try {
      const range = document.createRange();
      range.selectNodeContents(block);
      range.collapse(false); // 收到块末尾
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      editor.focus();
      return true;
    } catch {
      return false;
    }
  }, [editorRef]);

  const applyBlock = useCallback((tag) => {
    if (!restoreCaret()) { setMenuOpen(false); return; }
    try {
      document.execCommand('formatBlock', false, tag);
    } catch { /* 个别浏览器不支持，忽略 */ }
    fireChange();
    setMenuOpen(false);
    // 下一帧重算手柄位置（块标签变了，高度可能变化）
    requestAnimationFrame(() => refresh());
  }, [restoreCaret, fireChange, refresh]);

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
              onClick={() => applyBlock(opt.tag)}
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
