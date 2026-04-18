// ============================================
// RIEMer Land — 相册服务（Supabase + Storage）
// ============================================
// 表：albums / album_photos
// Storage bucket：album-photos （公开读）
// 未配置 Supabase 或失败时，回退到 localStorage，保证本地开发与离线可用。

import { supabase, isSupabaseConfigured } from '../lib/supabase';

const BUCKET = 'album-photos';
const LS_ALBUMS_KEY = 'riemer_albums_v1';

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
    caption: row.caption || '',
    sortIndex: typeof row.sort_index === 'number' ? row.sort_index : 0,
    uploadedById: row.uploaded_by_id || null,
    _fromDb: true,
  };
}

/* ============================================
 * 查询所有相册（含照片）
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
 * 上传单张图片到 Storage，返回 { url, path }
 * ============================================ */
async function uploadToStorage(file, userId) {
  if (!hasRemote()) {
    // 本地模式：生成 dataURL 以便刷新后仍可见（blob URL 无法持久化）
    const dataUrl = await fileToDataUrl(file);
    return { url: dataUrl, path: null };
  }

  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const rand = Math.random().toString(36).slice(2, 8);
  const path = `${userId || 'anon'}/${Date.now()}-${rand}.${ext}`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type || 'image/jpeg',
    });

  if (error) {
    console.warn('[AlbumService] Storage 上传失败，降级 dataURL：', error.message);
    const dataUrl = await fileToDataUrl(file);
    return { url: dataUrl, path: null };
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, path };
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
 * 创建相册（可附带初始照片）
 * files: [{ file, caption }]
 * ============================================ */
export async function createAlbum(meta, files, user) {
  const uploaded = [];
  for (const f of files) {
    try {
      const { url, path } = await uploadToStorage(f.file, user?.id);
      uploaded.push({ url, path, caption: f.caption || '' });
    } catch (err) {
      console.warn('[AlbumService] 单张上传失败：', err.message);
    }
  }

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
    // 先收集 storage paths
    const paths = (album.photos || [])
      .map((p) => p.storagePath)
      .filter(Boolean);
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
 * ============================================ */
export async function addPhotosToAlbum(album, files, user) {
  const uploaded = [];
  for (const f of files) {
    try {
      const { url, path } = await uploadToStorage(f.file, user?.id);
      uploaded.push({ url, path, caption: f.caption || '' });
    } catch (err) {
      console.warn('[AlbumService] 添加照片单张失败：', err.message);
    }
  }

  if (!hasRemote() || !album._fromDb) {
    const baseIndex = (album.photos || []).length;
    const newPhotos = uploaded.map((u, i) => ({
      id: `localp-${Date.now()}-${i}`,
      url: u.url,
      storagePath: u.path,
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
 * 删除一张照片（含 Storage 文件）
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
    if (photo.storagePath) {
      await supabase.storage.from(BUCKET).remove([photo.storagePath]).catch(() => {});
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
