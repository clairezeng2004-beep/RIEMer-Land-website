// ============================================
// RIEMer Land — 相册服务（Supabase + Storage）
// ============================================
// 表：albums / album_photos
// Storage bucket：album-photos （公开读）
// 照片存两份：原图 + 前端生成的缩略图（~1280px）
//   - url / storage_path       → 原图（供下载）
//   - thumb_url / thumb_path   → 缩略图（供列表/Lightbox 展示）
// 未配置 Supabase 或失败时，回退到 localStorage。

import { supabase, isSupabaseConfigured } from '../lib/supabase';

const BUCKET = 'album-photos';
const LS_ALBUMS_KEY = 'riemer_albums_v1';

// 缩略图参数：最长边 1280px、JPEG 质量 0.82
const THUMB_MAX_SIDE = 1280;
const THUMB_QUALITY = 0.82;
const DEFAULT_UPLOAD_CONCURRENCY = 5;
const BULK_UPLOAD_CONCURRENCY = 3;
const LARGE_UPLOAD_CONCURRENCY = 2;
const HUGE_UPLOAD_CONCURRENCY = 1;
const LARGE_UPLOAD_THRESHOLD = 8 * 1024 * 1024;
const HUGE_UPLOAD_THRESHOLD = 30 * 1024 * 1024;
const BULK_UPLOAD_THRESHOLD = 30;
const STORAGE_UPLOAD_ATTEMPTS = 4;

const hasRemote = () => !!(isSupabaseConfigured && supabase);

/* ---------- 数据库行 → 前端对象 ---------- */
function rowToAlbum(row, photos = []) {
  return {
    id: row.id,
    title: row.title || '',
    description: row.description || '',
    date: row.date || '',
    coverIndex: typeof row.cover_index === 'number' ? row.cover_index : 0,
    createdById: row.created_by_id || null,
    createdBy: row.created_by || '',
    createdAt: row.created_at || null,
    photos: photos.map(rowToPhoto),
    _fromDb: true,
  };
}

function rowToPhoto(row) {
  return {
    id: row.id,
    url: row.url,
    storagePath: row.storage_path || null,
    thumbUrl: row.thumb_url || null,
    thumbPath: row.thumb_path || null,
    originalName: row.original_name || null,
    caption: row.caption || '',
    sortIndex: typeof row.sort_index === 'number' ? row.sort_index : 0,
    uploadedById: row.uploaded_by_id || null,
    capturedAt: row.captured_at || null,
    _fromDb: true,
  };
}

function rpcRowToAlbum(row) {
  const cover = row.cover_id
    ? rowToPhoto({
        id: row.cover_id,
        url: row.cover_url,
        storage_path: row.cover_storage_path,
        thumb_url: row.cover_thumb_url,
        thumb_path: row.cover_thumb_path,
        original_name: row.cover_original_name,
        caption: row.cover_caption,
        sort_index: row.cover_sort_index,
        uploaded_by_id: row.cover_uploaded_by_id,
        captured_at: row.cover_captured_at,
      })
    : null;

  return {
    id: row.album_id,
    title: row.title || '',
    description: row.description || '',
    date: row.date || '',
    coverIndex: typeof row.cover_index === 'number' ? row.cover_index : 0,
    createdById: row.created_by_id || null,
    createdBy: row.created_by || '',
    createdAt: row.created_at || null,
    photos: cover ? [cover] : [],
    photoCount: Number(row.photo_count || 0),
    _fromDb: true,
    _partial: true,
  };
}

function collectStoragePaths(photos = []) {
  const paths = [];
  photos.forEach((p) => {
    if (p?.storagePath) paths.push(p.storagePath);
    if (p?.thumbPath) paths.push(p.thumbPath);
  });
  return paths;
}

async function removeStoragePaths(paths) {
  if (!hasRemote() || !Array.isArray(paths) || paths.length === 0) return;
  const uniquePaths = [...new Set(paths.filter(Boolean))];
  if (uniquePaths.length === 0) return;
  const { error } = await supabase.storage.from(BUCKET).remove(uniquePaths);
  if (error) {
    console.warn('[AlbumService] Storage 清理失败：', error.message);
  }
}

async function cleanupUploaded(uploaded = []) {
  await removeStoragePaths(
    uploaded.flatMap((u) => [u?.path, u?.thumbPath]).filter(Boolean)
  );
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function uploadStorageObject(path, body, options, label) {
  let lastError = null;
  for (let attempt = 1; attempt <= STORAGE_UPLOAD_ATTEMPTS; attempt++) {
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, body, {
        ...options,
        upsert: true,
      });

    if (!error) return;
    lastError = error;
    console.warn(`[AlbumService] ${label}上传失败（第 ${attempt}/${STORAGE_UPLOAD_ATTEMPTS} 次）：`, error.message);
    if (attempt < STORAGE_UPLOAD_ATTEMPTS) {
      await wait(1000 * attempt * attempt);
    }
  }
  throw lastError;
}

/* ============================================
 * 查询所有相册（含照片）
 * ⚠️ 性能注意：只在"本地模式"或需要全量数据时使用。
 * 列表页请优先使用 fetchAlbumList() 只拉封面 + 数量，避免一次性下载全站照片。
 * ============================================ */
export async function fetchAllAlbums() {
  if (!hasRemote()) return getLocalAlbums();

  try {
    const { data: albums, error: e1 } = await supabase
      .from('albums')
      .select('*')
      .order('date', { ascending: false })
      .order('created_at', { ascending: false });
    if (e1) throw e1;

    if (!albums || albums.length === 0) return [];

    const ids = albums.map((a) => a.id);
    const { data: photos, error: e2 } = await supabase
      .from('album_photos')
      .select('*')
      .in('album_id', ids)
      .order('sort_index', { ascending: true })
      .order('created_at', { ascending: true });
    if (e2) throw e2;

    const byAlbum = {};
    (photos || []).forEach((p) => {
      (byAlbum[p.album_id] = byAlbum[p.album_id] || []).push(p);
    });

    return albums.map((a) => rowToAlbum(a, byAlbum[a.id] || []));
  } catch (err) {
    console.warn('[AlbumService] 获取相册失败，回退本地：', err.message);
    return getLocalAlbums();
  }
}

/* ============================================
 * 列表页专用：只拉相册 + 每相册首张照片作为封面 + 总张数
 * 不把所有照片一次性拉回来，大幅提升相册 Tab 加载速度。
 * ============================================ */
export async function fetchAlbumList() {
  if (!hasRemote()) {
    // 本地模式直接返回（数据量小）
    return getLocalAlbums().map((a) => ({
      ...a,
      photoCount: (a.photos || []).length,
    }));
  }

  try {
    try {
      const { data: fastList, error: fastError } = await supabase
        .rpc('get_album_list_fast');
      if (!fastError && Array.isArray(fastList)) {
        return fastList.map(rpcRowToAlbum);
      }
      if (fastError) {
        console.warn('[AlbumService] 快速相册列表 RPC 不可用，回退普通查询：', fastError.message);
      }
    } catch (rpcErr) {
      console.warn('[AlbumService] 快速相册列表 RPC 异常，回退普通查询：', rpcErr?.message || rpcErr);
    }

    const { data: albums, error: e1 } = await supabase
      .from('albums')
      .select('*')
      .order('date', { ascending: false })
      .order('created_at', { ascending: false });
    if (e1) throw e1;
    if (!albums || albums.length === 0) return [];

    const ids = albums.map((a) => a.id);

    // 1) 拉每个相册"排序最前"的一张照片作为封面
    //    只取必要字段，减小载荷
    const { data: covers, error: e2 } = await supabase
      .from('album_photos')
      .select('id,album_id,url,storage_path,thumb_url,thumb_path,original_name,caption,sort_index,uploaded_by_id')
      .in('album_id', ids)
      .order('sort_index', { ascending: true })
      .order('created_at', { ascending: true });
    if (e2) throw e2;

    // 2) 每个相册：第一张作封面 + 总数
    const firstByAlbum = {};
    const countByAlbum = {};
    (covers || []).forEach((p) => {
      countByAlbum[p.album_id] = (countByAlbum[p.album_id] || 0) + 1;
      if (!firstByAlbum[p.album_id]) firstByAlbum[p.album_id] = p;
    });

    return albums.map((a) => {
      const cover = firstByAlbum[a.id];
      const photos = cover ? [rowToPhoto(cover)] : [];
      return {
        ...rowToAlbum(a, []),
        // 保持 photos 形状，列表页用 photos[0] 作为封面
        photos,
        coverIndex: 0,
        photoCount: countByAlbum[a.id] || 0,
        _partial: true, // 标记为部分数据，进详情时需再拉全部照片
      };
    });
  } catch (err) {
    console.warn('[AlbumService] 获取相册列表失败，回退本地：', err.message);
    return getLocalAlbums().map((a) => ({
      ...a,
      photoCount: (a.photos || []).length,
    }));
  }
}

/* ============================================
 * 懒加载单个相册的全部照片（用于打开相册详情页时）
 * ============================================ */
export async function fetchAlbumPhotos(albumId) {
  if (!hasRemote()) {
    const album = getLocalAlbums().find((a) => String(a.id) === String(albumId));
    return album ? album.photos || [] : [];
  }
  try {
    const { data, error } = await supabase
      .from('album_photos')
      .select('*')
      .eq('album_id', albumId)
      // 兜底排序键；真正的展示顺序在下方按"拍摄时间"重新排序。
      .order('sort_index', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) throw error;
    return sortPhotosByCapturedAt((data || []).map(rowToPhoto));
  } catch (err) {
    console.warn('[AlbumService] 加载相册照片失败：', err.message);
    throw err;
  }
}

/* ============================================
 * 按"拍摄时间"(captured_at) 升序排序照片。
 * - 有 EXIF 拍摄时间的照片按拍摄时间从早到晚排列；
 * - 没有拍摄时间的（老数据 / 无 EXIF）排在最后，并按原有
 *   sort_index → created_at 作为稳定兜底次序。
 * ============================================ */
function sortPhotosByCapturedAt(photos = []) {
  const toTime = (v) => {
    if (!v) return null;
    const t = new Date(v).getTime();
    return Number.isNaN(t) ? null : t;
  };
  return photos
    .map((photo, index) => ({ photo, index }))
    .sort((a, b) => {
      const ta = toTime(a.photo.capturedAt);
      const tb = toTime(b.photo.capturedAt);
      if (ta !== null && tb !== null) {
        if (ta !== tb) return ta - tb;
      } else if (ta !== null) {
        return -1; // 有拍摄时间的排在前
      } else if (tb !== null) {
        return 1;
      }
      // 都没有拍摄时间，或拍摄时间相同：保持稳定兜底次序
      const sa = typeof a.photo.sortIndex === 'number' ? a.photo.sortIndex : 0;
      const sb = typeof b.photo.sortIndex === 'number' ? b.photo.sortIndex : 0;
      if (sa !== sb) return sa - sb;
      return a.index - b.index;
    })
    .map((entry) => entry.photo);
}

/* ============================================
 * 前端生成缩略图
 * ------------------------------------------
 * 读入 File → 按最长边等比缩到 THUMB_MAX_SIDE → Canvas 导出 JPEG Blob
 * 失败（如 HEIC 浏览器不支持）时返回 null，上层继续只传原图。
 * ============================================ */
async function generateThumbnail(file) {
  if (!file || !file.type || !file.type.startsWith('image/')) return null;

  let objectUrl = null;
  let bitmap = null;
  try {
    // 优先用 createImageBitmap（快、无需 DOM）
    if (typeof createImageBitmap === 'function') {
      try {
        bitmap = await createImageBitmap(file);
      } catch {
        bitmap = null;
      }
    }

    let width, height;
    let source;

    if (bitmap) {
      width = bitmap.width;
      height = bitmap.height;
      source = bitmap;
    } else {
      // 兜底：用 <img>
      const img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = reject;
        objectUrl = URL.createObjectURL(file);
        el.src = objectUrl;
      });
      width = img.naturalWidth;
      height = img.naturalHeight;
      source = img;
    }

    if (!width || !height) return null;

    // 如果原图本身比阈值还小，就不再生成缩略图，避免双写浪费
    const maxSide = Math.max(width, height);
    if (maxSide <= THUMB_MAX_SIDE) return null;

    const scale = THUMB_MAX_SIDE / maxSide;
    const targetW = Math.round(width * scale);
    const targetH = Math.round(height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(source, 0, 0, targetW, targetH);

    const blob = await new Promise((resolve) => {
      canvas.toBlob((b) => resolve(b), 'image/jpeg', THUMB_QUALITY);
    });

    return blob || null;
  } catch (err) {
    console.warn('[AlbumService] 生成缩略图失败，跳过：', err?.message || err);
    return null;
  } finally {
    if (bitmap && typeof bitmap.close === 'function') bitmap.close();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

/* ============================================
 * 上传单张原图 + 缩略图到 Storage
 * 返回 { url, path, thumbUrl, thumbPath, originalName }
 * ============================================ */
async function uploadOneWithThumb(file, userId) {
  const originalName = file.name || '';

  if (!hasRemote()) {
    // 本地模式：用 dataURL 直接当 url，缩略图省略
    const dataUrl = await fileToDataUrl(file);
    return {
      url: dataUrl,
      path: null,
      thumbUrl: null,
      thumbPath: null,
      originalName,
    };
  }

  const ext = (originalName.split('.').pop() || 'jpg').toLowerCase();
  const rand = Math.random().toString(36).slice(2, 8);
  const baseKey = `${userId || 'anon'}/${Date.now()}-${rand}`;
  const originalPath = `${baseKey}.${ext}`;
  const thumbPath = `${baseKey}_thumb.jpg`;
  const thumbBlobPromise = generateThumbnail(file);

  // 1) 上传原图
  await uploadStorageObject(
    originalPath,
    file,
    {
      cacheControl: '3600',
      contentType: file.type || 'image/jpeg',
    },
    '原图'
  );

  const origPublic = supabase.storage.from(BUCKET).getPublicUrl(originalPath).data.publicUrl;

  // 2) 生成并上传缩略图（失败不影响主流程）
  let thumbUrl = null;
  let thumbPathFinal = null;

  const thumbBlob = await thumbBlobPromise;
  if (thumbBlob) {
    try {
      await uploadStorageObject(
        thumbPath,
        thumbBlob,
        {
          cacheControl: '3600',
          contentType: 'image/jpeg',
        },
        '缩略图'
      );
      thumbUrl = supabase.storage.from(BUCKET).getPublicUrl(thumbPath).data.publicUrl;
      thumbPathFinal = thumbPath;
    } catch (errThumb) {
      console.warn('[AlbumService] 缩略图上传失败（已忽略）：', errThumb.message);
    }
  }

  return {
    url: origPublic,
    path: originalPath,
    thumbUrl,
    thumbPath: thumbPathFinal,
    originalName,
  };
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function parseExifDate(value) {
  if (!value || typeof value !== 'string') return null;
  const match = value
    .trim()
    .match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const date = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

function readExifString(view, tiffStart, entryOffset, littleEndian) {
  if (!entryOffset) return null;
  const type = view.getUint16(entryOffset + 2, littleEndian);
  const count = view.getUint32(entryOffset + 4, littleEndian);
  if (type !== 2 || count <= 0) return null;
  const valueOffset = count <= 4
    ? entryOffset + 8
    : tiffStart + view.getUint32(entryOffset + 8, littleEndian);
  if (valueOffset < 0 || valueOffset + count > view.byteLength) return null;
  let text = '';
  for (let i = 0; i < count; i++) {
    const code = view.getUint8(valueOffset + i);
    if (code === 0) break;
    text += String.fromCharCode(code);
  }
  return text;
}

function findExifTag(view, tiffStart, ifdOffset, tagId, littleEndian) {
  if (!ifdOffset) return null;
  const absoluteOffset = tiffStart + ifdOffset;
  if (absoluteOffset < 0 || absoluteOffset + 2 > view.byteLength) return null;
  const entryCount = view.getUint16(absoluteOffset, littleEndian);
  for (let i = 0; i < entryCount; i++) {
    const entryOffset = absoluteOffset + 2 + i * 12;
    if (entryOffset + 12 > view.byteLength) return null;
    const tag = view.getUint16(entryOffset, littleEndian);
    if (tag === tagId) return entryOffset;
  }
  return null;
}

async function readImageCapturedAt(file) {
  if (!file || !/^image\/jpe?g$/i.test(file.type || '')) return null;
  try {
    const buffer = await file.slice(0, 256 * 1024).arrayBuffer();
    const view = new DataView(buffer);
    if (view.getUint16(0, false) !== 0xffd8) return null;

    let offset = 2;
    while (offset + 4 < view.byteLength) {
      if (view.getUint8(offset) !== 0xff) break;
      const marker = view.getUint8(offset + 1);
      const size = view.getUint16(offset + 2, false);
      if (marker === 0xe1) {
        const exifStart = offset + 4;
        const exifHeader = 'Exif\0\0';
        for (let i = 0; i < exifHeader.length; i++) {
          if (view.getUint8(exifStart + i) !== exifHeader.charCodeAt(i)) return null;
        }

        const tiffStart = exifStart + exifHeader.length;
        const endian = view.getUint16(tiffStart, false);
        const littleEndian = endian === 0x4949;
        if (!littleEndian && endian !== 0x4d4d) return null;
        const firstIfdOffset = view.getUint32(tiffStart + 4, littleEndian);
        const exifIfdEntry = findExifTag(view, tiffStart, firstIfdOffset, 0x8769, littleEndian);
        const exifIfdOffset = exifIfdEntry
          ? view.getUint32(exifIfdEntry + 8, littleEndian)
          : null;
        const dateOriginalEntry = findExifTag(view, tiffStart, exifIfdOffset, 0x9003, littleEndian);
        const dateEntry = dateOriginalEntry
          || findExifTag(view, tiffStart, exifIfdOffset, 0x9004, littleEndian)
          || findExifTag(view, tiffStart, firstIfdOffset, 0x0132, littleEndian);
        return parseExifDate(readExifString(view, tiffStart, dateEntry, littleEndian));
      }
      offset += 2 + size;
    }
  } catch (err) {
    console.warn('[AlbumService] 读取照片拍摄时间失败，使用默认顺序：', err?.message || err);
  }
  return null;
}

async function prepareFilesForUpload(files = []) {
  const prepared = await Promise.all(
    files.map(async (item, originalIndex) => {
      const capturedDate = await readImageCapturedAt(item.file);
      const fallbackTime = Number.isFinite(item.file?.lastModified) ? item.file.lastModified : 0;
      return {
        ...item,
        originalIndex,
        capturedAt: capturedDate ? capturedDate.toISOString() : null,
        sortTime: capturedDate ? capturedDate.getTime() : fallbackTime,
      };
    })
  );

  return prepared.sort((a, b) => {
    const aTime = Number.isFinite(a.sortTime) ? a.sortTime : 0;
    const bTime = Number.isFinite(b.sortTime) ? b.sortTime : 0;
    if (aTime !== bTime) return aTime - bTime;
    return a.originalIndex - b.originalIndex;
  });
}

/* ============================================
 * 并发上传一批文件，保持与入参相同的顺序。
 * onProgress(done, total) 每完成一张回调一次，用于 UI 显示进度。
 * 默认并发 4 张，既能跑满家用带宽，又不至于把浏览器 / Supabase 打爆。
 * ============================================ */
async function uploadFilesConcurrently(files, userId, onProgress, concurrency = DEFAULT_UPLOAD_CONCURRENCY) {
  try {
    onProgress && onProgress(0, files?.length || 0, {
      phase: 'preparing',
      current: '正在读取照片信息',
    });
  } catch { /* noop */ }

  const sortedFiles = await prepareFilesForUpload(files);
  const total = sortedFiles.length;
  let done = 0;
  const results = new Array(total);
  const hasLargeFiles = sortedFiles.some((f) => (f?.file?.size || 0) >= LARGE_UPLOAD_THRESHOLD);
  const hasHugeFiles = sortedFiles.some((f) => (f?.file?.size || 0) >= HUGE_UPLOAD_THRESHOLD);
  let effectiveConcurrency = concurrency;
  if (total >= BULK_UPLOAD_THRESHOLD) {
    effectiveConcurrency = Math.min(effectiveConcurrency, BULK_UPLOAD_CONCURRENCY);
  }
  if (hasLargeFiles) {
    effectiveConcurrency = Math.min(effectiveConcurrency, LARGE_UPLOAD_CONCURRENCY);
  }
  if (hasHugeFiles) {
    effectiveConcurrency = Math.min(effectiveConcurrency, HUGE_UPLOAD_CONCURRENCY);
  }
  try {
    onProgress && onProgress(0, total, {
      phase: 'uploading',
      current: `准备上传 ${total} 张照片`,
    });
  } catch { /* noop */ }

  let cursor = 0;
  const workers = Array.from({ length: Math.min(effectiveConcurrency, total) }, async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= total) return;
      const f = sortedFiles[idx];
      const fileName = f?.file?.name || `第 ${idx + 1} 张`;
      try {
        try {
          onProgress && onProgress(done, total, {
            phase: 'uploading',
            current: `正在上传：${fileName}`,
          });
        } catch { /* noop */ }
        const r = await uploadOneWithThumb(f.file, userId);
        results[idx] = { ...r, caption: f.caption || '', capturedAt: f.capturedAt || null };
      } catch (err) {
        console.warn('[AlbumService] 单张上传失败：', err?.message || err);
        results[idx] = null;
      } finally {
        done++;
        try {
          onProgress && onProgress(done, total, {
            phase: 'uploading',
            current: done >= total ? '照片上传完成，正在保存记录' : `已完成 ${done} 张`,
          });
        } catch { /* noop */ }
      }
    }
  });
  await Promise.all(workers);
  // 过滤掉失败的（保持剩余成功项的相对顺序）
  return results.filter(Boolean);
}

function ensureUploadSucceeded(uploaded, requestedCount) {
  if (requestedCount > 0 && uploaded.length === 0) {
    throw new Error('照片上传超时或失败。请检查网络后重试，或先少量分批上传。');
  }
}

function buildPhotoRows(albumId, uploaded, userId, baseIndex = 0, includeCapturedAt = true) {
  return uploaded.map((u, i) => {
    const row = {
      album_id: albumId,
      url: u.url,
      storage_path: u.path,
      thumb_url: u.thumbUrl,
      thumb_path: u.thumbPath,
      original_name: u.originalName,
      caption: u.caption,
      sort_index: baseIndex + i,
      uploaded_by_id: userId || null,
    };
    if (includeCapturedAt) row.captured_at = u.capturedAt;
    return row;
  });
}

const isMissingCapturedAtColumn = (error) =>
  error?.code === '42703' || /captured_at/i.test(error?.message || '');

async function insertPhotoRows(albumId, uploaded, userId, baseIndex = 0) {
  let response = await supabase
    .from('album_photos')
    .insert(buildPhotoRows(albumId, uploaded, userId, baseIndex, true))
    .select();

  if (response.error && isMissingCapturedAtColumn(response.error)) {
    console.warn('[AlbumService] album_photos.captured_at 尚未迁移，已回退为仅按本次上传顺序排序。');
    response = await supabase
      .from('album_photos')
      .insert(buildPhotoRows(albumId, uploaded, userId, baseIndex, false))
      .select();
  }

  return response;
}

/* ============================================
 * 创建相册（可附带初始照片）
 * files: [{ file, caption }]
 * options: { onProgress(done, total) }
 * ============================================ */
export async function createAlbum(meta, files, user, options = {}) {
  const { onProgress } = options;
  const uploaded = files && files.length > 0
    ? await uploadFilesConcurrently(files, user?.id, onProgress)
    : [];
  ensureUploadSucceeded(uploaded, files?.length || 0);
  try {
    onProgress && onProgress(uploaded.length, files?.length || 0, {
      phase: 'saving',
      current: '正在创建相册记录',
    });
  } catch { /* noop */ }

  if (!hasRemote()) {
    const album = {
      id: `local-${Date.now()}`,
      title: meta.title,
      description: meta.description || '',
      date: meta.date,
      coverIndex: 0,
      createdById: user?.id || null,
      createdBy: user?.nickname || user?.name || 'Unknown',
      photos: uploaded.map((u, i) => ({
        id: `localp-${Date.now()}-${i}`,
        url: u.url,
        storagePath: u.path,
        thumbUrl: u.thumbUrl,
        thumbPath: u.thumbPath,
        originalName: u.originalName,
        caption: u.caption,
        sortIndex: i,
        uploadedById: user?.id || null,
        capturedAt: u.capturedAt || null,
      })),
    };
    const list = getLocalAlbums();
    list.unshift(album);
    saveLocalAlbums(list);
    return album;
  }

  try {
    const { data: albumRow, error: e1 } = await supabase
      .from('albums')
      .insert({
        title: meta.title,
        description: meta.description || '',
        date: meta.date,
        cover_index: 0,
        created_by_id: user?.id || null,
        created_by: user?.nickname || user?.name || '',
      })
      .select()
      .single();
    if (e1) {
      await cleanupUploaded(uploaded);
      throw e1;
    }

    let photoRows = [];
    if (uploaded.length > 0) {
      try {
        onProgress && onProgress(uploaded.length, files?.length || 0, {
          phase: 'saving',
          current: '正在保存照片记录',
        });
      } catch { /* noop */ }
      const { data, error: e2 } = await insertPhotoRows(albumRow.id, uploaded, user?.id, 0);
      if (e2) {
        await cleanupUploaded(uploaded);
        await supabase.from('albums').delete().eq('id', albumRow.id).catch(() => {});
        throw e2;
      }
      photoRows = data || [];
    }

    return rowToAlbum(albumRow, photoRows);
  } catch (err) {
    console.warn('[AlbumService] 创建相册失败：', err.message);
    throw err;
  }
}

/* ============================================
 * 删除相册（级联删除照片 + Storage 文件）
 * ============================================ */
export async function deleteAlbum(album) {
  if (!hasRemote() || !album._fromDb) {
    const list = getLocalAlbums().filter((a) => a.id !== album.id);
    saveLocalAlbums(list);
    return;
  }

  try {
    const photos = album._partial ? await fetchAlbumPhotos(album.id) : (album.photos || []);
    const paths = collectStoragePaths(photos);
    await removeStoragePaths(paths);
    // ⚠️ Supabase 的 delete 在被 RLS 行级权限拦截时不会报错，只是删除 0 行。
    // 加 .select() 把真正被删的行拿回来，若为空说明没有权限或行不存在，
    // 否则界面会"假装删除成功"，刷新后相册又出现。
    const { data, error } = await supabase
      .from('albums')
      .delete()
      .eq('id', album.id)
      .select('id');
    if (error) throw error;
    if (!data || data.length === 0) {
      throw new Error('删除未生效：你可能没有权限删除该相册（仅创建者或管理员可删除）。');
    }
  } catch (err) {
    console.warn('[AlbumService] 删除相册失败：', err.message);
    throw err;
  }
}

/* ============================================
 * 向相册添加多张照片
 * options: { onProgress(done, total) }
 * ============================================ */
export async function addPhotosToAlbum(album, files, user, options = {}) {
  const { onProgress } = options;
  const uploaded = files && files.length > 0
    ? await uploadFilesConcurrently(files, user?.id, onProgress)
    : [];
  ensureUploadSucceeded(uploaded, files?.length || 0);
  try {
    onProgress && onProgress(uploaded.length, files?.length || 0, {
      phase: 'saving',
      current: '正在保存照片记录',
    });
  } catch { /* noop */ }

  if (!hasRemote() || !album._fromDb) {
    const baseIndex = (album.photos || []).length;
    const newPhotos = uploaded.map((u, i) => ({
      id: `localp-${Date.now()}-${i}`,
      url: u.url,
      storagePath: u.path,
      thumbUrl: u.thumbUrl,
      thumbPath: u.thumbPath,
      originalName: u.originalName,
      caption: u.caption,
      sortIndex: baseIndex + i,
      uploadedById: user?.id || null,
      capturedAt: u.capturedAt || null,
    }));
    const list = getLocalAlbums().map((a) =>
      a.id === album.id ? { ...a, photos: [...(a.photos || []), ...newPhotos] } : a
    );
    saveLocalAlbums(list);
    return newPhotos;
  }

  try {
    const baseIndex = (album.photos || []).length;
    const { data, error } = await insertPhotoRows(album.id, uploaded, user?.id, baseIndex);
    if (error) {
      await cleanupUploaded(uploaded);
      throw error;
    }
    return (data || []).map(rowToPhoto);
  } catch (err) {
    console.warn('[AlbumService] 添加照片失败：', err.message);
    throw err;
  }
}

/* ============================================
 * 删除一张照片（含 Storage 文件 + 缩略图）
 * ============================================ */
export async function deletePhoto(album, photo) {
  if (!hasRemote() || !photo._fromDb) {
    const list = getLocalAlbums().map((a) =>
      a.id === album.id
        ? { ...a, photos: (a.photos || []).filter((p) => p.id !== photo.id) }
        : a
    );
    saveLocalAlbums(list);
    return;
  }

  try {
    await removeStoragePaths(collectStoragePaths([photo]));
    // 同相册删除：用 .select() 校验是否真的删了行，避免 RLS 静默拦截后界面误判成功。
    const { data, error } = await supabase
      .from('album_photos')
      .delete()
      .eq('id', photo.id)
      .select('id');
    if (error) throw error;
    if (!data || data.length === 0) {
      throw new Error('删除未生效：你可能没有权限删除这张照片（仅上传者、相册创建者或管理员可删除）。');
    }
  } catch (err) {
    console.warn('[AlbumService] 删除照片失败：', err.message);
    throw err;
  }
}

/* ============================================
 * 本地回退存储
 * ============================================ */
function getLocalAlbums() {
  try {
    const raw = localStorage.getItem(LS_ALBUMS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveLocalAlbums(list) {
  try {
    localStorage.setItem(LS_ALBUMS_KEY, JSON.stringify(list));
  } catch (err) {
    console.warn('[AlbumService] 本地存储失败（可能超出 5MB 配额）：', err.message);
  }
}
