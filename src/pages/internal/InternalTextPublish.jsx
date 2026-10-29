import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import MarkdownInsertToolbar from '../../components/MarkdownInsertToolbar';
import WordBlockHandle from '../../components/WordBlockHandle';
import EditorToc from '../../components/EditorToc';
import SyncScrollToggle from '../../components/SyncScrollToggle';
import useMarkdownSyncScroll from '../../hooks/useMarkdownSyncScroll';
import { ChevronLeft, FileText, Code2, Eye, Upload } from 'lucide-react';
import WordEditorToolbar from '../../components/WordEditorToolbar';
import FloatingTextToolbar from '../../components/FloatingTextToolbar';
import { attachWordImageEditor } from '../../utils/wordImageEditor';
import { attachTableControls, attachColumnPlaceholderHandler, attachWordEditingNormalizer, attachEditableLinkOpener } from '../../utils/wordDocBlocks';
import { attachPasteAndMatchStyleHandler } from '../../utils/pasteMatchStyle';
import { handleEditorKeyDown } from '../../utils/editorTabIndent';
import { htmlToMarkdown, markdownToHtml } from '../../utils/markdownWordInterop';
import { plainTextToEditorHtml } from '../../utils/cleanPastedWordHtml';
import { hasInternalTextContent, renderInternalMarkdown, sanitizeInternalTextHtml } from '../../utils/internalTextHtml';
import './MemberSharingCreate.css';

export default function InternalTextPublish({ active = true, destination, busy, onClose, onPublish, onSwitchType }) {
  const dialogRef = useRef(null);
  const wordRef = useRef(null);
  const mdRef = useRef(null);
  const previewRef = useRef(null);
  const imageApiRef = useRef(null);
  const currentHtmlRef = useRef('');
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [format, setFormat] = useState('word');
  const [contributors, setContributors] = useState('');
  const [note, setNote] = useState('');
  const { editorRef: syncEditorRef, previewRef: syncPreviewRef, syncScroll, toggleSyncScroll, handleEditorScroll, handlePreviewScroll } = useMarkdownSyncScroll();
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [error, setError] = useState('');
  const preview = useMemo(() => format === 'markdown' ? renderInternalMarkdown(content) : '', [format, content]);

  useEffect(() => {
    if (!active) return;
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current.querySelector('button')?.focus();
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !busyRef.current) { event.preventDefault(); closeRef.current(); }
      if (event.key !== 'Tab') return;
      const nodes = [...dialogRef.current.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[contenteditable="true"]')]
        .filter((node) => node.getClientRects().length);
      if (event.shiftKey && document.activeElement === nodes[0]) { event.preventDefault(); nodes.at(-1)?.focus(); }
      if (!event.shiftKey && document.activeElement === nodes.at(-1)) { event.preventDefault(); nodes[0]?.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', onKeyDown); previous?.focus?.(); };
  }, [active]);

  useEffect(() => {
    if (format !== 'word') return;
    const editor = wordRef.current;
    editor.innerHTML = currentHtmlRef.current;
    const sync = () => { currentHtmlRef.current = editor.innerHTML; setContent(editor.innerHTML); };
    const imageApi = attachWordImageEditor(editor, { onChange: sync });
    imageApiRef.current = imageApi;
    const cleanups = [attachTableControls(editor, sync), attachColumnPlaceholderHandler(editor, sync),
      attachWordEditingNormalizer(editor, sync), attachPasteAndMatchStyleHandler(editor, { onChange: sync }), attachEditableLinkOpener(editor)];
    return () => { cleanups.forEach((cleanup) => cleanup()); imageApi.destroy(); imageApiRef.current = null; };
  }, [format]);

  const changeFormat = (next) => {
    if (format === next) return;
    const converted = next === 'markdown' ? htmlToMarkdown(wordRef.current?.innerHTML || content)
      : sanitizeInternalTextHtml(markdownToHtml(content));
    currentHtmlRef.current = next === 'word' ? converted : '';
    setContent(converted);
    setFormat(next);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    const body = format === 'word' ? sanitizeInternalTextHtml(wordRef.current?.innerHTML || '') : content;
    if (!name.trim() || !hasInternalTextContent(body, format)) { setError('请填写标题和正文。'); return; }
    setError('');
    try {
      if (await onPublish({ type: 'text', name, content: body, format, contributors, note })) onClose();
    } catch (err) { setError(err?.message || '发布失败，请重试。'); }
  };

  return createPortal(
    <div ref={dialogRef} style={{ display: active ? 'block' : 'none' }} role="dialog" aria-modal="true" className="if-text-publish msc-page" aria-labelledby="if-text-title">
      <div className="msc-topbar">
        <button type="button" className="msc-topbar__back" onClick={onClose} disabled={busy}><ChevronLeft size={20} /> 返回列表</button>
        <div className="msc-topbar__actions">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>取消</button>
          <button type="submit" form="if-text-form" className="btn btn-primary" disabled={busy}><Upload size={16} />{busy ? '发布中…' : '发布资料'}</button>
        </div>
      </div>
      <div className="msc-content"><div className="msc-content__inner">
        <h2 id="if-text-title" className="msc-content__title"><FileText size={22} />发布文本资料</h2>
        <p className="msc-content__desc">发布到：{destination}。支持 Word 风格编辑与 Markdown，直接填写正文即可发布。</p>
        <form id="if-text-form" className="msc-form" onSubmit={submit}>
          <fieldset disabled={busy} className="if-publish__fields">
            <div className="msc-form__field"><label htmlFor="if-text-name">标题</label>
              <input id="if-text-name" className="msc-form__input" placeholder="请输入资料标题" required value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div className="msc-form__field"><label htmlFor="if-text-contributors">内容贡献者<span className="msc-form__hint">选填，多人用顿号分隔</span></label>
              <input id="if-text-contributors" className="msc-form__input" placeholder="留空则显示上传者" maxLength={500} value={contributors} onChange={(e) => setContributors(e.target.value)} /></div>
            <div className="msc-form__field"><label htmlFor="if-text-note">备注</label>
              <textarea id="if-text-note" className="msc-form__textarea msc-form__textarea--summary" rows={3} maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} /></div>
            <div className="msc-form__field"><label>正文格式</label><div className="msc-form__format-toggle">
              <button type="button" className={`msc-form__format-btn ${format === 'word' ? 'msc-form__format-btn--active' : ''}`} onClick={() => changeFormat('word')}><FileText size={16} />Word 风格</button>
              <button type="button" className={`msc-form__format-btn ${format === 'markdown' ? 'msc-form__format-btn--active' : ''}`} onClick={() => changeFormat('markdown')}><Code2 size={16} />Markdown</button>
            </div></div>
            <div className="msc-form__field"><label htmlFor={format === 'word' ? 'if-text-word' : 'if-text-markdown'}>正文</label>
              {format === 'word' ? <div className="msc-form__word-editor-wrapper">
                <WordEditorToolbar editorRef={wordRef} imageApiRef={imageApiRef} onChange={(html) => { currentHtmlRef.current = html; setContent(html); }} />
                <div id="if-text-word" ref={wordRef} className="msc-form__word-editor" role="textbox" aria-label="正文" aria-multiline="true"
                  contentEditable={!busy} suppressContentEditableWarning data-placeholder="从 Word 复制内容后直接粘贴，也可以直接输入文字、插入图片、表格和分栏"
                  onKeyDown={handleEditorKeyDown}
                  onPaste={(e) => {
                    if (Array.from(e.clipboardData.files || []).some((file) => file.type.startsWith('image/'))) return;
                    e.preventDefault();
                    const html = e.clipboardData.getData('text/html');
                    document.execCommand('insertHTML', false, html ? sanitizeInternalTextHtml(html) : plainTextToEditorHtml(e.clipboardData.getData('text/plain')));
                    currentHtmlRef.current = wordRef.current.innerHTML; setContent(currentHtmlRef.current);
                  }}
                  onInput={() => { currentHtmlRef.current = wordRef.current.innerHTML; setContent(currentHtmlRef.current); }} />
                {!busy && <WordBlockHandle editorRef={wordRef} onChange={(html) => { currentHtmlRef.current = html; setContent(html); }} />}
                <EditorToc editorRef={wordRef} content={content} />
                {!busy && <FloatingTextToolbar editorRef={wordRef} onChange={(html) => { currentHtmlRef.current = html; setContent(html); }} />}
              </div> : <div className="msc-md-split">
                <div className="msc-md-split__pane"><div className="msc-md-split__label"><Code2 size={14} />编辑<SyncScrollToggle on={syncScroll} onToggle={toggleSyncScroll} /></div>
                  <MarkdownInsertToolbar textareaRef={mdRef} value={content} onChange={setContent} />
                  <textarea id="if-text-markdown" ref={(node) => { mdRef.current = node; syncEditorRef.current = node; }} onScroll={handleEditorScroll} className="msc-md-split__editor" rows={16} value={content} onChange={(e) => setContent(e.target.value)} placeholder={'# 标题\n\n正文内容…'} />
                  {!busy && <FloatingTextToolbar mode="markdown" editorRef={mdRef} value={content} onChange={setContent} />}
                </div>
                <div className="msc-md-split__pane"><div className="msc-md-split__label"><Eye size={14} />预览</div>
                  <div ref={(node) => { previewRef.current = node; syncPreviewRef.current = node; }} onScroll={handlePreviewScroll} className="msc-md-split__preview" dangerouslySetInnerHTML={{ __html: preview || '<p>在左侧输入内容后，这里会显示实时预览</p>' }} /></div>
              </div>}
            </div>
          </fieldset>
          {error && <p className="if-link-form__status is-error" role="alert">{error}</p>}
          <button type="button" className="msc-topbar__back" disabled={busy} onClick={() => onSwitchType('files')}>改为上传附件或添加链接</button>
        </form>
      </div></div>
    </div>, document.body
  );
}
