const LIST_RESTART_ATTR = 'data-list-restart';

function directListItems(list) {
  return [...(list?.children || [])].filter((child) => child.tagName?.toLowerCase() === 'li');
}

function orderedListDepth(list, root) {
  let depth = 0;
  let node = list.parentElement;
  while (node && node !== root) {
    if (node.tagName?.toLowerCase() === 'ol') depth += 1;
    node = node.parentElement;
  }
  return depth;
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
  const countersByDepth = [];

  root.querySelectorAll('ol').forEach((list) => {
    const depth = orderedListDepth(list, root);
    countersByDepth.length = depth + 1;

    const shouldRestart = isOrderedListRestarted(list);
    const previousCount = countersByDepth[depth] || 0;
    const start = shouldRestart || previousCount === 0 ? 1 : previousCount + 1;
    const currentStart = Number.parseInt(list.getAttribute('start') || '1', 10) || 1;

    if (currentStart !== start) {
      list.setAttribute('start', String(start));
      changed = true;
    }

    if (!shouldRestart && start === 1 && list.hasAttribute('start')) {
      list.removeAttribute('start');
      changed = true;
    }

    countersByDepth[depth] = start + Math.max(0, directListItems(list).length - 1);
  });

  return changed;
}
