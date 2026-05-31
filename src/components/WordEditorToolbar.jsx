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

  const handleInsertColumns = async (count, withFiles) => {
    setColOpen(false);
    if (!editorRef?.current) return;
    // 保证焦点落在编辑器里（否则光标不在内部，会追加到末尾）
    editorRef.current.focus();

    if (withFiles) {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.multiple = true;
      input.onchange = async () => {
        const files = Array.from(input.files || []).slice(0, count);
        await insertColumnsIntoEditor(editorRef.current, { count, files });
        fireChange();
      };
      input.click();
    } else {
      await insertColumnsIntoEditor(editorRef.current, { count });
      fireChange();
    }
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
    editorRef.current.focus();
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
          onClick={() => setColOpen((v) => !v)}
          title="插入多栏并排布局（类似飞书），常用于图片左右排版"
        >
          <Columns size={14} /> 分栏
          <ChevronDown size={12} />
        </button>
        {colOpen && (
          <div ref={colMenuRef} className="wet__menu">
            <div className="wet__menu-title">选择栏数</div>
            {[2, 3, 4].map((n) => (
              <div key={n} className="wet__menu-group">
                <div className="wet__menu-row">
                  <span className="wet__menu-row-label">{n} 栏</span>
                  <div className="wet__menu-row-actions">
                    <button
                      type="button"
                      className="wet__menu-btn"
                      onClick={() => handleInsertColumns(n, true)}
                      title={`选择 ${n} 张图片，一键插入 ${n} 栏布局`}
                    >
                      选图插入
                    </button>
                    <button
                      type="button"
                      className="wet__menu-btn wet__menu-btn--ghost"
                      onClick={() => handleInsertColumns(n, false)}
                      title="先插入空分栏，稍后点击各栏补图"
                    >
                      空分栏
                    </button>
                  </div>
                </div>
              </div>
            ))}
            <div className="wet__menu-tip">提示：空分栏中每一栏可点击「点此添加图片」补图，或点「输入文字」改为文字栏</div>
          </div>
        )}
      </div>

      {/* 表格 */}
      <div className="wet__dropdown-wrap">
        <button
          ref={tableBtnRef}
          type="button"
          className="msc-form__paste-btn msc-form__paste-btn--ghost"
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
