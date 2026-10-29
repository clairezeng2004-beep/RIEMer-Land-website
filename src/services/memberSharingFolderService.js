import { fetchSharingById, updateSharing } from './memberSharingService';
import { moveToRecycleBin } from './recycleBinService';
import { sortNodes, LINK_MIME, ZIP_EXTRACT_MAX_BYTES } from './internalFilesService';
import { hasInternalTextContent, sanitizeInternalTextHtml } from '../utils/internalTextHtml';

const newId = () => crypto.randomUUID();
const fileData = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(new Error(`无法读取 ${file.name}`));
  reader.readAsDataURL(file);
});

// The shared browser consumes nodes; storage remains in the sharing's existing attachments JSON.
export function createMemberSharingFolderService(postId, user, canWrite) {
  const read = async () => {
    const post = await fetchSharingById(postId, { strict: true });
    if (!post || post.format !== 'folder') throw new Error('文件夹已不存在，请返回列表。');
    return post;
  };
  const attachments = (post) => (post.attachments || []).map((item, index) => ({
    ...item, id: item.id || `legacy-${postId}-${index}`,
  }));
  const node = (item, post) => ({
    ...item, parentId: item.parentId || null, isFolder: !!item.isFolder,
    url: item.url || item.dataUrl, mimeType: item.kind === 'link' || item.type === 'link' ? LINK_MIME : item.type || '',
    sizeBytes: item.size || 0, note: item.note || '', contributorsOverride: item.contributorsOverride ?? null,
    createdById: item.createdById || post.authorId, createdBy: item.createdBy || post.author,
    createdAt: item.createdAt || post.createdAt,
  });
  const commit = async (change) => {
    if (!canWrite) throw new Error('只有管理员、作者或内容贡献者可以修改此文件夹。');
    const post = await read();
    const next = await change(attachments(post), post);
    return updateSharing(postId, { attachments: next });
  };
  const validateParent = (items, parentId) => {
    if (parentId && !items.some((item) => item.id === parentId && item.isFolder)) throw new Error('目标文件夹不存在。');
  };
  const metadata = (name, parentId, extra = {}) => ({
    id: newId(), name: (name || '').trim(), parentId: parentId || null,
    createdById: user?.id, createdBy: user?.name || user?.nickname || user?.email || '',
    createdAt: new Date().toISOString(), note: (extra.note || '').trim().slice(0, 200),
    contributorsOverride: extra.contributors?.trim() || null,
  });
  const patch = (target, fields) => commit((items) => {
    if (!items.some((item) => item.id === target.id)) throw new Error('资料已不存在，请刷新。');
    return items.map((item) => item.id === target.id ? { ...item, ...fields } : item);
  });
  const createFolder = async (parentId, name, _user, extra) => {
    if (!name?.trim()) throw new Error('请填写文件夹名称。');
    const item = { ...metadata(name, parentId, extra), isFolder: true, kind: 'folder' };
    await commit((items) => { validateParent(items, parentId); return [...items, item]; });
    return node(item, {});
  };
  const upload = async (parentId, entries, onProgress, extra) => {
    if (!canWrite) throw new Error('没有上传权限。');
    // Prepare one batch, then persist the complete tree in a single sharing update.
    const prepared = [];
    const directories = new Map([['', parentId || null]]);
    const directory = (path) => {
      if (directories.has(path)) return directories.get(path);
      const segments = path.split('/');
      const name = segments.pop();
      const item = { ...metadata(name, directory(segments.join('/')), extra), isFolder: true, kind: 'folder' };
      prepared.push(item);
      directories.set(path, item.id);
      return item.id;
    };
    for (const [index, entry] of entries.entries()) {
      const parts = entry.path.replace(/\\/g, '/').split('/').filter(Boolean);
      if (!parts.length || parts.some((part) => part === '..' || part === '.')) throw new Error('文件路径无效。');
      const name = parts.pop();
      const target = directory(parts.join('/'));
      const fields = metadata(entries.length === 1 && parts.length === 0 && extra?.name ? extra.name : name, target, extra);
      if (entry.isFolder) {
        directory([...parts, name].join('/'));
      } else {
        prepared.push({ ...fields, kind: 'file', type: entry.file.type || 'application/octet-stream', size: entry.file.size, dataUrl: await fileData(entry.file) });
      }
      onProgress?.(index + 1, entries.length, entry.path);
    }
    const saved = await commit((items) => { validateParent(items, parentId); return [...items, ...prepared]; });
    const ids = new Set(prepared.map((item) => item.id));
    return { results: (saved.attachments || []).filter((item) => ids.has(item.id)), errors: [] };
  };
  const uploadFiles = (parentId, files, _user, onProgress, extra) => upload(parentId, Array.from(files).map((file) => ({ file, path: file.name })), onProgress, extra);
  return {
    isInternalFilesAvailable: () => true,
    async fetchChildrenPage(parentId, { offset = 0, limit = 50 } = {}) {
      const post = await read();
      const items = sortNodes(attachments(post).filter((item) => (item.parentId || null) === (parentId || null)).map((item) => node(item, post)));
      return { items: items.slice(offset, offset + limit), total: items.length, hasMore: offset + limit < items.length };
    },
    async fetchBreadcrumb(folderId) {
      const post = await read();
      const items = attachments(post);
      const chain = [];
      const seen = new Set();
      while (folderId) {
        if (seen.has(folderId)) throw new Error('文件夹路径无效。');
        seen.add(folderId);
        const item = items.find((entry) => entry.id === folderId && entry.isFolder);
        if (!item) throw new Error('文件夹不存在。');
        chain.unshift(node(item, post));
        folderId = item.parentId;
      }
      return chain;
    },
    async fetchFolderContributors(ids) {
      const post = await read();
      const items = attachments(post);
      return Object.fromEntries(ids.map((id) => {
        const descendants = new Set([id]);
        let count;
        do { count = descendants.size; items.forEach((item) => { if (descendants.has(item.parentId)) descendants.add(item.id); }); } while (descendants.size !== count);
        const names = new Map(items.filter((item) => descendants.has(item.id) && !item.isFolder).map((item) => {
          const n = node(item, post); return [n.createdById || n.createdBy, { id: n.createdById, name: n.createdBy }];
        }));
        return [id, [...names.values()]];
      }));
    },
    createFolder, uploadFiles,
    uploadFolderTree: (parentId, files, _user, onProgress, extra) => upload(parentId, Array.from(files).map((file) => ({ file, path: file.webkitRelativePath || file.name })), onProgress, extra),
    async uploadZipAsFolder(parentId, file, _user, onProgress, extra) {
      if (file.size > ZIP_EXTRACT_MAX_BYTES) throw new Error('压缩包过大，请直接上传压缩包。');
      const { default: JSZip } = await import('jszip');
      const zip = await JSZip.loadAsync(file);
      if (Object.keys(zip.files).length > 5000) throw new Error('压缩包文件过多，请分批上传。');
      const entries = [];
      let bytes = 0;
      for (const entry of Object.values(zip.files)) {
        if (entry.unsafeOriginalName?.split('/').some((part) => part === '..')) throw new Error('压缩包包含不安全路径。');
        const path = `${file.name.replace(/\.zip$/i, '')}/${entry.name}`;
        if (entry.dir) entries.push({ path, isFolder: true });
        else {
          if (bytes + (entry._data?.uncompressedSize || 0) > ZIP_EXTRACT_MAX_BYTES) throw new Error('解压后文件过大，请直接上传压缩包。');
          const blob = await entry.async('blob');
          bytes += blob.size;
          if (bytes > ZIP_EXTRACT_MAX_BYTES) throw new Error('解压后文件过大，请直接上传压缩包。');
          entries.push({ path, file: new File([blob], entry.name.split('/').pop(), { type: blob.type }) });
        }
      }
      return upload(parentId, entries, onProgress, extra);
    },
    async createLink(parentId, fields) {
      if (!fields.name?.trim() || !/^https?:\/\//i.test(fields.url || '')) throw new Error('请填写名称和有效链接。');
      const item = { ...metadata(fields.name, parentId, fields), kind: 'link', type: 'link', url: fields.url };
      await commit((items) => { validateParent(items, parentId); return [...items, item]; });
      return node(item, {});
    },
    async createTextMaterial(parentId, fields) {
      const format = fields.format || 'plain';
      if (!fields.name?.trim() || !['plain', 'word', 'markdown'].includes(format) || !hasInternalTextContent(fields.content || '', format)) throw new Error('请填写资料标题和正文。');
      const ext = { plain: 'txt', word: 'html', markdown: 'md' }[format];
      const type = { plain: 'text/plain', word: 'text/x-riemer-html', markdown: 'text/markdown' }[format];
      const name = fields.name.toLowerCase().endsWith(`.${ext}`) ? fields.name : `${fields.name}.${ext}`;
      return uploadFiles(parentId, [new File([format === 'word' ? sanitizeInternalTextHtml(fields.content) : fields.content], name, { type })], user, null, { ...fields, name });
    },
    renameNode: (target, name) => {
      if (!name?.trim()) throw new Error('名称不能为空。');
      return patch(target, { name: name.trim() });
    },
    updateNote: (target, note) => patch(target, { note: (note || '').trim().slice(0, 200) }),
    updateContributors: (target, names) => patch(target, { contributorsOverride: names?.trim() || null }),
    async moveNodes(nodes, parentId) {
      await commit((items) => {
        validateParent(items, parentId);
        const ids = new Set(nodes.map((item) => item.id));
        if ([...ids].some((id) => !items.some((item) => item.id === id))) throw new Error('资料已不存在，请刷新。');
        let cursor = parentId;
        const seen = new Set();
        while (cursor) {
          if (ids.has(cursor) || seen.has(cursor)) throw new Error('不能将文件夹移入自身或下级文件夹。');
          seen.add(cursor); cursor = items.find((item) => item.id === cursor)?.parentId;
        }
        return items.map((item) => ids.has(item.id) ? { ...item, parentId: parentId || null } : item);
      });
      return { blocked: [] };
    },
    async deleteNode(target) {
      await commit(async (items, post) => {
        if (!items.some((item) => item.id === target.id)) throw new Error('资料已不存在，请刷新。');
        const removed = new Set([target.id]);
        let count;
        do { count = removed.size; items.forEach((item) => { if (removed.has(item.parentId)) removed.add(item.id); }); } while (removed.size !== count);
        const snapshot = { ...post, id: newId(), title: target.name, attachments: items.filter((item) => removed.has(item.id)).map((item) => ({ ...item, parentId: item.id === target.id ? null : item.parentId })) };
        const result = await moveToRecycleBin({ itemType: 'member_sharing', item: snapshot, user });
        if (!result.success) throw new Error(result.error || '无法移入回收站。');
        return items.filter((item) => !removed.has(item.id));
      });
    },
  };
}
