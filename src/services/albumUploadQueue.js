import {
  createAlbum as createAlbumRequest,
  addPhotosToAlbum as addPhotosToAlbumRequest,
} from './albumService';
import { emitNotificationEvent } from '../lib/notificationRuleEngine';
import {
  savePendingUpload,
  removePendingUpload,
  getPendingUploads,
} from './albumUploadPersistence';

const listeners = new Set();
const tasks = [];
let snapshot = [];

const cloneTask = (task) => ({
  id: task.id,
  type: task.type,
  status: task.status,
  title: task.title,
  albumId: task.albumId,
  albumTitle: task.albumTitle,
  done: task.done,
  total: task.total,
  error: task.error,
  createdAt: task.createdAt,
  updatedAt: task.updatedAt,
});

/* ---------- 刷新/关闭网页前的拦截：有任务在传时弹原生确认框 ---------- */
const hasRunningTasks = () => tasks.some((task) => task.status === 'running');
let guardAttached = false;
const beforeUnloadHandler = (event) => {
  if (!hasRunningTasks()) return undefined;
  // 触发浏览器原生"离开此页面？"确认框，防止手滑刷新/关闭打断上传。
  event.preventDefault();
  event.returnValue = '';
  return '';
};
const syncBeforeUnloadGuard = () => {
  if (typeof window === 'undefined') return;
  const need = hasRunningTasks();
  if (need && !guardAttached) {
    window.addEventListener('beforeunload', beforeUnloadHandler);
    guardAttached = true;
  } else if (!need && guardAttached) {
    window.removeEventListener('beforeunload', beforeUnloadHandler);
    guardAttached = false;
  }
};

const notify = () => {
  snapshot = tasks.map(cloneTask);
  syncBeforeUnloadGuard();
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {
      // Ignore subscriber failures so one stale view cannot break uploads.
    }
  });
};

const updateTask = (id, patch) => {
  const task = tasks.find((item) => item.id === id);
  if (!task) return null;
  Object.assign(task, patch, { updatedAt: Date.now() });
  notify();
  return task;
};

const emitUploadNotification = ({ user, albumTitle, count }) => {
  if (!count || count <= 0) return;
  try {
    const uploader = user?.nickname || user?.name || '某成员';
    emitNotificationEvent('gallery.upload', {
      operator: uploader,
      operatorUserId: user?.id,
      albumTitle,
      count,
    });
  } catch (err) {
    console.warn('[AlbumUploadQueue] 发送上传通知失败:', err?.message || err);
  }
};

export const subscribeAlbumUploadQueue = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const getAlbumUploadQueueSnapshot = () => snapshot;

export const getActiveAlbumUploadTask = () =>
  getAlbumUploadQueueSnapshot().find((task) => task.status === 'running') || null;

export const clearFinishedAlbumUploadTasks = () => {
  for (let i = tasks.length - 1; i >= 0; i--) {
    if (tasks[i].status !== 'running') tasks.splice(i, 1);
  }
  notify();
};

// 关闭单个已完成（成功/失败）的任务条；正在上传的任务不允许关闭。
export const clearAlbumUploadTask = (id) => {
  const idx = tasks.findIndex((task) => task.id === id);
  if (idx === -1) return;
  if (tasks[idx].status === 'running') return;
  tasks.splice(idx, 1);
  notify();
};

/* ============================================
 * 核心：把一个 job 跑起来（新建 / 加图通用）。
 * job: { id, type, meta?, album?, albumTitle?, files, user, createdAt }
 * 注意：job 已在调用前写入 IndexedDB；这里只负责执行 + 完成后清盘。
 * ============================================ */
const runJob = (job) => {
  const { id, type, files = [], user } = job;
  const isCreate = type === 'create-album';
  const displayTitle = isCreate
    ? job.meta?.title || '相册'
    : job.album?.title || job.albumTitle || '相册';

  // 同一任务已在内存队列里（例如续传被重复触发）→ 不重复跑
  if (tasks.some((item) => item.id === id)) return id;

  const task = {
    id,
    type,
    status: 'running',
    title: displayTitle,
    albumId: isCreate ? null : job.album?.id || null,
    albumTitle: displayTitle,
    done: 0,
    total: files.length || 0,
    error: '',
    createdAt: job.createdAt || Date.now(),
    updatedAt: Date.now(),
  };
  tasks.unshift(task);
  notify();

  const onProgress = (done, total) => updateTask(id, { done, total });

  const request = isCreate
    ? createAlbumRequest(job.meta, files, user, { onProgress })
    : addPhotosToAlbumRequest(job.album, files, user, { onProgress });

  request
    .then((result) => {
      const albumTitle = isCreate ? result?.title || displayTitle : displayTitle;
      const count = isCreate
        ? files.length || 0
        : Array.isArray(result)
          ? result.length
          : files.length || 0;
      updateTask(id, {
        status: 'success',
        albumId: isCreate ? result?.id || null : task.albumId,
        albumTitle,
        done: files.length || 0,
        total: files.length || 0,
      });
      removePendingUpload(id); // 成功 → 清盘
      emitUploadNotification({ user, albumTitle, count });
    })
    .catch((err) => {
      console.error('[AlbumUploadQueue] 上传失败：', err);
      updateTask(id, {
        status: 'error',
        error: err?.message || '上传失败',
      });
      removePendingUpload(id); // 彻底失败 → 也清盘，避免下次打开页面无限重试
    });

  return id;
};

const makeJobId = () =>
  `album-upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const slimUser = (user) =>
  user ? { id: user.id, name: user.name, nickname: user.nickname } : null;

export const startCreateAlbumUpload = ({ meta, files, user }) => {
  const id = makeJobId();
  const job = {
    id,
    type: 'create-album',
    meta,
    albumTitle: meta?.title || '相册',
    files,
    user: slimUser(user),
    createdAt: Date.now(),
  };
  savePendingUpload(job); // 先落盘，再开始传 —— 刷新也能续上
  runJob(job);
  return id;
};

export const startAddPhotosUpload = ({ album, files, user }) => {
  const id = makeJobId();
  // 续传时只需要 id / title / _fromDb / 以及"已有照片数"作为 sort_index 基准。
  const baseIndex = (album?.photos?.length ?? album?.photoCount) || 0;
  const slimAlbum = {
    id: album?.id || null,
    title: album?.title || '相册',
    _fromDb: !!album?._fromDb,
    photos: new Array(baseIndex), // 长度即 baseIndex，供 addPhotosToAlbum 计算排序起点
  };
  const job = {
    id,
    type: 'add-photos',
    album: slimAlbum,
    albumTitle: album?.title || '相册',
    files,
    user: slimUser(user),
    createdAt: Date.now(),
  };
  savePendingUpload(job);
  runJob(job);
  return id;
};

/* ============================================
 * 续传：读取 IndexedDB 里残留（被刷新/关闭中断）的任务并重新跑完。
 * 在相册页挂载时调用一次即可。
 * 注意：createAlbum / addPhotosToAlbum 都是"先把所有文件传到 Storage、
 *   最后再一次性写库"，所以中途被打断时数据库尚无记录，整体重跑是安全的
 *   （最坏只是重复上传若干已传到 Storage 的文件，浪费一点存储，不产生重复相册/照片）。
 * ============================================ */
let resuming = false;
export const resumePersistedAlbumUploads = async () => {
  if (resuming) return;
  resuming = true;
  try {
    const jobs = await getPendingUploads();
    jobs.forEach((job) => {
      if (!job || tasks.some((item) => item.id === job.id)) return;
      runJob(job);
    });
  } finally {
    resuming = false;
  }
};
