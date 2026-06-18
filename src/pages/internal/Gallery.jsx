import { useState, useRef, useCallback, useEffect, useSyncExternalStore } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useSiteContent } from '../../contexts/SiteContentContext';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
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
  CheckSquare,
  Square,
} from 'lucide-react';
import {
  fetchAlbumList,
  fetchAlbumPhotos,
  deleteAlbum as svcDeleteAlbum,
  deletePhoto as svcDeletePhoto,
} from '../../services/albumService';
import {
  clearFinishedAlbumUploadTasks,
  getAlbumUploadQueueSnapshot,
  startAddPhotosUpload,
  startCreateAlbumUpload,
  subscribeAlbumUploadQueue,
} from '../../services/albumUploadQueue';
import './Gallery.css';

/* ---------- 工具函数：选择缩略图 / 原图 URL ---------- */
// 展示优先用上传时生成的缩略图；老数据没有缩略图时降级回原图。
const getDisplayUrl = (photo) => photo?.thumbUrl || photo?.url || '';
// 下载始终走原图。
const getOriginalUrl = (photo) => photo?.url || '';
// 缩略图文件缺失或访问失败时，自动切回原图，避免相册里一片空白。
const fallbackToOriginal = (event, photo) => {
  const original = getOriginalUrl(photo);
  if (!original || event.currentTarget.src === original) return;
  event.currentTarget.src = original;
};

/* ---------- 工具函数：下载时推断合适的文件名 ----------
 * 优先级：caption(若无扩展名则补 ext) → originalName → storagePath 文件名 → 'photo.jpg'
 */
const guessDownloadFilename = (photo) => {
  const pickExt = () => {
    const fromPath = (photo?.storagePath || '').split('/').pop() || '';
    const m1 = fromPath.match(/\.([a-z0-9]+)$/i);
    if (m1) return m1[1].toLowerCase();
    const fromName = photo?.originalName || '';
    const m2 = fromName.match(/\.([a-z0-9]+)$/i);
    if (m2) return m2[1].toLowerCase();
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

const getDownloadUrl = (url, filename) => {
  try {
    const downloadUrl = new URL(url);
    downloadUrl.searchParams.set('download', filename);
    return downloadUrl.toString();
  } catch {
    return url;
  }
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
const MAX_UPLOAD_FILES = 200;
const MAX_UPLOAD_FILE_SIZE = 100 * 1024 * 1024;

const formatFileSize = (bytes) => {
  if (!Number.isFinite(bytes)) return '';
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)}MB`;
  return `${Math.max(1, Math.round(bytes / 1024))}KB`;
};

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

const canUseRealtime = () => !!(isSupabaseConfigured && supabase);


export default function Gallery() {
  const { isAuthenticated, isAdmin, user } = useAuth();
  const { internalConfig, updateInternalConfig } = useSiteContent();
  const gc = internalConfig.gallery || {};
  const uploadTasks = useSyncExternalStore(
    subscribeAlbumUploadQueue,
    getAlbumUploadQueueSnapshot,
    getAlbumUploadQueueSnapshot
  );
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
  const [selectedAlbum, setSelectedAlbum] = useState(null);
  const [albumDetailLoading, setAlbumDetailLoading] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(null);
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [selectedPhotoIds, setSelectedPhotoIds] = useState([]);
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
  const albumFileInputRef = useRef(null);
  const createAlbumFileRef = useRef(null);
  const refreshTimerRef = useRef(null);

  const refreshAlbumList = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      const list = await fetchAlbumList();
      setAlbums(list);
      writeAlbumListCache(list);
      return list;
    } catch (err) {
      console.warn('[Gallery] 加载相册失败：', err);
      return null;
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  /* ---- 初次加载：只拉相册列表 + 封面（不拉全部照片，避免卡顿）
         已有本地缓存时 loading=false，此处的拉取为"后台静默刷新"，
         拉到新数据再覆盖 state + 同步写回缓存。 ---- */
  useEffect(() => {
    let alive = true;
    (async () => {
      const list = await fetchAlbumList().catch((err) => {
        console.warn('[Gallery] 加载相册失败：', err);
        return null;
      });
      if (!alive) return;
      if (list) {
        setAlbums(list);
        writeAlbumListCache(list);
      }
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!canUseRealtime()) return undefined;

    const scheduleRefresh = (changedAlbumId = null) => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = setTimeout(async () => {
        await refreshAlbumList({ quiet: true });
        if (changedAlbumId && selectedAlbum?.id === changedAlbumId) {
          try {
            const photos = await fetchAlbumPhotos(changedAlbumId);
            setSelectedAlbum((prev) =>
              prev && prev.id === changedAlbumId ? { ...prev, photos, _partial: false } : prev
            );
          } catch (err) {
            console.warn('[Gallery] 实时刷新相册详情失败：', err);
          }
        }
      }, 700);
    };

    const channel = supabase
      .channel('gallery_realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'albums' },
        () => scheduleRefresh()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'album_photos' },
        (payload) => scheduleRefresh(payload.new?.album_id || payload.old?.album_id || null)
      )
      .subscribe();

    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      supabase.removeChannel(channel);
    };
  }, [refreshAlbumList, selectedAlbum?.id]);

  /* ---- albums 发生任何本地变更（创建/删除/改名/新增照片等）后，
         同步写回本地缓存，保证下次打开首屏即是最新。---- */
  useEffect(() => {
    if (loading) return; // 首批拉取完成之前不覆盖缓存
    writeAlbumListCache(albums);
  }, [albums, loading]);

  useEffect(() => {
    const latestFinished = uploadTasks.find((task) => task.status !== 'running');
    if (!latestFinished) return;
    refreshAlbumList({ quiet: true });
    if (latestFinished.albumId && selectedAlbum?.id === latestFinished.albumId) {
      fetchAlbumPhotos(latestFinished.albumId)
        .then((photos) => {
          setSelectedAlbum((prev) =>
            prev && prev.id === latestFinished.albumId
              ? { ...prev, photos, photoCount: photos.length, _partial: false }
              : prev
          );
        })
        .catch((err) => console.warn('[Gallery] 上传完成后刷新相册详情失败：', err));
    }
  }, [refreshAlbumList, selectedAlbum?.id, uploadTasks]);

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

  const revokePreviewUrls = (items) => {
    (items || []).forEach((item) => {
      if (item?.url) URL.revokeObjectURL(item.url);
    });
  };

  const clearCreateAlbumFiles = () => {
    revokePreviewUrls(createAlbumFiles);
    setCreateAlbumFiles([]);
  };

  const clearSelectedFiles = () => {
    revokePreviewUrls(selectedFiles);
    setSelectedFiles([]);
  };

  const clearPhotoSelection = () => {
    setSelectedPhotoIds([]);
    setMultiSelectMode(false);
  };

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  /* ---- 创建相册（上传到 Storage + 写入 DB） ---- */
  const handleCreateAlbum = async (e) => {
    e.preventDefault();
    // 不再因为"已有上传任务在进行"而阻塞：后台队列支持多组并发上传。
    if (!newAlbum.title.trim()) return;
    const y = newAlbum.year || now.getFullYear().toString();
    const m = (newAlbum.month || '1').padStart(2, '0');
    const d = newAlbum.day ? String(newAlbum.day).padStart(2, '0') : '';
    const albumDate = d ? `${y}-${m}-${d}` : `${y}-${m}`;

    const filesPayload = createAlbumFiles.map((f) => {
      const defaultCaption = f.file.name.replace(/\.[^.]+$/, '');
      return {
        file: f.file,
        caption: f.caption === defaultCaption ? '' : f.caption,
      };
    });
    startCreateAlbumUpload({
      meta: {
        title: newAlbum.title,
        description: newAlbum.description,
        date: albumDate,
      },
      files: filesPayload,
      user,
    });

    const resetNow = new Date();
    setNewAlbum({
      title: '',
      description: '',
      year: resetNow.getFullYear().toString(),
      month: (resetNow.getMonth() + 1).toString(),
      day: '',
    });
    clearCreateAlbumFiles();
    setShowCreateAlbum(false);
  };

  /* ---- 通用：把 File[] 转为预览对象 ---- */
  const filesToPreviews = (files, currentCount = 0) => {
    const imageFiles = files.filter((f) => f && f.type && f.type.startsWith('image/'));
    const oversized = imageFiles.filter((f) => f.size > MAX_UPLOAD_FILE_SIZE);
    const validFiles = imageFiles.filter((f) => f.size <= MAX_UPLOAD_FILE_SIZE);
    const availableSlots = Math.max(0, MAX_UPLOAD_FILES - currentCount);
    const picked = validFiles.slice(0, availableSlots);
    const skippedNonImages = files.length - imageFiles.length;
    const skippedByCount = Math.max(0, validFiles.length - picked.length);

    if (oversized.length > 0 || skippedNonImages > 0 || skippedByCount > 0) {
      const parts = [];
      if (skippedNonImages > 0) parts.push(`${skippedNonImages} 个非图片文件已跳过`);
      if (oversized.length > 0) {
        parts.push(`${oversized.length} 张超过 ${formatFileSize(MAX_UPLOAD_FILE_SIZE)} 的图片已跳过`);
      }
      if (skippedByCount > 0) {
        parts.push(`单次最多选择 ${MAX_UPLOAD_FILES} 张，超出的 ${skippedByCount} 张已跳过`);
      }
      alert(parts.join('，') + '。');
    }

    return picked.map((file) => ({
      file,
      url: URL.createObjectURL(file),
      caption: file.name.replace(/\.[^.]+$/, ''),
    }));
  };

  /* ---- 新建相册表单中选择图片（点击） ---- */
  const handleCreateAlbumFileSelect = (e) => {
    const files = Array.from(e.target.files || []);
    const previews = filesToPreviews(files, createAlbumFiles.length);
    setCreateAlbumFiles((prev) => [...prev, ...previews]);
    // 清空 input，避免同一文件无法再次选中
    if (e.target) e.target.value = '';
  };

  /* ---- 添加照片到相册（点击） ---- */
  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files || []);
    const previews = filesToPreviews(files, selectedFiles.length);
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
    const previews = filesToPreviews(files, createAlbumFiles.length);
    if (previews.length > 0) {
      setCreateAlbumFiles((prev) => [...prev, ...previews]);
    }
  };

  /* ---- 详情页上传 dropzone：拖拽 ---- */
  const handleAddPhotoDrop = (e) => {
    preventDragDefault(e);
    setIsDraggingAdd(false);
    const files = Array.from(e.dataTransfer?.files || []);
    const previews = filesToPreviews(files, selectedFiles.length);
    if (previews.length > 0) {
      setSelectedFiles((prev) => [...prev, ...previews]);
    }
  };

  const handleAddPhotos = async () => {
    // 允许并发：即使上一组还在后台上传，也能立刻提交新一组。
    if (!selectedAlbum || selectedFiles.length === 0) return;
    const filesPayload = selectedFiles.map((f) => {
      const defaultCaption = f.file.name.replace(/\.[^.]+$/, '');
      return {
        file: f.file,
        caption: f.caption === defaultCaption ? '' : f.caption,
      };
    });
    startAddPhotosUpload({ album: selectedAlbum, files: filesPayload, user });
    clearSelectedFiles();
    setShowAddPhoto(false);
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

  const handleDeleteSelectedPhotos = async () => {
    const selectedPhotos = (selectedAlbum?.photos || []).filter((photo) =>
      selectedPhotoIds.includes(photo.id)
    );
    const deletablePhotos = selectedPhotos.filter(canModifyPhoto);
    if (deletablePhotos.length === 0) return;
    if (!window.confirm(`确定要删除选中的 ${deletablePhotos.length} 张照片吗？`)) return;

    try {
      for (const photo of deletablePhotos) {
        await svcDeletePhoto(selectedAlbum, photo);
      }
    } catch (err) {
      console.error('[Gallery] 批量删除照片失败：', err);
      alert('删除照片失败：' + (err.message || '未知错误'));
      return;
    }

    const deletedIds = new Set(deletablePhotos.map((photo) => photo.id));
    setAlbums((prev) =>
      prev.map((a) =>
        a.id === selectedAlbum.id
          ? { ...a, photos: a.photos.filter((p) => !deletedIds.has(p.id)) }
          : a
      )
    );
    setSelectedAlbum((prev) => ({
      ...prev,
      photos: prev.photos.filter((p) => !deletedIds.has(p.id)),
    }));
    setSelectedPhotoIds((prev) => prev.filter((id) => !deletedIds.has(id)));
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

  const renderUploadStatus = () => {
    if (uploadTasks.length === 0) return null;
    const hasFinished = uploadTasks.some((task) => task.status !== 'running');
    return (
      <div className="gallery-upload-status-list">
        {uploadTasks.map((task) => {
          const isRunning = task.status === 'running';
          const isSuccess = task.status === 'success';
          return (
            <div
              key={task.id}
              className={`gallery-upload-status gallery-upload-status--${task.status}`}
            >
              <div className="gallery-upload-status__main">
                {isRunning && <Loader2 size={16} className="gallery-spin" />}
                <span>
                  {isRunning
                    ? `后台上传中：${task.albumTitle} ${task.done}/${task.total || 0}`
                    : isSuccess
                      ? `上传完成：${task.albumTitle}`
                      : `上传失败：${task.albumTitle}`}
                </span>
              </div>
              {!isRunning && task.error && (
                <span className="gallery-upload-status__error">{task.error}</span>
              )}
            </div>
          );
        })}
        {hasFinished && (
          <button
            type="button"
            className="gallery-upload-status__clear"
            onClick={clearFinishedAlbumUploadTasks}
          >
            关闭已完成
          </button>
        )}
      </div>
    );
  };

  /* ---- Lightbox ---- */
  const openLightbox = (index) => setLightboxIndex(index);
  const closeLightbox = () => setLightboxIndex(null);

  /* ---- 下载原图 ---- */
  const handleDownloadOriginal = (photo) => {
    const originalUrl = getOriginalUrl(photo);
    if (!originalUrl) return;
    const filename = guessDownloadFilename(photo);
    const a = document.createElement('a');
    a.href = getDownloadUrl(originalUrl, filename);
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleDownloadDisplay = (photo) => {
    const displayUrl = getDisplayUrl(photo);
    if (!displayUrl) return;
    const filename = guessDownloadFilename(photo);
    const a = document.createElement('a');
    a.href = getDownloadUrl(displayUrl, filename);
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const downloadPhotos = (photos, downloader) => {
    photos.forEach((photo, index) => {
      window.setTimeout(() => downloader(photo), index * 160);
    });
  };

  const togglePhotoSelected = (photoId) => {
    setSelectedPhotoIds((prev) =>
      prev.includes(photoId) ? prev.filter((id) => id !== photoId) : [...prev, photoId]
    );
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
                  clearCreateAlbumFiles();
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
          {renderUploadStatus()}

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
                      searchable={false}
                      options={Array.from({ length: 10 }, (_, i) => {
                        const y = new Date().getFullYear() - i;
                        return { value: String(y), label: `${y} 年` };
                      })}
                    />
                    <CustomSelect
                      size="sm"
                      className="gallery-create__select"
                      value={String(newAlbum.month)}
                      searchable={false}
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
                      searchable={false}
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
                    <p>
                      点击<span className="gallery-upload__drag-hint">或拖拽</span>照片到这里上传
                    </p>
                    <span>支持多张同时选择，创建后还能继续添加</span>
                    <span>单次最多 {MAX_UPLOAD_FILES} 张，单张不超过 {formatFileSize(MAX_UPLOAD_FILE_SIZE)}</span>
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
                              onClick={() => {
                                URL.revokeObjectURL(f.url);
                                setCreateAlbumFiles((prev) => prev.filter((_, idx) => idx !== i));
                              }}
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
                  disabled={!newAlbum.title.trim()}
                >
                  <Plus size={16} /> 创建{createAlbumFiles.length > 0 ? `（含 ${createAlbumFiles.length} 张照片）` : ''}
                </button>
              </form>
            </div>
          )}

          {/* 相册列表 */}
          {loading ? (
            <div className="gallery-loading">
              <Loader2 size={20} className="gallery-loading__spinner" />
              <span className="gallery-loading__text">加载中</span>
              <span className="gallery-loading__hint">通常需要 1–2 秒</span>
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
                        <img
                          src={getDisplayUrl(cover)}
                          alt={album.title}
                          loading="lazy"
                          decoding="async"
                          onError={(e) => fallbackToOriginal(e, cover)}
                        />
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
              clearSelectedFiles();
              clearPhotoSelection();
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
          <div className="gallery-detail__actions">
            <button
              className={`btn ${multiSelectMode ? 'btn-secondary' : 'btn-outline'}`}
              onClick={() => {
                const next = !multiSelectMode;
                setMultiSelectMode(next);
                setSelectedPhotoIds([]);
                if (next) {
                  setShowAddPhoto(false);
                  clearSelectedFiles();
                }
              }}
            >
              {multiSelectMode ? <CheckSquare size={18} /> : <Square size={18} />}
              {multiSelectMode ? '退出多选' : '多选'}
            </button>
            <button
              className="btn btn-primary"
              onClick={() => {
                const next = !showAddPhoto;
                if (!next) clearSelectedFiles();
                if (next) clearPhotoSelection();
                setShowAddPhoto(next);
              }}
            >
              {showAddPhoto ? <X size={18} /> : <Upload size={18} />}
              {showAddPhoto ? '取消' : '上传照片'}
            </button>
          </div>
        </div>
        {renderUploadStatus()}

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
              <p>
                点击<span className="gallery-upload__drag-hint">或拖拽</span>照片到这里上传
              </p>
              <span>支持多张同时选择，JPG / PNG / WebP 等图片格式</span>
              <span>单次最多 {MAX_UPLOAD_FILES} 张，单张不超过 {formatFileSize(MAX_UPLOAD_FILE_SIZE)}</span>
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
                          onClick={() => {
                            URL.revokeObjectURL(f.url);
                            setSelectedFiles((prev) => prev.filter((_, idx) => idx !== i));
                          }}
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
                >
                  <Upload size={16} /> 确认上传 {selectedFiles.length} 张照片
                </button>
              </>
            )}
          </div>
        )}

        {/* 照片网格 */}
        {multiSelectMode && selectedAlbum.photos.length > 0 && (() => {
          const selectedPhotos = selectedAlbum.photos.filter((photo) =>
            selectedPhotoIds.includes(photo.id)
          );
          const deletableSelectedPhotos = selectedPhotos.filter(canModifyPhoto);
          return (
            <div className="gallery-bulkbar">
              <span>已选择 {selectedPhotos.length} 张</span>
              <button
                type="button"
                onClick={() => setSelectedPhotoIds(selectedAlbum.photos.map((photo) => photo.id))}
              >
                全选
              </button>
              <button type="button" onClick={() => setSelectedPhotoIds([])}>
                清空
              </button>
              <button
                type="button"
                disabled={selectedPhotos.length === 0}
                onClick={() => downloadPhotos(selectedPhotos, handleDownloadOriginal)}
              >
                <Download size={14} /> 下载原图
              </button>
              <button
                type="button"
                disabled={selectedPhotos.length === 0}
                onClick={() => downloadPhotos(selectedPhotos, handleDownloadDisplay)}
              >
                <Download size={14} /> 下载
              </button>
              {deletableSelectedPhotos.length > 0 && (
                <button
                  type="button"
                  className="gallery-bulkbar__danger"
                  onClick={handleDeleteSelectedPhotos}
                >
                  <Trash2 size={14} /> 删除
                </button>
              )}
            </div>
          );
        })()}

        {albumDetailLoading ? (
          <div className="gallery-loading">
            <Loader2 size={20} className="gallery-loading__spinner" />
            <span className="gallery-loading__text">加载中</span>
            <span className="gallery-loading__hint">通常需要 1–2 秒</span>
          </div>
        ) : selectedAlbum.photos.length > 0 ? (
          <div className="photo-grid">
            {selectedAlbum.photos.map((photo, index) => (
              <div
                key={photo.id}
                className={`photo-card${multiSelectMode ? ' is-selecting' : ''}${selectedPhotoIds.includes(photo.id) ? ' is-selected' : ''}`}
                onClick={() => {
                  if (multiSelectMode) {
                    togglePhotoSelected(photo.id);
                    return;
                  }
                  openLightbox(index);
                }}
              >
                {multiSelectMode && (
                  <button
                    type="button"
                    className="photo-card__select"
                    onClick={(e) => {
                      e.stopPropagation();
                      togglePhotoSelected(photo.id);
                    }}
                    aria-label={selectedPhotoIds.includes(photo.id) ? '取消选择' : '选择照片'}
                  >
                    {selectedPhotoIds.includes(photo.id) ? (
                      <CheckSquare size={20} />
                    ) : (
                      <Square size={20} />
                    )}
                  </button>
                )}
                <img
                  src={getDisplayUrl(photo)}
                  alt={photo.caption}
                  loading="lazy"
                  decoding="async"
                  onError={(e) => fallbackToOriginal(e, photo)}
                />
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
              onError={(e) => fallbackToOriginal(e, selectedAlbum.photos[lightboxIndex])}
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
