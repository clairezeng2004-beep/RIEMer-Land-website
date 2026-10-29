import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Download, X } from 'lucide-react';
import { internalFilePreviewType, namedInternalFileDownloadUrl } from '../utils/internalFilePreview';
import { renderInternalMarkdown, sanitizeInternalTextHtml } from '../utils/internalTextHtml';
import './InternalFilePreview.css';

const WordPreview = lazy(() => import('./WordPreview'));

export default function InternalFilePreview({ file, onClose }) {
  const dialogRef = useRef(null);
  const [pdfUrl, setPdfUrl] = useState('');
  const [textContent, setTextContent] = useState('');
  const [textLoading, setTextLoading] = useState(true);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const type = internalFilePreviewType(file);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  useEffect(() => {
    if (!['pdf', 'text', 'rich', 'markdown'].includes(type)) return;
    const controller = new AbortController();
    let objectUrl;
    (async () => {
      try {
        const response = await fetch(file.url, { signal: controller.signal });
        if (!response.ok) throw new Error('资料加载失败，请稍后重试。');
        if (type !== 'pdf') {
          const content = await response.text();
          if (!controller.signal.aborted) { setTextContent(type === 'rich' ? sanitizeInternalTextHtml(content) : type === 'markdown' ? renderInternalMarkdown(content) : content); setTextLoading(false); }
          return;
        }
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        // 使用明确的 PDF 类型，避免存储服务返回下载响应头而触发下载。
        objectUrl = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
        setPdfUrl(objectUrl);
      } catch (err) {
        if (!controller.signal.aborted) setError(err.message || '预览加载失败。');
      }
    })();
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [file.url, type]);

  const download = async () => {
    setDownloading(true);
    try {
      const namedUrl = namedInternalFileDownloadUrl(file);
      if (namedUrl) {
        const link = document.createElement('a');
        link.href = namedUrl;
        link.download = file.name || '附件';
        document.body.appendChild(link);
        link.click();
        link.remove();
        return;
      }
      const response = await fetch(file.url);
      if (!response.ok) throw new Error('下载失败，请稍后重试。');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = file.name || '附件';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      setError(err.message || '下载失败。');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <dialog ref={dialogRef} className="if-preview" aria-labelledby="if-preview-title"
      onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <header className="if-preview__header">
        <h2 id="if-preview-title">{file.name || '附件预览'}</h2>
        <button type="button" className="if-btn" onClick={download} disabled={downloading || !file.url}>
          <Download size={16} />{downloading ? '下载中…' : '下载'}
        </button>
        <button type="button" className="if-icon-btn" onClick={onClose} aria-label="关闭预览"><X size={20} /></button>
      </header>
      {error && <p className="if-preview__message" role="alert">{error}</p>}
      {type === 'pdf' && <p className="if-preview__download-hint">下载请使用窗口右上角的“下载”，保存名称与网站显示一致。</p>}
      <div className="if-preview__body">
        {['rich', 'markdown'].includes(type) && (textLoading
          ? !error && <p className="if-preview__message" role="status">正在加载正文…</p>
          : <article className="if-preview__rich msc-md-split__preview" dangerouslySetInnerHTML={{ __html: textContent }} />)}
        {type === 'text' && (textLoading
          ? !error && <p className="if-preview__message" role="status">正在加载正文…</p>
          : <article className="if-preview__text">{textContent}</article>)}
        {type === 'pdf' && (pdfUrl
          ? <iframe src={`${pdfUrl}#toolbar=0`} title={file.name || 'PDF 预览'} className="if-preview__frame" />
          : !error && <p className="if-preview__message" role="status">正在加载 PDF…</p>)}
        {type === 'image' && <img src={file.url} alt={file.name} onError={() => setError('图片加载失败，请稍后重试。')} />}
        {type === 'word' && <Suspense fallback={<p className="if-preview__message">正在加载 Word 预览…</p>}>
          <WordPreview fileUrl={file.url} docId={`internal-file-${file.id}`} title={file.name} />
        </Suspense>}
        {!type && <p className="if-preview__message">此格式暂不支持在线预览。如需查看，请点击上方“下载”。</p>}
      </div>
    </dialog>
  );
}
