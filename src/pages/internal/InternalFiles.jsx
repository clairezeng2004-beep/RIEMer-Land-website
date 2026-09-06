import { useState, useEffect, useCallback, useRef } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import {
  isInternalFilesAvailable,
  fetchChildren,
  fetchBreadcrumb,
  createFolder,
  uploadFiles,
  uploadFolderTree,
  renameNode,
  deleteNode,
} from '../../services/internalFilesService';
import {
  HardDrive,
  Folder,
  File,
  FileText,
  FileSpreadsheet,
  FileImage,
  FolderPlus,
  Upload,
  FolderUp,
  Download,
  Pencil,
  Trash2,
  ChevronRight,
  RefreshCw,
  AlertCircle,
  Inbox,
} from 'lucide-react';
import './InternalFiles.css';

/* 文件大小格式化 */
function formatSize(bytes) {
  if (!bytes || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let val = bytes;
  let i = 0;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i += 1;
  }
  return `${val >= 10 || i === 0 ? Math.round(val) : val.toFixed(1)} ${units[i]}`;
}

function formatDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/* 按扩展名 / MIME 选择图标与类别标签 */
function getFileMeta(node) {
  const name = (node.name || '').toLowerCase();
  const mime = (node.mimeType || '').toLowerCase();
  const ext = name.includes('.') ? name.split('.').pop() : '';

  if (['doc', 'docx', 'rtf', 'odt'].includes(ext) || mime.includes('word')) {
    return { Icon: FileText, label: 'Word 文档', cls: 'is-word' };
  }
  if (['xls', 'xlsx', 'csv', 'ods'].includes(ext) || mime.includes('spreadsheet') || mime.includes('excel')) {
    return { Icon: FileSpreadsheet, label: '表格', cls: 'is-excel' };
  }
  if (ext === 'pdf' || mime.includes('pdf')) {
    return { Icon: FileText, label: 'PDF', cls: 'is-pdf' };
  }
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'heic'].includes(ext) || mime.startsWith('image/')) {
    return { Icon: FileImage, label: '图片', cls: 'is-image' };
  }
  if (['ppt', 'pptx', 'key'].includes(ext) || mime.includes('presentation')) {
    return { Icon: FileText, label: '演示文稿', cls: 'is-ppt' };
  }
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) {
    return { Icon: File, label: '压缩包', cls: 'is-zip' };
  }
  return { Icon: File, label: ext ? ext.toUpperCase() : '文件', cls: 'is-generic' };
}

/* 给公开 URL 追加 download 参数，点击时以「下载」而非「预览」方式返回 */
function toDownloadUrl(url, name) {
  if (!url) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}download=${encodeURIComponent(name || '')}`;
}

export default function InternalFiles() {
  const { isAuthenticated, isAdmin, user } = useAuth();

  const [folderId, setFolderId] = useState(null); // null = 根目录
  const [breadcrumb, setBreadcrumb] = useState([]); // [{id,name}, ...]
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false); // 上传/新建等写操作进行中
  const [progress, setProgress] = useState(null); // {done,total,current}
  const [dragOver, setDragOver] = useState(false);

  const filesInputRef = useRef(null);
  const folderInputRef = useRef(null);
  const inflightRef = useRef(false);

  const canModify = useCallback(
    (node) => isAdmin || (node.createdById && node.createdById === user?.id),
    [isAdmin, user?.id]
  );

  const load = useCallback(async (targetId) => {
    if (inflightRef.current) return;
    inflightRef.current = true;
    setLoading(true);
    setError('');
    try {
      const [children, crumb] = await Promise.all([
        fetchChildren(targetId),
        targetId ? fetchBreadcrumb(targetId) : Promise.resolve([]),
      ]);
      setItems(children);
      setBreadcrumb(crumb);
    } catch (err) {
      console.error('[InternalFiles] 加载失败：', err);
      setError(err?.message || '加载失败，请稍后重试。');
    } finally {
      setLoading(false);
      inflightRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated && isInternalFilesAvailable()) {
      load(folderId);
    } else {
      setLoading(false);
    }
  }, [isAuthenticated, folderId, load]);

  const openFolder = (id) => {
    if (busy) return;
    setFolderId(id);
  };

  /* ---- 新建文件夹 ---- */
  const handleNewFolder = async () => {
    const name = window.prompt('新建文件夹名称：', '新建文件夹');
    if (name === null) return;
    setBusy(true);
    try {
      await createFolder(folderId, name, user);
      await load(folderId);
    } catch (err) {
      alert('新建文件夹失败：' + (err?.message || err));
    } finally {
      setBusy(false);
    }
  };

  /* ---- 上传（文件 / 文件夹） ---- */
  const doUpload = async (fileList, isFolder) => {
    const list = Array.from(fileList || []);
    if (list.length === 0) return;
    setBusy(true);
    setProgress({ done: 0, total: list.length, current: '' });
    try {
      const onProgress = (done, total, current) =>
        setProgress({ done, total, current });
      const fn = isFolder ? uploadFolderTree : uploadFiles;
      const { errors } = await fn(folderId, list, user, onProgress);
      await load(folderId);
      if (errors && errors.length > 0) {
        alert(`部分文件上传失败（${errors.length} 个），其余已成功上传。`);
      }
    } catch (err) {
      alert('上传失败：' + (err?.message || err));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const handleFilesPicked = (e) => {
    doUpload(e.target.files, false);
    e.target.value = ''; // 允许再次选择同一文件
  };

  const handleFolderPicked = (e) => {
    doUpload(e.target.files, true);
    e.target.value = '';
  };

  /* ---- 拖拽上传（文件） ---- */
  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if (busy) return;
    const dropped = e.dataTransfer?.files;
    if (dropped && dropped.length > 0) doUpload(dropped, false);
  };

  /* ---- 重命名 ---- */
  const handleRename = async (node) => {
    const name = window.prompt('重命名：', node.name);
    if (name === null || name.trim() === node.name) return;
    setBusy(true);
    try {
      await renameNode(node, name);
      await load(folderId);
    } catch (err) {
      alert('重命名失败：' + (err?.message || err));
    } finally {
      setBusy(false);
    }
  };

  /* ---- 删除 ---- */
  const handleDelete = async (node) => {
    const msg = node.isFolder
      ? `确定删除文件夹「${node.name}」及其中的全部内容吗？此操作不可撤销。`
      : `确定删除文件「${node.name}」吗？此操作不可撤销。`;
    if (!window.confirm(msg)) return;
    setBusy(true);
    try {
      await deleteNode(node);
      await load(folderId);
    } catch (err) {
      alert('删除失败：' + (err?.message || err));
    } finally {
      setBusy(false);
    }
  };

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (!isInternalFilesAvailable()) {
    return (
      <div className="internal-files-page">
        <div className="container">
          <div className="internal-files-page__header">
            <div>
              <h1><HardDrive size={28} /> 内部资料</h1>
              <p>团队内部文件资源库</p>
            </div>
          </div>
          <div className="internal-files-page__empty">
            <AlertCircle size={40} />
            <p>服务未连接</p>
            <span>内部资料需要登录并连接服务器后才能使用。</span>
          </div>
        </div>
      </div>
    );
  }

  const folderCount = items.filter((i) => i.isFolder).length;
  const fileCount = items.length - folderCount;

  return (
    <div className="internal-files-page">
      <div className="container">
        {/* 头部 */}
        <div className="internal-files-page__header">
          <div>
            <h1><HardDrive size={28} /> 内部资料</h1>
            <p>团队内部文件资源库 · 可上传文件 / 文件夹，也可自行新建文件夹整理</p>
          </div>
          <div className="internal-files-page__actions">
            <button
              className="if-btn if-btn--ghost"
              onClick={() => load(folderId)}
              disabled={loading || busy}
              title="刷新"
            >
              <RefreshCw size={16} className={loading ? 'if-spin' : ''} />
              <span className="if-btn__text">刷新</span>
            </button>
            <button className="if-btn" onClick={handleNewFolder} disabled={busy}>
              <FolderPlus size={16} />
              <span className="if-btn__text">新建文件夹</span>
            </button>
            <button className="if-btn" onClick={() => filesInputRef.current?.click()} disabled={busy}>
              <Upload size={16} />
              <span className="if-btn__text">上传文件</span>
            </button>
            <button className="if-btn" onClick={() => folderInputRef.current?.click()} disabled={busy}>
              <FolderUp size={16} />
              <span className="if-btn__text">上传文件夹</span>
            </button>
          </div>
        </div>

        {/* 隐藏的文件选择框 */}
        <input
          ref={filesInputRef}
          type="file"
          multiple
          hidden
          onChange={handleFilesPicked}
        />
        <input
          ref={folderInputRef}
          type="file"
          hidden
          webkitdirectory=""
          directory=""
          multiple
          onChange={handleFolderPicked}
        />

        {/* 面包屑 */}
        <div className="internal-files-page__breadcrumb">
          <button
            className={`if-crumb ${folderId ? '' : 'if-crumb--active'}`}
            onClick={() => openFolder(null)}
            disabled={busy}
          >
            <Folder size={14} /> 全部资料
          </button>
          {breadcrumb.map((node, idx) => (
            <span key={node.id} className="if-crumb-wrap">
              <ChevronRight size={14} className="if-crumb-sep" />
              <button
                className={`if-crumb ${idx === breadcrumb.length - 1 ? 'if-crumb--active' : ''}`}
                onClick={() => openFolder(node.id)}
                disabled={busy}
              >
                {node.name}
              </button>
            </span>
          ))}
        </div>

        {/* 上传进度 */}
        {progress && (
          <div className="internal-files-page__progress">
            <RefreshCw size={16} className="if-spin" />
            <span>
              正在上传 {progress.done}/{progress.total}
              {progress.current ? ` · ${progress.current}` : ''}
            </span>
          </div>
        )}

        {error && (
          <div className="internal-files-page__error">
            <AlertCircle size={16} /> {error}
          </div>
        )}

        {/* 文件列表 */}
        <div
          className={`internal-files-page__body ${dragOver ? 'is-dragover' : ''}`}
          onDragOver={(e) => { e.preventDefault(); if (!busy) setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          {loading ? (
            <div className="internal-files-page__loading">
              <RefreshCw size={20} className="if-spin" />
              <span>加载中…</span>
            </div>
          ) : items.length === 0 ? (
            <div className="internal-files-page__empty">
              <Inbox size={40} />
              <p>这个文件夹是空的</p>
              <span>点击右上角「上传文件 / 上传文件夹」，或把文件拖拽到此处</span>
            </div>
          ) : (
            <div className="if-table">
              <div className="if-table__head">
                <span className="if-col-name">名称</span>
                <span className="if-col-size">大小</span>
                <span className="if-col-owner">上传者</span>
                <span className="if-col-date">时间</span>
                <span className="if-col-actions" />
              </div>
              {items.map((node) => {
                if (node.isFolder) {
                  return (
                    <div key={node.id} className="if-row">
                      <button
                        className="if-col-name if-name-btn"
                        onClick={() => openFolder(node.id)}
                        disabled={busy}
                        title={node.name}
                      >
                        <span className="if-icon is-folder"><Folder size={20} /></span>
                        <span className="if-name-text">{node.name}</span>
                      </button>
                      <span className="if-col-size">文件夹</span>
                      <span className="if-col-owner">{node.createdBy || '—'}</span>
                      <span className="if-col-date">{formatDate(node.createdAt)}</span>
                      <span className="if-col-actions">
                        {canModify(node) && (
                          <>
                            <button className="if-icon-btn" title="重命名" onClick={() => handleRename(node)} disabled={busy}>
                              <Pencil size={15} />
                            </button>
                            <button className="if-icon-btn if-icon-btn--danger" title="删除" onClick={() => handleDelete(node)} disabled={busy}>
                              <Trash2 size={15} />
                            </button>
                          </>
                        )}
                      </span>
                    </div>
                  );
                }

                const { Icon, label, cls } = getFileMeta(node);
                return (
                  <div key={node.id} className="if-row">
                    <a
                      className="if-col-name if-name-btn"
                      href={node.url || '#'}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={`${node.name} · 点击预览`}
                    >
                      <span className={`if-icon ${cls}`}><Icon size={20} /></span>
                      <span className="if-name-text">{node.name}</span>
                      <span className="if-badge">{label}</span>
                    </a>
                    <span className="if-col-size">{formatSize(node.sizeBytes)}</span>
                    <span className="if-col-owner">{node.createdBy || '—'}</span>
                    <span className="if-col-date">{formatDate(node.createdAt)}</span>
                    <span className="if-col-actions">
                      <a
                        className="if-icon-btn"
                        href={toDownloadUrl(node.url, node.name)}
                        title="下载"
                        download={node.name}
                      >
                        <Download size={15} />
                      </a>
                      {canModify(node) && (
                        <>
                          <button className="if-icon-btn" title="重命名" onClick={() => handleRename(node)} disabled={busy}>
                            <Pencil size={15} />
                          </button>
                          <button className="if-icon-btn if-icon-btn--danger" title="删除" onClick={() => handleDelete(node)} disabled={busy}>
                            <Trash2 size={15} />
                          </button>
                        </>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {!loading && items.length > 0 && (
          <div className="internal-files-page__stats">
            <span><Folder size={13} /> {folderCount} 个文件夹</span>
            <span><File size={13} /> {fileCount} 个文件</span>
          </div>
        )}

        <div className="internal-files-page__hint">
          <AlertCircle size={14} />
          <span>所有成员均可查看与上传；文件夹 / 文件的重命名和删除仅限上传者本人或管理员。删除文件夹会一并删除其中全部内容，且不可撤销。</span>
        </div>
      </div>
    </div>
  );
}
