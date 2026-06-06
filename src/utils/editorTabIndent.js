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
