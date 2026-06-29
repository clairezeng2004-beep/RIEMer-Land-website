import { insertHtmlReplacingEmptyParagraph, plainTextToEditorHtml } from './cleanPastedWordHtml';

export function insertPlainTextMatchingEditorStyle(editor, text) {
  if (!editor || !text) return false;
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
