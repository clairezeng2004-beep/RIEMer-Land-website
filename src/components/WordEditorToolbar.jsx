import { useEffect, useRef, useState } from 'react';
import {
  Image as ImageIcon,
  Columns,
  Table as TableIcon,
  ChevronDown,
} from 'lucide-react';
import {
  insertColumnsIntoEditor,
  insertTableIntoEditor,
} from '../utils/wordDocBlocks';
import './WordEditorToolbar.css';

/**
 * WordEditorToolbar —— 文档编辑器（Word 风格）上方的统一工具栏
 *
 * Props:
 *   editorRef          —— 目标 contentEditable 容器 ref
 *   imageApiRef        —— attachWordImageEditor 返回的 api ref（用于 pickImage）
 *   onChange           —— (html) => void，当分栏/表格变化后把最新 innerHTML 回写到 state
 *
 * 包含三个功能：
 *   1. 插入图片（复用 imageApi.pickImage()）
 *   2. 分栏（类似飞书图片分栏）：下拉选择 2/3/4 栏 + 可选一次批量选图
 *   3. 表格：飞书式网格选择器（悬停决定行列数）+ 点击插入
 */
export default function WordEditorToolbar({
  editorRef,
  imageApiRef,
  onChange,
}) {
  const fireChange = () => {
    if (editorRef?.current && onChange) {
      onChange(editorRef.current.innerHTML);
    }
  };

  /* ===================== 光标位置保存/恢复 =====================
     打开下拉菜单 / 点击菜单项会让 contentEditable 失焦，若插入前再 focus()
     会把光标重置到文首，导致分栏/表格被插到正文最前面。这里在交互开始前
     （mousedown，早于失焦）保存编辑器内的 Range，插入时再恢复。 */
  const savedRangeRef = useRef(null);
  const saveSelection = () => {
    const editor = editorRef?.current;
    if (!editor) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (editor.contains(range.commonAncestorContainer)) {
      savedRangeRef.current = range.cloneRange();
    }
  };
  const restoreSelection = () => {
    const editor = editorRef?.current;
    if (!editor) return;
    editor.focus();
    const range = savedRangeRef.current;
    if (range && editor.contains(range.commonAncestorContainer)) {
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  };

  /* ===================== 分栏下拉 ===================== */
  const [colOpen, setColOpen] = useState(false);
  const colBtnRef = useRef(null);
  const colMenuRef = useRef(null);

  useEffect(() => {
    if (!colOpen) return undefined;
    const onDoc = (e) => {
      if (
        colMenuRef.current?.contains(e.target) ||
        colBtnRef.current?.contains(e.target)
      ) {
        return;
      }
      setColOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [colOpen]);

  const handleInsertColumns = async (count) => {
    setColOpen(false);
    if (!editorRef?.current) return;
    // 恢复打开菜单前的光标位置，分栏将插在光标处而非正文最前
    restoreSelection();
    await insertColumnsIntoEditor(editorRef.current, { count });
    fireChange();
  };

  /* ===================== 表格网格选择器 ===================== */
  const [tableOpen, setTableOpen] = useState(false);
  const [grid, setGrid] = useState({ r: 0, c: 0 });
  const tableBtnRef = useRef(null);
  const tableMenuRef = useRef(null);

  useEffect(() => {
    if (!tableOpen) return undefined;
    const onDoc = (e) => {
      if (
        tableMenuRef.current?.contains(e.target) ||
        tableBtnRef.current?.contains(e.target)
      ) {
        return;
      }
      setTableOpen(false);
      setGrid({ r: 0, c: 0 });
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [tableOpen]);

  const GRID_ROWS = 8;
  const GRID_COLS = 8;

  const handlePickTable = (rows, cols) => {
    setTableOpen(false);
    setGrid({ r: 0, c: 0 });
    if (!editorRef?.current || rows < 1 || cols < 1) return;
    // 恢复光标位置，表格插在光标处而非正文最前
    restoreSelection();
    insertTableIntoEditor(editorRef.current, { rows, cols });
    fireChange();
  };

  return (
    <div className="msc-form__editor-toolbar">
      {/* 插入图片 */}
      <button
        type="button"
        className="msc-form__paste-btn msc-form__paste-btn--ghost"
        onClick={() => imageApiRef?.current?.pickImage()}
        title="插入图片（也支持拖拽/粘贴；插入后点击图片可拖动 8 个手柄调整大小，按住 Shift 自由缩放）"
      >
        <ImageIcon size={14} /> 插入图片（也支持拖拽插入）
      </button>

      {/* 分栏 */}
      <div className="wet__dropdown-wrap">
        <button
          ref={colBtnRef}
          type="button"
          className="msc-form__paste-btn msc-form__paste-btn--ghost"
          onMouseDown={saveSelection}
          onClick={() => setColOpen((v) => !v)}
          title="插入多栏并排布局（类似飞书），常用于图片左右排版"
        >
          <Columns size={14} /> 分栏
          <ChevronDown size={12} />
        </button>
        {colOpen && (
          <div ref={colMenuRef} className="wet__menu">
            <div className="wet__menu-title">选择栏数</div>
            <div className="wet__menu-cols">
              {[2, 3, 4].map((n) => (
                <button
                  key={n}
                  type="button"
                  className="wet__menu-col-btn"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleInsertColumns(n)}
                  title={`插入 ${n} 栏并排布局`}
                >
                  <Columns size={16} />
                  {n} 栏
                </button>
              ))}
            </div>
            <div className="wet__menu-tip">提示：插入后点击各栏「点此添加图片」补图，或点「输入文字」改为文字栏</div>
          </div>
        )}
      </div>

      {/* 表格 */}
      <div className="wet__dropdown-wrap">
        <button
          ref={tableBtnRef}
          type="button"
          className="msc-form__paste-btn msc-form__paste-btn--ghost"
          onMouseDown={saveSelection}
          onClick={() => setTableOpen((v) => !v)}
          title="插入表格（类似飞书）"
        >
          <TableIcon size={14} /> 表格
          <ChevronDown size={12} />
        </button>
        {tableOpen && (
          <div ref={tableMenuRef} className="wet__menu wet__menu--grid">
            <div className="wet__menu-title">
              {grid.r > 0 && grid.c > 0
                ? `${grid.r} × ${grid.c} 表格`
                : '鼠标悬停选择行列'}
            </div>
            <div
              className="wet__grid"
              onMouseLeave={() => setGrid({ r: 0, c: 0 })}
            >
              {Array.from({ length: GRID_ROWS }).map((_, r) => (
                <div key={r} className="wet__grid-row">
                  {Array.from({ length: GRID_COLS }).map((__, c) => {
                    const active = r < grid.r && c < grid.c;
                    return (
                      <span
                        key={c}
                        className={`wet__grid-cell${active ? ' wet__grid-cell--active' : ''}`}
                        onMouseEnter={() => setGrid({ r: r + 1, c: c + 1 })}
                        onMouseDown={(e) => {
                          // 阻止失焦导致下拉关闭前尺寸被重置
                          e.preventDefault();
                        }}
                        onClick={() => handlePickTable(r + 1, c + 1)}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
            <div className="wet__menu-tip">点击后插入表格；插入后鼠标悬停表格即可在边上增减行列</div>
          </div>
        )}
      </div>
    </div>
  );
}
