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

function normalizeUrl(value) {
  const url = String(value || '').trim();
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  return `https://${url}`;
}

export default function FolderItemsEditor({ items = [], onChange, title = '文件夹内容' }) {
  const inputRef = useRef(null);
  const [linkName, setLinkName] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const safeItems = Array.isArray(items) ? items : [];

  const addFiles = useCallback(async (fileList) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    const nextFiles = [];
    for (const file of files) {
      if (safeItems.length + nextFiles.length >= MAX_ITEMS) {
        alert(`文件夹最多放 ${MAX_ITEMS} 项`);
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
      } catch { /* ignore */ }
    }
    if (nextFiles.length > 0) onChange([...safeItems, ...nextFiles]);
  }, [onChange, safeItems]);

  const addLink = useCallback(() => {
    const url = normalizeUrl(linkUrl);
    const name = linkName.trim() || url;
    if (!url) {
      alert('请填写在线文档链接');
      return;
    }
    if (safeItems.length >= MAX_ITEMS) {
      alert(`文件夹最多放 ${MAX_ITEMS} 项`);
      return;
    }
    onChange([
      ...safeItems,
      {
        id: `folder_link_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        kind: 'link',
        name,
        url,
        type: 'link',
      },
    ]);
    setLinkName('');
    setLinkUrl('');
  }, [linkName, linkUrl, onChange, safeItems]);

  const removeItem = useCallback((id) => {
    onChange(safeItems.filter((item) => item.id !== id));
  }, [onChange, safeItems]);

  return (
    <div className="folder-editor">
      <div className="folder-editor__header">
        <div className="folder-editor__title">
          <FolderOpen size={18} />
          <span>{title}</span>
        </div>
        <span className="folder-editor__count">{safeItems.length} 项</span>
      </div>

      <div className="folder-editor__actions">
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
            onChange={(event) => setLinkUrl(event.target.value)}
            placeholder="在线文档链接"
            className="folder-editor__link-input folder-editor__link-input--url"
          />
          <button type="button" className="folder-editor__link-add" onClick={addLink}>
            <LinkIcon size={15} /> 添加链接
          </button>
        </div>
      </div>

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
