import { useState, useRef, useCallback, useEffect, useSyncExternalStore } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
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
  Pencil,
  Check,
  Heart,
  MessageCircle,
  Send,
} from 'lucide-react';
import {
  fetchAlbumList,
  fetchAlbumPhotos,
  deleteAlbum as svcDeleteAlbum,
  updateAlbum as svcUpdateAlbum,
  deletePhoto as svcDeletePhoto,
  fetchPhotoLikes,
  togglePhotoLike,
  fetchPhotoComments,
  addPhotoComment,
  deletePhotoComment,
  fetchAlbumLikes,
  toggleAlbumLike,
  fetchAlbumComments,
  addAlbumComment,
  deleteAlbumComment,
} from '../../services/albumService';
import {
  clearAlbumUploadTask,
  clearFinishedAlbumUploadTasks,
  getAlbumUploadQueueSnapshot,
  resumePersistedAlbumUploads,
  startAddPhotosUpload,
  startCreateAlbumUpload,
  subscribeAlbumUploadQueue,
} from '../../services/albumUploadQueue';
import { getCachedAllUsers } from '../../lib/userDirectoryCache';
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
  const { isAuthenticated, isAdmin, user, getAllUsers } = useAuth();
  const [uploaderNames, setUploaderNames] = useState({});
  const [editingAlbum, setEditingAlbum] = useState(false);
  const [albumEdit, setAlbumEdit] = useState({ title: '', description: '', year: '', month: '', day: '' });
  const [savingAlbumEdit, setSavingAlbumEdit] = useState(false);
  // 点赞：{ [photoId]: [userId, ...] }；评论：{ [photoId]: [{id,userId,userName,content,createdAt}] }
  const [photoLikes, setPhotoLikes] = useState({});
  const [photoComments, setPhotoComments] = useState({});
  const [commentDraft, setCommentDraft] = useState('');
  const [postingComment, setPostingComment] = useState(false);
  // 相册级点赞 / 评论
  const [albumLikes, setAlbumLikes] = useState([]);
  const [albumComments, setAlbumComments] = useState([]);
  const [albumCommentDraft, setAlbumCommentDraft] = useState('');
  const [postingAlbumComment, setPostingAlbumComment] = useState(false);
  const [showAlbumComments, setShowAlbumComments] = useState(false);
  const { internalConfig, updateInternalConfig } = useSiteContent();
  const navigate = useNavigate();
  // 当前 URL 的相册 id（/internal/gallery/:albumId）。无则为列表视图。
  const { albumId } = useParams();
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

  /* ---- 加载上传者目录：id → 显示名（昵称优先），用于照片角标 ---- */
  useEffect(() => {
    let alive = true;
    (async () => {
      const list = await getCachedAllUsers(getAllUsers).catch(() => []);
      if (!alive || !Array.isArray(list)) return;
      const map = {};
      list.forEach((u) => {
        if (!u?.id) return;
        map[u.id] = u.nickname || u.name || '';
      });
      setUploaderNames(map);
    })();
    return () => {
      alive = false;
    };
  }, [getAllUsers]);

  /* ---- 加载当前相册照片的点赞 & 评论 ---- */
  const detailPhotoIdsKey = (selectedAlbum?.photos || [])
    .filter((p) => p._fromDb)
    .map((p) => p.id)
    .join(',');
  useEffect(() => {
    const ids = detailPhotoIdsKey ? detailPhotoIdsKey.split(',') : [];
    if (ids.length === 0) {
      setPhotoLikes({});
      setPhotoComments({});
      return;
    }
    let alive = true;
    (async () => {
      const [likes, comments] = await Promise.all([
        fetchPhotoLikes(ids),
        fetchPhotoComments(ids),
      ]);
      if (!alive) return;
      setPhotoLikes(likes);
      setPhotoComments(comments);
    })();
    return () => {
      alive = false;
    };
  }, [detailPhotoIdsKey]);

  /* ---- 加载相册级点赞 & 评论 ---- */
  const detailAlbumId = selectedAlbum?._fromDb ? selectedAlbum.id : null;
  useEffect(() => {
    if (!detailAlbumId) {
      setAlbumLikes([]);
      setAlbumComments([]);
      setShowAlbumComments(false);
      return;
    }
    let alive = true;
    (async () => {
      const [likes, comments] = await Promise.all([
        fetchAlbumLikes(detailAlbumId),
        fetchAlbumComments(detailAlbumId),
      ]);
      if (!alive) return;
      setAlbumLikes(likes);
      setAlbumComments(comments);
    })();
    return () => {
      alive = false;
    };
  }, [detailAlbumId]);

  /* ---- 大图查看：键盘 ←/↑ 上一张，→/↓ 下一张，Esc 关闭 ---- */
  useEffect(() => {
    if (lightboxIndex === null) return undefined;
    const onKeyDown = (e) => {
      // 正在输入评论时不抢占方向键
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) {
        if (e.key === 'Escape') setLightboxIndex(null);
        return;
      }
      const count = selectedAlbum?.photos?.length || 0;
      if (count === 0) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        setCommentDraft('');
        setLightboxIndex((i) => (i - 1 + count) % count);
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        setCommentDraft('');
        setLightboxIndex((i) => (i + 1) % count);
      } else if (e.key === 'Escape') {
        setLightboxIndex(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [lightboxIndex, selectedAlbum]);

  /* ---- 续传：进入相册页时，把上次被刷新/关闭中断的上传任务接着跑完 ---- */
  useEffect(() => {
    resumePersistedAlbumUploads();
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

  /* ---- URL ↔ 选中相册同步：支持 /internal/gallery/:albumId 直达详情、刷新/收藏不丢 ---- */
  useEffect(() => {
    if (!albumId) {
      setSelectedAlbum(null); // 回到列表视图
      return;
    }
    // 已经打开的就是它：不重复处理，避免覆盖已加载的照片
    if (selectedAlbum?.id === albumId) return;
    const found = albums.find((a) => String(a.id) === String(albumId));
    if (found) {
      openAlbum(found);
    } else if (!loading) {
      // 列表已加载完仍找不到 → 无效或已删除的链接，回退到相册列表
      navigate('/internal/gallery', { replace: true });
    }
  }, [albumId, albums, loading, selectedAlbum?.id, openAlbum, navigate]);

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
  const handleDeleteAlbum = async (targetId) => {
    if (!window.confirm('确定要删除整个相册吗？所有照片将一并删除。')) return;
    const album = albums.find((a) => a.id === targetId);
    if (!album) return;
    try {
      await svcDeleteAlbum(album);
    } catch (err) {
      console.error('[Gallery] 删除相册失败：', err);
      alert('删除相册失败：' + (err.message || '未知错误'));
      return;
    }
    setAlbums((prev) => prev.filter((a) => a.id !== targetId));
    // 若正在查看被删的相册，回到列表（URL 同步）
    if (selectedAlbum?.id === targetId) navigate('/internal/gallery', { replace: true });
  };

  /* ---- 编辑相册信息（标题 / 描述 / 日期） ---- */
  const startEditAlbum = () => {
    if (!selectedAlbum) return;
    const parts = String(selectedAlbum.date || '').split('-');
    setAlbumEdit({
      title: selectedAlbum.title || '',
      description: selectedAlbum.description || '',
      year: parts[0] || String(now.getFullYear()),
      month: parts[1] ? String(parseInt(parts[1], 10)) : '1',
      day: parts[2] ? String(parseInt(parts[2], 10)) : '',
    });
    setEditingAlbum(true);
  };

  const cancelEditAlbum = () => {
    setEditingAlbum(false);
    setSavingAlbumEdit(false);
  };

  const handleSaveAlbumEdit = async () => {
    if (!selectedAlbum) return;
    if (!albumEdit.title.trim()) {
      alert('相册主题不能为空');
      return;
    }
    const y = albumEdit.year || String(now.getFullYear());
    const m = (albumEdit.month || '1').padStart(2, '0');
    const d = albumEdit.day ? String(albumEdit.day).padStart(2, '0') : '';
    const date = d ? `${y}-${m}-${d}` : `${y}-${m}`;
    const patch = { title: albumEdit.title.trim(), description: albumEdit.description.trim(), date };

    setSavingAlbumEdit(true);
    let saved;
    try {
      saved = await svcUpdateAlbum(selectedAlbum, patch);
    } catch (err) {
      console.error('[Gallery] 更新相册失败：', err);
      alert('保存失败：' + (err.message || '未知错误'));
      setSavingAlbumEdit(false);
      return;
    }
    const merged = { title: saved.title, description: saved.description, date: saved.date };
    setSelectedAlbum((prev) => (prev ? { ...prev, ...merged } : prev));
    setAlbums((prev) => prev.map((a) => (a.id === selectedAlbum.id ? { ...a, ...merged } : a)));
    setEditingAlbum(false);
    setSavingAlbumEdit(false);
  };

  /* ---- 点赞 / 取消点赞（乐观更新） ---- */
  const handleToggleLike = async (photo) => {
    if (!user?.id) return;
    const current = photoLikes[photo.id] || [];
    const liked = current.includes(user.id);
    const next = liked ? current.filter((id) => id !== user.id) : [...current, user.id];
    setPhotoLikes((prev) => ({ ...prev, [photo.id]: next }));
    try {
      await togglePhotoLike(photo.id, user.id, !liked);
    } catch (err) {
      console.warn('[Gallery] 点赞失败：', err);
      setPhotoLikes((prev) => ({ ...prev, [photo.id]: current })); // 回滚
    }
  };

  /* ---- 发表评论 ---- */
  const handlePostComment = async (photo) => {
    const text = commentDraft.trim();
    if (!text || postingComment) return;
    setPostingComment(true);
    try {
      const created = await addPhotoComment(photo.id, user, text);
      setPhotoComments((prev) => ({
        ...prev,
        [photo.id]: [...(prev[photo.id] || []), created],
      }));
      setCommentDraft('');
    } catch (err) {
      console.error('[Gallery] 评论失败：', err);
      alert('评论失败：' + (err.message || '未知错误'));
    } finally {
      setPostingComment(false);
    }
  };

  /* ---- 删除评论 ---- */
  const handleDeleteComment = async (photoId, commentId) => {
    const prevList = photoComments[photoId] || [];
    setPhotoComments((prev) => ({
      ...prev,
      [photoId]: prevList.filter((c) => c.id !== commentId),
    }));
    try {
      await deletePhotoComment(commentId);
    } catch (err) {
      console.warn('[Gallery] 删除评论失败：', err);
      setPhotoComments((prev) => ({ ...prev, [photoId]: prevList })); // 回滚
      alert('删除评论失败：' + (err.message || '未知错误'));
    }
  };

  const canDeleteComment = (comment) => isAdmin || (comment.userId && comment.userId === user?.id);

  /* ---- 相册级：点赞 / 评论 ---- */
  const handleToggleAlbumLike = async () => {
    if (!user?.id || !selectedAlbum) return;
    const liked = albumLikes.includes(user.id);
    const next = liked ? albumLikes.filter((id) => id !== user.id) : [...albumLikes, user.id];
    setAlbumLikes(next);
    try {
      await toggleAlbumLike(selectedAlbum.id, user.id, !liked);
    } catch (err) {
      console.warn('[Gallery] 相册点赞失败：', err);
      setAlbumLikes(albumLikes); // 回滚
    }
  };

  const handlePostAlbumComment = async () => {
    const text = albumCommentDraft.trim();
    if (!text || postingAlbumComment || !selectedAlbum) return;
    setPostingAlbumComment(true);
    try {
      const created = await addAlbumComment(selectedAlbum.id, user, text);
      setAlbumComments((prev) => [...prev, created]);
      setAlbumCommentDraft('');
    } catch (err) {
      console.error('[Gallery] 相册评论失败：', err);
      alert('评论失败：' + (err.message || '未知错误'));
    } finally {
      setPostingAlbumComment(false);
    }
  };

  const handleDeleteAlbumComment = async (commentId) => {
    const prevList = albumComments;
    setAlbumComments((prev) => prev.filter((c) => c.id !== commentId));
    try {
      await deleteAlbumComment(commentId);
    } catch (err) {
      console.warn('[Gallery] 删除相册评论失败：', err);
      setAlbumComments(prevList); // 回滚
      alert('删除评论失败：' + (err.message || '未知错误'));
    }
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
    const phaseLabel = {
      queued: '等待上传',
      preparing: '读取照片信息',
      uploading: '上传照片',
      saving: '保存相册',
      done: '上传完成',
    };
    const finishedCount = uploadTasks.filter((task) => task.status !== 'running').length;
    return (
      <div className="gallery-upload-status-list">
        {uploadTasks.map((task) => {
          const isRunning = task.status === 'running';
          const isSuccess = task.status === 'success';
          const phase = phaseLabel[task.phase] || '后台上传中';
          return (
            <div
              key={task.id}
              className={`gallery-upload-status gallery-upload-status--${task.status}`}
            >
              <div className="gallery-upload-status__main">
                {isRunning && <Loader2 size={16} className="gallery-spin" />}
                <div className="gallery-upload-status__text">
                  <span>
                    {isRunning
                      ? `${phase}：${task.albumTitle} ${task.done}/${task.total || 0}`
                      : isSuccess
                        ? `上传完成：${task.albumTitle}`
                        : `上传失败：${task.albumTitle}`}
                  </span>
                  {isRunning && task.current && (
                    <span className="gallery-upload-status__detail">{task.current}</span>
                  )}
                  {isRunning && (
                    <span className="gallery-upload-status__warn">
                      上传中，请不要刷新或关闭页面
                    </span>
                  )}
                  {!isRunning && task.error && (
                    <span className="gallery-upload-status__error">{task.error}</span>
                  )}
                </div>
              </div>
              {!isRunning && (
                <button
                  type="button"
                  className="gallery-upload-status__clear"
                  onClick={() => clearAlbumUploadTask(task.id)}
                >
                  关闭已完成
                </button>
              )}
            </div>
          );
        })}
        {finishedCount > 1 && (
          <button
            type="button"
            className="gallery-upload-status__clear-all"
            onClick={clearFinishedAlbumUploadTasks}
          >
            全部关闭
          </button>
        )}
      </div>
    );
  };

  /* ---- Lightbox ---- */
  const openLightbox = (index) => {
    setCommentDraft('');
    setLightboxIndex(index);
  };
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
    setCommentDraft('');
    setLightboxIndex(
      (lightboxIndex - 1 + selectedAlbum.photos.length) % selectedAlbum.photos.length
    );
  };

  const lightboxNext = () => {
    if (lightboxIndex === null || !selectedAlbum) return;
    setCommentDraft('');
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
                      searchable={true}
                      searchPlaceholder="输入年份…"
                      options={Array.from({ length: 10 }, (_, i) => {
                        const y = new Date().getFullYear() - i;
                        return { value: String(y), label: `${y} 年` };
                      })}
                    />
                    <CustomSelect
                      size="sm"
                      className="gallery-create__select"
                      value={String(newAlbum.month)}
                      searchable={true}
                      searchPlaceholder="输入月份…"
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
                      searchable={true}
                      searchPlaceholder="输入日期…"
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
                    onClick={() => navigate(`/internal/gallery/${album.id}`)}
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
              navigate('/internal/gallery'); // URL 同步会清空 selectedAlbum
              setShowAddPhoto(false);
              setEditingAlbum(false);
              clearSelectedFiles();
              clearPhotoSelection();
            }}
          >
            <ChevronLeft size={20} /> 返回相册
          </button>
          {editingAlbum ? (
            <div className="gallery-detail__info gallery-detail__edit">
              <input
                type="text"
                className="gallery-create__input gallery-detail__edit-title"
                value={albumEdit.title}
                onChange={(e) => setAlbumEdit({ ...albumEdit, title: e.target.value })}
                placeholder="相册主题"
              />
              <textarea
                className="gallery-create__input gallery-create__textarea"
                value={albumEdit.description}
                onChange={(e) => setAlbumEdit({ ...albumEdit, description: e.target.value })}
                placeholder="描述（选填）"
                rows={2}
              />
              <div className="gallery-create__date-row">
                <CustomSelect
                  size="sm"
                  className="gallery-create__select"
                  value={String(albumEdit.year)}
                  onChange={(v) => setAlbumEdit({ ...albumEdit, year: v })}
                  searchable={true}
                  searchPlaceholder="输入年份…"
                  options={Array.from({ length: 10 }, (_, i) => {
                    const y = now.getFullYear() - i;
                    return { value: String(y), label: `${y} 年` };
                  })}
                />
                <CustomSelect
                  size="sm"
                  className="gallery-create__select"
                  value={String(albumEdit.month)}
                  searchable={true}
                  searchPlaceholder="输入月份…"
                  onChange={(v) => {
                    const maxDay = daysInMonth(albumEdit.year, v);
                    setAlbumEdit((prev) => ({
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
                  value={String(albumEdit.day || '')}
                  onChange={(v) => setAlbumEdit({ ...albumEdit, day: v })}
                  placeholder="日（选填）"
                  allowClear
                  searchable={true}
                  searchPlaceholder="输入日期…"
                  options={Array.from(
                    { length: daysInMonth(albumEdit.year, albumEdit.month) },
                    (_, i) => ({ value: String(i + 1), label: `${i + 1} 日` })
                  )}
                />
              </div>
            </div>
          ) : (
            <div className="gallery-detail__info">
              <h1>{selectedAlbum.title}</h1>
              {selectedAlbum.description && (
                <p className="gallery-detail__desc">{selectedAlbum.description}</p>
              )}
              <span className="gallery-detail__meta">
                <Calendar size={14} /> {formatAlbumDate(selectedAlbum.date)} · {selectedAlbum.photoCount ?? selectedAlbum.photos.length} 张照片
                {selectedAlbum.createdBy && <> · 由 {selectedAlbum.createdBy} 创建</>}
              </span>
            </div>
          )}
          <div className="gallery-detail__actions">
            {editingAlbum ? (
              <>
                <button
                  className="btn btn-primary"
                  onClick={handleSaveAlbumEdit}
                  disabled={savingAlbumEdit}
                >
                  {savingAlbumEdit ? <Loader2 size={18} className="gallery-spin" /> : <Check size={18} />}
                  {savingAlbumEdit ? '保存中' : '保存'}
                </button>
                <button
                  className="btn btn-ghost"
                  onClick={cancelEditAlbum}
                  disabled={savingAlbumEdit}
                >
                  <X size={18} /> 取消
                </button>
              </>
            ) : (
              <>
                {canModifyAlbum(selectedAlbum) && !multiSelectMode && (
                  <button
                    className="btn btn-ghost"
                    onClick={startEditAlbum}
                    title="编辑相册信息"
                  >
                    <Pencil size={18} /> 编辑
                  </button>
                )}
                <button
                  className={`btn btn-ghost gallery-detail__toggle${multiSelectMode ? ' is-active' : ''}`}
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
              </>
            )}
          </div>
        </div>
        {renderUploadStatus()}

        {/* 相册级点赞 + 评论 */}
        {!editingAlbum && selectedAlbum._fromDb && (() => {
          const liked = user?.id && albumLikes.includes(user.id);
          const likerNames = albumLikes.map((id) => uploaderNames[id]).filter(Boolean).join('、');
          return (
            <div className="gallery-detail__social">
              <div className="gallery-detail__social-bar">
                <button
                  className={`gallery-detail__like${liked ? ' is-liked' : ''}`}
                  onClick={handleToggleAlbumLike}
                  title={likerNames ? `点赞：${likerNames}` : '点赞这个相册'}
                >
                  <Heart size={16} fill={liked ? 'currentColor' : 'none'} />
                  <span>{albumLikes.length > 0 ? `${albumLikes.length} 个赞` : '点赞'}</span>
                </button>
                <button
                  className="gallery-detail__comment-toggle"
                  onClick={() => setShowAlbumComments((v) => !v)}
                >
                  <MessageCircle size={16} />
                  <span>评论{albumComments.length > 0 ? ` ${albumComments.length}` : ''}</span>
                </button>
                {likerNames && <span className="gallery-detail__likers">{likerNames}</span>}
              </div>

              {showAlbumComments && (
                <div className="gallery-detail__comments">
                  {albumComments.length === 0 ? (
                    <p className="gallery-detail__comments-empty">还没有评论，来说点什么吧</p>
                  ) : (
                    albumComments.map((c) => (
                      <div key={c.id} className="gallery-detail__comment">
                        <span className="gallery-detail__comment-author">{c.userName || '匿名'}</span>
                        <span className="gallery-detail__comment-text">{c.content}</span>
                        {canDeleteComment(c) && (
                          <button
                            className="gallery-detail__comment-del"
                            onClick={() => handleDeleteAlbumComment(c.id)}
                            title="删除评论"
                          >
                            <X size={12} />
                          </button>
                        )}
                      </div>
                    ))
                  )}
                  <div className="gallery-detail__comment-form">
                    <input
                      type="text"
                      value={albumCommentDraft}
                      onChange={(e) => setAlbumCommentDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handlePostAlbumComment();
                        }
                      }}
                      placeholder="写评论…"
                      maxLength={500}
                    />
                    <button
                      onClick={handlePostAlbumComment}
                      disabled={postingAlbumComment || !albumCommentDraft.trim()}
                      title="发送"
                    >
                      {postingAlbumComment ? <Loader2 size={16} className="gallery-spin" /> : <Send size={16} />}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })()}

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
                取消选择
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
                {uploaderNames[photo.uploadedById] && (
                  <span className="photo-card__uploader" title={`上传者：${uploaderNames[photo.uploadedById]}`}>
                    {uploaderNames[photo.uploadedById]}
                  </span>
                )}
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
                    {(() => {
                      const likers = photoLikes[photo.id] || [];
                      const liked = user?.id && likers.includes(user.id);
                      const likerNames = likers
                        .map((id) => uploaderNames[id])
                        .filter(Boolean)
                        .join('、');
                      return (
                        <button
                          className={`photo-card__like${liked ? ' is-liked' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleLike(photo);
                          }}
                          title={likerNames ? `点赞：${likerNames}` : '点赞'}
                        >
                          <Heart size={14} fill={liked ? 'currentColor' : 'none'} />
                          {likers.length > 0 && <span>{likers.length}</span>}
                        </button>
                      );
                    })()}
                    <button
                      className="photo-card__comment"
                      onClick={(e) => {
                        e.stopPropagation();
                        openLightbox(index);
                      }}
                      title="评论"
                    >
                      <MessageCircle size={14} />
                      {(photoComments[photo.id] || []).length > 0 && (
                        <span>{(photoComments[photo.id] || []).length}</span>
                      )}
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
            {(() => {
              const lp = selectedAlbum.photos[lightboxIndex];
              const likers = photoLikes[lp.id] || [];
              const liked = user?.id && likers.includes(user.id);
              const likerNames = likers.map((id) => uploaderNames[id]).filter(Boolean).join('、');
              const comments = photoComments[lp.id] || [];
              return (
                <div className="lightbox__social" onClick={(e) => e.stopPropagation()}>
                  <div className="lightbox__social-head">
                    <button
                      className={`lightbox__like${liked ? ' is-liked' : ''}`}
                      onClick={() => handleToggleLike(lp)}
                    >
                      <Heart size={16} fill={liked ? 'currentColor' : 'none'} />
                      <span>{likers.length > 0 ? `${likers.length} 个赞` : '点赞'}</span>
                    </button>
                    {likerNames && <span className="lightbox__likers">{likerNames}</span>}
                  </div>

                  <div className="lightbox__comments">
                    {comments.length === 0 ? (
                      <p className="lightbox__comments-empty">还没有评论，来说点什么吧</p>
                    ) : (
                      comments.map((c) => (
                        <div key={c.id} className="lightbox__comment">
                          <span className="lightbox__comment-author">{c.userName || '匿名'}</span>
                          <span className="lightbox__comment-text">{c.content}</span>
                          {canDeleteComment(c) && (
                            <button
                              className="lightbox__comment-del"
                              onClick={() => handleDeleteComment(lp.id, c.id)}
                              title="删除评论"
                            >
                              <X size={12} />
                            </button>
                          )}
                        </div>
                      ))
                    )}
                  </div>

                  <div className="lightbox__comment-form">
                    <input
                      type="text"
                      value={commentDraft}
                      onChange={(e) => setCommentDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handlePostComment(lp);
                        }
                      }}
                      placeholder="写评论…"
                      maxLength={500}
                    />
                    <button
                      onClick={() => handlePostComment(lp)}
                      disabled={postingComment || !commentDraft.trim()}
                      title="发送"
                    >
                      {postingComment ? <Loader2 size={16} className="gallery-spin" /> : <Send size={16} />}
                    </button>
                  </div>
                </div>
              );
            })()}
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
