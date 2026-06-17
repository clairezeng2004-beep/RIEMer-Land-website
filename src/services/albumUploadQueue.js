import {
  createAlbum as createAlbumRequest,
  addPhotosToAlbum as addPhotosToAlbumRequest,
} from './albumService';
import { emitNotificationEvent } from '../lib/notificationRuleEngine';

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

const notify = () => {
  snapshot = tasks.map(cloneTask);
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

export const startCreateAlbumUpload = ({ meta, files, user }) => {
  const id = `album-upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const task = {
    id,
    type: 'create-album',
    status: 'running',
    title: meta.title,
    albumId: null,
    albumTitle: meta.title,
    done: 0,
    total: files?.length || 0,
    error: '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  tasks.unshift(task);
  notify();

  createAlbumRequest(meta, files, user, {
    onProgress: (done, total) => updateTask(id, { done, total }),
  })
    .then((album) => {
      updateTask(id, {
        status: 'success',
        albumId: album?.id || null,
        albumTitle: album?.title || meta.title,
        done: files?.length || 0,
        total: files?.length || 0,
      });
      emitUploadNotification({ user, albumTitle: album?.title || meta.title, count: files?.length || 0 });
    })
    .catch((err) => {
      console.error('[AlbumUploadQueue] 创建相册上传失败：', err);
      updateTask(id, {
        status: 'error',
        error: err?.message || '上传失败',
      });
    });

  return id;
};

export const startAddPhotosUpload = ({ album, files, user }) => {
  const id = `album-upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const task = {
    id,
    type: 'add-photos',
    status: 'running',
    title: album?.title || '相册',
    albumId: album?.id || null,
    albumTitle: album?.title || '相册',
    done: 0,
    total: files?.length || 0,
    error: '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  tasks.unshift(task);
  notify();

  addPhotosToAlbumRequest(album, files, user, {
    onProgress: (done, total) => updateTask(id, { done, total }),
  })
    .then((photos) => {
      updateTask(id, {
        status: 'success',
        done: files?.length || 0,
        total: files?.length || 0,
      });
      emitUploadNotification({ user, albumTitle: album?.title || '相册', count: photos?.length || 0 });
    })
    .catch((err) => {
      console.error('[AlbumUploadQueue] 上传照片失败：', err);
      updateTask(id, {
        status: 'error',
        error: err?.message || '上传失败',
      });
    });

  return id;
};
