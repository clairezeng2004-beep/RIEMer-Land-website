import { insertHtmlReplacingEmptyParagraph, plainTextToEditorHtml } from './cleanPastedWordHtml';

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getSelectionInEditor(editor) {
  const sel = window.getSelection();
  if (!editor || !sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  const start = range.startContainer?.nodeType === 1
    ? range.startContainer
    : range.startContainer?.parentElement;
  const end = range.endContainer?.nodeType === 1
    ? range.endContainer
    : range.endContainer?.parentElement;
  if (!start || !end || !editor.contains(start) || !editor.contains(end)) return null;
  return { sel, range, start, end };
}

export function isSelectionInImageCaption(editor) {
  const context = getSelectionInEditor(editor);
  if (!context) return false;
  const caption = context.start.closest?.('.msc-img-caption');
  return !!(caption && editor.contains(caption) && caption.contains(context.end));
}

function insertTextIntoCaption(editor, text) {
  const context = getSelectionInEditor(editor);
  if (!context) return false;
  const caption = context.start.closest?.('.msc-img-caption');
  if (!caption || !editor.contains(caption) || !caption.contains(context.end)) return false;

  const html = escapeHtml(text).replace(/\r\n|\r|\n/g, '<br>');
  context.range.deleteContents();
  const template = document.createElement('template');
  template.innerHTML = html;
  const fragment = template.content;
  const inserted = [...fragment.childNodes];
  context.range.insertNode(fragment);

  if (inserted.length > 0) {
    const nextRange = document.createRange();
    nextRange.setStartAfter(inserted[inserted.length - 1]);
    nextRange.collapse(true);
    context.sel.removeAllRanges();
    context.sel.addRange(nextRange);
  }
  return true;
}

export function insertPlainTextMatchingEditorStyle(editor, text) {
  if (!editor || !text) return false;
  if (insertTextIntoCaption(editor, text)) return true;
  const html = plainTextToEditorHtml(text);
  if (!insertHtmlReplacingEmptyParagraph(editor, html || text)) {
    document.execCommand('insertHTML', false, html || text);
  }
  return true;
}

export function attachPasteAndMatchStyleHandler(editor, { onChange } = {}) {
  if (!editor) return () => {};

  const onBeforeInput = (event) => {
    if (event.inputType !== 'insertFromPasteAsPlainText') return;
    const text = event.dataTransfer?.getData('text/plain') || event.data || '';
    if (!text) return;
    event.preventDefault();
    event.stopPropagation();
    if (insertPlainTextMatchingEditorStyle(editor, text)) {
      onChange?.(editor.innerHTML);
    }
  };

  editor.addEventListener('beforeinput', onBeforeInput, true);
  return () => {
    editor.removeEventListener('beforeinput', onBeforeInput, true);
  };
}
