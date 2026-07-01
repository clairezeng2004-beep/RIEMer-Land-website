const LIST_RESTART_ATTR = 'data-list-restart';

function directListItems(list) {
  return [...(list?.children || [])].filter((child) => child.tagName?.toLowerCase() === 'li');
}

export function getCurrentOrderedList(editor) {
  if (!editor) return null;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const node = sel.anchorNode?.nodeType === 1 ? sel.anchorNode : sel.anchorNode?.parentElement;
  const list = node?.closest?.('ol');
  return list && editor.contains(list) ? list : null;
}

export function isOrderedListRestarted(list) {
  return list?.getAttribute?.(LIST_RESTART_ATTR) === 'true';
}

export function setOrderedListRestart(list, shouldRestart) {
  if (!list || list.tagName?.toLowerCase() !== 'ol') return;
  if (shouldRestart) {
    list.setAttribute(LIST_RESTART_ATTR, 'true');
    list.setAttribute('start', '1');
  } else {
    list.removeAttribute(LIST_RESTART_ATTR);
  }
}

export function normalizeOrderedListNumbering(root) {
  if (!root) return false;
  let changed = false;
  const countersByParent = new WeakMap();

  root.querySelectorAll('ol').forEach((list) => {
    const parentScope = list.parentElement || root;
    const previousCount = countersByParent.get(parentScope) || 0;
    const rawStart = list.getAttribute('start');
    const currentStart = Number.parseInt(rawStart || '1', 10) || 1;
    // 粘贴 Word / 网页内容时，"重新开始编号"通常只保留为 start="1"，
    // 不会带我们自己的 data-list-restart。遇到同一父级下已有前序编号时，
    // 显式 start=1 应视为用户/来源内容的重启意图，而不是强行续号。
    const shouldRestart = isOrderedListRestarted(list) || (previousCount > 0 && rawStart === '1');
    const start = shouldRestart || previousCount === 0 ? 1 : previousCount + 1;

    if (currentStart !== start) {
      list.setAttribute('start', String(start));
      changed = true;
    }

    if (shouldRestart && !isOrderedListRestarted(list)) {
      list.setAttribute(LIST_RESTART_ATTR, 'true');
      changed = true;
    }

    if (!shouldRestart && start === 1 && list.hasAttribute('start')) {
      list.removeAttribute('start');
      changed = true;
    }

    countersByParent.set(parentScope, start + Math.max(0, directListItems(list).length - 1));
  });

  return changed;
}
