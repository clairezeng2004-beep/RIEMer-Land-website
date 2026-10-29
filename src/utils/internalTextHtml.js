import { cleanPastedWordHtml } from './cleanPastedWordHtml';
import { markdownToHtml } from './markdownWordInterop';

export function sanitizeInternalTextHtml(html) {
  const doc = new DOMParser().parseFromString(html || '', 'text/html');
  doc.querySelectorAll('script,style,iframe,object,embed,svg,math,form,input,button,textarea,select,base,meta,link').forEach((el) => el.remove());
  doc.querySelectorAll('a').forEach((el) => {
    if (!/^(https?:\/\/|mailto:|#|\/(?!\/))/i.test((el.getAttribute('href') || '').trim())) el.removeAttribute('href');
  });
  doc.querySelectorAll('img').forEach((el) => {
    if (!/^(https?:\/\/|data:image\/(?:png|jpeg|gif|webp|avif|bmp);base64,|\/(?!\/))/i.test((el.getAttribute('src') || '').trim())) el.remove();
  });
  return cleanPastedWordHtml(doc.body.innerHTML, { preserveEditorAttrs: true, normalizeDivs: false });
}

export function renderInternalMarkdown(content) {
  return sanitizeInternalTextHtml(markdownToHtml(content));
}

export function hasInternalTextContent(content, format) {
  if (format !== 'word') return !!content.trim();
  const doc = new DOMParser().parseFromString(sanitizeInternalTextHtml(content), 'text/html');
  return !!doc.body.textContent.trim() || !!doc.querySelector('img');
}
