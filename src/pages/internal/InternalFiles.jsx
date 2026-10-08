import { useState, useEffect, useCallback, useRef } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import {
  isInternalFilesAvailable,
  fetchChildrenPage,
  fetchChildrenCount,
  fetchBreadcrumb,
  createFolder,
  uploadFiles,
  uploadFolderTree,
  uploadZipAsFolder,
  isZipFile,
  ZIP_EXTRACT_MAX_BYTES,
  renameNode,
  updateNote,
  deleteNode,
  sortNodes,
  fetchFolderContributors,
  createLink,
  parseSharedLink,
  isLinkNode,
  linkSourceLabel,
  CHILDREN_PAGE_SIZE,
} from '../../services/internalFilesService';
import {
  HardDrive,
  Folder,
  File,
  FileText,
  FileSpreadsheet,
  FileImage,
  FolderPlus,
  Upload,
  FolderUp,
  FolderArchive,
  Link2,
  Pencil,
  Trash2,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  AlertCircle,
  Inbox,
  StickyNote,
  Info,
  User,
  Users,
  Clock,
  X,
} from 'lucide-react';
import './InternalFiles.css';

/* 文件大小格式化 */
function formatSize(bytes) {
  if (!bytes || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let val = bytes;
  let i = 0;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i += 1;
  }
  return `${val >= 10 || i === 0 ? Math.round(val) : val.toFixed(1)} ${units[i]}`;
}

function formatDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/* 按扩展名 / MIME 选择图标与类别标签 */
function getFileMeta(node) {
  if (isLinkNode(node)) {
    const source = linkSourceLabel(node.url);
    return { Icon: Link2, label: source ? `${source} 链接` : '链接', cls: 'is-link' };
  }
  const name = (node.name || '').toLowerCase();
  const mime = (node.mimeType || '').toLowerCase();
  const ext = name.includes('.') ? name.split('.').pop() : '';

  if (['doc', 'docx', 'rtf', 'odt'].includes(ext) || mime.includes('word')) {
    return { Icon: FileText, label: 'Word 文档', cls: 'is-word' };
  }
  if (['xls', 'xlsx', 'csv', 'ods'].includes(ext) || mime.includes('spreadsheet') || mime.includes('excel')) {
    return { Icon: FileSpreadsheet, label: '表格', cls: 'is-excel' };
  }
  if (ext === 'pdf' || mime.includes('pdf')) {
    return { Icon: FileText, label: 'PDF', cls: 'is-pdf' };
  }
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'heic'].includes(ext) || mime.startsWith('image/')) {
    return { Icon: FileImage, label: '图片', cls: 'is-image' };
  }
  if (['ppt', 'pptx', 'key'].includes(ext) || mime.includes('presentation')) {
    return { Icon: FileText, label: '演示文稿', cls: 'is-ppt' };
  }
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) {
    return { Icon: File, label: '压缩包', cls: 'is-zip' };
  }
  return { Icon: File, label: ext ? ext.toUpperCase() : '文件', cls: 'is-generic' };
}

/* ============================================
 * 目录首页本地缓存（stale-while-revalidate）
 *   初次进入 / 切目录时先用上次的结果瞬时渲染，再后台拉最新替换，
 *   消除「列表要转很久才出来」的等待感。只缓存第一页（≤50 项）。
 *   localStorage 不可用（隐私模式 / 超额）时全部静默跳过。
 * ============================================ */
const LIST_CACHE_PREFIX = 'riemer:if:list:v1:';
const LIST_CACHE_INDEX = 'riemer:if:list:v1:index';
const LIST_CACHE_MAX = 24; // 最多缓存的目录数，超出按最久未用淘汰

function listCacheKey(folderId) {
  return LIST_CACHE_PREFIX + (folderId || 'root');
}

function readListCache(folderId) {
  try {
    const raw = localStorage.getItem(listCacheKey(folderId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeListCache(folderId, data) {
  try {
    const key = listCacheKey(folderId);
    const entry = {
      items: (data.items || []).slice(0, CHILDREN_PAGE_SIZE),
      total: data.total ?? null,
      hasMore: !!data.hasMore,
      contribs: data.contribs || {},
      ts: Date.now(),
    };
    localStorage.setItem(key, JSON.stringify(entry));
    // 维护 LRU 索引，超出上限淘汰最久未写入的目录
    let index = [];
    try {
      index = JSON.parse(localStorage.getItem(LIST_CACHE_INDEX) || '[]');
    } catch {
      index = [];
    }
    index = index.filter((k) => k !== key);
    index.push(key);
    while (index.length > LIST_CACHE_MAX) {
      const old = index.shift();
      try { localStorage.removeItem(old); } catch { /* ignore */ }
    }
    localStorage.setItem(LIST_CACHE_INDEX, JSON.stringify(index));
  } catch {
    /* 写缓存失败不影响功能，静默跳过 */
  }
}

/* 把某目录里各文件夹的贡献者并入其列表缓存（贡献者晚于列表算出） */
function mergeContribCache(folderId, contribSlice) {
  try {
    const key = listCacheKey(folderId);
    const raw = localStorage.getItem(key);
    if (!raw) return;
    const entry = JSON.parse(raw);
    entry.contribs = { ...(entry.contribs || {}), ...contribSlice };
    localStorage.setItem(key, JSON.stringify(entry));
  } catch {
    /* ignore */
  }
}

/* 把单独算出的总数并回列表缓存（总数晚于列表返回，供下次首帧直接显示「共 N 项」） */
function mergeTotalCache(folderId, total) {
  try {
    const key = listCacheKey(folderId);
    const raw = localStorage.getItem(key);
    if (!raw) return;
    const entry = JSON.parse(raw);
    entry.total = total;
    localStorage.setItem(key, JSON.stringify(entry));
  } catch {
    /* ignore */
  }
}

/* 备注单元格：上传者本人可点击编辑，其余人只读 */
function NoteCell({ node, editable, busy, onEdit }) {
  const hasNote = !!(node.note && node.note.trim());
  if (editable) {
    return (
      <button
        className={`if-col-note if-note-btn ${hasNote ? '' : 'is-empty'}`}
        onClick={() => onEdit(node)}
        disabled={busy}
        title={hasNote ? `${node.note}（点击编辑）` : '点击添加备注'}
      >
        <StickyNote size={13} className="if-note-icon" />
        <span className="if-note-text">{hasNote ? node.note : '添加备注'}</span>
      </button>
    );
  }
  return (
    <span className={`if-col-note if-note-readonly ${hasNote ? '' : 'is-empty'}`} title={node.note || ''}>
      {hasNote ? (
        <>
          <StickyNote size={13} className="if-note-icon" />
          <span className="if-note-text">{node.note}</span>
        </>
      ) : (
        <span className="if-note-dash">—</span>
      )}
    </span>
  );
}

/* 内容贡献者单元格
 *   文件：上传者本人（固定不变）
 *   文件夹：所有在其中上传过资料的人（按最早上传排序，随他人上传而更新）
 *   人数较多时（尤其手机）名字省略显示，点「N 人」看完整名单（详情弹窗）
 */
function ContribCell({ contributors, loading, onDetail }) {
  if (loading) {
    return <span className="if-col-contrib is-loading">…</span>;
  }
  const list = contributors || [];
  if (list.length === 0) {
    return (
      <span className="if-col-contrib is-empty">
        <span className="if-contrib-dash">—</span>
      </span>
    );
  }
  const names = list.map((c) => c.name).join('、');
  return (
    <span className="if-col-contrib" title={names}>
      <Users size={13} className="if-contrib-icon" />
      <span className="if-contrib-names">{names}</span>
      {list.length > 1 && (
        <button
          type="button"
          className="if-contrib-more"
          onClick={onDetail}
          title="查看全部贡献者"
        >
          {list.length} 人
        </button>
      )}
    </span>
  );
}

export default function InternalFiles() {
  const { isAuthenticated, isAdmin, user } = useAuth();

  // 首帧种子：初始进入的是根目录（folderId=null），若本地有它的列表缓存，就在
  // useState 初始化时同步注入首帧——与成员分享页一致，省去先渲染一帧「加载中…」
  // 再补内容的空窗。惰性初始化只读一次，避免每次渲染都碰 localStorage。
  const [seed] = useState(() => {
    const c = readListCache(null);
    return c && Array.isArray(c.items) && c.items.length
      ? {
          items: sortNodes(c.items),
          total: c.total ?? null,
          hasMore: !!c.hasMore,
          contribs: c.contribs || {},
        }
      : null;
  });

  const [folderId, setFolderId] = useState(null); // null = 根目录
  const [breadcrumb, setBreadcrumb] = useState([]); // [{id,name}, ...]
  const [items, setItems] = useState(() => (seed ? seed.items : []));
  const [total, setTotal] = useState(() => (seed ? seed.total : null)); // 当前目录项总数（单独并行拉取）
  const [hasMore, setHasMore] = useState(() => (seed ? seed.hasMore : false)); // 是否还有下一页
  const [loading, setLoading] = useState(() => !seed); // 首屏 / 切换目录加载（有种子即非加载态）
  const [loadingMore, setLoadingMore] = useState(false); // 「加载更多」进行中
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false); // 上传/新建等写操作进行中
  const [progress, setProgress] = useState(null); // {done,total,current}
  const [dragOver, setDragOver] = useState(false);
  const [detailNode, setDetailNode] = useState(null); // 长按/悬停查看的「上传详情」
  const [linkDraft, setLinkDraft] = useState(null); // 「添加链接」弹窗：{ text, name, nameEdited }
  const [folderContribs, setFolderContribs] = useState(() => (seed ? seed.contribs : {})); // { folderId: [{id,name}] } 文件夹贡献者

  const filesInputRef = useRef(null);
  const folderInputRef = useRef(null);
  const zipInputRef = useRef(null);
  const inflightRef = useRef(false);
  // 每次 load 递增的令牌：单独并行拉取的「总数」回来晚，用它挡掉切目录后
  // 落到错误目录上的旧计数。
  const loadTokenRef = useRef(0);
  // 长按检测：按住 ~500ms 视为长按，弹出上传详情，并抑制随后的点击（进文件夹/打开文件）
  const pressTimerRef = useRef(null);
  const longPressedRef = useRef(false);

  // 重命名 / 删除 / 编辑备注：上传者本人或管理员
  const canModify = useCallback(
    (node) => isAdmin || (node.createdById && node.createdById === user?.id),
    [isAdmin, user?.id]
  );

  // 归一化某节点的「内容贡献者」
  //   文件：上传者本人（固定）
  //   文件夹：已取到的贡献者名单；空文件夹（无人上传资料）回退为文件夹创建者
  //   返回 { list, loading }
  const contribsFor = useCallback(
    (node) => {
      if (!node.isFolder) {
        const name = node.createdBy || '';
        return { list: name ? [{ id: node.createdById, name }] : [], loading: false };
      }
      if (!(node.id in folderContribs)) return { list: [], loading: true };
      const list = folderContribs[node.id] || [];
      if (list.length === 0 && node.createdBy) {
        return { list: [{ id: node.createdById, name: node.createdBy }], loading: false };
      }
      return { list, loading: false };
    },
    [folderContribs]
  );

  const startPress = useCallback((node) => {
    longPressedRef.current = false;
    clearTimeout(pressTimerRef.current);
    pressTimerRef.current = setTimeout(() => {
      longPressedRef.current = true;
      setDetailNode(node);
    }, 500);
  }, []);

  const cancelPress = useCallback(() => {
    clearTimeout(pressTimerRef.current);
    pressTimerRef.current = null;
  }, []);

  // 后台拉取一批文件夹的贡献者并静默并入（不清空已渲染的名字，避免闪烁），
  // 同时写回该目录的列表缓存，供下次瞬时渲染
  const refreshContribs = useCallback((targetId, pageItems) => {
    const folderIds = (pageItems || []).filter((n) => n.isFolder).map((n) => n.id);
    if (folderIds.length === 0) return;
    fetchFolderContributors(folderIds)
      .then((map) => {
        const slice = {};
        for (const id of folderIds) slice[id] = map[id] || [];
        setFolderContribs((prev) => ({ ...prev, ...slice }));
        mergeContribCache(targetId, slice);
      })
      .catch(() => {});
  }, []);

  // 首屏加载 / 刷新：先用本地缓存瞬时渲染，再后台拉最新替换（stale-while-revalidate）
  const load = useCallback(async (targetId) => {
    if (inflightRef.current) return;
    inflightRef.current = true;
    const token = ++loadTokenRef.current;
    setError('');

    // 1) 命中缓存 → 立即渲染上次结果，去掉等待感
    const cached = readListCache(targetId);
    if (cached && Array.isArray(cached.items) && cached.items.length) {
      setItems(sortNodes(cached.items));
      setTotal(cached.total ?? null);
      setHasMore(!!cached.hasMore);
      setFolderContribs(cached.contribs || {});
      setLoading(false);
    } else {
      setLoading(true);
      setFolderContribs({});
    }

    // 总数不阻塞行数据：单独并行拉取，回来后再补「共 N 项」，并挡掉切目录后的旧计数。
    fetchChildrenCount(targetId)
      .then((count) => {
        if (token !== loadTokenRef.current) return;
        setTotal(count);
        mergeTotalCache(targetId, count);
      })
      .catch(() => {});

    // 2) 后台拉最新，替换缓存内容
    try {
      const [page, crumb] = await Promise.all([
        fetchChildrenPage(targetId, { offset: 0, limit: CHILDREN_PAGE_SIZE }),
        targetId ? fetchBreadcrumb(targetId) : Promise.resolve([]),
      ]);
      setItems(sortNodes(page.items));
      // total 由上面的 fetchChildrenCount 单独维护，这里不用 page.total（恒为 null）覆盖它
      setHasMore(page.hasMore);
      setBreadcrumb(crumb);
      writeListCache(targetId, {
        items: page.items,
        total: cached?.total ?? null, // 先沿用旧计数占位，新计数到达后由 mergeTotalCache 覆盖
        hasMore: page.hasMore,
        contribs: {},
      });
      refreshContribs(targetId, page.items);
    } catch (err) {
      console.error('[InternalFiles] 加载失败：', err);
      // 已有缓存则继续显示缓存，不用报错盖掉列表
      if (!(cached && cached.items && cached.items.length)) {
        setError(err?.message || '加载失败，请稍后重试。');
      }
    } finally {
      setLoading(false);
      inflightRef.current = false;
    }
  }, [refreshContribs]);

  // 加载下一页并追加到当前列表（偏移量按已加载数量，与服务端排序对齐）
  const loadMore = useCallback(async () => {
    if (inflightRef.current || loadingMore || !hasMore) return;
    inflightRef.current = true;
    setLoadingMore(true);
    try {
      const page = await fetchChildrenPage(folderId, {
        offset: items.length,
        limit: CHILDREN_PAGE_SIZE,
      });
      setItems((prev) => sortNodes([...prev, ...page.items]));
      // total 由 fetchChildrenCount 维护，这里不用 page.total（null）覆盖
      setHasMore(page.hasMore);
      refreshContribs(folderId, page.items); // 新翻出来的文件夹补算贡献者
    } catch (err) {
      console.error('[InternalFiles] 加载更多失败：', err);
      setError(err?.message || '加载更多失败，请稍后重试。');
    } finally {
      setLoadingMore(false);
      inflightRef.current = false;
    }
  }, [folderId, items.length, hasMore, loadingMore, refreshContribs]);

  useEffect(() => {
    if (isAuthenticated && isInternalFilesAvailable()) {
      load(folderId);
    } else {
      setLoading(false);
    }
  }, [isAuthenticated, folderId, load]);

  const openFolder = (id) => {
    // 长按刚触发过详情，抑制这次点击，避免误进文件夹
    if (longPressedRef.current) {
      longPressedRef.current = false;
      return;
    }
    if (busy) return;
    setFolderId(id);
  };

  /* ---- 编辑备注（仅上传者本人）---- */
  const handleEditNote = async (node) => {
    const next = window.prompt('备注（简短说明，留空可清除）：', node.note || '');
    if (next === null || next.trim() === (node.note || '')) return;
    setBusy(true);
    try {
      await updateNote(node, next);
      await load(folderId);
    } catch (err) {
      alert('保存备注失败：' + (err?.message || err));
    } finally {
      setBusy(false);
    }
  };

  /* ---- 新建文件夹 ---- */
  const handleNewFolder = async () => {
    const name = window.prompt('新建文件夹名称：', '新建文件夹');
    if (name === null) return;
    setBusy(true);
    try {
      await createFolder(folderId, name, user);
      await load(folderId);
    } catch (err) {
      alert('新建文件夹失败：' + (err?.message || err));
    } finally {
      setBusy(false);
    }
  };

  /* ---- 添加链接（大文件放 WPS / 腾讯文档等网盘，这里只存网址）---- */
  // 粘贴内容变化时自动识别名称；用户手动改过名称后不再覆盖
  const handleLinkTextChange = (text) => {
    setLinkDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        text,
        name: prev.nameEdited ? prev.name : parseSharedLink(text).name,
      };
    });
  };

  const handleSubmitLink = async (e) => {
    e.preventDefault();
    if (!linkDraft || busy) return;
    const { url, code } = parseSharedLink(linkDraft.text);
    if (!url) return;
    setBusy(true);
    try {
      await createLink(
        folderId,
        { name: linkDraft.name, url, note: code ? `提取码：${code}` : '' },
        user
      );
      setLinkDraft(null);
      await load(folderId);
    } catch (err) {
      alert('添加链接失败：' + (err?.message || err));
    } finally {
      setBusy(false);
    }
  };

  /* ---- 上传（文件 / 文件夹 / 压缩包） ---- */
  // 普通上传里遇到 .zip 时逐个询问：解压成文件夹，还是原样上传压缩包
  const askExtractZips = (list) => {
    const plain = [];
    const zips = [];
    for (const file of list) {
      if (!isZipFile(file)) {
        plain.push(file);
      } else if (file.size > ZIP_EXTRACT_MAX_BYTES) {
        const ok = window.confirm(
          `「${file.name}」超过 ${Math.round(ZIP_EXTRACT_MAX_BYTES / 1024 / 1024)}MB，无法在线解压。\n\n确定：不解压，原样上传压缩包\n取消：跳过这个文件（大文件建议改用「添加链接」）`
        );
        if (ok) plain.push(file);
      } else {
        const extract = window.confirm(
          `「${file.name}」是压缩包，要自动解压吗？\n\n确定：解压，按包内目录结构存成文件夹\n取消：不解压，原样上传压缩包`
        );
        (extract ? zips : plain).push(file);
      }
    }
    return { plain, zips };
  };

  const doUpload = async (fileList, isFolder) => {
    const list = Array.from(fileList || []);
    if (list.length === 0) return;
    const { plain, zips } = isFolder ? { plain: list, zips: [] } : askExtractZips(list);
    if (plain.length === 0 && zips.length === 0) return;
    setBusy(true);
    setProgress({ done: 0, total: plain.length, current: '' });
    try {
      const onProgress = (done, total, current) =>
        setProgress({ done, total, current });
      let failed = 0;
      if (plain.length > 0) {
        const fn = isFolder ? uploadFolderTree : uploadFiles;
        const { errors } = await fn(folderId, plain, user, onProgress);
        failed += errors?.length || 0;
      }
      const zipFailures = [];
      for (const zip of zips) {
        setProgress({ done: 0, total: 0, current: zip.name, label: '正在解压' });
        try {
          const { errors } = await uploadZipAsFolder(folderId, zip, user, onProgress);
          failed += errors?.length || 0;
        } catch (err) {
          zipFailures.push(`「${zip.name}」：${err?.message || err}`);
        }
      }
      await load(folderId);
      if (zipFailures.length > 0) {
        alert(`以下压缩包未能解压，可重新选择并改为「不解压，原样上传」：\n${zipFailures.join('\n')}`);
      }
      if (failed > 0) {
        alert(`部分文件上传失败（${failed} 个），其余已成功上传。`);
      }
    } catch (err) {
      alert('上传失败：' + (err?.message || err));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const handleFilesPicked = (e) => {
    doUpload(e.target.files, false);
    e.target.value = ''; // 允许再次选择同一文件
  };

  const handleFolderPicked = (e) => {
    doUpload(e.target.files, true);
    e.target.value = '';
  };

  /* ---- 拖拽上传（文件） ---- */
  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if (busy) return;
    const dropped = e.dataTransfer?.files;
    if (dropped && dropped.length > 0) doUpload(dropped, false);
  };

  /* ---- 重命名 ---- */
  const handleRename = async (node) => {
    const name = window.prompt('重命名：', node.name);
    if (name === null || name.trim() === node.name) return;
    setBusy(true);
    try {
      await renameNode(node, name);
      await load(folderId);
    } catch (err) {
      alert('重命名失败：' + (err?.message || err));
    } finally {
      setBusy(false);
    }
  };

  /* ---- 删除 ---- */
  const handleDelete = async (node) => {
    const msg = node.isFolder
      ? `确定删除文件夹「${node.name}」及其中的全部内容吗？此操作不可撤销。`
      : `确定删除文件「${node.name}」吗？此操作不可撤销。`;
    if (!window.confirm(msg)) return;
    setBusy(true);
    try {
      await deleteNode(node);
      await load(folderId);
    } catch (err) {
      alert('删除失败：' + (err?.message || err));
    } finally {
      setBusy(false);
    }
  };

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (!isInternalFilesAvailable()) {
    return (
      <div className="internal-files-page">
        <div className="container">
          <div className="internal-files-page__header">
            <div>
              <h1><HardDrive size={28} /> 内部资料</h1>
              <p>团队内部文件资源库</p>
            </div>
          </div>
          <div className="internal-files-page__empty">
            <AlertCircle size={40} />
            <p>服务未连接</p>
            <span>内部资料需要登录并连接服务器后才能使用。</span>
          </div>
        </div>
      </div>
    );
  }

  const folderCount = items.filter((i) => i.isFolder).length;
  const fileCount = items.length - folderCount;

  return (
    <div className="internal-files-page">
      <div className="container">
        {/* 头部 */}
        <div className="internal-files-page__header">
          <div>
            <h1><HardDrive size={28} /> 内部资料</h1>
            <p>团队内部文件资源库 · 小文件直接上传，zip 压缩包可自动解压成文件夹；超过 20MB 的大文件，先传到 WPS / 腾讯文档等网盘，再点「添加链接」粘贴分享链接</p>
          </div>
          <div className="internal-files-page__actions">
            <button
              className="if-btn if-btn--ghost"
              onClick={() => load(folderId)}
              disabled={loading || busy}
              title="刷新"
            >
              <RefreshCw size={16} className={loading ? 'if-spin' : ''} />
              <span className="if-btn__text">刷新</span>
            </button>
            <button className="if-btn" onClick={handleNewFolder} disabled={busy}>
              <FolderPlus size={16} />
              <span className="if-btn__text">新建文件夹</span>
            </button>
            <button className="if-btn" onClick={() => filesInputRef.current?.click()} disabled={busy}>
              <Upload size={16} />
              <span className="if-btn__text">上传文件</span>
            </button>
            <button className="if-btn" onClick={() => folderInputRef.current?.click()} disabled={busy}>
              <FolderUp size={16} />
              <span className="if-btn__text">上传文件夹</span>
            </button>
            <button
              className="if-btn"
              onClick={() => zipInputRef.current?.click()}
              disabled={busy}
              title="上传 .zip 压缩包，可自动解压成文件夹（手机上可代替「上传文件夹」）"
            >
              <FolderArchive size={16} />
              <span className="if-btn__text">上传压缩包</span>
            </button>
            <button
              className="if-btn"
              onClick={() => setLinkDraft({ text: '', name: '', nameEdited: false })}
              disabled={busy}
              title="大文件先传到 WPS / 腾讯文档等网盘，再在这里添加分享链接"
            >
              <Link2 size={16} />
              <span className="if-btn__text">添加链接</span>
            </button>
          </div>
        </div>

        {/* 隐藏的文件选择框 */}
        <input
          ref={filesInputRef}
          type="file"
          multiple
          hidden
          onChange={handleFilesPicked}
        />
        <input
          ref={folderInputRef}
          type="file"
          hidden
          webkitdirectory=""
          directory=""
          multiple
          onChange={handleFolderPicked}
        />
        <input
          ref={zipInputRef}
          type="file"
          accept=".zip,application/zip,application/x-zip-compressed"
          multiple
          hidden
          onChange={handleFilesPicked}
        />

        {/* 面包屑 */}
        <div className="internal-files-page__breadcrumb">
          <button
            className={`if-crumb ${folderId ? '' : 'if-crumb--active'}`}
            onClick={() => openFolder(null)}
            disabled={busy}
          >
            <Folder size={14} /> 全部资料
          </button>
          {breadcrumb.map((node, idx) => (
            <span key={node.id} className="if-crumb-wrap">
              <ChevronRight size={14} className="if-crumb-sep" />
              <button
                className={`if-crumb ${idx === breadcrumb.length - 1 ? 'if-crumb--active' : ''}`}
                onClick={() => openFolder(node.id)}
                disabled={busy}
              >
                {node.name}
              </button>
            </span>
          ))}
        </div>

        {/* 上传进度 */}
        {progress && (
          <div className="internal-files-page__progress">
            <RefreshCw size={16} className="if-spin" />
            <span>
              {progress.label || `正在上传 ${progress.done}/${progress.total}`}
              {progress.current ? ` · ${progress.current}` : ''}
            </span>
          </div>
        )}

        {error && (
          <div className="internal-files-page__error">
            <AlertCircle size={16} /> {error}
          </div>
        )}

        {/* 文件列表 */}
        <div
          className={`internal-files-page__body ${dragOver ? 'is-dragover' : ''}`}
          onDragOver={(e) => { e.preventDefault(); if (!busy) setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          {loading ? (
            <div className="internal-files-page__loading">
              <RefreshCw size={20} className="if-spin" />
              <span>加载中…</span>
            </div>
          ) : items.length === 0 ? (
            <div className="internal-files-page__empty">
              <Inbox size={40} />
              <p>这个文件夹是空的</p>
              <span>点击右上角「上传文件 / 上传文件夹 / 上传压缩包 / 添加链接」，或把文件拖拽到此处</span>
            </div>
          ) : (
            <div className="if-table">
              <div className="if-table__head">
                <span className="if-col-name">名称</span>
                <span className="if-col-size">大小</span>
                <span className="if-col-contrib">内容贡献者</span>
                <span className="if-col-note">备注</span>
                <span className="if-col-actions" />
              </div>
              {items.map((node) => {
                const detailTitle = `由 ${node.createdBy || '未知'} 上传${node.createdAt ? ` · ${formatDate(node.createdAt)}` : ''}`;

                if (node.isFolder) {
                  return (
                    <div
                      key={node.id}
                      className="if-row"
                      onPointerDown={() => startPress(node)}
                      onPointerUp={cancelPress}
                      onPointerLeave={cancelPress}
                      onPointerCancel={cancelPress}
                      onContextMenu={(e) => e.preventDefault()}
                    >
                      <button
                        className="if-col-name if-name-btn"
                        onClick={() => openFolder(node.id)}
                        disabled={busy}
                        title={`${node.name}（${detailTitle}）`}
                      >
                        <span className="if-icon is-folder"><Folder size={20} /></span>
                        <span className="if-name-text">{node.name}</span>
                      </button>
                      <span className="if-col-size">文件夹</span>
                      {(() => {
                        const { list, loading: contribLoading } = contribsFor(node);
                        return (
                          <ContribCell
                            contributors={list}
                            loading={contribLoading}
                            onDetail={() => setDetailNode(node)}
                          />
                        );
                      })()}
                      <NoteCell node={node} editable={canModify(node)} busy={busy} onEdit={handleEditNote} />
                      <span className="if-col-actions">
                        <button className="if-icon-btn" title="上传详情" onClick={() => setDetailNode(node)}>
                          <Info size={15} />
                        </button>
                        {canModify(node) && (
                          <>
                            <button className="if-icon-btn if-row-modify" title="重命名" onClick={() => handleRename(node)} disabled={busy}>
                              <Pencil size={15} />
                            </button>
                            <button className="if-icon-btn if-icon-btn--danger if-row-modify" title="删除" onClick={() => handleDelete(node)} disabled={busy}>
                              <Trash2 size={15} />
                            </button>
                          </>
                        )}
                      </span>
                    </div>
                  );
                }

                const { Icon, label, cls } = getFileMeta(node);
                return (
                  <div
                    key={node.id}
                    className="if-row"
                    onPointerDown={() => startPress(node)}
                    onPointerUp={cancelPress}
                    onPointerLeave={cancelPress}
                    onPointerCancel={cancelPress}
                    onContextMenu={(e) => e.preventDefault()}
                  >
                    <a
                      className="if-col-name if-name-btn"
                      href={node.url || '#'}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={`${node.name} · ${isLinkNode(node) ? '点击在新页面打开链接' : '点击预览'}（${detailTitle}）`}
                      onClick={(e) => {
                        if (longPressedRef.current) {
                          e.preventDefault();
                          longPressedRef.current = false;
                        }
                      }}
                    >
                      <span className={`if-icon ${cls}`}><Icon size={20} /></span>
                      <span className="if-name-text">{node.name}</span>
                      <span className="if-badge">{label}</span>
                    </a>
                    <span className="if-col-size">{isLinkNode(node) ? '链接' : formatSize(node.sizeBytes)}</span>
                    {(() => {
                      const { list, loading: contribLoading } = contribsFor(node);
                      return (
                        <ContribCell
                          contributors={list}
                          loading={contribLoading}
                          onDetail={() => setDetailNode(node)}
                        />
                      );
                    })()}
                    <NoteCell node={node} editable={canModify(node)} busy={busy} onEdit={handleEditNote} />
                    <span className="if-col-actions">
                      <button className="if-icon-btn" title="上传详情" onClick={() => setDetailNode(node)}>
                        <Info size={15} />
                      </button>
                      {canModify(node) && (
                        <>
                          <button className="if-icon-btn if-row-modify" title="重命名" onClick={() => handleRename(node)} disabled={busy}>
                            <Pencil size={15} />
                          </button>
                          <button className="if-icon-btn if-icon-btn--danger if-row-modify" title="删除" onClick={() => handleDelete(node)} disabled={busy}>
                            <Trash2 size={15} />
                          </button>
                        </>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* 分页懒加载：还有更多目录项时才显示 */}
          {!loading && hasMore && (
            <div className="internal-files-page__more">
              <button
                className="if-btn if-btn--ghost"
                onClick={loadMore}
                disabled={loadingMore || busy}
              >
                {loadingMore ? (
                  <>
                    <RefreshCw size={16} className="if-spin" />
                    <span>加载中…</span>
                  </>
                ) : (
                  <>
                    <ChevronDown size={16} />
                    <span>
                      加载更多{total != null ? `（还有 ${total - items.length} 项）` : ''}
                    </span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>

        {!loading && items.length > 0 && (
          <div className="internal-files-page__stats">
            <span><Folder size={13} /> {folderCount} 个文件夹</span>
            <span><File size={13} /> {fileCount} 个文件</span>
            {total != null && (hasMore || total > items.length) && (
              <span>已加载 {items.length} / 共 {total} 项</span>
            )}
          </div>
        )}

        <div className="internal-files-page__hint">
          <AlertCircle size={14} />
          <span>大文件直接上传又慢又容易失败，建议改用「添加链接」：先把文件传到 WPS、腾讯文档等网盘并复制分享链接，粘贴进来后会自动识别名称，点击条目即跳转到网盘查看（记得在网盘里把分享权限设为可查看）。上传 zip 压缩包时可选择自动解压（按包内目录存成文件夹）或原样上传，仅支持 .zip，不支持带密码的包。所有成员均可查看与上传；备注、重命名与删除仅限上传者本人或管理员。长按（手机）或按住 / 点击 <Info size={12} /> 可查看「谁在何时上传」。删除文件夹会一并删除其中全部内容，且不可撤销。</span>
        </div>
      </div>

      {/* 添加链接弹窗 */}
      {linkDraft && (() => {
        const parsed = parseSharedLink(linkDraft.text);
        const source = linkSourceLabel(parsed.url);
        const hasText = !!linkDraft.text.trim();
        return (
          <div className="if-detail-overlay" onClick={() => !busy && setLinkDraft(null)}>
            <form className="if-detail if-link-form" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmitLink}>
              <div className="if-detail__head">
                <span className="if-detail__title">添加链接</span>
                <button type="button" className="if-icon-btn" onClick={() => setLinkDraft(null)} disabled={busy} title="关闭">
                  <X size={16} />
                </button>
              </div>
              <p className="if-link-form__tip">
                适合 20MB 以上的大文件：先把文件传到 WPS、腾讯文档、百度网盘等，点「分享」复制链接，再整段粘贴到下面。
              </p>
              <label className="if-link-form__label" htmlFor="if-link-text">分享内容或网址</label>
              <textarea
                id="if-link-text"
                className="if-link-form__input"
                rows={3}
                autoFocus
                placeholder="例如：【腾讯文档】期末复习笔记 https://docs.qq.com/doc/xxxx"
                value={linkDraft.text}
                onChange={(e) => handleLinkTextChange(e.target.value)}
              />
              {hasText && (
                <div className={`if-link-form__status ${parsed.url ? '' : 'is-error'}`}>
                  {parsed.url
                    ? `已识别${source ? ` ${source} ` : ''}链接：${parsed.url}${parsed.code ? `（提取码 ${parsed.code} 会写入备注）` : ''}`
                    : '没有识别到网址，需包含以 http:// 或 https:// 开头的链接。'}
                </div>
              )}
              <label className="if-link-form__label" htmlFor="if-link-name">显示名称</label>
              <input
                id="if-link-name"
                className="if-link-form__input"
                type="text"
                placeholder="列表里显示的文件名"
                value={linkDraft.name}
                onChange={(e) => {
                  const name = e.target.value;
                  setLinkDraft((prev) => (prev ? { ...prev, name, nameEdited: true } : prev));
                }}
              />
              <div className="if-link-form__actions">
                <button type="button" className="if-btn if-btn--ghost" onClick={() => setLinkDraft(null)} disabled={busy}>
                  取消
                </button>
                <button type="submit" className="if-btn" disabled={busy || !parsed.url || !linkDraft.name.trim()}>
                  {busy ? '添加中…' : '添加'}
                </button>
              </div>
            </form>
          </div>
        );
      })()}

      {/* 上传详情弹窗（长按 / Info 触发） */}
      {detailNode && (
        <div className="if-detail-overlay" onClick={() => setDetailNode(null)}>
          <div className="if-detail" onClick={(e) => e.stopPropagation()}>
            <div className="if-detail__head">
              <span className="if-detail__title">{detailNode.isFolder ? '文件夹详情' : '文件详情'}</span>
              <button className="if-icon-btn" onClick={() => setDetailNode(null)} title="关闭">
                <X size={16} />
              </button>
            </div>
            <div className="if-detail__name">{detailNode.name}</div>
            <ul className="if-detail__list">
              <li><User size={14} /><span>{detailNode.isFolder ? '创建者' : '上传者'}</span><b>{detailNode.createdBy || '未知'}</b></li>
              <li><Clock size={14} /><span>{detailNode.isFolder ? '创建时间' : '上传时间'}</span><b>{formatDate(detailNode.createdAt) || '未知'}</b></li>
              {detailNode.isFolder && (() => {
                const { list } = contribsFor(detailNode);
                return (
                  <li>
                    <Users size={14} /><span>贡献者</span>
                    <b>{list.length ? list.map((c) => c.name).join('、') : '（暂无上传）'}</b>
                  </li>
                );
              })()}
              {!detailNode.isFolder && (isLinkNode(detailNode) ? (
                <li><Link2 size={14} /><span>链接</span><b className="if-detail__url">{detailNode.url}</b></li>
              ) : (
                <li><Info size={14} /><span>大小</span><b>{formatSize(detailNode.sizeBytes)}</b></li>
              ))}
              <li><StickyNote size={14} /><span>备注</span><b>{detailNode.note?.trim() || '（空）'}</b></li>
            </ul>
            {/* 管理操作：手机版行内不放编辑备注/重命名/删除，改到这里 */}
            {canModify(detailNode) && (
              <div className="if-detail__actions">
                <button
                  type="button"
                  className="if-detail__act-btn"
                  disabled={busy}
                  onClick={() => { const n = detailNode; setDetailNode(null); handleEditNote(n); }}
                >
                  <StickyNote size={15} /> 编辑备注
                </button>
                <button
                  type="button"
                  className="if-detail__act-btn"
                  disabled={busy}
                  onClick={() => { const n = detailNode; setDetailNode(null); handleRename(n); }}
                >
                  <Pencil size={15} /> 重命名
                </button>
                <button
                  type="button"
                  className="if-detail__act-btn if-detail__act-btn--danger"
                  disabled={busy}
                  onClick={() => { const n = detailNode; setDetailNode(null); handleDelete(n); }}
                >
                  <Trash2 size={15} /> 删除
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
