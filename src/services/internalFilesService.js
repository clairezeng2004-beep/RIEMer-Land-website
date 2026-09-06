// ============================================
// RIEMer Land — 内部资料 文件资源管理器服务
// ============================================
// 表：internal_files（文件夹 + 文件 混合自引用树）
//   parent_id 指向所在文件夹，NULL = 根目录
// Storage bucket：internal-files（公开读，路径带随机串不可枚举）
//
// 能力：
//   - 列目录 / 面包屑
//   - 新建文件夹
//   - 上传若干文件到当前目录（搬运）
//   - 上传整个文件夹（保留子目录结构，webkitdirectory）
//   - 重命名 / 删除（文件夹递归删除子孙 + 清理 Storage）
//
// 未配置 Supabase 时不可用（内部资料需登录并连接服务器）。

import { supabase, isSupabaseConfigured } from '../lib/supabase';

const BUCKET = 'internal-files';
const STORAGE_UPLOAD_ATTEMPTS = 4;
const UPLOAD_CONCURRENCY = 3;

export const isInternalFilesAvailable = () => !!(isSupabaseConfigured && supabase);

const requireRemote = () => {
  if (!isInternalFilesAvailable()) {
    throw new Error('内部资料需要登录并连接服务器后才能使用。');
  }
};

/* ---------- 数据库行 → 前端对象 ---------- */
function rowToNode(row) {
  return {
    id: row.id,
    parentId: row.parent_id || null,
    name: row.name || '',
    isFolder: !!row.is_folder,
    storagePath: row.storage_path || null,
    url: row.url || null,
    mimeType: row.mime_type || '',
    sizeBytes: Number(row.size_bytes || 0),
    createdById: row.created_by_id || null,
    createdBy: row.created_by || '',
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

/* 目录内排序：文件夹在前，同类按名称（中文/数字友好） */
function sortNodes(nodes) {
  const collator = new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' });
  return [...nodes].sort((a, b) => {
    if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
    return collator.compare(a.name || '', b.name || '');
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* 带重试的 Storage 上传 */
async function uploadStorageObject(path, body, options) {
  let lastError = null;
  for (let attempt = 1; attempt <= STORAGE_UPLOAD_ATTEMPTS; attempt++) {
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, body, { ...options, upsert: true });
    if (!error) return;
    lastError = error;
    console.warn(`[InternalFiles] 上传失败（第 ${attempt}/${STORAGE_UPLOAD_ATTEMPTS} 次）：`, error.message);
    if (attempt < STORAGE_UPLOAD_ATTEMPTS) await wait(1000 * attempt * attempt);
  }
  throw lastError;
}

async function removeStoragePaths(paths) {
  const unique = [...new Set((paths || []).filter(Boolean))];
  if (unique.length === 0) return;
  // Storage remove 一次最多处理有限个对象，分批清理更稳
  for (let i = 0; i < unique.length; i += 100) {
    const batch = unique.slice(i, i + 100);
    const { error } = await supabase.storage.from(BUCKET).remove(batch);
    if (error) console.warn('[InternalFiles] Storage 清理失败：', error.message);
  }
}

/* ============================================
 * 列出某个目录下的直接子项
 * parentId 为 null / undefined 表示根目录
 * ============================================ */
export async function fetchChildren(parentId = null) {
  requireRemote();
  let query = supabase.from('internal_files').select('*');
  query = parentId ? query.eq('parent_id', parentId) : query.is('parent_id', null);
  const { data, error } = await query;
  if (error) throw error;
  return sortNodes((data || []).map(rowToNode));
}

/* 单个节点（用于面包屑 / 校验） */
export async function fetchNode(id) {
  requireRemote();
  if (!id) return null;
  const { data, error } = await supabase
    .from('internal_files')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToNode(data) : null;
}

/* ============================================
 * 面包屑：从当前文件夹一路向上取到根
 * 返回从根到当前的数组（不含「根目录」占位，UI 自行补）
 * ============================================ */
export async function fetchBreadcrumb(folderId) {
  requireRemote();
  const chain = [];
  let cursor = folderId;
  // 防御：最多向上 50 层，避免异常数据造成死循环
  let guard = 0;
  while (cursor && guard < 50) {
    const node = await fetchNode(cursor);
    if (!node) break;
    chain.unshift(node);
    cursor = node.parentId;
    guard += 1;
  }
  return chain;
}

/* ============================================
 * 新建文件夹
 * ============================================ */
export async function createFolder(parentId, name, user) {
  requireRemote();
  const clean = (name || '').trim() || '新建文件夹';
  const { data, error } = await supabase
    .from('internal_files')
    .insert({
      parent_id: parentId || null,
      name: clean,
      is_folder: true,
      created_by_id: user?.id || null,
      created_by: user?.nickname || user?.name || '',
    })
    .select('*')
    .single();
  if (error) throw error;
  return rowToNode(data);
}

/* 生成 Storage 对象路径（保留扩展名，主体随机不可枚举） */
function buildStoragePath(userId, fileName) {
  const ext = (fileName?.split('.').pop() || '').toLowerCase();
  const rand = Math.random().toString(36).slice(2, 10);
  const base = `${userId || 'anon'}/${Date.now()}-${rand}`;
  return ext && ext !== fileName?.toLowerCase() ? `${base}.${ext}` : base;
}

/* 上传单个文件到 Storage 并写入数据库行 */
async function uploadOneFile(parentId, file, user) {
  const path = buildStoragePath(user?.id, file.name);
  await uploadStorageObject(path, file, {
    cacheControl: '3600',
    contentType: file.type || 'application/octet-stream',
  });
  const url = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

  const { data, error } = await supabase
    .from('internal_files')
    .insert({
      parent_id: parentId || null,
      name: file.name || '未命名文件',
      is_folder: false,
      storage_path: path,
      url,
      mime_type: file.type || '',
      size_bytes: file.size || 0,
      created_by_id: user?.id || null,
      created_by: user?.nickname || user?.name || '',
    })
    .select('*')
    .single();

  if (error) {
    // 行写入失败则回收已上传对象，避免产生孤儿文件
    await removeStoragePaths([path]);
    throw error;
  }
  return rowToNode(data);
}

/* 并发跑一批上传任务，onProgress(done, total, currentName) */
async function runUploads(tasks, onProgress) {
  const total = tasks.length;
  let done = 0;
  const results = [];
  const errors = [];
  let cursor = 0;

  const worker = async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= total) return;
      const task = tasks[idx];
      try {
        onProgress?.(done, total, task.label);
        const node = await task.run();
        results.push(node);
      } catch (err) {
        console.warn('[InternalFiles] 单个文件上传失败：', task.label, err?.message || err);
        errors.push({ label: task.label, error: err });
      } finally {
        done += 1;
        onProgress?.(done, total, task.label);
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(UPLOAD_CONCURRENCY, total) }, worker)
  );
  return { results, errors };
}

/* ============================================
 * 上传若干文件到当前目录（普通「搬运」上传）
 * files: File[]
 * ============================================ */
export async function uploadFiles(parentId, files, user, onProgress) {
  requireRemote();
  const list = Array.from(files || []);
  if (list.length === 0) return { results: [], errors: [] };

  const tasks = list.map((file) => ({
    label: file.name || '文件',
    run: () => uploadOneFile(parentId, file, user),
  }));
  return runUploads(tasks, onProgress);
}

/* ============================================
 * 上传整个文件夹（保留子目录结构）
 * files 来自 <input webkitdirectory>，每个 File 带 webkitRelativePath
 * 先按深度创建所需文件夹，再把文件放进对应文件夹
 * ============================================ */
export async function uploadFolderTree(parentId, files, user, onProgress) {
  requireRemote();
  const list = Array.from(files || []);
  if (list.length === 0) return { results: [], errors: [] };

  // 1) 收集所有需要创建的目录（相对当前目录），按层级深度升序
  const dirSet = new Set();
  for (const f of list) {
    const rel = f.webkitRelativePath || f.name || '';
    const parts = rel.split('/');
    parts.pop(); // 去掉文件名
    let acc = '';
    for (const seg of parts) {
      acc = acc ? `${acc}/${seg}` : seg;
      dirSet.add(acc);
    }
  }
  const dirs = [...dirSet].sort(
    (a, b) => a.split('/').length - b.split('/').length
  );

  // 2) 依次创建文件夹，记录「相对路径 → 文件夹 id」
  const folderIdByPath = new Map();
  folderIdByPath.set('', parentId || null);
  for (const dir of dirs) {
    const idx = dir.lastIndexOf('/');
    const parentDir = idx === -1 ? '' : dir.slice(0, idx);
    const name = idx === -1 ? dir : dir.slice(idx + 1);
    const pid = folderIdByPath.has(parentDir)
      ? folderIdByPath.get(parentDir)
      : parentId || null;
    const node = await createFolder(pid, name, user);
    folderIdByPath.set(dir, node.id);
  }

  // 3) 逐个文件放入对应文件夹并上传
  const tasks = list.map((file) => {
    const rel = file.webkitRelativePath || file.name || '';
    const idx = rel.lastIndexOf('/');
    const dir = idx === -1 ? '' : rel.slice(0, idx);
    const targetId = folderIdByPath.has(dir)
      ? folderIdByPath.get(dir)
      : parentId || null;
    return {
      label: rel || file.name,
      run: () => uploadOneFile(targetId, file, user),
    };
  });

  return runUploads(tasks, onProgress);
}

/* ============================================
 * 重命名文件夹 / 文件（仅改显示名，不动 Storage 路径）
 * ============================================ */
export async function renameNode(node, newName) {
  requireRemote();
  const clean = (newName || '').trim();
  if (!clean) throw new Error('名称不能为空。');
  const { data, error } = await supabase
    .from('internal_files')
    .update({ name: clean, updated_at: new Date().toISOString() })
    .eq('id', node.id)
    .select('id, name');
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error('重命名未生效：你可能没有权限修改此项（仅上传者或管理员可操作）。');
  }
  return data[0].name;
}

/* 递归收集某文件夹下所有子孙的 Storage 路径（BFS） */
async function collectDescendantStoragePaths(folderId) {
  const paths = [];
  let frontier = [folderId];
  let guard = 0;
  while (frontier.length && guard < 1000) {
    const { data, error } = await supabase
      .from('internal_files')
      .select('id, storage_path, is_folder')
      .in('parent_id', frontier);
    if (error) throw error;
    const rows = data || [];
    const nextFolders = [];
    for (const r of rows) {
      if (r.storage_path) paths.push(r.storage_path);
      if (r.is_folder) nextFolders.push(r.id);
    }
    frontier = nextFolders;
    guard += 1;
  }
  return paths;
}

/* ============================================
 * 删除文件夹 / 文件
 *   文件夹：先收集所有子孙的 Storage 对象并清理，
 *          再删除该文件夹行（子孙行随 FK ON DELETE CASCADE 一并删除）
 *   文件：清理自身 Storage 对象后删除行
 * ============================================ */
export async function deleteNode(node) {
  requireRemote();
  const paths = [];
  if (node.isFolder) {
    const descendants = await collectDescendantStoragePaths(node.id);
    paths.push(...descendants);
  } else if (node.storagePath) {
    paths.push(node.storagePath);
  }

  await removeStoragePaths(paths);

  // .select() 校验 RLS 是否真的删了行，避免静默拦截造成「假删除」
  const { data, error } = await supabase
    .from('internal_files')
    .delete()
    .eq('id', node.id)
    .select('id');
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error('删除未生效：你可能没有权限删除此项（仅上传者或管理员可删除）。');
  }
}
