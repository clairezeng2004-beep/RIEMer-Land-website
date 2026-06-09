// ============================================
// 富文本编辑器：列表 Tab 缩进 / Shift+Tab 反缩进
// ============================================
// 用于 contentEditable（Word 富文本）编辑器的 onKeyDown。
// 当光标位于有序/无序列表内时：
//   - Tab        → 缩进一级（execCommand('indent')，生成嵌套子列表）
//   - Shift+Tab  → 反缩进一级（execCommand('outdent')）
// 不在列表里时不拦截 Tab，保持原有行为。

/** 判断光标是否落在 UL/OL/LI 内部（且仍在编辑器范围内） */
function caretInList(editor) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  let node = sel.anchorNode;
  if (!node) return false;
  if (node.nodeType === 3) node = node.parentElement;
  while (node && node !== editor) {
    const tag = node.tagName;
    if (tag === 'LI' || tag === 'UL' || tag === 'OL') return true;
    node = node.parentElement;
  }
  return false;
}

/**
 * 绑定到编辑器 onKeyDown：处理列表的 Tab / Shift+Tab 多级缩进。
 * @param {KeyboardEvent} e —— React 合成键盘事件（currentTarget 为编辑器元素）
 */
export function handleEditorTabIndent(e) {
  if (e.key !== 'Tab') return;
  const editor = e.currentTarget;
  if (!editor) return;
  if (!caretInList(editor)) return; // 不在列表里 → 不拦截

  e.preventDefault();
  try {
    document.execCommand(e.shiftKey ? 'outdent' : 'indent');
  } catch {
    /* 个别浏览器不支持，忽略 */
  }
  // execCommand 不一定触发 React 的 onInput，这里补发一个冒泡的 input 事件，
  // 让编辑器既有的 onInput 把最新 innerHTML 同步回 state。
  try {
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  } catch {
    /* 忽略 */
  }
}

// ============================================
// 列表项「行首退格」：删掉项目符号/编号，但保留缩进层级
// ============================================
// 默认行为下，列表项行首退格会与上一项合并；很多用户其实想要的是
// 「去掉这一行的点点 / 1. / a.，但保持当前缩进」。
// 实现思路：先反复 outdent 让光标脱离所有列表（浏览器会正确拆分列表、
// 生成普通块），再给这个普通块补上与原来等量的左缩进 margin-left，
// 这样就实现了「无符号但仍缩进」，且不必一直保持列表形态才有缩进。

/** 取光标所在的 LI（仍在编辑器内才返回） */
function getCaretLi(editor) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  let node = sel.anchorNode;
  if (!node) return null;
  if (node.nodeType === 3) node = node.parentElement;
  let li = null;
  while (node && node !== editor) {
    if (node.tagName === 'LI') { li = node; break; }
    node = node.parentElement;
  }
  return li && editor.contains(li) ? li : null;
}

/** 光标是否位于该 LI 的最起始处（前面没有任何文字 / 图片等内容） */
function caretAtStartOfLi(li) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return false;
  const range = sel.getRangeAt(0);
  const probe = document.createRange();
  probe.selectNodeContents(li);
  try {
    probe.setEnd(range.startContainer, range.startOffset);
  } catch {
    return false;
  }
  const frag = probe.cloneContents();
  if ((frag.textContent || '').replace(/\u200b/g, '').length > 0) return false;
  if (frag.querySelector && frag.querySelector('img, br, hr, table')) return false;
  return true;
}

/** 取光标所在的「编辑器直接子块」 */
function getDirectChildBlock(editor) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  let node = sel.anchorNode;
  if (node && node.nodeType === 3) node = node.parentElement;
  while (node && node.parentElement && node.parentElement !== editor) {
    node = node.parentElement;
  }
  return node && node.parentElement === editor ? node : null;
}

/** 列表嵌套深度（UL/OL 祖先个数），用于测量失败时回退计算缩进量 */
function listDepth(li, editor) {
  let depth = 0;
  let n = li.parentElement;
  while (n && n !== editor) {
    if (n.tagName === 'UL' || n.tagName === 'OL') depth += 1;
    n = n.parentElement;
  }
  return depth;
}

export function handleEditorListBackspace(e) {
  if (e.key !== 'Backspace') return;
  const editor = e.currentTarget;
  if (!editor) return;
  const li = getCaretLi(editor);
  if (!li) return;
  // 只在「行首」拦截：行中退格保持默认的删字符行为
  if (!caretAtStartOfLi(li)) return;

  // 先记录当前文本的左缩进量（视口坐标 → 相对编辑器内容区），
  // outdent 之后用它给普通段落补回等量 margin-left。
  const depth = listDepth(li, editor);
  let indentPx = 0;
  try {
    const editorRect = editor.getBoundingClientRect();
    const cs = window.getComputedStyle(editor);
    const contentLeft =
      editorRect.left + (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.borderLeftWidth) || 0);
    const probe = document.createRange();
    probe.selectNodeContents(li);
    probe.collapse(true);
    const startRect = probe.getBoundingClientRect();
    if (startRect && startRect.left) {
      indentPx = Math.max(0, Math.round(startRect.left - contentLeft));
    }
  } catch {
    indentPx = 0;
  }
  // 测量失败（折叠区 rect 可能为 0）时，用嵌套深度 × 默认缩进回退
  if (indentPx === 0 && depth > 0) indentPx = depth * 40;

  e.preventDefault();

  // 反复 outdent 直到脱离所有列表；浏览器会自动拆分列表、生成普通块
  let guard = 0;
  try {
    while (getCaretLi(editor) && guard < 16) {
      document.execCommand('outdent');
      guard += 1;
    }
  } catch {
    /* 个别浏览器不支持，忽略 */
  }

  // 给生成的普通块补上等量左缩进，保持「无符号但仍缩进」
  const block = getDirectChildBlock(editor);
  if (block && block !== editor && indentPx > 0) {
    block.style.marginLeft = `${indentPx}px`;
  }

  try {
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  } catch {
    /* 忽略 */
  }
}

// ============================================
// 首行空行退格：当光标在编辑器「第一个块」且该块为空时，
// 退格可删除这个空行（原生行为下首个空块前面没有内容，退格无反应）。
// ============================================
export function handleEditorFirstLineBackspace(e) {
  if (e.key !== 'Backspace') return;
  const editor = e.currentTarget;
  if (!editor) return;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return;

  const block = getDirectChildBlock(editor);
  if (!block || block !== editor.firstElementChild) return; // 必须是第一个块
  const next = block.nextElementSibling;
  if (!next) return; // 只剩这一个块时保留，避免编辑器变空

  // 该块必须为空：无文字、无图片/分割线/表格等（去掉零宽空格 U+200B 再判断）
  const zwsp = new RegExp(String.fromCharCode(0x200B), 'g');
  if ((block.textContent || '').replace(zwsp, '').trim() !== '') return;
  if (block.querySelector && block.querySelector('img, hr, table')) return;

  e.preventDefault();
  block.remove();
  // 光标移到新的第一个块起始
  try {
    const range = document.createRange();
    range.selectNodeContents(next);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  } catch { /* ignore */ }
  try {
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  } catch { /* ignore */ }
}

/**
 * 组合处理器：Tab 列表缩进 + 列表项行首退格去符号保缩进 + 首行空行退格删除。
 * 编辑器的 onKeyDown 直接用这个即可（前面已处理则不再走后面的逻辑）。
 */
export function handleEditorKeyDown(e) {
  handleEditorTabIndent(e);
  if (e.defaultPrevented) return;
  handleEditorListBackspace(e);
  if (e.defaultPrevented) return;
  handleEditorFirstLineBackspace(e);
}
