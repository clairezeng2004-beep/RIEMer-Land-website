import { stripUnderline } from './stripUnderline';

function isBoldWeight(value) {
  const fw = String(value || '').toLowerCase();
  return fw === 'bold' || fw === 'bolder' || (/^\d+$/.test(fw) && parseInt(fw, 10) >= 600);
}

function toSemanticInlineTags(doc) {
  doc.querySelectorAll('[style]').forEach((el) => {
    const tag = el.tagName.toLowerCase();
    if (['strong', 'b', 'em', 'i'].includes(tag) || /^h[1-6]$/.test(tag)) return;
    const isBold = isBoldWeight(el.style.fontWeight);
    const isItalic = String(el.style.fontStyle || '').toLowerCase() === 'italic';
    if (!isBold && !isItalic) return;

    const frag = doc.createDocumentFragment();
    while (el.firstChild) frag.appendChild(el.firstChild);
    let wrapper = frag;
    if (isItalic) {
      const em = doc.createElement('em');
      em.appendChild(wrapper);
      wrapper = em;
    }
    if (isBold) {
      const strong = doc.createElement('strong');
      strong.appendChild(wrapper);
      wrapper = strong;
    }
    el.appendChild(wrapper);
  });
}

function sanitizeStyle(el, { preserveTextAlign, preserveImageSize }) {
  const tag = el.tagName.toLowerCase();
  const style = el.style;
  const kept = [];

  if (preserveTextAlign) {
    const textAlign = String(style.textAlign || '').toLowerCase();
    if (['left', 'center', 'right', 'justify'].includes(textAlign)) {
      kept.push(`text-align: ${textAlign}`);
      el.setAttribute('align', textAlign);
    } else {
      el.removeAttribute('align');
    }
  } else {
    el.removeAttribute('align');
  }

  if (tag === 'img' && preserveImageSize) {
    const width = String(style.width || '').trim();
    const height = String(style.height || '').trim();
    const maxWidth = String(style.maxWidth || '').trim();
    if (/^\d+(?:\.\d+)?(px|%)$/.test(width)) kept.push(`width: ${width}`);
    if (/^\d+(?:\.\d+)?(px|%)$/.test(height)) kept.push(`height: ${height}`);
    if (/^\d+(?:\.\d+)?(px|%)$/.test(maxWidth)) kept.push(`max-width: ${maxWidth}`);
  }

  if (kept.length > 0) el.setAttribute('style', kept.join('; '));
  else el.removeAttribute('style');
}

function sanitizeClass(el, { preserveEditorAttrs }) {
  const raw = String(el.getAttribute('class') || '');
  if (!raw) return;
  const classes = raw
    .split(/\s+/)
    .filter(Boolean)
    .filter((name) => name.startsWith('msc-'));

  if (classes.length === 0) {
    el.removeAttribute('class');
    return;
  }

  if (el.tagName.toLowerCase() === 'img') {
    el.setAttribute('class', classes.includes('msc-img') ? 'msc-img' : classes.join(' '));
    return;
  }

  if (preserveEditorAttrs) el.setAttribute('class', classes.join(' '));
  else el.removeAttribute('class');
}

function isColumnAuxiliary(el) {
  return !!el?.classList && (
    el.classList.contains('msc-col-resizer')
    || el.classList.contains('msc-col-adder')
    || el.classList.contains('msc-col__empty')
    || el.classList.contains('msc-col__act')
    || el.classList.contains('msc-col__placeholder')
  );
}

function unwrapElement(el) {
  const frag = el.ownerDocument.createDocumentFragment();
  while (el.firstChild) frag.appendChild(el.firstChild);
  el.replaceWith(frag);
}

function moveColumnContentIntoFragment(source, frag) {
  if (isColumnAuxiliary(source)) return;
  while (source.firstChild) {
    const child = source.firstChild;
    if (child.nodeType === 1 && isColumnAuxiliary(child)) {
      child.remove();
      continue;
    }
    frag.appendChild(child);
  }
}

function isExternalColumnLayout(el) {
  const tag = el.tagName?.toLowerCase?.();
  if (!['div', 'section', 'article'].includes(tag)) return false;
  const style = String(el.getAttribute('style') || '').toLowerCase();
  return /column-count\s*:|columns\s*:|grid-template-columns\s*:/.test(style);
}

function flattenPastedColumns(doc) {
  doc
    .querySelectorAll('.msc-col-resizer, .msc-col-adder, .msc-col__empty, .msc-col__act, .msc-col__placeholder')
    .forEach((el) => el.remove());

  doc.querySelectorAll('.msc-cols, [data-cols]').forEach((container) => {
    const frag = doc.createDocumentFragment();
    const cols = [...container.children].filter((child) => child.classList?.contains('msc-col'));
    const sources = cols.length > 0 ? cols : [...container.children];

    sources.forEach((source) => moveColumnContentIntoFragment(source, frag));

    container.replaceWith(frag);
  });

  doc.querySelectorAll('.msc-col').forEach((col) => unwrapElement(col));

  [...doc.querySelectorAll('div, section, article')].reverse().forEach((el) => {
    if (isExternalColumnLayout(el)) unwrapElement(el);
  });
}

function hasBlockChild(el) {
  return !!el.querySelector?.('address, article, aside, blockquote, div, dl, fieldset, figure, h1, h2, h3, h4, h5, h6, hr, ol, p, pre, table, ul');
}

function normalizeDivElements(doc) {
  [...doc.querySelectorAll('div')].reverse().forEach((div) => {
    if (hasBlockChild(div)) {
      unwrapElement(div);
      return;
    }

    const p = doc.createElement('p');
    [...div.attributes].forEach((attr) => p.setAttribute(attr.name, attr.value));
    while (div.firstChild) p.appendChild(div.firstChild);
    div.replaceWith(p);
  });
}

export function cleanPastedWordHtml(html, {
  preserveTextAlign = true,
  preserveEditorAttrs = false,
  normalizeDivs = true,
} = {}) {
  const doc = new DOMParser().parseFromString(html || '', 'text/html');
  doc.querySelectorAll('script, style, meta, link, title, head').forEach((el) => el.remove());

  toSemanticInlineTags(doc);
  flattenPastedColumns(doc);

  doc.querySelectorAll('*').forEach((el) => {
    sanitizeStyle(el, { preserveTextAlign, preserveImageSize: true });
    sanitizeClass(el, { preserveEditorAttrs });

    const tag = el.tagName.toLowerCase();
    const allowed = tag === 'img'
      ? new Set(['src', 'alt', 'width', 'height', 'style', 'class', 'draggable'])
      : new Set([
        'href',
        ...(preserveTextAlign && el.hasAttribute('style') ? ['style', 'align'] : []),
        ...(preserveEditorAttrs ? ['class', 'data-msc-table', 'data-cols', 'contenteditable'] : []),
      ]);

    [...el.attributes].forEach((attr) => {
      if (!allowed.has(attr.name)) el.removeAttribute(attr.name);
    });
  });

  doc.querySelectorAll('img').forEach((img) => {
    if (!img.src || img.src.startsWith('file:')) {
      img.remove();
      return;
    }
    if (!img.classList.contains('msc-img')) img.classList.add('msc-img');
    img.setAttribute('draggable', 'true');
    const parent = img.parentElement;
    if (!parent || !parent.classList.contains('msc-img-wrap')) {
      const wrap = doc.createElement('p');
      wrap.className = 'msc-img-wrap';
      wrap.setAttribute('style', 'text-align: center');
      img.replaceWith(wrap);
      wrap.appendChild(img);
    }
  });

  let cleaned = doc.body.innerHTML;
  if (normalizeDivs) {
    normalizeDivElements(doc);
    cleaned = doc.body.innerHTML;
  }
  cleaned = cleaned
    .replace(/<span[^>]*>/gi, '')
    .replace(/<\/span>/gi, '')
    .replace(/<p>\s*<\/p>/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return stripUnderline(cleaned);
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function plainTextToEditorHtml(text) {
  return stripUnderline(
    String(text || '')
      .split(/\n\n+/)
      .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
      .join('')
  );
}

function isEmptyParagraph(node) {
  if (!node || node.nodeType !== 1 || node.tagName.toLowerCase() !== 'p') return false;
  if (node.querySelector('img, video, table, iframe')) return false;
  const text = String(node.textContent || '').replace(/\u200B/g, '').trim();
  if (text) return false;
  return [...node.childNodes].every((child) => {
    if (child.nodeType === 3) return !String(child.textContent || '').replace(/\u200B/g, '').trim();
    if (child.nodeType !== 1) return true;
    return child.tagName.toLowerCase() === 'br';
  });
}

function fragmentFromHtml(html) {
  const template = document.createElement('template');
  template.innerHTML = html || '';
  return template.content;
}

function placeCaretAfter(node) {
  if (!node) return;
  try {
    const range = document.createRange();
    range.setStartAfter(node);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  } catch { /* ignore */ }
}

export function insertHtmlReplacingEmptyParagraph(editor, html) {
  if (!editor || !html) return false;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return false;
  const range = sel.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) return false;

  const anchor =
    range.startContainer.nodeType === 1
      ? range.startContainer
      : range.startContainer.parentElement;
  const paragraph = anchor?.closest?.('p');
  if (!paragraph || !editor.contains(paragraph) || !isEmptyParagraph(paragraph)) return false;

  const previous = paragraph.previousElementSibling;
  const isAfterImage =
    previous?.classList?.contains('msc-img-wrap')
    || previous?.matches?.('img.msc-img')
    || previous?.querySelector?.('img.msc-img');
  if (!isAfterImage) return false;

  const frag = fragmentFromHtml(html);
  const inserted = [...frag.childNodes];
  if (inserted.length === 0) return false;
  paragraph.replaceWith(frag);
  placeCaretAfter(inserted[inserted.length - 1]);
  return true;
}
