import { useState, useRef, useCallback, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useSiteContent } from '../../contexts/SiteContentContext';
import { useWysiwyg } from '../../contexts/WysiwygContext';
import { useNotifications } from '../../contexts/NotificationContext';
import { emitNotificationEvent } from '../../lib/notificationRuleEngine';
import EditableText from '../../components/EditableText';
import CustomSelect from '../../components/CustomSelect';
import {
  Camera,
  Plus,
  X,
  Upload,
  ChevronLeft,
  ChevronRight,
  Calendar,
  Image as ImageIcon,
  Trash2,
  FolderPlus,
  Images,
  Download,
  Loader2,
} from 'lucide-react';
import {
  fetchAlbumList,
  fetchAlbumPhotos,
  createAlbum as svcCreateAlbum,
  deleteAlbum as svcDeleteAlbum,
  addPhotosToAlbum as svcAddPhotos,
  deletePhoto as svcDeletePhoto,
} from '../../services/albumService';
import './Gallery.css';

/* ---------- 工具函数：选择缩略图 / 原图 URL ---------- */
// 展示优先用上传时生成的缩略图；老数据没有缩略图时降级回原图。
const getDisplayUrl = (photo) => photo?.thumbUrl || photo?.url || '';
// 下载始终走原图。
const getOriginalUrl = (photo) => photo?.url || '';

/* ---------- 工具函数：下载时推断合适的文件名 ----------
 * 优先级：caption(若无扩展名则补 ext) → originalName → storagePath 文件名 → 'photo.jpg'
 */
const guessDownloadFilename = (photo, blob) => {
  const pickExt = () => {
    const fromPath = (photo?.storagePath || '').split('/').pop() || '';
    const m1 = fromPath.match(/\.([a-z0-9]+)$/i);
    if (m1) return m1[1].toLowerCase();
    const fromName = photo?.originalName || '';
    const m2 = fromName.match(/\.([a-z0-9]+)$/i);
    if (m2) return m2[1].toLowerCase();
    const m3 = (blob?.type || '').match(/^image\/([a-z0-9+]+)$/i);
    if (m3) return m3[1].toLowerCase().replace('jpeg', 'jpg');
    return 'jpg';
  };
  const ext = pickExt();

  // 1) caption 有值就用 caption（若 caption 自带扩展名则不重复追加）
  if (photo?.caption && photo.caption.trim()) {
    const c = photo.caption.trim();
    return /\.[a-z0-9]+$/i.test(c) ? c : `${c}.${ext}`;
  }
  // 2) 用户上传时的原始文件名
  if (photo?.originalName) return photo.originalName;
  // 3) storage path 的文件名
  const fromPath = (photo?.storagePath || '').split('/').pop();
  if (fromPath) return fromPath;
  // 4) 兜底
  return `photo.${ext}`;
};

/* ---------- 工具函数：格式化日期显示 ---------- */
const formatAlbumDate = (dateStr) => {
  if (!dateStr) return '';
  // 支持 "2025"、"2025-03"、"2025-03-22"
  const parts = dateStr.split('-');
  const y = parts[0];
  const m = parts[1] ? parseInt(parts[1], 10) : null;
  const d = parts[2] ? parseInt(parts[2], 10) : null;
  if (m && d) return `${y} 年 ${m} 月 ${d} 日`;
  if (m) return `${y} 年 ${m} 月`;
  return `${y} 年`;
};

/* ---------- 工具函数：根据年月计算该月天数（用于"日"下拉的选项数量） ---------- */
const daysInMonth = (year, month) => {
  const y = parseInt(year, 10);
  const m = parseInt(month, 10);
  if (!y || !m || m < 1 || m > 12) return 31;
  // new Date(y, m, 0) 的 day 即 y 年 m 月的最后一天
  return new Date(y, m, 0).getDate();
};

/* ---------- 空状态由接口/本地缓存提供，不再 seed 示例数据 ---------- */

/**
 * 相册列表的本地缓存（SWR 模式）
 * - 打开页面先读缓存，立刻显示上次的列表，避免白屏等待；
 * - 后台再调 fetchAlbumList() 拉最新，拉到后覆盖并同步写回缓存。
 * 只缓存封面 + 数量（fetchAlbumList 的 _partial 结构），不缓存详情里的全量照片。
 */
const ALBUM_LIST_CACHE_KEY = 'riemer_album_list_cache_v1';

const readAlbumListCache = () => {
  try {
    const raw = localStorage.getItem(ALBUM_LIST_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const writeAlbumListCache = (list) => {
  try {
    localStorage.setItem(ALBUM_LIST_CACHE_KEY, JSON.stringify(list));
  } catch { /* quota/private mode 忽略 */ }
};


export default function Gallery() {
  const { isAuthenticated, isAdmin, user } = useAuth();
  const { internalConfig, updateInternalConfig } = useSiteContent();
  const { editing } = useWysiwyg();
  // useNotifications 保留以确保 NotificationProvider 就绪；
  // 通知派发已统一走规则引擎 emitNotificationEvent。
  useNotifications();
  const gc = internalConfig.gallery || {};

  const updateGallery = useCallback(
    (key, val) => updateInternalConfig({ gallery: { [key]: val } }),
    [updateInternalConfig]
  );
  // 初始值优先用本地缓存（SWR）：有缓存立刻显示；没有则 loading=true 等接口
  const [albums, setAlbums] = useState(() => readAlbumListCache() || []);
  const [loading, setLoading] = useState(() => {
    const cached = readAlbumListCache();
    return !cached || cached.length === 0;
  });
  const [submitting, setSubmitting] = useState(false);
  // 上传进度：{ done, total }，total=0 表示无进度条（如纯元信息创建）
  const [uploadProgress, setUploadProgress] = useState({ done: 0, total: 0 });
  const [selectedAlbum, setSelectedAlbum] = useState(null);
  const [albumDetailLoading, setAlbumDetailLoading] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(null);
  const [showCreateAlbum, setShowCreateAlbum] = useState(false);
  const [showAddPhoto, setShowAddPhoto] = useState(false);
  const now = new Date();
  const [newAlbum, setNewAlbum] = useState({
    title: '',
    description: '',
    year: now.getFullYear().toString(),
    month: (now.getMonth() + 1).toString(),
    day: '', // 选填
  });
  const [selectedFiles, setSelectedFiles] = useState([]);
  // 新建相册时预选的照片（与 selectedFiles 结构一致）
  const [createAlbumFiles, setCreateAlbumFiles] = useState([]);
  // 拖拽态：标记两个 dropzone 的 hover 高亮
  const [isDraggingCreate, setIsDraggingCreate] = useState(false);
  const [isDraggingAdd, setIsDraggingAdd] = useState(false);
  const fileInputRef = useRef(null);
  const albumFileInputRef = useRef(null);
  const createAlbumFileRef = useRef(null);

  /* ---- 初次加载：只拉相册列表 + 封面（不拉全部照片，避免卡顿）
         已有本地缓存时 loading=false，此处的拉取为"后台静默刷新"，
         拉到新数据再覆盖 state + 同步写回缓存。 ---- */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const list = await fetchAlbumList();
        if (!alive) return;
        setAlbums(list);
        writeAlbumListCache(list);
      } catch (err) {
        console.warn('[Gallery] 加载相册失败：', err);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  /* ---- albums 发生任何本地变更（创建/删除/改名/新增照片等）后，
         同步写回本地缓存，保证下次打开首屏即是最新。---- */
  useEffect(() => {
    if (loading) return; // 首批拉取完成之前不覆盖缓存
    writeAlbumListCache(albums);
  }, [albums, loading]);

  /* ---- 打开相册详情：若当前是 _partial 数据，懒加载全部照片 ---- */
  const openAlbum = useCallback(async (album) => {
    setSelectedAlbum(album);
    if (!album?._partial) return;
    setAlbumDetailLoading(true);
    try {
      const photos = await fetchAlbumPhotos(album.id);
      // 同时更新列表和当前详情
      setAlbums((prev) =>
        prev.map((a) =>
          a.id === album.id ? { ...a, photos, _partial: false } : a
        )
      );
      setSelectedAlbum((prev) =>
        prev && prev.id === album.id ? { ...prev, photos, _partial: false } : prev
      );
    } catch (err) {
      console.warn('[Gallery] 打开相册失败：', err);
      alert('加载相册照片失败：' + (err.message || '未知错误'));
    } finally {
      setAlbumDetailLoading(false);
    }
  }, []);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  /* ---- 创建相册（上传到 Storage + 写入 DB） ---- */
  const handleCreateAlbum = async (e) => {
    e.preventDefault();
    if (!newAlbum.title.trim() || submitting) return;
    const y = newAlbum.year || now.getFullYear().toString();
    const m = (newAlbum.month || '1').padStart(2, '0');
    const d = newAlbum.day ? String(newAlbum.day).padStart(2, '0') : '';
    const albumDate = d ? `${y}-${m}-${d}` : `${y}-${m}`;

    // 关键：立即进入提交态并初始化进度，让按钮第一时间给出反馈，
    // 而不是等上传完才改 UI，避免"点击无反应"的错觉。
    setSubmitting(true);
    setUploadProgress({ done: 0, total: createAlbumFiles.length });
    try {
      const filesPayload = createAlbumFiles.map((f) => {
        const defaultCaption = f.file.name.replace(/\.[^.]+$/, '');
        return {
          file: f.file,
          caption: f.caption === defaultCaption ? '' : f.caption,
        };
      });
      const album = await svcCreateAlbum(
        {
          title: newAlbum.title,
          description: newAlbum.description,
          date: albumDate,
        },
        filesPayload,
        user,
        {
          onProgress: (done, total) => setUploadProgress({ done, total }),
        }
      );
      setAlbums((prev) => [album, ...prev]);

      // 发送"相册新增照片"通知：统一走规则引擎，由用户自定义规则决定是否收到。
      // 仅当本次创建确实带了照片时才发，纯建空相册不打扰其他人。
      if (filesPayload.length > 0) {
        try {
          const uploader = user?.nickname || user?.name || '某成员';
          emitNotificationEvent('gallery.upload', {
            operator: uploader,
            operatorUserId: user?.id,
            albumTitle: album.title,
            count: filesPayload.length,
          });
        } catch (err) {
          console.warn('[Gallery] 发送上传通知失败:', err?.message || err);
        }
      }

      const resetNow = new Date();
      setNewAlbum({
        title: '',
        description: '',
        year: resetNow.getFullYear().toString(),
        month: (resetNow.getMonth() + 1).toString(),
        day: '',
      });
      // 释放 blob URL
      createAlbumFiles.forEach((f) => URL.revokeObjectURL(f.url));
      setCreateAlbumFiles([]);
      setShowCreateAlbum(false);
    } catch (err) {
      console.error('[Gallery] 创建相册失败：', err);
      alert('创建相册失败：' + (err.message || '未知错误'));
    } finally {
      setSubmitting(false);
      setUploadProgress({ done: 0, total: 0 });
    }
  };

  /* ---- 通用：把 File[] 转为预览对象 ---- */
  const filesToPreviews = (files) =>
    files
      .filter((f) => f && f.type && f.type.startsWith('image/'))
      .map((file) => ({
        file,
        url: URL.createObjectURL(file),
        caption: file.name.replace(/\.[^.]+$/, ''),
      }));

  /* ---- 新建相册表单中选择图片（点击） ---- */
  const handleCreateAlbumFileSelect = (e) => {
    const files = Array.from(e.target.files || []);
    const previews = filesToPreviews(files);
    setCreateAlbumFiles((prev) => [...prev, ...previews]);
    // 清空 input，避免同一文件无法再次选中
    if (e.target) e.target.value = '';
  };

  /* ---- 添加照片到相册（点击） ---- */
  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files || []);
    const previews = filesToPreviews(files);
    setSelectedFiles((prev) => [...prev, ...previews]);
    if (e.target) e.target.value = '';
  };

  /* ---- 拖拽：通用阻止默认 ---- */
  const preventDragDefault = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  /* ---- 新建相册 dropzone：拖拽 ---- */
  const handleCreateAlbumDrop = (e) => {
    preventDragDefault(e);
    setIsDraggingCreate(false);
    const files = Array.from(e.dataTransfer?.files || []);
    const previews = filesToPreviews(files);
    if (previews.length > 0) {
      setCreateAlbumFiles((prev) => [...prev, ...previews]);
    }
  };

  /* ---- 详情页上传 dropzone：拖拽 ---- */
  const handleAddPhotoDrop = (e) => {
    preventDragDefault(e);
    setIsDraggingAdd(false);
    const files = Array.from(e.dataTransfer?.files || []);
    const previews = filesToPreviews(files);
    if (previews.length > 0) {
      setSelectedFiles((prev) => [...prev, ...previews]);
    }
  };

  const handleAddPhotos = async () => {
    if (!selectedAlbum || selectedFiles.length === 0 || submitting) return;
    setSubmitting(true);
    setUploadProgress({ done: 0, total: selectedFiles.length });
    try {
      const filesPayload = selectedFiles.map((f) => {
        const defaultCaption = f.file.name.replace(/\.[^.]+$/, '');
        return {
          file: f.file,
          caption: f.caption === defaultCaption ? '' : f.caption,
        };
      });
      const newPhotos = await svcAddPhotos(selectedAlbum, filesPayload, user, {
        onProgress: (done, total) => setUploadProgress({ done, total }),
      });
      setAlbums((prev) =>
        prev.map((a) =>
          a.id === selectedAlbum.id
            ? { ...a, photos: [...a.photos, ...newPhotos] }
            : a
        )
      );
      setSelectedAlbum((prev) => ({
        ...prev,
        photos: [...prev.photos, ...newPhotos],
      }));

      // 发送"相册新增照片"通知（由规则引擎按用户自定义规则触发）。
      // 以实际成功写入的 newPhotos 数量为准，避免中途失败时数字对不上。
      if (Array.isArray(newPhotos) && newPhotos.length > 0) {
        try {
          const uploader = user?.nickname || user?.name || '某成员';
          emitNotificationEvent('gallery.upload', {
            operator: uploader,
            operatorUserId: user?.id,
            albumTitle: selectedAlbum.title,
            count: newPhotos.length,
          });
        } catch (err) {
          console.warn('[Gallery] 发送上传通知失败:', err?.message || err);
        }
      }

      // 释放 blob URL
      selectedFiles.forEach((f) => URL.revokeObjectURL(f.url));
      setSelectedFiles([]);
      setShowAddPhoto(false);
    } catch (err) {
      console.error('[Gallery] 上传照片失败：', err);
      alert('上传照片失败：' + (err.message || '未知错误'));
    } finally {
      setSubmitting(false);
      setUploadProgress({ done: 0, total: 0 });
    }
  };

  /* ---- 删除照片 ---- */
  const handleDeletePhoto = async (photoId) => {
    if (!window.confirm('确定要删除这张照片吗？')) return;
    const photo = selectedAlbum.photos.find((p) => p.id === photoId);
    if (!photo) return;
    try {
      await svcDeletePhoto(selectedAlbum, photo);
    } catch (err) {
      console.error('[Gallery] 删除照片失败：', err);
      alert('删除照片失败：' + (err.message || '未知错误'));
      return;
    }
    setAlbums((prev) =>
      prev.map((a) =>
        a.id === selectedAlbum.id
          ? { ...a, photos: a.photos.filter((p) => p.id !== photoId) }
          : a
      )
    );
    setSelectedAlbum((prev) => ({
      ...prev,
      photos: prev.photos.filter((p) => p.id !== photoId),
    }));
  };

  /* ---- 删除相册 ---- */
  const handleDeleteAlbum = async (albumId) => {
    if (!window.confirm('确定要删除整个相册吗？所有照片将一并删除。')) return;
    const album = albums.find((a) => a.id === albumId);
    if (!album) return;
    try {
      await svcDeleteAlbum(album);
    } catch (err) {
      console.error('[Gallery] 删除相册失败：', err);
      alert('删除相册失败：' + (err.message || '未知错误'));
      return;
    }
    setAlbums((prev) => prev.filter((a) => a.id !== albumId));
    if (selectedAlbum?.id === albumId) setSelectedAlbum(null);
  };

  // 权限判断：管理员或创建者/上传者可删除
  const canModifyAlbum = (album) => {
    if (isAdmin) return true;
    if (album.createdById && album.createdById === user?.id) return true;
    if (album.createdBy && album.createdBy === user?.name) return true;
    return false;
  };

  const canModifyPhoto = (photo) => {
    if (isAdmin) return true;
    // 照片上传者可删除
    if (photo.uploadedById && photo.uploadedById === user?.id) return true;
    // 相册创建者也可删除相册内的照片
    if (selectedAlbum?.createdById && selectedAlbum.createdById === user?.id) return true;
    return false;
  };

  /* ---- Lightbox ---- */
  const openLightbox = (index) => setLightboxIndex(index);
  const closeLightbox = () => setLightboxIndex(null);

  /* ---- 下载原图 ---- */
  const handleDownloadOriginal = async (photo) => {
    const originalUrl = getOriginalUrl(photo);
    if (!originalUrl) return;
    try {
      const response = await fetch(originalUrl);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = guessDownloadFilename(photo, blob);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch {
      // fallback: 直接在新标签页打开原图
      window.open(originalUrl, '_blank');
    }
  };

  const lightboxPrev = () => {
    if (lightboxIndex === null || !selectedAlbum) return;
    setLightboxIndex(
      (lightboxIndex - 1 + selectedAlbum.photos.length) % selectedAlbum.photos.length
    );
  };

  const lightboxNext = () => {
    if (lightboxIndex === null || !selectedAlbum) return;
    setLightboxIndex((lightboxIndex + 1) % selectedAlbum.photos.length);
  };

  /* ========================================
     VIEW: 相册列表
     ======================================== */
  if (!selectedAlbum) {
    return (
      <div className="gallery-page">
        <div className="container">
          {/* Header */}
          <div className="gallery-page__header">
            <div>
              <h1>
                <Camera size={28} /> <EditableText
                  value={gc.pageTitle}
                  onChange={(v) => updateGallery('pageTitle', v)}
                  configKey="gallery.pageTitle"
                  as="span"
                />
              </h1>
              <p><EditableText
                value={gc.pageDesc}
                onChange={(v) => updateGallery('pageDesc', v)}
                configKey="gallery.pageDesc"
                as="span"
              /></p>
            </div>
            <button
              className="btn btn-primary"
              onClick={() => {
                const next = !showCreateAlbum;
                if (!next) {
                  // 关闭/取消时清空已选图片
                  setCreateAlbumFiles([]);
                }
                setShowCreateAlbum(next);
              }}
            >
              {showCreateAlbum ? <X size={18} /> : <FolderPlus size={18} />}
              {showCreateAlbum ? '取消' : <EditableText
                value={gc.newAlbumBtn}
                onChange={(v) => updateGallery('newAlbumBtn', v)}
                configKey="gallery.newAlbumBtn"
                as="span"
              />}
            </button>
          </div>

          {/* 新建相册表单 */}
          {showCreateAlbum && (
            <div className="gallery-create card">
              <h3>
                <FolderPlus size={18} /> 新建相册
              </h3>
              <form onSubmit={handleCreateAlbum} className="gallery-create__form">
                <div className="gallery-create__field">
                  <label>相册主题</label>
                  <input
                    type="text"
                    value={newAlbum.title}
                    onChange={(e) => setNewAlbum({ ...newAlbum, title: e.target.value })}
                    placeholder="例如：招新聚会"
                    className="gallery-create__input"
                    required
                  />
                </div>
                <div className="gallery-create__field">
                  <label>时间</label>
                  <div className="gallery-create__date-row">
                    <CustomSelect
                      size="sm"
                      className="gallery-create__select"
                      value={String(newAlbum.year)}
                      onChange={(v) => setNewAlbum({ ...newAlbum, year: v })}
                      options={Array.from({ length: 10 }, (_, i) => {
                        const y = new Date().getFullYear() - i;
                        return { value: String(y), label: `${y} 年` };
                      })}
                    />
                    <CustomSelect
                      size="sm"
                      className="gallery-create__select"
                      value={String(newAlbum.month)}
                      onChange={(v) => {
                        // 切换月份后，如果已选的"日"超出新月天数，则清空
                        const maxDay = daysInMonth(newAlbum.year, v);
                        setNewAlbum((prev) => ({
                          ...prev,
                          month: v,
                          day: prev.day && parseInt(prev.day, 10) > maxDay ? '' : prev.day,
                        }));
                      }}
                      options={Array.from({ length: 12 }, (_, i) => ({
                        value: String(i + 1),
                        label: `${i + 1} 月`,
                      }))}
                    />
                    <CustomSelect
                      size="sm"
                      className="gallery-create__select"
                      value={String(newAlbum.day || '')}
                      onChange={(v) => setNewAlbum({ ...newAlbum, day: v })}
                      placeholder="日（选填）"
                      allowClear
                      options={Array.from(
                        { length: daysInMonth(newAlbum.year, newAlbum.month) },
                        (_, i) => ({ value: String(i + 1), label: `${i + 1} 日` })
                      )}
                    />
                  </div>
                </div>
                <div className="gallery-create__field">
                  <label>描述（选填）</label>
                  <textarea
                    value={newAlbum.description}
                    onChange={(e) => setNewAlbum({ ...newAlbum, description: e.target.value })}
                    placeholder="简要描述这次活动"
                    className="gallery-create__input gallery-create__textarea"
                    rows={3}
                  />
                </div>
                <div className="gallery-create__field">
                  <label>照片（选填）</label>
                  <div
                    className={`gallery-upload__dropzone gallery-create__dropzone${isDraggingCreate ? ' is-dragover' : ''}`}
                    onClick={() => createAlbumFileRef.current?.click()}
                    onDragEnter={(e) => {
                      preventDragDefault(e);
                      setIsDraggingCreate(true);
                    }}
                    onDragOver={(e) => {
                      preventDragDefault(e);
                      setIsDraggingCreate(true);
                    }}
                    onDragLeave={(e) => {
                      preventDragDefault(e);
                      setIsDraggingCreate(false);
                    }}
                    onDrop={handleCreateAlbumDrop}
                  >
                    <input
                      ref={createAlbumFileRef}
                      type="file"
                      multiple
                      accept="image/*"
                      onChange={handleCreateAlbumFileSelect}
                      style={{ display: 'none' }}
                    />
                    <Upload size={28} />
                    <p>点击或拖拽照片到这里上传</p>
                    <span>支持多张同时选择，创建后还能继续添加</span>
                  </div>
                  {createAlbumFiles.length > 0 && (
                    <div className="gallery-upload__preview gallery-create__preview">
                      {createAlbumFiles.map((f, i) => (
                        <div key={i} className="gallery-upload__preview-item">
                          <div className="gallery-upload__preview-img-wrapper">
                            <img src={f.url} alt={f.caption} />
                            <button
                              type="button"
                              className="gallery-upload__preview-remove"
                              onClick={() =>
                                setCreateAlbumFiles((prev) => prev.filter((_, idx) => idx !== i))
                              }
                            >
                              <X size={14} />
                            </button>
                          </div>
                          <input
                            type="text"
                            className="gallery-upload__caption-input"
                            placeholder="添加注释（选填）"
                            value={f.caption === f.file.name.replace(/\.[^.]+$/, '') ? '' : f.caption}
                            onChange={(e) => {
                              setCreateAlbumFiles((prev) =>
                                prev.map((item, idx) =>
                                  idx === i ? { ...item, caption: e.target.value } : item
                                )
                              );
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={submitting || !newAlbum.title.trim()}
                >
                  {submitting ? (
                    <>
                      <Loader2 size={16} className="gallery-spin" />
                      {uploadProgress.total > 0
                        ? `正在上传 ${uploadProgress.done}/${uploadProgress.total}…`
                        : '正在创建…'}
                    </>
                  ) : (
                    <>
                      <Plus size={16} /> 创建{createAlbumFiles.length > 0 ? `（含 ${createAlbumFiles.length} 张照片）` : ''}
                    </>
                  )}
                </button>
              </form>
            </div>
          )}

          {/* 相册列表 */}
          {loading ? (
            <div className="gallery-empty">
              <Images size={48} />
              <h3>加载中...</h3>
            </div>
          ) : albums.length > 0 ? (
            <div className="gallery-grid">
              {[...albums].sort((a, b) => b.date.localeCompare(a.date)).map((album) => {
                const cover = album.photos[album.coverIndex] || album.photos[0];
                return (
                  <div
                    key={album.id}
                    className="album-card card"
                    onClick={() => openAlbum(album)}
                  >
                    <div className="album-card__cover">
                      {cover ? (
                        <img src={getDisplayUrl(cover)} alt={album.title} loading="lazy" decoding="async" />
                      ) : (
                        <div className="album-card__cover-empty">
                          <Images size={40} />
                          <span>暂无照片</span>
                        </div>
                      )}
                      <div className="album-card__cover-overlay">
                        <span className="album-card__photo-count">
                          <ImageIcon size={14} /> {album.photoCount ?? album.photos.length} 张
                        </span>
                      </div>
                    </div>
                    <div className="album-card__body">
                      <h3 className="album-card__title">{album.title}</h3>
                      {album.description && (
                        <p className="album-card__desc">{album.description}</p>
                      )}
                      <div className="album-card__meta">
                        <span>
                          <Calendar size={12} /> {formatAlbumDate(album.date)}
                        </span>
                      </div>
                    </div>
                    {/* 删除按钮 */}
                    {canModifyAlbum(album) && (
                      <button
                        className="album-card__delete"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteAlbum(album.id);
                        }}
                        title="删除相册"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="gallery-empty">
              <Images size={48} />
              <h3>还没有相册</h3>
              <p>点击「新建相册」开始记录美好瞬间</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  /* ========================================
     VIEW: 相册详情（照片网格）
     ======================================== */
  return (
    <div className="gallery-page">
      <div className="container">
        {/* 详情 Header */}
        <div className="gallery-detail__header">
          <button
            className="gallery-detail__back"
            onClick={() => {
              setSelectedAlbum(null);
              setShowAddPhoto(false);
              setSelectedFiles([]);
            }}
          >
            <ChevronLeft size={20} /> 返回相册
          </button>
          <div className="gallery-detail__info">
            <h1>{selectedAlbum.title}</h1>
            {selectedAlbum.description && (
              <p className="gallery-detail__desc">{selectedAlbum.description}</p>
            )}
            <span className="gallery-detail__meta">
              <Calendar size={14} /> {formatAlbumDate(selectedAlbum.date)} · {selectedAlbum.photoCount ?? selectedAlbum.photos.length} 张照片
            </span>
          </div>
          <button
            className="btn btn-primary"
            onClick={() => setShowAddPhoto(!showAddPhoto)}
          >
            {showAddPhoto ? <X size={18} /> : <Upload size={18} />}
            {showAddPhoto ? '取消' : '上传照片'}
          </button>
        </div>

        {/* 上传照片区域 */}
        {showAddPhoto && (
          <div className="gallery-upload card">
            <div
              className={`gallery-upload__dropzone${isDraggingAdd ? ' is-dragover' : ''}`}
              onClick={() => albumFileInputRef.current?.click()}
              onDragEnter={(e) => {
                preventDragDefault(e);
                setIsDraggingAdd(true);
              }}
              onDragOver={(e) => {
                preventDragDefault(e);
                setIsDraggingAdd(true);
              }}
              onDragLeave={(e) => {
                preventDragDefault(e);
                setIsDraggingAdd(false);
              }}
              onDrop={handleAddPhotoDrop}
            >
              <input
                ref={albumFileInputRef}
                type="file"
                multiple
                accept="image/*"
                onChange={handleFileSelect}
                style={{ display: 'none' }}
              />
              <Upload size={32} />
              <p>点击或拖拽照片到这里上传</p>
              <span>支持多张同时选择，JPG / PNG / WebP 等图片格式</span>
            </div>

            {selectedFiles.length > 0 && (
              <>
                <div className="gallery-upload__preview">
                  {selectedFiles.map((f, i) => (
                    <div key={i} className="gallery-upload__preview-item">
                      <div className="gallery-upload__preview-img-wrapper">
                        <img src={f.url} alt={f.caption} />
                        <button
                          className="gallery-upload__preview-remove"
                          onClick={() =>
                            setSelectedFiles((prev) => prev.filter((_, idx) => idx !== i))
                          }
                        >
                          <X size={14} />
                        </button>
                      </div>
                      <input
                        type="text"
                        className="gallery-upload__caption-input"
                        placeholder="添加注释（选填）"
                        value={f.caption === f.file.name.replace(/\.[^.]+$/, '') ? '' : f.caption}
                        onChange={(e) => {
                          setSelectedFiles((prev) =>
                            prev.map((item, idx) =>
                              idx === i ? { ...item, caption: e.target.value } : item
                            )
                          );
                        }}
                      />
                    </div>
                  ))}
                </div>
                <button
                  className="btn btn-primary"
                  onClick={handleAddPhotos}
                  disabled={submitting}
                >
                  {submitting ? (
                    <>
                      <Loader2 size={16} className="gallery-spin" />
                      正在上传 {uploadProgress.done}/{uploadProgress.total || selectedFiles.length}…
                    </>
                  ) : (
                    <>
                      <Upload size={16} /> 确认上传 {selectedFiles.length} 张照片
                    </>
                  )}
                </button>
              </>
            )}
          </div>
        )}

        {/* 照片网格 */}
        {albumDetailLoading ? (
          <div className="gallery-empty">
            <Images size={48} />
            <h3>加载中...</h3>
          </div>
        ) : selectedAlbum.photos.length > 0 ? (
          <div className="photo-grid">
            {selectedAlbum.photos.map((photo, index) => (
              <div
                key={photo.id}
                className="photo-card"
                onClick={() => openLightbox(index)}
              >
                <img src={getDisplayUrl(photo)} alt={photo.caption} loading="lazy" decoding="async" />
                <div className="photo-card__overlay">
                  {photo.caption && (
                    <span className="photo-card__caption">{photo.caption}</span>
                  )}
                  <div className="photo-card__actions">
                    <button
                      className="photo-card__download"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDownloadOriginal(photo);
                      }}
                      title="下载原图"
                    >
                      <Download size={14} />
                      <span>下载原图</span>
                    </button>
                    {canModifyPhoto(photo) && (
                      <button
                        className="photo-card__delete"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeletePhoto(photo.id);
                        }}
                        title="删除照片"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="gallery-empty">
            <ImageIcon size={48} />
            <h3>这个相册还没有照片</h3>
            <p>点击「上传照片」添加第一张照片吧</p>
          </div>
        )}
      </div>

      {/* Lightbox */}
      {lightboxIndex !== null && selectedAlbum.photos[lightboxIndex] && (
        <div className="lightbox" onClick={closeLightbox}>
          <div className="lightbox__content" onClick={(e) => e.stopPropagation()}>
            <img
              src={getDisplayUrl(selectedAlbum.photos[lightboxIndex])}
              alt={selectedAlbum.photos[lightboxIndex].caption}
            />
            {selectedAlbum.photos[lightboxIndex].caption && (
              <div className="lightbox__caption">
                {selectedAlbum.photos[lightboxIndex].caption}
              </div>
            )}
          </div>

          <button
            className="lightbox__download"
            onClick={(e) => {
              e.stopPropagation();
              handleDownloadOriginal(selectedAlbum.photos[lightboxIndex]);
            }}
            title="下载原图"
          >
            <Download size={20} /> 下载原图
          </button>

          <button className="lightbox__close" onClick={closeLightbox}>
            <X size={24} />
          </button>

          {selectedAlbum.photos.length > 1 && (
            <>
              <button
                className="lightbox__nav lightbox__nav--prev"
                onClick={(e) => {
                  e.stopPropagation();
                  lightboxPrev();
                }}
              >
                <ChevronLeft size={28} />
              </button>
              <button
                className="lightbox__nav lightbox__nav--next"
                onClick={(e) => {
                  e.stopPropagation();
                  lightboxNext();
                }}
              >
                <ChevronRight size={28} />
              </button>
            </>
          )}

          <div className="lightbox__counter">
            {lightboxIndex + 1} / {selectedAlbum.photos.length}
          </div>
        </div>
      )}
    </div>
  );
}
