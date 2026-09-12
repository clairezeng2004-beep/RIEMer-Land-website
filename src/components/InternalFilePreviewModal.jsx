import { useRef } from 'react';
import { Download, Printer, X, FileText, AlertCircle } from 'lucide-react';
import './InternalFilePreviewModal.css';

/* 给公开 URL 追加 download 参数，点击时以「下载」而非「预览」方式返回 */
function toDownloadUrl(url, name) {
  if (!url) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}download=${encodeURIComponent(name || '')}`;
}

/* PDF 预览地址：加 #toolbar=0&navpanes=0 隐藏浏览器 PDF 查看器自带的
   下载/打印/侧栏工具条，避免用户绕过我们（能记录的）按钮直接下载。 */
function toPdfViewerUrl(url) {
  if (!url) return url;
  const [base] = url.split('#'); // 去掉可能已有的 hash 再拼
  return `${base}#toolbar=0&navpanes=0`;
}

/* 判断预览类别：image / pdf / other */
function getPreviewKind(node) {
  const name = (node?.name || '').toLowerCase();
  const mime = (node?.mimeType || '').toLowerCase();
  const ext = name.includes('.') ? name.split('.').pop() : '';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'heic'].includes(ext) || mime.startsWith('image/')) {
    return 'image';
  }
  if (ext === 'pdf' || mime.includes('pdf')) {
    return 'pdf';
  }
  return 'other';
}

/**
 * 内部资料 · 站内文件预览弹窗
 * 在站内直接预览文件，并提供「下载 / 打印」按钮。
 * 只有点这两个按钮才通过 onLog 记录下载历史；仅打开预览本身不记录。
 *   props:
 *     node       — 文件节点（含 name / url / mimeType 等）
 *     onClose()  — 关闭弹窗
 *     onLog(action) — 记录一次动作，action 为 'download' | 'print'
 */
export default function InternalFilePreviewModal({ node, onClose, onLog }) {
  const frameRef = useRef(null);
  if (!node) return null;

  const kind = getPreviewKind(node);

  const handleDownload = () => {
    onLog?.('download');
    const a = document.createElement('a');
    a.href = toDownloadUrl(node.url, node.name);
    a.download = node.name || '';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const handlePrint = () => {
    onLog?.('print');
    const frame = frameRef.current;
    if (frame) {
      // 同源才能直接打印内嵌内容；文件在 Storage 上属跨域，多会抛错 → 兜底新标签
      try {
        frame.contentWindow.focus();
        frame.contentWindow.print();
        return;
      } catch {
        /* 跨域无法直接打印，走兜底 */
      }
    }
    if (node.url) window.open(node.url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="ifp-overlay" onClick={onClose}>
      <div className="ifp-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ifp-head">
          <span className="ifp-title" title={node.name}>{node.name}</span>
          <div className="ifp-head-actions">
            <button className="ifp-btn" onClick={handleDownload}>
              <Download size={15} /> <span>下载</span>
            </button>
            <button className="ifp-btn ifp-btn--ghost" onClick={handlePrint}>
              <Printer size={15} /> <span>打印</span>
            </button>
            <button className="ifp-close" onClick={onClose} title="关闭">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="ifp-body">
          {kind === 'image' && (
            <img className="ifp-image" src={node.url} alt={node.name} />
          )}
          {kind === 'pdf' && (
            <iframe
              ref={frameRef}
              className="ifp-frame"
              src={toPdfViewerUrl(node.url)}
              title={node.name}
            />
          )}
          {kind === 'other' && (
            <div className="ifp-placeholder">
              <FileText size={44} />
              <p>此类型文件暂不支持在线预览</p>
              <span>请点上方「下载」保存后查看，或用「打印」在新标签中打开。</span>
            </div>
          )}
        </div>

        <div className="ifp-foot">
          <AlertCircle size={13} />
          <span>点「下载」或「打印」会被记录到下载历史（仅管理员可见）。</span>
        </div>
      </div>
    </div>
  );
}
