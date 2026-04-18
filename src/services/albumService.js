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
    _fromDb: true,
  };
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
      .select('id,album_id,url,storage_path,thumb_url,thumb_path,original_name,caption,sort_index')
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
      .order('sort_index', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data || []).map(rowToPhoto);
  } catch (err) {
    console.warn('[AlbumService] 加载相册照片失败：', err.message);
    throw err;
  }
}

/* ============================================
 * 前端生成缩略图
 * ------------------------------------------
 * 读入 File → 按最长边等比缩到 THUMB_MAX_SIDE → Canvas 导出 JPEG Blob
 * 失败（如 HEIC 浏览器不支持）时返回 null，上层继续只传原图。
 * ============================================ */
async function generateThumbnail(file) {
  if (!file || !file.type || !file.type.startsWith('image/')) return null;

  try {
    // 优先用 createImageBitmap（快、无需 DOM）
    let bitmap = null;
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
        el.src = URL.createObjectURL(file);
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

    if (bitmap && typeof bitmap.close === 'function') bitmap.close();

    return blob || null;
  } catch (err) {
    console.warn('[AlbumService] 生成缩略图失败，跳过：', err?.message || err);
    return null;
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

  // 1) 上传原图
  const { error: errOrig } = await supabase.storage
    .from(BUCKET)
    .upload(originalPath, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type || 'image/jpeg',
    });

  if (errOrig) {
    console.warn('[AlbumService] 原图上传失败，降级 dataURL：', errOrig.message);
    const dataUrl = await fileToDataUrl(file);
    return { url: dataUrl, path: null, thumbUrl: null, thumbPath: null, originalName };
  }

  const origPublic = supabase.storage.from(BUCKET).getPublicUrl(originalPath).data.publicUrl;

  // 2) 生成并上传缩略图（失败不影响主流程）
  let thumbUrl = null;
  let thumbPathFinal = null;

  const thumbBlob = await generateThumbnail(file);
  if (thumbBlob) {
    const { error: errThumb } = await supabase.storage
      .from(BUCKET)
      .upload(thumbPath, thumbBlob, {
        cacheControl: '3600',
        upsert: false,
        contentType: 'image/jpeg',
      });
    if (!errThumb) {
      thumbUrl = supabase.storage.from(BUCKET).getPublicUrl(thumbPath).data.publicUrl;
      thumbPathFinal = thumbPath;
    } else {
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

/* ============================================
 * 并发上传一批文件，保持与入参相同的顺序。
 * onProgress(done, total) 每完成一张回调一次，用于 UI 显示进度。
 * 默认并发 4 张，既能跑满家用带宽，又不至于把浏览器 / Supabase 打爆。
 * ============================================ */
async function uploadFilesConcurrently(files, userId, onProgress, concurrency = 4) {
  const total = files.length;
  let done = 0;
  const results = new Array(total);

  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, total) }, async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= total) return;
      const f = files[idx];
      try {
        const r = await uploadOneWithThumb(f.file, userId);
        results[idx] = { ...r, caption: f.caption || '' };
      } catch (err) {
        console.warn('[AlbumService] 单张上传失败：', err?.message || err);
        results[idx] = null;
      } finally {
        done++;
        try { onProgress && onProgress(done, total); } catch { /* noop */ }
      }
    }
  });
  await Promise.all(workers);
  // 过滤掉失败的（保持剩余成功项的相对顺序）
  return results.filter(Boolean);
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
    if (e1) throw e1;

    let photoRows = [];
    if (uploaded.length > 0) {
      const { data, error: e2 } = await supabase
        .from('album_photos')
        .insert(
          uploaded.map((u, i) => ({
            album_id: albumRow.id,
            url: u.url,
            storage_path: u.path,
            thumb_url: u.thumbUrl,
            thumb_path: u.thumbPath,
            original_name: u.originalName,
            caption: u.caption,
            sort_index: i,
            uploaded_by_id: user?.id || null,
          }))
        )
        .select();
      if (e2) throw e2;
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
    // 收集所有原图 + 缩略图路径
    const paths = [];
    (album.photos || []).forEach((p) => {
      if (p.storagePath) paths.push(p.storagePath);
      if (p.thumbPath) paths.push(p.thumbPath);
    });
    if (paths.length > 0) {
      await supabase.storage.from(BUCKET).remove(paths).catch(() => {});
    }
    const { error } = await supabase.from('albums').delete().eq('id', album.id);
    if (error) throw error;
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
    }));
    const list = getLocalAlbums().map((a) =>
      a.id === album.id ? { ...a, photos: [...(a.photos || []), ...newPhotos] } : a
    );
    saveLocalAlbums(list);
    return newPhotos;
  }

  try {
    const baseIndex = (album.photos || []).length;
    const { data, error } = await supabase
      .from('album_photos')
      .insert(
        uploaded.map((u, i) => ({
          album_id: album.id,
          url: u.url,
          storage_path: u.path,
          thumb_url: u.thumbUrl,
          thumb_path: u.thumbPath,
          original_name: u.originalName,
          caption: u.caption,
          sort_index: baseIndex + i,
          uploaded_by_id: user?.id || null,
        }))
      )
      .select();
    if (error) throw error;
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
    const paths = [];
    if (photo.storagePath) paths.push(photo.storagePath);
    if (photo.thumbPath) paths.push(photo.thumbPath);
    if (paths.length > 0) {
      await supabase.storage.from(BUCKET).remove(paths).catch(() => {});
    }
    const { error } = await supabase.from('album_photos').delete().eq('id', photo.id);
    if (error) throw error;
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
