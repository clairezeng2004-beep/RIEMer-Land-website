/**
 * wordDocBlocks
 * -------------
 * 给 contentEditable 的 Word 风格富文本编辑器提供两种"块"能力：
 *
 *   1) insertColumnsIntoEditor(editor, { count, files })
 *      —— 插入一个多栏并排容器（类似飞书的图片分栏），
 *         每栏既可以放图片，也可以输入文字。
 *         结构：
 *         <div class="msc-cols msc-cols--2" data-cols="2">
 *           <div class="msc-col">
 *             <img class="msc-img" src="..." />
 *           </div>
 *           <div class="msc-col">
 *             <p><br /></p>
 *             <p><br /></p>
 *           </div>
 *           <div class="msc-col">
 *             <!-- 填了文字的栏：一个可编辑 <p>（和正文一样的富文本行为） -->
 *             <p>这里是任意文字…</p>
 *           </div>
 *         </div>
 *
 *      兼容历史数据：如果发现旧结构里的 <span class="msc-col__placeholder">，
 *      placeholder handler 仍会把它当作"插图"按钮处理（点击 → 选图填充），
 *      保证早期文档打开后依然可用。
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
 *   - 高亮块是纯 HTML 结构，颜色通过 class 控制，Emoji 通过工具栏交互替换文本。
 */

import {
  EDITOR_IMAGE_COMPRESSION_OPTIONS,
  imageFileToCompressedDataUrl,
} from './imageCompression';
import { normalizeOrderedListNumbering } from './orderedListNumbering';

const CALLOUT_PENDING_DELETE_CLASS = 'msc-callout--pending-delete';
const ZERO_WIDTH_SPACE = '\u200B';

function imageFileToEditorDataUrl(file) {
  return imageFileToCompressedDataUrl(file, EDITOR_IMAGE_COMPRESSION_OPTIONS);
}

function getScrollSnapshot(editor) {
  const nodes = [{ node: window, top: window.scrollY, left: window.scrollX }];
  let el = editor;
  while (el) {
    nodes.push({ node: el, top: el.scrollTop, left: el.scrollLeft });
    el = el.parentElement;
  }
  return nodes;
}

function restoreScrollSnapshot(snapshot) {
  snapshot.forEach(({ node, top, left }) => {
    if (node === window) {
      window.scrollTo(left, top);
    } else {
      node.scrollTop = top;
      node.scrollLeft = left;
    }
  });
}

/** 在光标处插入一段 HTML（作为独立块），若光标不在编辑器内则追加到末尾 */
function insertBlockAtCaret(editor, node, { addTrailingParagraph = true } = {}) {
  const sel = window.getSelection();
  let inserted = false;
  if (sel && sel.rangeCount > 0) {
    const range = sel.getRangeAt(0);
    if (editor.contains(range.commonAncestorContainer)) {
      const insertRange = range.cloneRange();
      insertRange.collapse(false);
      insertRange.insertNode(node);
      inserted = true;
    }
  }
  if (!inserted) editor.appendChild(node);

  if (!addTrailingParagraph) return;

  // 插一个空段落在后面，方便继续输入
  const trailer = document.createElement('p');
  trailer.style.textAlign = 'left';
  trailer.setAttribute('align', 'left');
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

function removeEmptyParagraphAfter(node) {
  const next = node?.nextElementSibling;
  if (!next || next.tagName?.toLowerCase() !== 'p') return false;
  if (next.classList?.contains('msc-img-caption')) return false;
  if (next.querySelector?.('img, video, table, iframe')) return false;
  const text = String(next.textContent || '').replace(/\u200B/g, '').trim();
  if (text) return false;
  const isEmpty = [...next.childNodes].every((child) => {
    if (child.nodeType === 3) return !String(child.textContent || '').replace(/\u200B/g, '').trim();
    if (child.nodeType !== 1) return true;
    return child.tagName?.toLowerCase() === 'br';
  });
  if (!isEmpty) return false;
  next.remove();
  return true;
}

function placeCaretAtStart(node) {
  try {
    const range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    node.focus?.();
  } catch { /* ignore */ }
}

function getCalloutBodyEmpty(body) {
  if (!body) return true;
  return !String(body.textContent || '').replace(/\u200B/g, '').trim()
    && !body.querySelector?.('img, video, table, iframe');
}

function ensureCalloutEditableBody(body) {
  if (!body) return;
  const placeholder = body.getAttribute('data-placeholder') || '在这里输入高亮内容';
  body.setAttribute('data-placeholder', placeholder);
  if (String(body.textContent || '').trim() === placeholder && !body.querySelector?.('img, video, table, iframe')) {
    body.innerHTML = `<p>${ZERO_WIDTH_SPACE}</p>`;
  }
  body.toggleAttribute('data-empty', getCalloutBodyEmpty(body));
  if (!body.querySelector('p, h1, h2, h3, h4, ul, ol, blockquote')) {
    const p = document.createElement('p');
    p.textContent = ZERO_WIDTH_SPACE;
    body.appendChild(p);
  } else if (getCalloutBodyEmpty(body)) {
    const first = body.querySelector('p, h1, h2, h3, h4, li, blockquote');
    if (first && !first.querySelector?.('img, video, table, iframe')) {
      first.textContent = ZERO_WIDTH_SPACE;
    }
  }
}

function normalizeCalloutStructure(callout) {
  if (!callout) return false;
  let changed = false;

  let emoji = callout.querySelector(':scope > .msc-callout__emoji');
  if (!emoji) {
    emoji = document.createElement('span');
    emoji.className = 'msc-callout__emoji';
    emoji.setAttribute('contenteditable', 'false');
    emoji.setAttribute('role', 'button');
    emoji.setAttribute('tabindex', '0');
    emoji.setAttribute('title', '选择 Emoji');
    emoji.textContent = '💡';
    callout.insertBefore(emoji, callout.firstChild);
    changed = true;
  }

  let body = callout.querySelector(':scope > .msc-callout__body');
  if (!body) {
    body = document.createElement('div');
    body.className = 'msc-callout__body';
    callout.appendChild(body);
    changed = true;
  }

  const strayNodes = Array.from(callout.childNodes).filter((node) => {
    if (node === emoji || node === body) return false;
    if (node.nodeType === Node.TEXT_NODE) {
      return Boolean(String(node.textContent || '').replace(/\u200B/g, '').trim());
    }
    return true;
  });

  strayNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = String(node.textContent || '').replace(/\s+/g, ' ').trim();
      node.remove();
      if (!text) return;
      const p = document.createElement('p');
      p.textContent = text;
      body.appendChild(p);
    } else {
      body.appendChild(node);
    }
    changed = true;
  });

  Array.from(callout.childNodes).forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE && !String(node.textContent || '').trim()) {
      node.remove();
      changed = true;
    }
  });

  ensureCalloutEditableBody(body);
  return changed;
}

function updateCalloutPlaceholders(editor) {
  let changed = false;
  editor?.querySelectorAll?.('.msc-callout').forEach((callout) => {
    if (normalizeCalloutStructure(callout)) changed = true;
  });
  editor?.querySelectorAll?.('.msc-callout__body').forEach(ensureCalloutEditableBody);
  return changed;
}

function focusCalloutBody(body, { atEnd = false } = {}) {
  ensureCalloutEditableBody(body);
  const target = body.querySelector('p, h1, h2, h3, h4, li, blockquote') || body;
  if (getCalloutBodyEmpty(body)) {
    try {
      let textNode = Array.from(target.childNodes).find((node) => node.nodeType === Node.TEXT_NODE);
      if (!textNode) {
        textNode = document.createTextNode(ZERO_WIDTH_SPACE);
        target.insertBefore(textNode, target.firstChild);
      }
      const range = document.createRange();
      range.setStart(textNode, 0);
      range.collapse(true);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      target.focus?.();
      return;
    } catch {
      /* fall through */
    }
  }
  if (atEnd) placeCaretAtEnd(target);
  else placeCaretAtStart(target);
}

function clearPendingCalloutSelection(editor, except = null) {
  editor?.querySelectorAll?.(`.${CALLOUT_PENDING_DELETE_CLASS}`).forEach((callout) => {
    if (callout !== except) callout.classList.remove(CALLOUT_PENDING_DELETE_CLASS);
  });
}

function insertParagraphAfterRemovedCallout(callout) {
  const p = document.createElement('p');
  p.innerHTML = '<br />';
  callout.parentNode?.insertBefore(p, callout.nextSibling);
  callout.remove();
  placeCaretAtStart(p);
}

function getPendingSelectedCallout(editor) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const pending = editor?.querySelector?.(`.${CALLOUT_PENDING_DELETE_CLASS}`);
  if (!pending) return null;
  const range = sel.getRangeAt(0);
  try {
    return range.intersectsNode(pending) ? pending : null;
  } catch {
    return null;
  }
}

function getCaretContainerElement() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  return {
    range,
    element: range.startContainer?.nodeType === Node.ELEMENT_NODE
      ? range.startContainer
      : range.startContainer?.parentElement,
  };
}

function isRangeAtStartOfElement(range, element) {
  if (!range || !element) return false;
  const probe = document.createRange();
  probe.selectNodeContents(element);
  try {
    probe.setEnd(range.startContainer, range.startOffset);
  } catch {
    return false;
  }
  return !String(probe.toString() || '').replace(/\u200B/g, '').trim();
}

function getPreviousEmptyCalloutFromCaret(editor) {
  const caret = getCaretContainerElement();
  if (!caret?.element || !editor?.contains?.(caret.element)) return null;
  if (caret.element.closest?.('.msc-callout')) return null;

  const block = caret.element.closest?.('p, h1, h2, h3, h4, li, blockquote, div');
  if (!block || block === editor || !editor.contains(block)) return null;
  if (!isRangeAtStartOfElement(caret.range, block)) return null;

  const previous = block.previousElementSibling;
  if (!previous?.classList?.contains('msc-callout')) return null;
  const body = previous.querySelector('.msc-callout__body');
  return getCalloutBodyEmpty(body) ? previous : null;
}

function selectCalloutForDeletion(editor, callout) {
  if (!callout || !editor?.contains?.(callout)) return false;
  clearPendingCalloutSelection(editor, callout);
  callout.classList.add(CALLOUT_PENDING_DELETE_CLASS);
  const range = document.createRange();
  range.selectNode(callout);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
  return true;
}

function handleCalloutDeleteKey(editor, key) {
  const sel = window.getSelection();
  const pending = getPendingSelectedCallout(editor);
  if (pending) {
    insertParagraphAfterRemovedCallout(pending);
    return 'removed';
  }

  if (key === 'Backspace') {
    const previousEmptyCallout = getPreviousEmptyCalloutFromCaret(editor);
    if (previousEmptyCallout) {
      selectCalloutForDeletion(editor, previousEmptyCallout);
      return 'selected';
    }
  }

  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return false;
  const anchor = sel.anchorNode?.nodeType === 1 ? sel.anchorNode : sel.anchorNode?.parentElement;
  const callout = anchor?.closest?.('.msc-callout');
  if (!callout || !editor.contains(callout)) return false;
  const body = callout.querySelector('.msc-callout__body');
  if (body && !getCalloutBodyEmpty(body)) return false;

  if (callout.classList.contains(CALLOUT_PENDING_DELETE_CLASS)) {
    insertParagraphAfterRemovedCallout(callout);
    return 'removed';
  }

  selectCalloutForDeletion(editor, callout);
  return 'selected';
}

function insertTextAtSelection(text) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  const range = sel.getRangeAt(0);
  range.deleteContents();
  const node = document.createTextNode(text);
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
  return true;
}

function buildEmptyColumnContent() {
  // 只放一个空段落：避免图片插入后其前/后出现多余空行（栏高度由 CSS min-height 控制）
  const frag = document.createDocumentFragment();
  const p = document.createElement('p');
  p.style.textAlign = 'left';
  p.setAttribute('align', 'left');
  p.innerHTML = '<br />';
  frag.appendChild(p);
  return frag;
}

function appendColumnImage(col, src) {
  const wrap = document.createElement('p');
  wrap.className = 'msc-img-wrap';
  wrap.style.textAlign = 'center';

  const img = document.createElement('img');
  img.src = src;
  img.className = 'msc-img';
  // 允许选中后随光标拖拽移动（编辑器内）
  img.setAttribute('draggable', 'true');
  img.setAttribute('loading', 'lazy');
  img.setAttribute('decoding', 'async');
  img.alt = '';
  wrap.appendChild(img);
  col.appendChild(wrap);
  return img;
}

function getColumns(container) {
  return [...container.children].filter((el) => el.classList?.contains('msc-col'));
}

function ensureColumnMeta(container) {
  if (!container) return [];
  const cols = getColumns(container);
  const n = cols.length;
  container.setAttribute('data-cols', String(n));
  container.removeAttribute('data-cols-label');
  // 先给一个等分百分比兜底；布局完成后 updateColumnLabels 会按真实宽度刷新
  cols.forEach((col) => {
    if (!col.getAttribute('data-col-label')) {
      col.setAttribute('data-col-label', `${Math.round(100 / n)}%`);
    }
  });
  return cols;
}

/** 按各栏真实宽度刷新右上角"占页面宽度百分比"标签（拖拽/增删栏后实时更新） */
function updateColumnLabels(container) {
  if (!container) return;
  const cols = getColumns(container);
  if (cols.length === 0) return;
  const widths = cols.map((c) => c.getBoundingClientRect().width);
  const total = widths.reduce((s, w) => s + w, 0) || 1;
  cols.forEach((col, i) => {
    col.setAttribute('data-col-label', `${Math.round((widths[i] / total) * 100)}%`);
  });
}

function setColumnTrackFractions(container, widths) {
  const total = widths.reduce((sum, width) => sum + Math.max(0, width), 0) || 1;
  container.style.gridTemplateColumns = widths
    .map((width) => `${Math.max(0.001, width / total).toFixed(6)}fr`)
    .join(' ');
}

function normalizePercentColumnTracks(container) {
  if (!container || !/%/.test(container.style.gridTemplateColumns || '')) return;
  const cols = getColumns(container);
  if (cols.length === 0) return;
  const widths = cols.map((col) => col.getBoundingClientRect().width);
  setColumnTrackFractions(container, widths);
}

function ensureColumnResizers(container) {
  if (!container) return;
  const cols = ensureColumnMeta(container);
  const needed = Math.max(0, cols.length - 1);
  const existing = [...container.querySelectorAll(':scope > .msc-col-resizer')];
  // 幂等：手柄数量正确时直接复用（仅校正索引），不再每次 hover 都销毁重建。
  // 旧实现会在鼠标移到分栏上时反复删除/重建手柄，导致用户正要按住分隔线拖动时，
  // 手柄被从指针下移除 → pointerdown 落空 → 分隔线“拖不动”。
  if (existing.length === needed) {
    existing.forEach((handle, i) => handle.setAttribute('data-resizer-index', String(i)));
    return;
  }
  existing.forEach((el) => el.remove());
  for (let i = 0; i < needed; i += 1) {
    const handle = document.createElement('span');
    handle.className = 'msc-col-resizer';
    handle.setAttribute('contenteditable', 'false');
    handle.setAttribute('data-resizer-index', String(i));
    handle.setAttribute('title', '拖拽调整相邻两栏宽度');
    container.appendChild(handle);
  }
}

function layoutColumnResizers(container) {
  if (!container) return;
  normalizePercentColumnTracks(container);
  updateColumnLabels(container); // 顺带刷新各栏百分比标签
  const cols = getColumns(container);
  const handles = [...container.querySelectorAll(':scope > .msc-col-resizer')];
  if (cols.length < 2 || handles.length === 0) return;
  const base = container.getBoundingClientRect();
  handles.forEach((handle, index) => {
    const leftCol = cols[index];
    const rightCol = cols[index + 1];
    if (!leftCol || !rightCol) return;
    const a = leftCol.getBoundingClientRect();
    const b = rightCol.getBoundingClientRect();
    const x = ((a.right + b.left) / 2) - base.left;
    handle.style.left = `${x}px`;
  });
}

/** 某一栏是否为空（无图片、无非空白文字） */
function isEmptyColumn(col) {
  if (!col) return true;
  if (col.querySelector('img')) return false;
  // 去掉零宽空格(U+200B)后再判断是否只剩空白
  const ZERO_WIDTH = new RegExp(String.fromCharCode(0x200B), 'g');
  return (col.textContent || '').replace(ZERO_WIDTH, '').trim() === '';
}

/** 把光标放到某节点内容末尾 */
function placeCaretAtEnd(node) {
  try {
    const range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  } catch { /* ignore */ }
}

function cloneBlockShell(block) {
  const next = document.createElement(block.tagName.toLowerCase());
  Array.from(block.attributes || []).forEach((attr) => {
    next.setAttribute(attr.name, attr.value);
  });
  return next;
}

function appendNodesOrBreak(target, nodes) {
  if (!target) return;
  nodes.forEach((node) => target.appendChild(node));
  if (!target.childNodes.length) target.innerHTML = '<br />';
}

function getDirectChildWithin(parent, node) {
  let current = node;
  while (current && current.parentNode !== parent) current = current.parentNode;
  return current || null;
}

function splitBlockAtCaretLine(editor, block) {
  if (!editor || !block || !editor.contains(block)) return block;
  const tag = block.tagName?.toLowerCase();
  if (!['p', 'h1', 'h2', 'h3', 'blockquote', 'div'].includes(tag)) return block;
  if (!block.querySelector?.('br')) return block;

  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return block;
  const anchor = sel.anchorNode;
  if (!anchor || !block.contains(anchor)) return block;
  const directChild = anchor === block ? block.childNodes[sel.anchorOffset] : getDirectChildWithin(block, anchor);
  const childNodes = Array.from(block.childNodes);
  let cursorIndex = directChild ? childNodes.indexOf(directChild) : sel.anchorOffset;
  if (cursorIndex < 0) cursorIndex = Math.max(0, Math.min(childNodes.length - 1, sel.anchorOffset));

  let start = cursorIndex;
  while (start > 0 && childNodes[start - 1]?.nodeName !== 'BR') start -= 1;
  let end = cursorIndex;
  while (end < childNodes.length && childNodes[end]?.nodeName !== 'BR') end += 1;

  const beforeNodes = childNodes.slice(0, start);
  const currentNodes = childNodes.slice(start, end);
  const afterNodes = childNodes.slice(end + 1);
  if (!beforeNodes.length && !afterNodes.length) return block;

  const beforeBlock = beforeNodes.length ? cloneBlockShell(block) : null;
  const currentBlock = cloneBlockShell(block);
  const afterBlock = afterNodes.length ? cloneBlockShell(block) : null;
  appendNodesOrBreak(beforeBlock, beforeNodes);
  appendNodesOrBreak(currentBlock, currentNodes);
  appendNodesOrBreak(afterBlock, afterNodes);

  if (beforeBlock) block.parentNode?.insertBefore(beforeBlock, block);
  block.parentNode?.insertBefore(currentBlock, block);
  if (afterBlock) block.parentNode?.insertBefore(afterBlock, block);
  block.remove();
  placeCaretAtEnd(currentBlock);
  return currentBlock;
}

export function attachEditableLinkOpener(editor) {
  if (!editor) return () => {};
  const handler = (e) => {
    const target = e.target instanceof HTMLElement ? e.target : e.target?.parentElement;
    const link = target?.closest?.('a[href]');
    if (!link || !editor.contains(link)) return;
    const href = link.getAttribute('href');
    if (!href || href.startsWith('#')) return;
    e.preventDefault();
    e.stopPropagation();
    window.open(href, '_blank', 'noopener,noreferrer');
  };
  editor.addEventListener('click', handler);
  return () => editor.removeEventListener('click', handler);
}

/** 删栏后：把剩余栏还原为等分，并刷新栏数标签/分隔手柄 */
function redistributeColumns(container) {
  const cols = getColumns(container);
  const n = cols.length;
  container.classList.remove('msc-cols--1', 'msc-cols--2', 'msc-cols--3', 'msc-cols--4');
  container.classList.add(`msc-cols--${n}`);
  // 清掉拖拽时写入的内联宽度，交回 .msc-cols--N 的等分规则
  container.style.gridTemplateColumns = '';
  ensureColumnMeta(container);
  ensureColumnResizers(container);
  ensureColumnAdders(container);
  requestAnimationFrame(() => {
    layoutColumnResizers(container);
    layoutColumnAdders(container);
  });
}

/** 生成/校正「新增一栏」加号按钮：左端、各栏之间、右端各一个（最多 4 栏） */
function ensureColumnAdders(container) {
  if (!container) return;
  const cols = getColumns(container);
  const needed = cols.length >= 4 ? 0 : cols.length + 1; // 最多 4 栏
  const existing = [...container.querySelectorAll(':scope > .msc-col-adder')];
  // 幂等：数量正确就复用（仅校正索引），不每次 hover 都销毁重建。
  // 否则鼠标移动到加号上时按钮被重建，click 落在已脱离 DOM 的旧节点上 → 点击无效。
  if (existing.length === needed) {
    existing.forEach((adder, i) => adder.setAttribute('data-adder-index', String(i)));
    return;
  }
  existing.forEach((el) => el.remove());
  for (let i = 0; i < needed; i += 1) {
    const adder = document.createElement('span');
    adder.className = 'msc-col-adder';
    adder.setAttribute('contenteditable', 'false');
    adder.setAttribute('data-adder-index', String(i));
    adder.setAttribute('title', '在此处新增一栏');
    adder.textContent = '+';
    container.appendChild(adder);
  }
}

/** 把加号按钮定位到对应栏的左/右边界 */
function layoutColumnAdders(container) {
  if (!container) return;
  const cols = getColumns(container);
  const adders = [...container.querySelectorAll(':scope > .msc-col-adder')];
  if (cols.length === 0 || adders.length === 0) return;
  const base = container.getBoundingClientRect();
  adders.forEach((adder) => {
    const i = Number(adder.getAttribute('data-adder-index'));
    let x;
    if (i <= 0) {
      x = cols[0].getBoundingClientRect().left - base.left;
    } else if (i >= cols.length) {
      x = cols[cols.length - 1].getBoundingClientRect().right - base.left;
    } else {
      const a = cols[i - 1].getBoundingClientRect();
      const b = cols[i].getBoundingClientRect();
      x = ((a.right + b.left) / 2) - base.left;
    }
    adder.style.left = `${x}px`;
  });
}

/** 在第 index 个位置插入一个空栏（index===栏数时追加到末尾） */
function insertEmptyColumnAt(container, index) {
  const cols = getColumns(container);
  if (cols.length >= 4) return;
  const col = document.createElement('div');
  col.className = 'msc-col';
  col.appendChild(buildEmptyColumnContent());
  const ref = cols[index];
  if (ref) {
    container.insertBefore(col, ref);
  } else {
    // 追加：插到所有 .msc-col 之后、辅助元素（resizer/adder）之前
    const firstAux = container.querySelector(':scope > .msc-col-resizer, :scope > .msc-col-adder');
    if (firstAux) container.insertBefore(col, firstAux);
    else container.appendChild(col);
  }
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
  const scrollSnapshot = getScrollSnapshot(editor);

  const container = document.createElement('div');
  container.className = `msc-cols msc-cols--${n}`;
  container.setAttribute('data-cols', String(n));

  const datas = [];
  for (let i = 0; i < n; i++) {
    const f = files[i];
    if (f && f.type?.startsWith('image/')) {
      // eslint-disable-next-line no-await-in-loop
      const url = await imageFileToEditorDataUrl(f);
      datas[i] = url;
    } else {
      datas[i] = null;
    }
  }

  for (let i = 0; i < n; i++) {
    const col = document.createElement('div');
    col.className = 'msc-col';
    if (datas[i]) {
      appendColumnImage(col, datas[i]);
    } else {
      col.appendChild(buildEmptyColumnContent());
    }
    container.appendChild(col);
  }
  ensureColumnResizers(container);
  ensureColumnAdders(container);

  insertBlockAtCaret(editor, container, { addTrailingParagraph: false });
  removeEmptyParagraphAfter(container);
  restoreScrollSnapshot(scrollSnapshot);
  requestAnimationFrame(() => {
    removeEmptyParagraphAfter(container);
    layoutColumnResizers(container);
    layoutColumnAdders(container);
    try {
      const range = document.createRange();
      range.selectNode(container);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    } catch { /* ignore */ }
    restoreScrollSnapshot(scrollSnapshot);
  });
}

/* =========================================================================
 * 2) 高亮块
 * ========================================================================= */

export function insertCalloutIntoEditor(editor, { tone = 'sage' } = {}) {
  if (!editor) return;
  const safeTone = ['sage', 'sun', 'rose', 'sky', 'lavender'].includes(tone) ? tone : 'sage';

  const block = document.createElement('div');
  block.className = `msc-callout msc-callout--${safeTone}`;
  block.setAttribute('data-callout-tone', safeTone);

  const emoji = document.createElement('span');
  emoji.className = 'msc-callout__emoji';
  emoji.setAttribute('contenteditable', 'false');
  emoji.setAttribute('role', 'button');
  emoji.setAttribute('tabindex', '0');
  emoji.setAttribute('title', '选择 Emoji');
  emoji.textContent = '💡';

  const body = document.createElement('div');
  body.className = 'msc-callout__body';
  body.setAttribute('data-placeholder', '在这里输入高亮内容');
  body.setAttribute('data-empty', '');
  const p = document.createElement('p');
  p.innerHTML = '<br />';
  body.appendChild(p);

  block.appendChild(emoji);
  block.appendChild(body);
  insertBlockAtCaret(editor, block);
  placeCaretAtStart(p);
}

/**
 * 为编辑器挂载"分栏列占位点击 → 选图 / 改为文字输入"的交互。
 * 返回 destroy 函数。
 *
 * 兼容三种点击目标（都在空分栏里）：
 *   - 新版「点此添加图片」按钮：.msc-col__act--img
 *   - 新版「输入文字」按钮    ：.msc-col__act--text
 *   - 旧版占位 span            ：.msc-col__placeholder（当作"添加图片"处理）
 */
export function attachColumnPlaceholderHandler(editor, onChange) {
  if (!editor) return () => {};
  let dragState = null;

  const refreshAll = () => {
    editor.querySelectorAll('.msc-cols').forEach((container) => {
      ensureColumnResizers(container);
      ensureColumnAdders(container);
      layoutColumnResizers(container);
      layoutColumnAdders(container);
    });
  };

  /** 把指定 col 的内容替换为一张图片（通过文件选择器） */
  const pickAndInsertImage = (col) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const url = await imageFileToEditorDataUrl(file);
      col.innerHTML = '';
      const img = appendColumnImage(col, url);
      // 分栏图片不再自动追加空行；选区停在图片节点上，避免生成右侧光标。
      try {
        const range = document.createRange();
        range.selectNode(img);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      } catch { /* ignore */ }
      const container = col.closest('.msc-cols');
      ensureColumnMeta(container);
      requestAnimationFrame(() => layoutColumnResizers(container));
      onChange?.();
    };
    input.click();
  };

  /** 把指定 col 的内容替换为一个可编辑的 <p>，并把光标放进去 */
  const switchColToText = (col) => {
    col.innerHTML = '';
    const p = document.createElement('p');
    // 用 <br> 占位，保证空 <p> 在 contentEditable 里有可落脚的基线
    p.style.textAlign = 'left';
    p.setAttribute('align', 'left');
    p.innerHTML = '<br />';
    col.appendChild(p);
    try {
      const range = document.createRange();
      range.setStart(p, 0);
      range.collapse(true);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    } catch { /* ignore */ }
    const container = col.closest('.msc-cols');
    ensureColumnMeta(container);
    requestAnimationFrame(() => layoutColumnResizers(container));
    onChange?.();
  };

  const selectColumn = (col) => {
    const container = col.closest('.msc-cols');
    if (!container || !editor.contains(container)) return;
    getColumns(container).forEach((item) => item.classList.toggle('msc-col--selected', item === col));
  };

  const clearColumnSelection = () => {
    editor.querySelectorAll('.msc-col--selected').forEach((item) => item.classList.remove('msc-col--selected'));
  };

  const ensureCaretInColumn = (col, { force = false } = {}) => {
    if (!col || !editor.contains(col)) return;
    const sel = window.getSelection();
    const anchor = sel?.anchorNode;
    if (!force && anchor && col.contains(anchor)) return;
    const target =
      col.querySelector('p, h1, h2, h3, h4, ul, ol, blockquote')
      || col;
    placeCaretAtStart(target);
  };

  const syncSelectedColumnFromCaret = () => {
    const sel = window.getSelection();
    const anchor =
      sel?.anchorNode?.nodeType === 1 ? sel.anchorNode : sel?.anchorNode?.parentElement;
    const col = anchor?.closest?.('.msc-col');
    if (col && editor.contains(col)) {
      selectColumn(col);
      return;
    }
    if (anchor && editor.contains(anchor)) clearColumnSelection();
  };

  const isColumnControlTarget = (target) => (
    target?.closest?.('.msc-col-resizer, .msc-col-adder, .msc-col__act, .msc-col__placeholder')
  );

  const handler = (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;

    // 0) 点击「+」加号 → 在对应位置新增一栏并重排
    const adder = t.closest('.msc-col-adder');
    if (adder && editor.contains(adder)) {
      e.preventDefault();
      e.stopPropagation();
      const container = adder.closest('.msc-cols');
      if (!container) return;
      const index = Number(adder.getAttribute('data-adder-index'));
      insertEmptyColumnAt(container, index);
      redistributeColumns(container);
      onChange?.();
      return;
    }

    const col = t.closest('.msc-col');
    if (col && editor.contains(col)) {
      selectColumn(col);
      requestAnimationFrame(() => {
        ensureCaretInColumn(col);
        layoutColumnResizers(col.closest('.msc-cols'));
      });
    } else if (editor.contains(t)) {
      clearColumnSelection();
    }

    // 1) 历史文档里的「输入文字」按钮
    const textBtn = t.closest('.msc-col__act--text');
    if (textBtn && editor.contains(textBtn)) {
      const col = textBtn.closest('.msc-col');
      if (!col) return;
      e.preventDefault();
      e.stopPropagation();
      switchColToText(col);
      return;
    }

    // 2) 历史文档里的「点此添加图片」按钮
    const imgBtn = t.closest('.msc-col__act--img');
    if (imgBtn && editor.contains(imgBtn)) {
      const col = imgBtn.closest('.msc-col');
      if (!col) return;
      e.preventDefault();
      e.stopPropagation();
      pickAndInsertImage(col);
      return;
    }

    // 3) 旧版占位 span（历史文档兼容）
    if (t.classList.contains('msc-col__placeholder')) {
      const col = t.closest('.msc-col');
      if (!col) return;
      e.preventDefault();
      e.stopPropagation();
      pickAndInsertImage(col);
    }
  };

  const onMouseOver = (e) => {
    if (dragState) return; // 拖拽进行中不要重建手柄，避免打断拖动
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    const container = t.closest('.msc-cols');
    if (!container || !editor.contains(container)) return;
    ensureColumnResizers(container);
    ensureColumnAdders(container);
    layoutColumnResizers(container);
    layoutColumnAdders(container);
  };

  const onPointerDown = (e) => {
    const target = e.target instanceof HTMLElement ? e.target : null;
    const pressedCol = target?.closest('.msc-col');
    if (pressedCol && editor.contains(pressedCol)) {
      selectColumn(pressedCol);
      if (!isColumnControlTarget(target) && !target.closest('img')) {
        requestAnimationFrame(() => {
          ensureCaretInColumn(pressedCol, { force: true });
          syncSelectedColumnFromCaret();
        });
      }
    }

    const handle = e.target instanceof HTMLElement ? e.target.closest('.msc-col-resizer') : null;
    if (!handle || !editor.contains(handle)) return;
    const container = handle.closest('.msc-cols');
    if (!container) return;
    const cols = getColumns(container);
    const index = Number(handle.getAttribute('data-resizer-index'));
    const left = cols[index];
    const right = cols[index + 1];
    if (!left || !right) return;

    e.preventDefault();
    e.stopPropagation();

    const leftRect = left.getBoundingClientRect();
    const rightRect = right.getBoundingClientRect();
    const pairLeft = leftRect.left;
    const pairWidth = rightRect.right - leftRect.left;
    const startLeftWidth = leftRect.width;
    const startRightWidth = rightRect.width;
    const colWidths = cols.map((col) => col.getBoundingClientRect().width);

    dragState = {
      container,
      cols,
      index,
      pairLeft,
      pairWidth,
      startLeftWidth,
      startRightWidth,
      colWidths,
    };
    container.classList.add('msc-cols--resizing');
    handle.classList.add('msc-col-resizer--active');
    handle.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e) => {
    if (!dragState) return;
    const {
      container,
      cols,
      index,
      pairLeft,
      pairWidth,
      startLeftWidth,
      startRightWidth,
      colWidths,
    } = dragState;
    const pairTotal = startLeftWidth + startRightWidth;
    const minWidth = Math.min(160, Math.max(72, pairTotal * 0.18));
    const rawLeft = e.clientX - pairLeft;
    const nextLeft = Math.max(minWidth, Math.min(pairWidth - minWidth, rawLeft));
    const nextRight = pairTotal - nextLeft;
    const next = [...colWidths];
    next[index] = nextLeft;
    next[index + 1] = nextRight;
    setColumnTrackFractions(container, next);
    cols[index]?.classList.add('msc-col--selected');
    cols[index + 1]?.classList.add('msc-col--selected');
    layoutColumnResizers(container);
  };

  const finishDrag = () => {
    if (!dragState) return;
    dragState.container.classList.remove('msc-cols--resizing');
    dragState.container.querySelectorAll('.msc-col-resizer--active').forEach((el) => {
      el.classList.remove('msc-col-resizer--active');
    });
    layoutColumnResizers(dragState.container);
    dragState = null;
    onChange?.();
  };

  // 退格删除：分栏全空 → 一次退格删整块；当前栏空 → 删该栏并按新栏数重排
  const onKeyDown = (e) => {
    if (e.key !== 'Backspace' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return;
    const anchor =
      sel.anchorNode?.nodeType === 1 ? sel.anchorNode : sel.anchorNode?.parentElement;
    const container = anchor?.closest?.('.msc-cols');
    if (!container || !editor.contains(container)) return;

    const currentCol = anchor.closest('.msc-col');

    // 当前栏为空 → 退格只删「这一栏」，而不是整个分栏：
    //   删除后若仍有 ≥2 栏 → 按新栏数等分重排；只剩 1 栏 → 取消分栏并保留内容。
    if (currentCol && editor.contains(currentCol) && isEmptyColumn(currentCol)) {
      e.preventDefault();
      currentCol.remove();
      const remaining = getColumns(container);
      if (remaining.length >= 2) {
        redistributeColumns(container);
        placeCaretAtStart(remaining[0]);
      } else if (remaining.length === 1) {
        redistributeColumns(container);
        remaining[0].setAttribute('data-col-label', '100%');
        placeCaretAtStart(remaining[0]);
      } else {
        // 理论上不会出现（分栏至少 2 栏），兜底：删空块
        const prev = container.previousElementSibling;
        const next = container.nextElementSibling;
        container.remove();
        if (prev) placeCaretAtEnd(prev);
        else if (next) placeCaretAtStart(next);
      }
      onChange?.();
    }
  };

  const onScrollOrResize = () => refreshAll();

  refreshAll();
  document.addEventListener('selectionchange', syncSelectedColumnFromCaret);
  editor.addEventListener('click', handler);
  editor.addEventListener('keyup', syncSelectedColumnFromCaret);
  editor.addEventListener('input', syncSelectedColumnFromCaret);
  editor.addEventListener('keydown', onKeyDown);
  editor.addEventListener('mouseover', onMouseOver);
  editor.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', finishDrag);
  window.addEventListener('resize', onScrollOrResize);
  editor.addEventListener('scroll', onScrollOrResize);
  editor.parentElement?.addEventListener('scroll', onScrollOrResize);

  return () => {
    document.removeEventListener('selectionchange', syncSelectedColumnFromCaret);
    editor.removeEventListener('click', handler);
    editor.removeEventListener('keyup', syncSelectedColumnFromCaret);
    editor.removeEventListener('input', syncSelectedColumnFromCaret);
    editor.removeEventListener('keydown', onKeyDown);
    editor.removeEventListener('mouseover', onMouseOver);
    editor.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', finishDrag);
    window.removeEventListener('resize', onScrollOrResize);
    editor.removeEventListener('scroll', onScrollOrResize);
    editor.parentElement?.removeEventListener('scroll', onScrollOrResize);
  };
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
    <button type="button" class="msc-table-ctl__btn msc-table-ctl__btn--select" data-act="select-table" title="全选表格">✣</button>
    <button type="button" class="msc-table-ctl__btn" data-act="add-col" title="在右侧添加列">
      <span class="msc-table-ctl__v">+</span>
    </button>
    <button type="button" class="msc-table-ctl__btn msc-table-ctl__btn--del-col" data-act="del-col" title="删除最后一列">−</button>
    <button type="button" class="msc-table-ctl__btn msc-table-ctl__btn--del-row" data-act="del-row" title="删除最后一行">−</button>
    <div class="msc-table-ctl__insert-line" aria-hidden="true"></div>
    <button type="button" class="msc-table-ctl__btn msc-table-ctl__btn--insert-row" data-act="insert-row" title="插入行">
      <span class="msc-table-ctl__h">+</span>
    </button>
  `;
  editor.parentElement?.appendChild(overlay);

  let currentWrap = null;
  let hoveredRow = null;
  let hoveredRowIndex = -1;
  let hideRowTimer = null;
  const insertLine = overlay.querySelector('.msc-table-ctl__insert-line');
  const insertRowBtn = overlay.querySelector('[data-act="insert-row"]');
  const ROW_INSERT_Y_TOLERANCE = 28;
  const ROW_INSERT_X_TOLERANCE = 56;

  function clearHideRowTimer() {
    if (!hideRowTimer) return;
    window.clearTimeout(hideRowTimer);
    hideRowTimer = null;
  }

  function scheduleHideRowInsert() {
    clearHideRowTimer();
    hideRowTimer = window.setTimeout(() => {
      hideRowTimer = null;
      hideRowInsert();
    }, 220);
  }

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
    layoutRowInsert();
  }

  function hideRowInsert() {
    clearHideRowTimer();
    hoveredRow = null;
    hoveredRowIndex = -1;
    if (insertLine) insertLine.style.display = 'none';
    if (insertRowBtn) insertRowBtn.style.display = 'none';
  }

  function layoutRowInsert() {
    if (!currentWrap || !hoveredRow || !insertLine || !insertRowBtn) {
      hideRowInsert();
      return;
    }
    const wrapRect = currentWrap.getBoundingClientRect();
    const rowRect = hoveredRow.getBoundingClientRect();
    const table = currentWrap.querySelector('table');
    const tableRect = table?.getBoundingClientRect?.() || wrapRect;
    const y = rowRect.bottom - wrapRect.top;
    insertLine.style.display = 'block';
    insertLine.style.left = `${Math.max(0, tableRect.left - wrapRect.left)}px`;
    insertLine.style.top = `${y}px`;
    insertLine.style.width = `${tableRect.width}px`;
    insertRowBtn.style.display = 'inline-flex';
    insertRowBtn.style.left = `${Math.max(0, tableRect.left - wrapRect.left) - 11}px`;
    insertRowBtn.style.top = `${y}px`;
  }

  function onMouseOver(e) {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    const wrap = t.closest('.msc-table-wrap');
    if (wrap && editor.contains(wrap)) {
      clearHideRowTimer();
      currentWrap = wrap;
      layout();
    }
  }
  function onMouseMove(e) {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    const directWrap = t.closest('.msc-table-wrap');
    let wrap = directWrap && editor.contains(directWrap) ? directWrap : null;
    if (!wrap && currentWrap && editor.contains(currentWrap)) {
      const rect = currentWrap.getBoundingClientRect();
      const withinLooseWrap =
        e.clientX >= rect.left - ROW_INSERT_X_TOLERANCE &&
        e.clientX <= rect.right + ROW_INSERT_X_TOLERANCE &&
        e.clientY >= rect.top - ROW_INSERT_Y_TOLERANCE &&
        e.clientY <= rect.bottom + ROW_INSERT_Y_TOLERANCE;
      if (withinLooseWrap) wrap = currentWrap;
    }
    if (!wrap) {
      scheduleHideRowInsert();
      return;
    }
    clearHideRowTimer();
    currentWrap = wrap;
    const rows = Array.from(wrap.querySelectorAll('tbody > tr'));
    const table = wrap.querySelector('table');
    const tableRect = table?.getBoundingClientRect?.();
    if (!rows.length || !tableRect) {
      scheduleHideRowInsert();
      return;
    }
    const nearest = rows
      .map((row, index) => {
        const rect = row.getBoundingClientRect();
        return { row, index, distance: Math.abs(e.clientY - rect.bottom) };
      })
      .filter((item) => item.distance <= ROW_INSERT_Y_TOLERANCE)
      .sort((a, b) => a.distance - b.distance)[0];
    if (!nearest || e.clientX < tableRect.left - ROW_INSERT_X_TOLERANCE || e.clientX > tableRect.right + ROW_INSERT_X_TOLERANCE) {
      scheduleHideRowInsert();
      return;
    }
    hoveredRow = nearest.row;
    hoveredRowIndex = nearest.index;
    layout();
  }
  function onMouseLeaveEditor() {
    currentWrap = null;
    hideRowInsert();
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
  function insertRowAfter(index) {
    if (!currentWrap) return;
    const tbody = currentWrap.querySelector('tbody');
    const rows = Array.from(tbody?.querySelectorAll('tr') || []);
    const refRow = rows[index];
    const firstRow = rows[0];
    if (!tbody || !firstRow || !refRow) return;
    const colCount = firstRow.children.length;
    const tr = document.createElement('tr');
    for (let i = 0; i < colCount; i++) {
      const td = document.createElement('td');
      td.innerHTML = '<br />';
      tr.appendChild(td);
    }
    tbody.insertBefore(tr, refRow.nextSibling);
    hoveredRow = tr;
    hoveredRowIndex = index + 1;
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

  function selectTable() {
    if (!currentWrap) return;
    const table = currentWrap.querySelector('table');
    if (!table) return;
    const range = document.createRange();
    range.selectNode(table);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    editor.focus();
  }

  function onOverlayClick(e) {
    const btn = e.target instanceof HTMLElement ? e.target.closest('[data-act]') : null;
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const act = btn.getAttribute('data-act');
    if (act === 'select-table') selectTable();
    else if (act === 'add-col') addCol();
    else if (act === 'insert-row') insertRowAfter(hoveredRowIndex);
    else if (act === 'del-col') delCol();
    else if (act === 'del-row') delRow();
  }

  function onScrollOrResize() {
    if (currentWrap) layout();
  }

  editor.addEventListener('mouseover', onMouseOver);
  editor.addEventListener('mousemove', onMouseMove);
  editor.addEventListener('mouseleave', onMouseLeaveEditor);
  overlay.addEventListener('click', onOverlayClick);
  window.addEventListener('resize', onScrollOrResize);
  editor.addEventListener('scroll', onScrollOrResize);
  editor.parentElement?.addEventListener('scroll', onScrollOrResize);

  return () => {
    editor.removeEventListener('mouseover', onMouseOver);
    editor.removeEventListener('mousemove', onMouseMove);
    editor.removeEventListener('mouseleave', onMouseLeaveEditor);
    overlay.removeEventListener('click', onOverlayClick);
    window.removeEventListener('resize', onScrollOrResize);
    editor.removeEventListener('scroll', onScrollOrResize);
    editor.parentElement?.removeEventListener('scroll', onScrollOrResize);
    clearHideRowTimer();
    overlay.remove();
  };
}


export function attachWordEditingNormalizer(editor, onChange) {
  if (!editor) return () => {};

  const normalizeLists = () => {
    if (normalizeOrderedListNumbering(editor)) onChange?.();
  };

  const isEmptyPlainParagraph = (node) => {
    if (!node || node.tagName?.toLowerCase() !== 'p') return false;
    if (node.classList?.contains('msc-img-wrap') || node.classList?.contains('msc-img-caption')) return false;
    if (node.querySelector?.('img, video, table, iframe')) return false;
    const text = String(node.textContent || '').replace(/\u200B/g, '').trim();
    if (text) return false;
    return [...node.childNodes].every((child) => {
      if (child.nodeType === 3) return !String(child.textContent || '').replace(/\u200B/g, '').trim();
      if (child.nodeType !== 1) return true;
      return child.tagName?.toLowerCase() === 'br';
    });
  };

  const isEmptyTextBlock = (node) => {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
    const tag = node.tagName?.toLowerCase();
    if (!['p', 'h1', 'h2', 'h3', 'blockquote'].includes(tag)) return false;
    if (node.classList?.contains('msc-img-wrap') || node.classList?.contains('msc-img-caption')) return false;
    if (node.closest?.('td, th, .msc-callout, .msc-cols')) return false;
    if (node.querySelector?.('img, video, table, iframe')) return false;
    const text = String(node.textContent || '').replace(/\u200B/g, '').trim();
    if (text) return false;
    return [...node.childNodes].every((child) => {
      if (child.nodeType === Node.TEXT_NODE) return !String(child.textContent || '').replace(/\u200B/g, '').trim();
      if (child.nodeType !== Node.ELEMENT_NODE) return true;
      return child.tagName?.toLowerCase() === 'br';
    });
  };

  const getCaretTextBlock = () => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return null;
    const node = sel.anchorNode?.nodeType === Node.ELEMENT_NODE
      ? sel.anchorNode
      : sel.anchorNode?.parentElement;
    const block = node?.closest?.('p, h1, h2, h3, blockquote');
    return block && editor.contains(block) ? block : null;
  };

  const normalizeEmptyHeadingBlocks = () => {
    let changed = false;
    const caretBlock = getCaretTextBlock();
    editor.querySelectorAll('h1, h2, h3').forEach((heading) => {
      if (!isEmptyTextBlock(heading)) return;
      const p = document.createElement('p');
      p.innerHTML = '<br />';
      heading.parentNode?.replaceChild(p, heading);
      if (heading === caretBlock) placeCaretAtStart(p);
      changed = true;
    });
    return changed;
  };

  const removeCurrentEmptyTextBlock = () => {
    const block = getCaretTextBlock();
    if (!block || !isEmptyTextBlock(block)) return false;
    if (!block.previousElementSibling && !block.nextElementSibling) return false;
    const nextTarget = block.previousElementSibling || block.nextElementSibling;
    block.remove();
    if (nextTarget) placeCaretAtEnd(nextTarget);
    onChange?.();
    return true;
  };

  const ensureEmptyCaretLeftAligned = () => {
    let changed = false;
    if (!String(editor.textContent || '').replace(/\u200B/g, '').trim()
      && !editor.querySelector('img, video, table, iframe')) {
      const p = editor.querySelector('p') || document.createElement('p');
      if (!p.parentNode) editor.appendChild(p);
      if (!p.innerHTML || p.innerHTML === '') p.innerHTML = '<br />';
      if (p.style.textAlign !== 'left' || p.getAttribute('align') !== 'left') {
        p.style.textAlign = 'left';
        p.setAttribute('align', 'left');
        changed = true;
      }
    }

    editor.querySelectorAll('p').forEach((p) => {
      if (!isEmptyPlainParagraph(p)) return;
      const align = String(p.style.textAlign || p.getAttribute('align') || '').toLowerCase();
      if (align && align !== 'left') {
        p.style.textAlign = 'left';
        p.setAttribute('align', 'left');
        changed = true;
      }
    });
    if (normalizeEmptyHeadingBlocks()) changed = true;
    if (changed) onChange?.();
  };

  const onClick = (e) => {
    const target = e.target instanceof HTMLElement ? e.target : e.target?.parentElement;
    const callout = target?.closest?.('.msc-callout');
    if (!callout || !editor.contains(callout)) {
      clearPendingCalloutSelection(editor);
      return;
    }
    clearPendingCalloutSelection(editor, callout);
    normalizeCalloutStructure(callout);
    const body = target?.closest?.('.msc-callout__body') || callout.querySelector('.msc-callout__body');
    if (!body) return;
    if (target?.closest?.('.msc-callout__emoji')) return;
    if (getCalloutBodyEmpty(body)) focusCalloutBody(body);
    else if (!target?.closest?.('.msc-callout__body')) focusCalloutBody(body, { atEnd: true });
  };

  const onMouseDown = (e) => {
    const target = e.target instanceof HTMLElement ? e.target : e.target?.parentElement;
    const callout = target?.closest?.('.msc-callout');
    if (!callout || !editor.contains(callout)) return;
    if (target?.closest?.('.msc-callout__emoji')) return;
    normalizeCalloutStructure(callout);
    const body = target?.closest?.('.msc-callout__body') || callout.querySelector('.msc-callout__body');
    if (!body || !getCalloutBodyEmpty(body)) return;
    e.preventDefault();
    clearPendingCalloutSelection(editor, callout);
    focusCalloutBody(body);
  };

  const onPaste = (e) => {
    const target = e.target instanceof HTMLElement ? e.target : e.target?.parentElement;
    const callout = target?.closest?.('.msc-callout');
    clearPendingCalloutSelection(editor);
    if (callout && editor.contains(callout)) normalizeCalloutStructure(callout);
    const body = target?.closest?.('.msc-callout__body') || callout?.querySelector?.('.msc-callout__body');
    if (!body || !editor.contains(body)) return;
    const rawText = e.clipboardData?.getData('text/plain') || '';
    if (!rawText) return;
    const text = rawText.replace(/\s+/g, ' ').trim();
    e.preventDefault();
    if (!text) return;
    if (getCalloutBodyEmpty(body)) focusCalloutBody(body);
    insertTextAtSelection(text);
    body.removeAttribute('data-empty');
    onChange?.();
  };

  const convertTypedOrderedListMarker = () => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return false;
    const range = sel.getRangeAt(0);
    const anchor = range.startContainer?.nodeType === 1
      ? range.startContainer
      : range.startContainer?.parentElement;
    const block = anchor?.closest?.('p, li');
    if (!block || !editor.contains(block)) return false;
    if (block.querySelector('img, table, iframe, video')) return false;

    const probe = document.createRange();
    probe.selectNodeContents(block);
    try {
      probe.setEnd(range.startContainer, range.startOffset);
    } catch {
      return false;
    }
    const before = String(probe.toString() || '').replace(/\u200B/g, '');
    const lineText = before.split(/\n/).pop() || '';
    const markerMatch = lineText.match(/^(\s*)(?:\d+|[a-zA-Z]|[ivxlcdmIVXLCDM]+)\.$/);
    if (!markerMatch) return false;

    const lineBlock = splitBlockAtCaretLine(editor, block);
    const lineRange = document.createRange();
    lineRange.selectNodeContents(lineBlock);
    const lineSel = window.getSelection();
    lineSel?.removeAllRanges();
    lineSel?.addRange(lineRange);

    const markerLength = markerMatch[0].length;
    const markerRange = document.createRange();
    markerRange.selectNodeContents(lineBlock);
    const walker = document.createTreeWalker(lineBlock, NodeFilter.SHOW_TEXT);
    let remaining = markerLength;
    let endNode = null;
    let endOffset = 0;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const length = String(node.textContent || '').replace(/\u200B/g, '').length;
      if (remaining <= length) {
        endNode = node;
        endOffset = remaining;
        break;
      }
      remaining -= length;
    }
    if (endNode) {
      markerRange.setStart(lineBlock, 0);
      markerRange.setEnd(endNode, endOffset);
      markerRange.deleteContents();
    } else {
      lineBlock.innerHTML = '<br />';
    }

    placeCaretAtEnd(lineBlock);
    if (lineBlock.tagName?.toLowerCase() !== 'li') {
      document.execCommand('insertOrderedList', false, null);
    }
    normalizeOrderedListNumbering(editor);
    onChange?.();
    return true;
  };

  const onKeyDown = (e) => {
    if ((e.key === 'Backspace' || e.key === 'Delete') && !e.altKey && !e.ctrlKey && !e.metaKey) {
      const calloutDeleteResult = handleCalloutDeleteKey(editor, e.key);
      if (calloutDeleteResult) {
        e.preventDefault();
        if (calloutDeleteResult === 'removed') onChange?.();
        return;
      }
      if (removeCurrentEmptyTextBlock()) {
        e.preventDefault();
        return;
      }
    }

    clearPendingCalloutSelection(editor);

    if (e.key === ' ' && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
      if (convertTypedOrderedListMarker()) {
        e.preventDefault();
        return;
      }
    }

    if (e.key !== 'Enter' || e.altKey || e.ctrlKey || e.metaKey) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return;
    const anchor =
      sel.anchorNode?.nodeType === 1 ? sel.anchorNode : sel.anchorNode?.parentElement;
    const caption = anchor?.closest?.('.msc-img-caption');
    if (caption && editor.contains(caption)) {
      e.preventDefault();
      const range = sel.getRangeAt(0);
      range.deleteContents();
      const br = document.createElement('br');
      const spacer = document.createTextNode('\u200B');
      range.insertNode(br);
      br.parentNode?.insertBefore(spacer, br.nextSibling);
      range.setStart(spacer, 1);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      onChange?.();
      return;
    }
    if (e.shiftKey) return;
    const heading = anchor?.closest?.('h1, h2, h3');
    if (heading && editor.contains(heading)) {
      e.preventDefault();
      const range = sel.getRangeAt(0);
      const p = document.createElement('p');
      p.innerHTML = '<br />';
      const beforeHeading = isRangeAtStartOfElement(range, heading);
      heading.parentNode?.insertBefore(p, beforeHeading ? heading : heading.nextSibling);
      placeCaretAtStart(p);
      onChange?.();
      return;
    }

    const quote = anchor?.closest?.('blockquote');
    if (!quote || !editor.contains(quote)) return;

    e.preventDefault();
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const br = document.createElement('br');
    const spacer = document.createTextNode(ZERO_WIDTH_SPACE);
    range.insertNode(br);
    br.parentNode?.insertBefore(spacer, br.nextSibling);
    range.setStart(spacer, 1);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    onChange?.();
  };

  const onInput = () => {
    clearPendingCalloutSelection(editor);
    requestAnimationFrame(() => {
      normalizeLists();
      ensureEmptyCaretLeftAligned();
      if (updateCalloutPlaceholders(editor)) onChange?.();
    });
  };

  normalizeLists();
  ensureEmptyCaretLeftAligned();
  if (updateCalloutPlaceholders(editor)) onChange?.();
  editor.addEventListener('click', onClick);
  editor.addEventListener('mousedown', onMouseDown);
  editor.addEventListener('paste', onPaste);
  editor.addEventListener('keydown', onKeyDown);
  editor.addEventListener('input', onInput);
  return () => {
    editor.removeEventListener('click', onClick);
    editor.removeEventListener('mousedown', onMouseDown);
    editor.removeEventListener('paste', onPaste);
    editor.removeEventListener('keydown', onKeyDown);
    editor.removeEventListener('input', onInput);
  };
}
