// ============================================
// 相册上传任务持久化（IndexedDB）
// --------------------------------------------
// 目的：让"后台上传"在刷新 / 误关网页后不丢失——
//   start 上传时把任务（含 File blob）写入 IndexedDB，
//   成功或失败后删除；下次打开相册页时把残留的任务重新跑完。
// File / Blob 可被结构化克隆，直接存进 IndexedDB 即可，无需手动转 ArrayBuffer。
// IndexedDB 不可用（隐私模式 / 老浏览器）时所有方法静默降级为 no-op，
//   上传仍走内存队列，只是不再具备"刷新续传"能力。
// ============================================

const DB_NAME = 'riemer-album-uploads';
const STORE = 'jobs';
const DB_VERSION = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB 不可用'));
      return;
    }
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      reject(err);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function withStore(mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const store = tx.objectStore(STORE);
        let result;
        try {
          result = fn(store);
        } catch (err) {
          reject(err);
          return;
        }
        tx.oncomplete = () => {
          db.close();
          resolve(result);
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
        tx.onabort = () => {
          db.close();
          reject(tx.error);
        };
      })
  );
}

/**
 * 保存（或覆盖）一个待上传任务。
 * job 形如：
 *   { id, type:'create-album'|'add-photos', meta?, album?, albumTitle, files:[{file,caption}], user, createdAt }
 */
export async function savePendingUpload(job) {
  try {
    await withStore('readwrite', (store) => store.put(job));
  } catch (err) {
    console.warn('[AlbumUploadPersistence] 保存待上传任务失败（已忽略）：', err?.message || err);
  }
}

/** 删除一个任务（成功或彻底失败后调用）。 */
export async function removePendingUpload(id) {
  try {
    await withStore('readwrite', (store) => store.delete(id));
  } catch (err) {
    console.warn('[AlbumUploadPersistence] 删除待上传任务失败（已忽略）：', err?.message || err);
  }
}

/** 读取所有残留（被中断）的任务。失败时返回空数组。 */
export async function getPendingUploads() {
  try {
    return await withStore('readonly', (store) => {
      return new Promise((resolve, reject) => {
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    });
  } catch (err) {
    console.warn('[AlbumUploadPersistence] 读取待上传任务失败（已忽略）：', err?.message || err);
    return [];
  }
}
