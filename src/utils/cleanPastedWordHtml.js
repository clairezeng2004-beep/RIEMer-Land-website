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

export function cleanPastedWordHtml(html, {
  preserveTextAlign = true,
  preserveEditorAttrs = false,
  normalizeDivs = true,
} = {}) {
  const doc = new DOMParser().parseFromString(html || '', 'text/html');
  doc.querySelectorAll('script, style, meta, link, title, head').forEach((el) => el.remove());

  toSemanticInlineTags(doc);

  doc.querySelectorAll('*').forEach((el) => {
    sanitizeStyle(el, { preserveTextAlign, preserveImageSize: true });

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
    cleaned = cleaned
      .replace(/<div[^>]*>/gi, '<p>')
      .replace(/<\/div>/gi, '</p>');
  }
  cleaned = cleaned
    .replace(/<span[^>]*>/gi, '')
    .replace(/<\/span>/gi, '')
    .replace(/<p>\s*<\/p>/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return stripUnderline(cleaned);
}
