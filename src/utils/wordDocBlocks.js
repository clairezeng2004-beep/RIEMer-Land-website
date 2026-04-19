/**
 * wordDocBlocks
 * -------------
 * 给 contentEditable 的 Word 风格富文本编辑器提供两种"块"能力：
 *
 *   1) insertColumnsIntoEditor(editor, { count, files })
 *      —— 插入一个多栏并排容器（类似飞书的图片分栏），
 *         每栏可以是图片或空占位。
 *         结构：
 *         <div class="msc-cols msc-cols--2" data-cols="2">
 *           <div class="msc-col">
 *             <img class="msc-img" src="..." />
 *           </div>
 *           <div class="msc-col">
 *             <span class="msc-col__placeholder">点此添加图片</span>
 *           </div>
 *         </div>
 *
 *   2) insertTableIntoEditor(editor, { rows, cols })
 *      —— 插入一个可编辑表格（类似飞书的表格），
 *         每个单元格直接在 contentEditable 容器内可编辑文本。
 *         悬停表格时在右/下 / 右下角会显示"+行 / +列 / 删行 / 删列"操作条。
 *         结构：
 *         <div class="msc-table-wrap" data-msc-table>
 *           <table class="msc-table">
 *             <tbody>
 *               <tr><td> ... </td>...</tr>
 *               ...
 *             </tbody>
 *           </table>
 *         </div>
 *
 * 设计原则：
 *   - 生成的 HTML 是纯 DOM（可被 innerHTML 来回回写），不依赖 React；
 *   - 预览页只要加载 wordDocBlocks.css 对应选择器即可还原效果；
 *   - 表格的行列增删是"行为层"，需要额外调用 attachTableControls(editor)
 *     为当前编辑器挂载 hover 控制条。
 */

/** 在光标处插入一段 HTML（作为独立块），若光标不在编辑器内则追加到末尾 */
function insertBlockAtCaret(editor, node) {
  const sel = window.getSelection();
  let inserted = false;
  if (sel && sel.rangeCount > 0) {
    const range = sel.getRangeAt(0);
    if (editor.contains(range.commonAncestorContainer)) {
      range.deleteContents();
      range.insertNode(node);
      inserted = true;
    }
  }
  if (!inserted) editor.appendChild(node);

  // 插一个空段落在后面，方便继续输入
  const trailer = document.createElement('p');
  trailer.innerHTML = '<br />';
  node.parentNode?.insertBefore(trailer, node.nextSibling);

  // 把光标挪到 trailer 里
  try {
    const r = document.createRange();
    r.setStart(trailer, 0);
    r.collapse(true);
    const s = window.getSelection();
    s?.removeAllRanges();
    s?.addRange(r);
  } catch { /* ignore */ }
}

/** 文件 → dataURL */
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* =========================================================================
 * 1) 图片分栏（飞书风格）
 * ========================================================================= */

/**
 * 插入一个 N 栏容器；若传了 files，按顺序填充；不足则用占位。
 * @param {HTMLElement} editor
 * @param {{ count?: number, files?: File[] }} opts
 */
export async function insertColumnsIntoEditor(editor, { count = 2, files = [] } = {}) {
  if (!editor) return;
  const n = Math.max(2, Math.min(4, Math.floor(count) || 2));

  const container = document.createElement('div');
  container.className = `msc-cols msc-cols--${n}`;
  container.setAttribute('data-cols', String(n));

  const datas = [];
  for (let i = 0; i < n; i++) {
    const f = files[i];
    if (f && f.type?.startsWith('image/')) {
      // eslint-disable-next-line no-await-in-loop
      const url = await fileToDataUrl(f);
      datas[i] = url;
    } else {
      datas[i] = null;
    }
  }

  for (let i = 0; i < n; i++) {
    const col = document.createElement('div');
    col.className = 'msc-col';
    if (datas[i]) {
      const img = document.createElement('img');
      img.src = datas[i];
      img.className = 'msc-img';
      img.setAttribute('draggable', 'false');
      img.alt = '';
      col.appendChild(img);
    } else {
      const placeholder = document.createElement('span');
      placeholder.className = 'msc-col__placeholder';
      placeholder.textContent = '点此添加图片';
      placeholder.setAttribute('contenteditable', 'false');
      col.appendChild(placeholder);
    }
    container.appendChild(col);
  }

  insertBlockAtCaret(editor, container);
}

/**
 * 为编辑器挂载"分栏列占位点击 → 选图填充"的交互。
 * 返回 destroy 函数。
 */
export function attachColumnPlaceholderHandler(editor, onChange) {
  if (!editor) return () => {};
  const handler = async (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    if (!t.classList.contains('msc-col__placeholder')) return;
    e.preventDefault();
    e.stopPropagation();
    const col = t.closest('.msc-col');
    if (!col) return;
    // 弹起文件选择器
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const url = await fileToDataUrl(file);
      // 替换 placeholder 为 <img>
      col.innerHTML = '';
      const img = document.createElement('img');
      img.src = url;
      img.className = 'msc-img';
      img.setAttribute('draggable', 'false');
      img.alt = '';
      col.appendChild(img);
      onChange?.();
    };
    input.click();
  };
  editor.addEventListener('click', handler);
  return () => editor.removeEventListener('click', handler);
}

/* =========================================================================
 * 2) 表格
 * ========================================================================= */

/**
 * 构造 table DOM
 */
function buildTableEl(rows, cols) {
  const wrap = document.createElement('div');
  wrap.className = 'msc-table-wrap';
  wrap.setAttribute('data-msc-table', '1');

  const table = document.createElement('table');
  table.className = 'msc-table';
  const tbody = document.createElement('tbody');
  for (let r = 0; r < rows; r++) {
    const tr = document.createElement('tr');
    for (let c = 0; c < cols; c++) {
      const td = document.createElement('td');
      td.innerHTML = '<br />';
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

/**
 * 插入表格
 */
export function insertTableIntoEditor(editor, { rows = 3, cols = 3 } = {}) {
  if (!editor) return;
  const r = Math.max(1, Math.min(20, Math.floor(rows) || 3));
  const c = Math.max(1, Math.min(10, Math.floor(cols) || 3));
  const wrap = buildTableEl(r, c);
  insertBlockAtCaret(editor, wrap);

  // 将光标放到第一个单元格
  try {
    const firstCell = wrap.querySelector('td');
    if (firstCell) {
      const range = document.createRange();
      range.selectNodeContents(firstCell);
      range.collapse(true);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      firstCell.focus?.();
    }
  } catch { /* ignore */ }
}

/**
 * 为编辑器挂载表格 hover 控制条（+行 / +列 / -行 / -列）
 * 返回 destroy 函数
 */
export function attachTableControls(editor, onChange) {
  if (!editor) return () => {};

  // 确保编辑器父级是定位容器（和图片 resizer 一致，一般已由 wordImageEditor 设置）
  if (editor.parentElement) {
    const cs = getComputedStyle(editor.parentElement);
    if (cs.position === 'static') editor.parentElement.style.position = 'relative';
  }

  // 控制条容器
  const overlay = document.createElement('div');
  overlay.className = 'msc-table-ctl';
  overlay.style.display = 'none';
  overlay.innerHTML = `
    <button type="button" class="msc-table-ctl__btn" data-act="add-col" title="在右侧添加列">
      <span class="msc-table-ctl__v">+</span>
    </button>
    <button type="button" class="msc-table-ctl__btn msc-table-ctl__btn--row" data-act="add-row" title="在底部添加行">
      <span class="msc-table-ctl__h">+</span>
    </button>
    <button type="button" class="msc-table-ctl__btn msc-table-ctl__btn--del-col" data-act="del-col" title="删除最后一列">−</button>
    <button type="button" class="msc-table-ctl__btn msc-table-ctl__btn--del-row" data-act="del-row" title="删除最后一行">−</button>
  `;
  editor.parentElement?.appendChild(overlay);

  let currentWrap = null;

  function layout() {
    if (!currentWrap || !editor.parentElement) {
      overlay.style.display = 'none';
      return;
    }
    const wrapRect = editor.parentElement.getBoundingClientRect();
    const r = currentWrap.getBoundingClientRect();
    overlay.style.display = 'block';
    overlay.style.left = `${r.left - wrapRect.left}px`;
    overlay.style.top = `${r.top - wrapRect.top}px`;
    overlay.style.width = `${r.width}px`;
    overlay.style.height = `${r.height}px`;
  }

  function onMouseOver(e) {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    const wrap = t.closest('.msc-table-wrap');
    if (wrap && editor.contains(wrap)) {
      currentWrap = wrap;
      layout();
    }
  }
  function onMouseLeaveEditor() {
    currentWrap = null;
    overlay.style.display = 'none';
  }

  function addCol() {
    if (!currentWrap) return;
    currentWrap.querySelectorAll('tr').forEach((tr) => {
      const td = document.createElement('td');
      td.innerHTML = '<br />';
      tr.appendChild(td);
    });
    layout();
    onChange?.();
  }
  function addRow() {
    if (!currentWrap) return;
    const tbody = currentWrap.querySelector('tbody');
    const firstRow = tbody?.querySelector('tr');
    if (!tbody || !firstRow) return;
    const colCount = firstRow.children.length;
    const tr = document.createElement('tr');
    for (let i = 0; i < colCount; i++) {
      const td = document.createElement('td');
      td.innerHTML = '<br />';
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
    layout();
    onChange?.();
  }
  function delCol() {
    if (!currentWrap) return;
    const firstRow = currentWrap.querySelector('tr');
    if (!firstRow || firstRow.children.length <= 1) return; // 至少保留 1 列
    currentWrap.querySelectorAll('tr').forEach((tr) => {
      if (tr.lastElementChild) tr.removeChild(tr.lastElementChild);
    });
    layout();
    onChange?.();
  }
  function delRow() {
    if (!currentWrap) return;
    const tbody = currentWrap.querySelector('tbody');
    if (!tbody || tbody.children.length <= 1) return; // 至少保留 1 行
    tbody.removeChild(tbody.lastElementChild);
    layout();
    onChange?.();
  }

  function onOverlayClick(e) {
    const btn = e.target instanceof HTMLElement ? e.target.closest('[data-act]') : null;
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const act = btn.getAttribute('data-act');
    if (act === 'add-col') addCol();
    else if (act === 'add-row') addRow();
    else if (act === 'del-col') delCol();
    else if (act === 'del-row') delRow();
  }

  function onScrollOrResize() {
    if (currentWrap) layout();
  }

  editor.addEventListener('mouseover', onMouseOver);
  editor.addEventListener('mouseleave', onMouseLeaveEditor);
  overlay.addEventListener('click', onOverlayClick);
  window.addEventListener('resize', onScrollOrResize);
  editor.addEventListener('scroll', onScrollOrResize);
  editor.parentElement?.addEventListener('scroll', onScrollOrResize);

  return () => {
    editor.removeEventListener('mouseover', onMouseOver);
    editor.removeEventListener('mouseleave', onMouseLeaveEditor);
    overlay.removeEventListener('click', onOverlayClick);
    window.removeEventListener('resize', onScrollOrResize);
    editor.removeEventListener('scroll', onScrollOrResize);
    editor.parentElement?.removeEventListener('scroll', onScrollOrResize);
    overlay.remove();
  };
}
