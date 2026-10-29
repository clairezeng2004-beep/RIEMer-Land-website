import { useCallback, useRef, useState } from 'react';
import {
  FolderOpen,
  Link as LinkIcon,
  Upload,
  X,
  File,
  FileText,
  Image,
  FileSpreadsheet,
  FileArchive,
} from 'lucide-react';
import { buildLinkAttachment, normalizeLinkUrl, splitPastedLink } from '../utils/sharedLink';
import './FolderItemsEditor.css';

const MAX_ITEMS = 20;

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function getFileIcon(item = {}) {
  if (item.kind === 'link' || item.type === 'link') return LinkIcon;
  const ext = String(item.name || '').split('.').pop().toLowerCase();
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return Image;
  if (['pdf'].includes(ext)) return FileText;
  if (['xls', 'xlsx', 'csv'].includes(ext)) return FileSpreadsheet;
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return FileArchive;
  if (['doc', 'docx', 'ppt', 'pptx', 'txt', 'md'].includes(ext)) return FileText;
  return File;
}

function formatFileSize(bytes) {
  if (!Number.isFinite(Number(bytes))) return '在线链接';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function FolderItemsEditor({ items = [], onChange, title = '文件夹内容', maxItems = MAX_ITEMS, disabled = false, onReadingChange }) {
  const inputRef = useRef(null);
  const [linkName, setLinkName] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const readingRef = useRef(false);
  const safeItems = Array.isArray(items) ? items : [];

  const addFiles = useCallback(async (fileList) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    if (disabled || readingRef.current) return;
    readingRef.current = true;
    setReading(true);
    onReadingChange?.(true);
    setError('');
    const nextFiles = [];
    for (const file of files) {
      if (safeItems.length + nextFiles.length >= maxItems) {
        setError(`文件夹最多放 ${maxItems} 项`);
        break;
      }
      try {
        const dataUrl = await fileToDataUrl(file);
        nextFiles.push({
          id: `folder_file_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          kind: 'file',
          name: file.name,
          size: file.size,
          type: file.type,
          dataUrl,
        });
      } catch { setError(`无法读取 ${file.name}，请重新选择文件。`); }
    }
    if (nextFiles.length > 0) onChange([...safeItems, ...nextFiles]);
    readingRef.current = false;
    setReading(false);
    onReadingChange?.(false);
  }, [onChange, safeItems, maxItems, disabled, onReadingChange]);

  const addLink = useCallback(() => {
    const url = normalizeLinkUrl(linkUrl);
    if (!url) {
      setError('请填写在线文档链接');
      return;
    }
    if (safeItems.length >= maxItems) {
      setError(`文件夹最多放 ${maxItems} 项`);
      return;
    }
    onChange([
      ...safeItems,
      buildLinkAttachment({ name: linkName, url }),
    ]);
    setLinkName('');
    setLinkUrl('');
    setError('');
  }, [linkName, linkUrl, onChange, safeItems, maxItems]);

  const removeItem = useCallback((id) => {
    onChange(safeItems.filter((item) => item.id !== id));
  }, [onChange, safeItems]);

  return (
    <div className="folder-editor" onDragOver={(event) => {
      if (Array.from(event.dataTransfer.types).includes('Files')) event.preventDefault();
    }} onDrop={(event) => {
      if (!Array.from(event.dataTransfer.types).includes('Files')) return;
      event.preventDefault();
      addFiles(event.dataTransfer.files);
    }}>
      <div className="folder-editor__header">
        <div className="folder-editor__title">
          <FolderOpen size={18} />
          <span>{title}</span>
        </div>
        <span className="folder-editor__count">{safeItems.length} 项</span>
      </div>

      <p className="folder-editor__drop-hint">将文件拖到此处，或点击“添加文件”。已有文件时也可以继续添加。</p>
      {reading && <p className="folder-editor__drop-hint" role="status">正在读取文件…</p>}
      {error && <p className="folder-editor__drop-hint" role="alert">{error}</p>}
      <fieldset disabled={reading || disabled} className="folder-editor__actions">
        <button
          type="button"
          className="folder-editor__upload"
          onClick={() => inputRef.current?.click()}
        >
          <Upload size={15} /> 添加文件
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="folder-editor__input"
          onChange={(event) => {
            addFiles(event.target.files);
            event.target.value = '';
          }}
        />
        <div className="folder-editor__link-form">
          <input
            type="text"
            value={linkName}
            onChange={(event) => setLinkName(event.target.value)}
            placeholder="链接名称"
            className="folder-editor__link-input"
          />
          <input
            type="url"
            value={linkUrl}
            onChange={(event) => {
              // 整段粘贴 WPS / 腾讯文档等的分享文案时，自动拆出网址并填好名称
              const split = splitPastedLink(event.target.value);
              if (!split) {
                setLinkUrl(event.target.value);
                return;
              }
              setLinkUrl(split.url);
              if (!linkName.trim() && split.name) setLinkName(split.name);
            }}
            placeholder="在线文档链接（可直接粘贴分享内容）"
            className="folder-editor__link-input folder-editor__link-input--url"
          />
          <button type="button" className="folder-editor__link-add" onClick={addLink}>
            <LinkIcon size={15} /> 添加链接
          </button>
        </div>
      </fieldset>

      <div className="folder-editor__list">
        {safeItems.length === 0 ? (
          <div className="folder-editor__empty">文件夹里还没有内容</div>
        ) : (
          safeItems.map((item) => {
            const Icon = getFileIcon(item);
            return (
              <div key={item.id || item.name} className="folder-editor__item">
                <Icon size={18} className="folder-editor__item-icon" />
                <div className="folder-editor__item-main">
                  <span className="folder-editor__item-name">{item.name || item.url || '未命名项目'}</span>
                  <span className="folder-editor__item-meta">
                    {item.kind === 'link' || item.type === 'link' ? '在线文档链接' : formatFileSize(item.size)}
                  </span>
                </div>
                <button
                  type="button"
                  className="folder-editor__remove"
                  disabled={reading || disabled}
                  onClick={() => removeItem(item.id)}
                  title="移除"
                >
                  <X size={14} />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
