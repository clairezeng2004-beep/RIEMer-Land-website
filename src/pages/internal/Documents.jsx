import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { marked } from 'marked';
import { useAuth } from '../../contexts/AuthContext';
import { emitNotificationEvent } from '../../lib/notificationRuleEngine';
import {
  FileText,
  Upload,
  Search,
  Download,
  Trash2,
  Plus,
  File,
  FolderOpen,
  X,
  Eye,
  Image,
  FileSpreadsheet,
  Presentation,
  ChevronLeft,
  Clock,
  User,
  HardDrive,
  BarChart3,
  ThumbsUp,
  CheckCircle2,
  Edit3,
  Paperclip,
  Code2,
} from 'lucide-react';
import { documentsData } from '../../data/siteData';
import CustomSelect from '../../components/CustomSelect';
import { useSiteContent } from '../../contexts/SiteContentContext';
import EditableText from '../../components/EditableText';
import { pinyinMatch } from '../../utils/pinyinSearch';
import { stripUnderline } from '../../utils/stripUnderline';
import TextAnnotation from '../../components/TextAnnotation';
import WordPreview from '../../components/WordPreview';
import {
  fetchAllFromCloud,
  fetchViewsFromCloud,
  fetchViewLog,
  deleteUserDoc,
  markDefaultDeleted,
  updateDoc as cloudUpdateDoc,
  canUseSupabase,
  subscribeDocuments,
  subscribeDeletedDefaults,
} from '../../lib/documentsService';
import ViewLogPopover from '../../components/ViewLogPopover';
import { getCachedAllUsers } from '../../lib/userDirectoryCache';
import './Documents.css';

const defaultTypeLabels = {
  course: '课程及考试资料',
  history: '历史会议',
  process: '流程手册及模版文件',
  regulation: '规章制度',
  experience: '成员经验分享',
};

const defaultTypeColors = {
  course: '#5EAD8C',
  history: '#4FBFC4',
  process: '#D4A44C',
  regulation: '#8B5CF6',
  experience: '#EC4899',
};

const fileTypeIcons = {
  pdf: FileText,
  docx: FileText,
  xlsx: FileSpreadsheet,
  pptx: Presentation,
  image: Image,
};

const fileTypeLabels = {
  pdf: 'PDF 文档',
  docx: 'Word 文档',
  xlsx: 'Excel 表格',
  pptx: 'PPT 演示',
  image: '图片',
};

// 从文件名推断类型
function inferFileType(fileName) {
  if (!fileName) return 'pdf';
  const ext = fileName.split('.').pop().toLowerCase();
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) return 'image';
  if (['xlsx', 'xls', 'csv'].includes(ext)) return 'xlsx';
  if (['pptx', 'ppt'].includes(ext)) return 'pptx';
  if (['docx', 'doc'].includes(ext)) return 'docx';
  return 'pdf';
}

// ============ localStorage 持久化 ============
// 用户通过独立发布页上传的文档（内容+附件）
const DOCUMENTS_KEY = 'riemer_documents';
// 被删除的默认（示例/模拟）文档 id 列表，避免刷新后又出现
const DELETED_DEFAULT_IDS_KEY = 'riemer_documents_deleted_default_ids';

function loadUserDocs() {
  try {
    const stored = localStorage.getItem(DOCUMENTS_KEY);
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return [];
}

function saveUserDocs(data) {
  try {
    localStorage.setItem(DOCUMENTS_KEY, JSON.stringify(data));
  } catch (err) {
    console.error('localStorage 保存失败', err);
  }
}

function loadDeletedDefaultIds() {
  try {
    const stored = localStorage.getItem(DELETED_DEFAULT_IDS_KEY);
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return [];
}

function saveDeletedDefaultIds(ids) {
  try {
    localStorage.setItem(DELETED_DEFAULT_IDS_KEY, JSON.stringify(ids));
  } catch (err) {
    console.error('localStorage 保存失败', err);
  }
}

// 判断是否为用户发布的文档（而非默认模拟数据）
function isUserDoc(doc) {
  return String(doc?.id || '').startsWith('doc-');
}

function mergeDocuments({ userDocs, deletedIds, filterTypes }) {
  const deletedSet = new Set((deletedIds || []).map(String));
  const userIds = new Set((userDocs || []).map((d) => String(d.id)));
  const defaults = documentsData.filter(
    (d) => !deletedSet.has(String(d.id)) && !userIds.has(String(d.id))
  );
  const base = filterTypes
    ? [...defaults, ...(userDocs || [])].filter((d) => filterTypes.includes(d.type))
    : [...(userDocs || []), ...defaults];
  return base.sort((a, b) => {
    const aIsUser = isUserDoc(a);
    const bIsUser = isUserDoc(b);
    if (aIsUser && !bIsUser) return -1;
    if (!aIsUser && bIsUser) return 1;
    return 0;
  });
}

// 流程模板 / 文档详情页共享的浏览计数（与 ProcessTemplateDetail 完全一致）
const PTD_VIEWS_KEY = 'riemer_process_template_views';

function loadDocViews() {
  try {
    const stored = localStorage.getItem(PTD_VIEWS_KEY);
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return {};
}

export default function Documents({ filterTypes, customTitle, customDesc, configSection }) {
  const { isAuthenticated, isAdmin, user, getAllUsers } = useAuth();
  const { internalConfig, updateInternalConfig, filterOptions, updateFilterOptions, flushSettingToCloud, SITE_KEYS } = useSiteContent();

  // 立即把最新的 filterOptions / internalConfig 推云端。
  // 就地编辑筛选项时必须用它替代 context 自带的 400ms 去抖 push：
  // 用户常常点完"+ 添加分类"就立即关 tab / 刷新，去抖 setTimeout 被卸载丢弃，
  // pagehide 的兜底又因浏览器在 unload 阶段 cancel 非 sendBeacon fetch 而不可靠，
  // 云端从未写入 → 跨设备看不到，本设备刷新还会被 realtime 回流覆盖掉本地 localStorage。
  // 这里统一立即推送并等待返回，失败时给用户弹窗提示真实原因。
  const flushFilterOptionsNow = useCallback((nextFilterOptions) => {
    flushSettingToCloud(SITE_KEYS.FILTER_OPTIONS, nextFilterOptions).then((res) => {
      if (!res?.success) {
        alert(`筛选分类已保存到本地，但同步到云端失败：${res?.error || '未知错误'}\n其它设备可能暂时看不到最新分类。`);
      }
    });
  }, [flushSettingToCloud, SITE_KEYS]);

  const flushInternalConfigNow = useCallback((nextInternalConfig) => {
    flushSettingToCloud(SITE_KEYS.INTERNAL_CONFIG, nextInternalConfig).then((res) => {
      if (!res?.success) {
        alert(`页面筛选设置已保存到本地，但同步到云端失败：${res?.error || '未知错误'}\n其它设备可能暂时看不到最新设置。`);
      }
    });
  }, [flushSettingToCloud, SITE_KEYS]);

  /* ==========
     贡献者真名映射：通过 uploadedById 动态解析真名，
     兼容历史数据里存了昵称的情况，保证"贡献者"统一显示真名。
     ========== */
  const [userNameMap, setUserNameMap] = useState({});
  // 所有可选贡献者（来自 getAllUsers，已授权）——用于上传表单的多选下拉
  const [allUsers, setAllUsers] = useState([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // 走模块级 30s 缓存，和评论区 / 文档详情页共享同一份 profiles 查询，
        // 避免每次打开上传表单都触发一次全表拉取。
        const list = (await getCachedAllUsers(getAllUsers)) || [];
        if (cancelled) return;
        const map = {};
        list.forEach((u) => {
          if (u?.id) map[u.id] = u.name || u.nickname || '';
        });
        setUserNameMap(map);
        setAllUsers(list);
      } catch {
        /* 拉取失败时回退到 doc.uploadedBy 原值 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getAllUsers]);

  const resolveContributorName = useCallback(
    (uid, fallback) => {
      if (uid && userNameMap[uid]) return userNameMap[uid];
      if (uid && user?.id === uid && (user.name || user.nickname)) {
        return user.name || user.nickname;
      }
      return fallback || 'Unknown';
    },
    [userNameMap, user],
  );

  const resolveLikeUserName = useCallback(
    (like) => {
      const uid = like?.userId;
      if (uid && userNameMap[uid]) return userNameMap[uid];
      if (uid && user?.id === uid && (user.name || user.nickname)) {
        return user.name || user.nickname;
      }
      return like?.userName || 'Unknown';
    },
    [userNameMap, user],
  );

  /* 展示贡献者：优先读 doc.contributorIds（多贡献者），
     缺省则回退到旧的 uploadedById / uploadedBy 单贡献者逻辑。 */
  const resolveContributors = useCallback(
    (doc) => {
      const ids = Array.isArray(doc?.contributorIds) ? doc.contributorIds : [];
      if (ids.length > 0) {
        return ids
          .map((id) => resolveContributorName(id, null))
          .filter(Boolean)
          .join('、');
      }
      return resolveContributorName(doc?.uploadedById, doc?.uploadedBy);
    },
    [resolveContributorName],
  );
  const sectionKey = configSection || 'documents';
  const dc = internalConfig[sectionKey] || internalConfig.documents;
  // 页面级筛选扩展（仅 filterTypes 模式下有意义）：
  // - extraTypeKeys: 本页新增出来、但还不在 filterTypes 白名单里的分类 key
  // - hiddenBuiltinKeys: 本页被"删除（隐藏）"的白名单内置分类 key
  // 两者配合 filterTypes 白名单，构成当前 tab 实际可见的 types 列表。
  const extraTypeKeys = useMemo(
    () => (Array.isArray(dc?.extraTypeKeys) ? dc.extraTypeKeys : []),
    [dc]
  );
  const hiddenBuiltinKeys = useMemo(
    () => (Array.isArray(dc?.hiddenBuiltinKeys) ? dc.hiddenBuiltinKeys : []),
    [dc]
  );

  // 从 filterOptions 获取动态文档类型
  const docTypes = filterOptions.documentTypes || [];
  const typeLabels = useMemo(() => {
    const labels = { ...defaultTypeLabels };
    docTypes.forEach((t) => { labels[t.key] = t.label; });
    return labels;
  }, [docTypes]);
  const typeColors = useMemo(() => {
    const colors = { ...defaultTypeColors };
    docTypes.forEach((t) => { colors[t.key] = t.color; });
    return colors;
  }, [docTypes]);

  const updateDocs = useCallback(
    (key, val) => updateInternalConfig({ [sectionKey]: { [key]: val } }),
    [updateInternalConfig, sectionKey]
  );

  // 编辑模式：添加新筛选项
  const [showAddType, setShowAddType] = useState(false);
  const [newTypeLabel, setNewTypeLabel] = useState('');
  // 编辑模式：重命名筛选项
  const [renamingType, setRenamingType] = useState(null);
  const [renameValue, setRenameValue] = useState('');

  const handleAddType = () => {
    const trimmed = newTypeLabel.trim();
    if (!trimmed) return;
    // 重名检测：仅与"本页当前真正可见的分类"比较（即 types 数组里渲染出来的那几个）。
    // ⚠️ 不能用全局 docTypes 当基准 —— docTypes 是 filterOptions.documentTypes，
    // 包含所有 Documents 页面（总入口 / 流程模板 / 规章制度）共用的分类池。本页可能
    // 通过 filterTypes 白名单 + hiddenBuiltinKeys 把其中一部分隐藏掉了，那些"看不见
    // 的分类"不应阻止用户在当前 tab 新建同名项，否则会出现"UI 上明明没有该分类，
    // 却弹框说已存在"的矛盾提示。
    const normalized = trimmed.toLowerCase();
    // types 里 '全部' 是 UI 虚拟项，过滤掉；其余每个 key 通过 typeLabels 解析成 label
    const visibleLabels = types
      .filter((k) => k !== '全部')
      .map((k) => String(typeLabels[k] || '').trim().toLowerCase())
      .filter(Boolean);
    if (visibleLabels.includes(normalized)) {
      alert(`分类「${trimmed}」已存在，请换一个名字。`);
      return;
    }
    // 生成唯一 key
    const key = 'custom_' + Date.now();
    // 随机颜色
    const palette = ['#5EAD8C', '#4FBFC4', '#D4A44C', '#8B5CF6', '#EC4899', '#F59E0B', '#3B82F6', '#EF4444', '#10B981', '#6366F1'];
    const color = palette[docTypes.length % palette.length];
    // ① 先在全局文档类型池里注册（保证其它通过 filterOptions 读取的地方拿到 label/color）
    const nextFilterOptions = {
      ...filterOptions,
      documentTypes: [...docTypes, { key, label: trimmed, color }],
    };
    updateFilterOptions(nextFilterOptions);
    flushFilterOptionsNow(nextFilterOptions);
    // ② 对 filterTypes 模式（例如"流程模板文件"页）：filterTypes 是写死的白名单
    //   (['process', 'regulation'])，新 key 不在白名单里就不会被 types 数组采纳。
    //   这里用页面级 extraTypeKeys 把新 key 补进来，避免污染其它不受 filterTypes 约束
    //   的 Documents 页（例如"文档管理"总入口会看到所有全局分类，互不干扰）。
    if (filterTypes) {
      const nextExtra = [...extraTypeKeys, key];
      updateDocs('extraTypeKeys', nextExtra);
      // 立即把整份 internalConfig 推云，和 filterOptions 保持一致的即时性
      const nextInternalConfig = {
        ...internalConfig,
        [sectionKey]: { ...(internalConfig[sectionKey] || {}), extraTypeKeys: nextExtra },
      };
      flushInternalConfigNow(nextInternalConfig);
    }
    setNewTypeLabel('');
    setShowAddType(false);
  };

  const handleRenameType = (typeKey) => {
    const trimmed = renameValue.trim();
    if (!trimmed) return;
    // 重名检测：改名后不能与"本页其它可见分类"重名（同样只看当前 tab 用户眼见的那几个，
    // 不把其它 Documents 页独有的分类也纳入对比，理由见 handleAddType 的注释）。
    // 允许改回自己（typeKey === 当前项），也允许只改大小写/空白。
    const normalized = trimmed.toLowerCase();
    const visibleLabels = types
      .filter((k) => k !== '全部' && k !== typeKey)
      .map((k) => String(typeLabels[k] || '').trim().toLowerCase())
      .filter(Boolean);
    if (visibleLabels.includes(normalized)) {
      alert(`分类「${trimmed}」已存在，请换一个名字。`);
      return;
    }
    const nextFilterOptions = {
      ...filterOptions,
      documentTypes: docTypes.map((t) =>
        t.key === typeKey ? { ...t, label: trimmed } : t
      ),
    };
    updateFilterOptions(nextFilterOptions);
    flushFilterOptionsNow(nextFilterOptions);
    setRenamingType(null);
    setRenameValue('');
  };

  const handleDeleteType = (typeKey) => {
    if (!window.confirm('确定要删除这个筛选分类吗？')) return;
    if (filterTypes) {
      // filterTypes 模式（例如"流程模板文件"页）：
      // - 若删除的是白名单内置 key（process/regulation），不动全局 filterOptions
      //   ——因为其它 Documents 页可能仍在使用这些分类的 label/color；只在本页加一条
      //   hiddenBuiltinKeys 记录，让本 tab 视觉上不再显示该分类。
      // - 若删除的是本页添加的 custom_*，则同步从 extraTypeKeys 和全局池移除。
      if (filterTypes.includes(typeKey)) {
        const nextHidden = hiddenBuiltinKeys.includes(typeKey)
          ? hiddenBuiltinKeys
          : [...hiddenBuiltinKeys, typeKey];
        updateDocs('hiddenBuiltinKeys', nextHidden);
        const nextInternalConfig = {
          ...internalConfig,
          [sectionKey]: { ...(internalConfig[sectionKey] || {}), hiddenBuiltinKeys: nextHidden },
        };
        flushInternalConfigNow(nextInternalConfig);
      } else {
        const nextExtra = extraTypeKeys.filter((k) => k !== typeKey);
        updateDocs('extraTypeKeys', nextExtra);
        const nextInternalConfig = {
          ...internalConfig,
          [sectionKey]: { ...(internalConfig[sectionKey] || {}), extraTypeKeys: nextExtra },
        };
        flushInternalConfigNow(nextInternalConfig);
        const nextFilterOptions = {
          ...filterOptions,
          documentTypes: docTypes.filter((t) => t.key !== typeKey),
        };
        updateFilterOptions(nextFilterOptions);
        flushFilterOptionsNow(nextFilterOptions);
      }
    } else {
      // 无 filterTypes 约束的总入口：沿用原行为——直接从全局池删除。
      const nextFilterOptions = {
        ...filterOptions,
        documentTypes: docTypes.filter((t) => t.key !== typeKey),
      };
      updateFilterOptions(nextFilterOptions);
      flushFilterOptionsNow(nextFilterOptions);
    }
    setSelectedTypes((prev) => prev.filter((type) => type !== typeKey));
  };
  const [documents, setDocuments] = useState(() => {
    if (canUseSupabase()) return [];
    const userDocs = loadUserDocs();
    return mergeDocuments({
      userDocs,
      deletedIds: loadDeletedDefaultIds(),
      filterTypes,
    });
  });
  const [cloudLoading, setCloudLoading] = useState(() => canUseSupabase());
  const pendingDeletedIdsRef = useRef(new Set());
  const [pendingDeletedIds, setPendingDeletedIds] = useState([]);
  const hidePendingDeletedDocs = useCallback(
    (items) => items.filter((doc) => !pendingDeletedIdsRef.current.has(String(doc.id))),
    [],
  );

  // 与 ProcessTemplateDetail 共享的浏览计数（在列表卡片上实时展示）
  const [docViews, setDocViews] = useState(() => loadDocViews());

  const shouldUseCloudDocs = canUseSupabase();
  const refreshSeqRef = useRef(0);

  const applyCloudDocs = useCallback((cloudDocs, cloudDeletedIds) => {
    const sorted = mergeDocuments({
      userDocs: cloudDocs,
      deletedIds: cloudDeletedIds,
      filterTypes,
    });
    setDocuments(hidePendingDeletedDocs(sorted));
    try {
      saveUserDocs(cloudDocs);
      localStorage.setItem(DELETED_DEFAULT_IDS_KEY, JSON.stringify(cloudDeletedIds));
    } catch { /* ignore */ }
  }, [filterTypes, hidePendingDeletedDocs]);

  // 刷新函数：云端优先。Supabase 已配置时不使用本地缓存替代云端结果，
  // 避免手机端刷新后显示和电脑端不一致的旧本地数据。
  const refreshDocs = useCallback(async ({ allowLocalFallback = true } = {}) => {
    const seq = refreshSeqRef.current + 1;
    refreshSeqRef.current = seq;

    if (shouldUseCloudDocs) {
      setCloudLoading(true);
      const cloud = await fetchAllFromCloud();
      if (refreshSeqRef.current !== seq) return;
      if (cloud) {
        applyCloudDocs(cloud.docs, cloud.deletedIds);
        if (refreshSeqRef.current === seq) setCloudLoading(false);
        fetchViewsFromCloud().then((mergedViews) => {
          if (refreshSeqRef.current === seq && mergedViews) setDocViews(mergedViews);
        });
        return;
      }
      if (refreshSeqRef.current === seq) setCloudLoading(false);
      if (!allowLocalFallback) return;
    }

    if (!allowLocalFallback && shouldUseCloudDocs) return;

    const userDocs = loadUserDocs();
    const sorted = mergeDocuments({
      userDocs,
      deletedIds: loadDeletedDefaultIds(),
      filterTypes,
    });
    setDocuments(hidePendingDeletedDocs(sorted));
    setDocViews(loadDocViews());
    setCloudLoading(false);
  }, [applyCloudDocs, filterTypes, hidePendingDeletedDocs, shouldUseCloudDocs]);

  // ========== 云端同步 ==========
  // 挂载时从 Supabase 拉取最新文档列表 + 已删除默认 id + 浏览计数；
  // 成功后覆盖本地 state；失败时不回退旧缓存，避免跨设备数据不一致。
  useEffect(() => {
    if (!shouldUseCloudDocs) return;
    refreshDocs({ allowLocalFallback: false });
  }, [shouldUseCloudDocs, refreshDocs]);

  // ---- 订阅 documents / documents_deleted_defaults 表的 realtime 变更 ----
  // 其它设备新增/编辑/删除文档、或删除默认模拟数据时，本设备自动刷新
  useEffect(() => {
    if (!shouldUseCloudDocs) return;

    // 简单策略：收到任何变更 → 重新从云端拉一次 + 本地 state 替换
    // 这样能保证和 fetchAllFromCloud 的合并逻辑完全一致，避免重复维护
    let timer = null;
    const refetch = () => {
      // 200ms 节流，避免批量写入时频繁刷
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        refreshDocs({ allowLocalFallback: false });
      }, 200);
    };

    const unsubDocs = subscribeDocuments(() => refetch());
    const unsubDeleted = subscribeDeletedDefaults(() => refetch());

    return () => {
      if (timer) clearTimeout(timer);
      unsubDocs();
      unsubDeleted();
    };
  }, [shouldUseCloudDocs, refreshDocs]);

  // 监听独立发布页（新窗口）发来的刷新消息 + 监听浏览计数变化
  useEffect(() => {
    const handler = (event) => {
      if (event?.data?.type === 'process-template-created') {
        refreshDocs({ allowLocalFallback: false });
      }
    };
    window.addEventListener('message', handler);

    // 兜底：窗口 focus 时刷新一次（用户从详情页标签切回来时看到最新浏览数）
    const onFocus = () => {
      refreshDocs({ allowLocalFallback: false });
      setDocViews(loadDocViews());
    };
    window.addEventListener('focus', onFocus);

    // 跨标签页通信：详情页在另一个标签写 localStorage 会触发 storage 事件
    const onStorage = (e) => {
      if (e.key === PTD_VIEWS_KEY) {
        setDocViews(loadDocViews());
      }
      if (e.key === DOCUMENTS_KEY || e.key === DELETED_DEFAULT_IDS_KEY) {
        refreshDocs({ allowLocalFallback: !shouldUseCloudDocs });
      }
    };
    window.addEventListener('storage', onStorage);

    // 本页隐藏 → 显示时也兜底刷新一次（部分浏览器对同源新标签回切没有 focus 事件）
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        setDocViews(loadDocViews());
        if (shouldUseCloudDocs) {
          refreshDocs({ allowLocalFallback: false });
        }
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.removeEventListener('message', handler);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refreshDocs, shouldUseCloudDocs]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTypes, setSelectedTypes] = useState([]);
  const [showUpload, setShowUpload] = useState(false);
  const [newDoc, setNewDoc] = useState({ title: '', type: filterTypes ? filterTypes[0] : 'course', description: '' });
  // 贡献者多选（id 数组）。默认上传者本人，打开上传表单时用 useEffect 同步一次。
  const [contributorIds, setContributorIds] = useState(() => (user?.id ? [user.id] : []));
  // 打开上传表单时：若用户刚登录完（初始 state 为 []），补一次默认
  useEffect(() => {
    if (showUpload && user?.id && contributorIds.length === 0) {
      setContributorIds([user.id]);
    }
    // 仅在打开表单的瞬间 & 用户 id 可用时触发；不监听 contributorIds 以免覆盖用户的清空操作
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showUpload, user?.id]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewDoc, setPreviewDoc] = useState(null);
  const [isDragOver, setIsDragOver] = useState(false);

  // 访问记录弹层：点击小眼睛时激活，保存当前查看的文档
  const [viewLogDoc, setViewLogDoc] = useState(null);
  const fileInputRef = useRef(null);
  const docContentRef = useRef(null);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  const types = filterTypes
    ? [
        '全部',
        // 白名单内置分类：必须仍然存在于 docTypes / 默认 typeLabels 中，且未被本页隐藏
        ...filterTypes.filter(
          (ft) =>
            !hiddenBuiltinKeys.includes(ft) &&
            (docTypes.some((t) => t.key === ft) || defaultTypeLabels[ft])
        ),
        // 页面级新增分类：key 需仍在全局 docTypes 中（避免全局被删后此处变成孤儿）
        ...extraTypeKeys.filter((k) => docTypes.some((t) => t.key === k)),
      ]
    : ['全部', ...docTypes.map((t) => t.key)];

  // 把用户在描述里粘贴进来的 HTML 实体（&nbsp; / &amp; / &lt; 等）还原为真实字符，
  // 并剥掉任何残留的 HTML 标签；空值/非字符串直接返回 ''
  const decodePlainText = (val) => {
    if (val == null) return '';
    const str = String(val);
    if (!str) return '';
    // 用浏览器原生解码（支持全部 HTML 实体，且不会执行脚本）
    const parser = new DOMParser();
    try {
      const doc = parser.parseFromString(`<!doctype html><body>${str}`, 'text/html');
      return (doc.body.textContent || '').trim();
    } catch {
      return str;
    }
  };

  const filtered = documents.filter((doc) => {
    if (pendingDeletedIds.includes(String(doc.id))) return false;
    const desc = decodePlainText(doc.description);
    const matchesSearch =
      !searchTerm ||
      pinyinMatch(doc.title, searchTerm) ||
      pinyinMatch(desc, searchTerm);
    const matchesType = selectedTypes.length === 0 || selectedTypes.includes(doc.type);
    return matchesSearch && matchesType;
  });

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      if (!newDoc.title) {
        setNewDoc((prev) => ({ ...prev, title: file.name.replace(/\.[^.]+$/, '') }));
      }
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      setSelectedFile(file);
      if (!newDoc.title) {
        setNewDoc((prev) => ({ ...prev, title: file.name.replace(/\.[^.]+$/, '') }));
      }
      if (!showUpload) setShowUpload(true);
    }
  };

  const handleAddDocument = (e) => {
    e.preventDefault();
    if (!newDoc.title) return;

    const fileType = selectedFile ? inferFileType(selectedFile.name) : 'pdf';
    const fileUrl = selectedFile ? URL.createObjectURL(selectedFile) : null;

    // 贡献者：多选 id 数组。若空则回退到当前用户本人，保证至少有一位。
    const finalContributorIds =
      contributorIds.length > 0
        ? contributorIds
        : user?.id
          ? [user.id]
          : [];
    // 主贡献者 = 第一位（默认就是当前用户，除非用户调整了顺序）
    const primaryId = finalContributorIds[0] || null;
    const primaryName =
      (primaryId && (userNameMap[primaryId] || (primaryId === user?.id ? user?.name || user?.nickname : ''))) ||
      user?.name ||
      user?.nickname ||
      'Unknown';

    const doc = {
      id: Date.now().toString(),
      title: newDoc.title,
      type: newDoc.type,
      fileType,
      fileUrl,
      description: decodePlainText(newDoc.description),
      // 兼容旧字段：主贡献者（列表卡片 fallback 会用到）
      uploadedBy: primaryName,
      uploadedById: primaryId,
      // 新：多贡献者列表
      contributorIds: finalContributorIds,
      date: new Date().toISOString().split('T')[0],
      size: selectedFile ? formatSize(selectedFile.size) : '—',
      viewCount: 0,
      _file: selectedFile,
    };
    setDocuments([doc, ...documents]);
    // 通知由规则引擎统一触发（规则可在"通知管理"页面自定义）
    const uploaderLabel = finalContributorIds
      .map((id) => userNameMap[id] || (id === user?.id ? user?.name || user?.nickname : ''))
      .filter(Boolean)
      .join('、') || primaryName;
    emitNotificationEvent('doc.upload', {
      operator: uploaderLabel,
      operatorUserId: user?.id,
      title: doc.title,
      typeLabel: typeLabels[doc.type],
    });
    setNewDoc({ title: '', type: 'course', description: '' });
    setContributorIds(user?.id ? [user.id] : []);
    setSelectedFile(null);
    setShowUpload(false);
  };

  const handleDelete = (id) => {
    // 先找到被删除的文档，用于在通知中显示详细信息
    const target = documents.find((d) => d.id === id);
    if (!target) return;

    const typeLabel = typeLabels[target.type] || '文档';
    const confirmMsg = `确定要删除文档「${target.title}」吗？`;
    if (window.confirm(confirmMsg)) {
      const sid = String(id);
      pendingDeletedIdsRef.current.add(sid);
      setPendingDeletedIds(Array.from(pendingDeletedIdsRef.current));
      setDocuments((prev) => prev.filter((d) => String(d.id) !== sid));
      setPreviewDoc((prev) => (prev && String(prev.id) === sid ? null : prev));
      setViewLogDoc((prev) => (prev && String(prev.id) === sid ? null : prev));

      // 判断这条到底是「内置默认示例」还是「用户/云端发布的文档」：
      // 之前用 id 是否以 'doc-' 开头来判断，但新发布的文档 id 其实是纯数字
      // （Date.now().toString()），导致它被误判为默认示例，云端那一行没被删除，
      // 刷新后又从云端拉回来 —— 这正是「流程模板删了又出现」的根因。
      // 现在改为：只有 id 真的存在于内置 documentsData 里才算默认示例，其余一律
      // 当作用户/云端文档，删除时必须删掉云端那一行。
      const isDefaultDoc = documentsData.some((d) => String(d.id) === sid);

      // 本地缓存里若有同 id 记录，一并移除（含覆盖层）
      const userDocs = loadUserDocs();
      if (userDocs.some((d) => String(d.id) === sid)) {
        saveUserDocs(userDocs.filter((d) => String(d.id) !== sid));
      }

      if (isDefaultDoc) {
        // 内置示例：写一条「已删除默认」标记（本地 + 云端），保证其它设备也不再渲染。
        const deletedIds = loadDeletedDefaultIds();
        if (!deletedIds.includes(sid)) {
          deletedIds.push(sid);
          saveDeletedDefaultIds(deletedIds);
        }
        if (shouldUseCloudDocs) {
          markDefaultDeleted(id).catch((err) => {
            console.warn('[Documents] 云端标记默认文档删除失败:', err);
          });
        }
      } else if (shouldUseCloudDocs) {
        // 用户/云端文档：直接删掉云端那一行（deleteUserDoc 内部会同时清本地缓存）。
        deleteUserDoc(id).catch((err) => {
          console.warn('[Documents] 云端删除文档失败:', err);
        });
      }
      // 通知由规则引擎统一触发。消息通知作为操作记录保留，但不再手写本地通知，
      // 避免一端删除后另一端只看到本机缓存里的旧通知文案。
      const operator = user?.name || user?.nickname || '管理员';
      const uploader = resolveContributors(target) || '未知';
      emitNotificationEvent('doc.delete', {
        operator,
        operatorUserId: user?.id,
        title: target.title,
        typeLabel,
        uploader,
        date: target.date || '',
      });
    }
  };

  // 权限判断：管理员或贡献者可删除/修改
  const canModify = (doc) => {
    if (isAdmin) return true;
    if (user?.id && Array.isArray(doc.contributorIds) && doc.contributorIds.includes(user.id)) return true;
    if (doc.uploadedById && doc.uploadedById === user?.id) return true;
    // 兼容旧数据：对比上传者名称
    if (doc.uploadedBy && doc.uploadedBy === user?.name) return true;
    return false;
  };

  // 点赞/取消点赞
  const handleLike = (docId, e) => {
    if (e) e.stopPropagation();
    if (!user) return;
    const likeData = {
      userId: user.id,
      userName: user.name || user.nickname || user.email,
      userAvatar: user.avatar || null,
    };

    let nextLikesSnapshot = null;

    setDocuments((prev) =>
      prev.map((d) => {
        if (d.id !== docId) return d;
        const likes = d.likes || [];
        const alreadyLiked = likes.some((l) => l.userId === user.id);
        const nextLikes = alreadyLiked
          ? likes.filter((l) => l.userId !== user.id)
          : [...likes, likeData];
        nextLikesSnapshot = nextLikes;
        return { ...d, likes: nextLikes };
      })
    );
    // 同步更新 previewDoc
    if (previewDoc && previewDoc.id === docId) {
      setPreviewDoc((prev) => {
        if (!prev) return prev;
        const likes = prev.likes || [];
        const alreadyLiked = likes.some((l) => l.userId === user.id);
        return {
          ...prev,
          likes: alreadyLiked
            ? likes.filter((l) => l.userId !== user.id)
            : [...likes, likeData],
        };
      });
    }

    // 流程模板模式：点赞同步到 Supabase（仅对用户文档 doc-* 有效）
    if (
      shouldUseCloudDocs &&
      String(docId).startsWith('doc-') &&
      nextLikesSnapshot
    ) {
      cloudUpdateDoc(docId, { likes: nextLikesSnapshot }).catch((err) => {
        console.warn('[Documents] 云端点赞同步失败:', err);
      });
    }
  };

  // 检查当前用户是否已点赞
  const hasLiked = (doc) => {
    if (!user || !doc.likes) return false;
    return doc.likes.some((l) => l.userId === user.id);
  };

  /* ==========
     智能下载：按优先级处理不同形态的文档
     1) doc.fileUrl：单个原文件（老版本上传）—— 直接触发 <a download>
     2) doc.attachments[]（发布页上传的附件列表）——有几个就逐个触发下载
     3) doc.content（富文本 / Markdown 正文）—— 把正文打包成 .md 或 .html 文件下载
     4) 以上都没有（纯占位示例）—— 给出清晰 toast 提示，避免按钮"静默无反应"
     ========== */
  const triggerDownload = (href, filename) => {
    const a = document.createElement('a');
    a.href = href;
    a.download = filename || '下载';
    // 跨源 blob / dataURL 在新 tab 打开更稳；同源可直接 click
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleDownload = (doc, e) => {
    if (e) e.stopPropagation();
    if (!doc) return;

    // 1) 有主文件
    if (doc.fileUrl) {
      triggerDownload(doc.fileUrl, doc.title);
      return;
    }

    // 2) 有附件列表
    const atts = Array.isArray(doc.attachments) ? doc.attachments.filter((a) => a?.dataUrl || a?.url) : [];
    if (atts.length > 0) {
      // 多个附件时按顺序触发（浏览器会弹"是否允许下载多个文件"一次，之后静默）
      atts.forEach((f, idx) => {
        setTimeout(() => triggerDownload(f.dataUrl || f.url, f.name || `${doc.title}-${idx + 1}`), idx * 150);
      });
      return;
    }

    // 3) 只有正文 content（富文本/Markdown）—— 把正文导出为文件
    const content = typeof doc.content === 'string' ? doc.content.trim() : '';
    if (content) {
      const isMd = doc.format === 'markdown';
      const mime = isMd ? 'text/markdown;charset=utf-8' : 'text/html;charset=utf-8';
      const ext = isMd ? 'md' : 'html';
      // HTML 情况下包装成完整 HTML 文档，确保本地浏览器/Word 打开时能显示样式
      const body = isMd
        ? content
        : `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${doc.title || ''}</title></head><body>${content}</body></html>`;
      const blob = new Blob([body], { type: mime });
      const url = URL.createObjectURL(blob);
      triggerDownload(url, `${doc.title || 'document'}.${ext}`);
      // 释放 blob URL
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      return;
    }

    // 4) 真的没有任何可下载内容
    window.alert('该文档暂无可下载的原文件或正文内容。');
  };

  const openPreview = (doc) => {
    // 增加浏览次数
    setDocuments((prev) =>
      prev.map((d) => (d.id === doc.id ? { ...d, viewCount: (d.viewCount || 0) + 1 } : d))
    );
    setPreviewDoc(doc);
  };

  const closePreview = () => {
    setPreviewDoc(null);
  };

  const canPreview = (doc) => {
    // 1) 外链文件（PDF/图片/Word）可在线预览
    if (doc.fileUrl && ['pdf', 'image', 'docx'].includes(doc.fileType)) return true;
    // 2) 以文本形式输入的文档（Word/HTML 或 Markdown）同样可在线预览
    if (doc.content && String(doc.content).trim().length > 0) return true;
    return false;
  };

  // 文本形式（content）的渲染：根据 format 决定 Markdown 解析还是原样 HTML
  const renderedTextContent = useMemo(() => {
    if (!previewDoc || !previewDoc.content) return '';
    if (previewDoc.format === 'markdown') {
      marked.setOptions({ breaks: true, gfm: true });
      return stripUnderline(marked.parse(stripUnderline(previewDoc.content)));
    }
    // word 格式本身就是 HTML，原样返回（清掉下划线）
    return stripUnderline(previewDoc.content);
  }, [previewDoc]);

  const FileIcon = ({ fileType, size = 24 }) => {
    const Icon = fileTypeIcons[fileType] || FileText;
    return <Icon size={size} />;
  };

  return (
    <div className="documents-page">
      <div className="container">
        <div className="documents-page__header">
          <div>
            <h1>
              <FolderOpen size={28} /> <EditableText
                value={customTitle || dc.pageTitle}
                onChange={(v) => updateDocs('pageTitle', v)}
                configKey={`${sectionKey}.pageTitle`}
                as="span"
              />
            </h1>
            <p><EditableText
              value={customDesc || dc.pageDesc}
              onChange={(v) => updateDocs('pageDesc', v)}
              configKey={`${sectionKey}.pageDesc`}
              as="span"
            /></p>
          </div>
          {configSection === 'processTemplates' ? (
            // 流程模板：新窗口打开独立发布页（支持 Markdown/Word/附件）
            // 文案与普通文档页共享 internalConfig.documents.uploadBtn，
            // 因为本页 internalConfig.processTemplates 分片里并没有 uploadBtn 字段，
            // 若直接读 dc.uploadBtn 会得到 undefined，EditableText 就会渲染成空字符串
            // ——也就是之前看到的「按钮只剩加号，文字丢失」现象。
            <a
              href="/internal/process-templates/create"
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-primary"
            >
              <Plus size={18} />
              <EditableText
                value={internalConfig.documents?.uploadBtn || '上传文档'}
                onChange={(v) => updateInternalConfig({ documents: { uploadBtn: v } })}
                configKey="documents.uploadBtn"
                as="span"
              />
            </a>
          ) : (
            <button
              className="btn btn-primary"
              onClick={() => setShowUpload(!showUpload)}
            >
              {showUpload ? <X size={18} /> : <Plus size={18} />}
              {showUpload ? '取消' : <EditableText
                value={dc.uploadBtn || '上传文档'}
                onChange={(v) => updateDocs('uploadBtn', v)}
                configKey="documents.uploadBtn"
                as="span"
              />}
            </button>
          )}
        </div>

        {/* Upload Form — 仅在行内上传模式下显示 */}
        {showUpload && configSection !== 'processTemplates' && (
          <div className="documents-upload card">
            <h3>
              <Upload size={18} /> 上传新文档
            </h3>
            <form onSubmit={handleAddDocument} className="documents-upload__form">
              {/* 拖拽上传区域 */}
              <div
                className={`documents-upload__dropzone ${isDragOver ? 'documents-upload__dropzone--active' : ''} ${selectedFile ? 'documents-upload__dropzone--has-file' : ''}`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  onChange={handleFileSelect}
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png,.gif,.webp"
                  style={{ display: 'none' }}
                />
                {selectedFile ? (
                  <div className="documents-upload__file-info">
                    <FileIcon fileType={inferFileType(selectedFile.name)} size={32} />
                    <div>
                      <p className="documents-upload__file-name">{selectedFile.name}</p>
                      <p className="documents-upload__file-size">{formatSize(selectedFile.size)}</p>
                    </div>
                    <button
                      type="button"
                      className="documents-upload__file-remove"
                      onClick={(e) => { e.stopPropagation(); setSelectedFile(null); }}
                    >
                      <X size={16} />
                    </button>
                  </div>
                ) : (
                  <div className="documents-upload__dropzone-content">
                    <UploadCloud size={36} />
                    <p>拖拽文件到此处，或点击选择文件</p>
                    <span>支持 PDF、Word、Excel、PPT、图片等格式</span>
                  </div>
                )}
              </div>

              <div className="documents-upload__row">
                <div className="documents-upload__field">
                  <label>文档标题</label>
                  <input
                    type="text"
                    value={newDoc.title}
                    onChange={(e) => setNewDoc({ ...newDoc, title: e.target.value })}
                    placeholder="请输入文档标题"
                    className="documents-upload__input"
                    required
                  />
                </div>
                <div className="documents-upload__field">
                  <label>文档类型</label>
                  <CustomSelect
                    value={newDoc.type}
                    onChange={(val) => setNewDoc({ ...newDoc, type: val })}
                    options={Object.entries(typeLabels)
                      .filter(([key]) => !filterTypes || filterTypes.includes(key))
                      .map(([key, label]) => ({
                        value: key,
                        label,
                      }))}
                  />
                </div>
              </div>
              {/* 贡献者（多选）——支持文档迁移：上传者本人 ≠ 贡献者，可选多人 */}
              <div className="documents-upload__field">
                <label>贡献者（可多选）</label>
                <CustomSelect
                  multiple
                  searchable
                  searchPlaceholder="搜索成员（支持中文/拼音/首字母）"
                  value={contributorIds}
                  onChange={(vals) => setContributorIds(vals)}
                  placeholder="请选择贡献者"
                  options={(() => {
                    // 候选项 = 所有注册成员 ∪ 当前用户本人（兜底）。
                    // 之前这里过滤了 u.authorized === true，导致：
                    //   1) 文档迁移场景下，历史贡献者还没走完授权流程就选不到；
                    //   2) authorized 字段类型漂移（布尔 / 字符串 'true' / 1 都真实出现过）
                    //      会把合法已授权成员也挡掉，表现为"只看得到自己"。
                    // 放宽到全部 getAllUsers() 结果即可——UserManagement 的授权控制依然有效，
                    // 只是"能否被列为贡献者"与"能否登录后台"解耦。
                    // CustomSelect 内部 pinyinMatch 支持中文 / 拼音全拼 / 首字母三种搜索。
                    const seen = new Set();
                    const opts = [];
                    const pushUser = (u) => {
                      if (!u?.id || seen.has(u.id)) return;
                      seen.add(u.id);
                      opts.push({
                        value: u.id,
                        label: u.name || u.nickname || u.email || u.id,
                      });
                    };
                    if (user) pushUser(user);
                    allUsers.forEach(pushUser);
                    return opts;
                  })()}
                />
              </div>
              <div className="documents-upload__field">
                <label>描述</label>
                <textarea
                  value={newDoc.description}
                  onChange={(e) => setNewDoc({ ...newDoc, description: e.target.value })}
                  placeholder="简要描述文档内容"
                  className="documents-upload__input documents-upload__textarea"
                  rows={3}
                />
              </div>
              <button type="submit" className="btn btn-primary">
                <Upload size={16} /> 确认上传
              </button>
            </form>
          </div>
        )}

        {/* Filters */}
        <div className="documents-filters">
          <div className="documents-filters__search">
            <Search size={18} className="documents-filters__icon" />
            <input
              type="text"
              placeholder="搜索文档..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="documents-filters__input"
            />
          </div>
          <div className="documents-filters__types">
            {/*
              管理分类的三个入口（新增 / 重命名 / 删除）原先只在 WYSIWYG
              编辑模式(editing)下显示，普通管理员打开页面看不到\"添加分类\"
              按钮，体验上像\"无法自定义\"。
              现在把这三个入口的显示条件从 `editing` 改为 `isAdmin`：
                - 只要是管理员就能直接在本页管理筛选分类；
                - EditableText（页面标题 / 描述 / 按钮文案）仍然只有在
                  editing 下才可编辑，避免普通操作时误改页面文案。
              仅管理员生效，普通成员看到的始终是只读分类条。
            */}
            {types.map((type) => (
              <div key={type} className="documents-filters__type-wrapper">
                {isAdmin && renamingType === type && type !== '全部' ? (
                  <div className="documents-filters__rename">
                    <input
                      type="text"
                      className="documents-filters__rename-input"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRenameType(type);
                        if (e.key === 'Escape') { setRenamingType(null); setRenameValue(''); }
                      }}
                      autoFocus
                      /* 宽度跟随文字长度（自适应 chip）：
                         用户反馈"编辑筛选项时胶囊一直是固定宽度，文字变长就
                         和下面的内容重叠，手机端电脑端都有"。根因是 CSS 里
                         .documents-filters__rename-input 写死了 width: 120px。
                         这里用原生 <input size> 属性（以字符数为单位，近似
                         按当前字号撑宽度），配合 CSS 里 width: auto 让它
                         真正按 size 展开。min 8 字符兜底，避免空值时塌成极窄。
                         +2 给中英文混排留呼吸；中文在 size 单位下会略偏窄，
                         +2 的富余能把中文标题撑完整。 */
                      size={Math.max(8, renameValue.length + 2)}
                    />
                    <button
                      className="documents-filters__rename-confirm"
                      onClick={() => handleRenameType(type)}
                      disabled={!renameValue.trim()}
                      title="确认"
                    >
                      <CheckCircle2 size={14} />
                    </button>
                    <button
                      className="documents-filters__rename-cancel"
                      onClick={() => { setRenamingType(null); setRenameValue(''); }}
                      title="取消"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <button
                    className={`documents-filters__type ${
                      (type === '全部' ? selectedTypes.length === 0 : selectedTypes.includes(type))
                        ? 'documents-filters__type--active'
                        : ''
                    }`}
                    onClick={() => {
                      if (type === '全部') setSelectedTypes([]);
                      else {
                        setSelectedTypes((prev) => (
                          prev.includes(type) ? prev.filter((item) => item !== type) : [...prev, type]
                        ));
                      }
                    }}
                  >
                    {type === '全部' ? '全部' : typeLabels[type] || type}
                  </button>
                )}
                {isAdmin && type !== '全部' && renamingType !== type && (
                  <div className="documents-filters__type-actions">
                    <button
                      className="documents-filters__type-edit"
                      onClick={(e) => { e.stopPropagation(); setRenamingType(type); setRenameValue(typeLabels[type] || type); }}
                      title="重命名"
                    >
                      <Edit3 size={12} />
                    </button>
                    <button
                      className="documents-filters__type-delete"
                      onClick={(e) => { e.stopPropagation(); handleDeleteType(type); }}
                      title="删除分类"
                    >
                      <X size={12} />
                    </button>
                  </div>
                )}
              </div>
            ))}
            {isAdmin && (
              showAddType ? (
                <div className="documents-filters__add-type">
                  <input
                    type="text"
                    className="documents-filters__add-input"
                    placeholder="新分类名称"
                    value={newTypeLabel}
                    onChange={(e) => setNewTypeLabel(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleAddType();
                      if (e.key === 'Escape') { setShowAddType(false); setNewTypeLabel(''); }
                    }}
                    autoFocus
                  />
                  <button
                    className="documents-filters__add-confirm"
                    onClick={handleAddType}
                    disabled={!newTypeLabel.trim()}
                    title="确认添加"
                  >
                    <CheckCircle2 size={14} />
                  </button>
                  <button
                    className="documents-filters__add-cancel"
                    onClick={() => { setShowAddType(false); setNewTypeLabel(''); }}
                    title="取消"
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <button
                  className="documents-filters__type documents-filters__type--add"
                  onClick={() => setShowAddType(true)}
                  title="添加新分类"
                >
                  <Plus size={14} /> 添加分类
                </button>
              )
            )}
          </div>
        </div>

        {/* Documents Grid */}
        <div className="documents-grid">
          {filtered.map((doc) => {
            const handleCardClick = () => {
              // 统一所有文档（流程模板 + 普通文档）都用新窗口全屏查看页，
              // 不再使用悬浮 Modal。ProcessTemplateDetail 页内部已通过 canEdit
              // 控制编辑权限（管理员或本人上传的用户文档可编辑，其余只读）。
              window.open(
                `/internal/process-templates/view/${doc.id}`,
                '_blank',
                'noopener,noreferrer'
              );
            };
            return (
            <div
              key={doc.id}
              className="doc-card card"
              onClick={handleCardClick}
            >
              {/* 顶部色条 */}
              <div
                className="doc-card__accent"
                style={{ background: typeColors[doc.type] }}
              />

              {/* 信息区 */}
              <div className="doc-card__body">
                <div className="doc-card__top">
                  <span
                    className="doc-card__type-badge"
                    style={{ color: typeColors[doc.type], background: `${typeColors[doc.type]}15` }}
                  >
                    {typeLabels[doc.type]}
                  </span>
                </div>

                <h4 className="doc-card__title">{doc.title}</h4>
                <p className="doc-card__desc">{decodePlainText(doc.description)}</p>

                <div className="doc-card__footer">
                  <span className="doc-card__author">
                    <User size={12} /> 贡献者：{resolveContributors(doc)}
                  </span>
                  <button
                    type="button"
                    className="doc-card__stats views-trigger"
                    onClick={(e) => {
                      // 不能冒泡到卡片本身的打开预览行为
                      e.stopPropagation();
                      setViewLogDoc(doc);
                    }}
                    title="查看所有访问记录"
                  >
                    <Eye size={12} /> {(docViews[doc.id] || 0) + (doc.viewCount || 0)}
                  </button>
                </div>

                <div className="doc-card__meta">
                  <span className="doc-card__meta-item">
                    <Clock size={14} />
                    {doc.date}
                  </span>
                </div>
              </div>

              {/* 底部操作区：点赞 + 操作按钮 */}
              <div className="doc-card__bottom" onClick={(e) => e.stopPropagation()}>
                <div className="doc-card__bottom-left">
                  <button
                    className={`doc-card__like-btn ${hasLiked(doc) ? 'doc-card__like-btn--active' : ''}`}
                    onClick={(e) => handleLike(doc.id, e)}
                    title={hasLiked(doc) ? '取消点赞' : '点赞'}
                  >
                    <ThumbsUp size={14} />
                    <span>{(doc.likes || []).length}</span>
                  </button>
                  {(doc.likes || []).length > 0 && (
                    <div className="doc-card__like-names">
                      {(doc.likes || []).map((like, idx) => (
                        <span key={like.userId} className="doc-card__like-name">
                          {resolveLikeUserName(like)}{idx < (doc.likes || []).length - 1 ? '、' : ''}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="doc-card__bottom-right">
                  <button
                    className="doc-card__action-icon"
                    onClick={(e) => handleDownload(doc, e)}
                    title="下载原文件"
                  >
                    <Download size={14} />
                  </button>
                  {canModify(doc) && (
                    <button
                      className="doc-card__action-icon doc-card__action-icon--danger"
                      onClick={(e) => { e.stopPropagation(); handleDelete(doc.id); }}
                      title="删除"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            </div>
            );
          })}
        </div>

        {cloudLoading && filtered.length === 0 && (
          <div className="documents-grid documents-grid--skeleton" aria-label="正在读取云端文档">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="doc-card doc-card--skeleton card">
                <div className="doc-card__accent" />
                <div className="doc-card__body">
                  <div className="doc-skeleton doc-skeleton--badge" />
                  <div className="doc-skeleton doc-skeleton--title" />
                  <div className="doc-skeleton doc-skeleton--line" />
                  <div className="doc-skeleton doc-skeleton--line doc-skeleton--short" />
                </div>
                <div className="doc-card__bottom">
                  <div className="doc-skeleton doc-skeleton--pill" />
                  <div className="doc-skeleton doc-skeleton--icon" />
                </div>
              </div>
            ))}
          </div>
        )}

        {filtered.length === 0 && !cloudLoading && (
          <div className="documents-list__empty">
            <File size={48} />
            <h3>暂无文档</h3>
            <p>点击"上传文档"按钮添加新文档</p>
          </div>
        )}
      </div>

      {/* Preview Modal */}
      {previewDoc && (
        <div className="doc-preview-overlay" onClick={closePreview}>
          <div className="doc-preview" onClick={(e) => e.stopPropagation()}>
            {/* 预览头部 */}
            <div className="doc-preview__header">
              <button className="doc-preview__back" onClick={closePreview}>
                <ChevronLeft size={20} /> 返回列表
              </button>
              <div className="doc-preview__title-area">
                <h3>{previewDoc.title}</h3>
                <span className="doc-preview__meta">
                  贡献者：{resolveContributors(previewDoc)} · {previewDoc.date} · {previewDoc.size}
                </span>
              </div>
              <div className="doc-preview__header-actions">
                {(previewDoc.fileUrl ||
                  (Array.isArray(previewDoc.attachments) && previewDoc.attachments.length > 0) ||
                  (typeof previewDoc.content === 'string' && previewDoc.content.trim().length > 0)) && (
                  <button
                    className="doc-preview__download"
                    onClick={() => handleDownload(previewDoc)}
                    title="下载原文件"
                  >
                    <Download size={16} /> 下载
                  </button>
                )}
                <button className="doc-preview__close" onClick={closePreview}>
                  <X size={20} />
                </button>
              </div>
            </div>

            {/* 预览内容区 */}
            <div className="doc-preview__content" ref={docContentRef}>
              {/* 优先：以文本形式输入的正文（Markdown / Word-HTML） */}
              {previewDoc.content && String(previewDoc.content).trim().length > 0 ? (
                <div className="doc-preview__text">
                  <div
                    className={`doc-preview__text-body ${
                      previewDoc.format === 'markdown'
                        ? 'doc-preview__text-body--markdown'
                        : 'doc-preview__text-body--word'
                    }`}
                    dangerouslySetInnerHTML={{ __html: renderedTextContent }}
                  />

                  {/* 附件列表（有附件时一并展示，仍可下载） */}
                  {Array.isArray(previewDoc.attachments) && previewDoc.attachments.length > 0 && (
                    <div className="doc-preview__attachments">
                      <div className="doc-preview__attachments-header">
                        <Paperclip size={16} />
                        <span>附件（{previewDoc.attachments.length}）</span>
                      </div>
                      <ul className="doc-preview__attachments-list">
                        {previewDoc.attachments.map((f) => (
                          <li key={f.id || f.name} className="doc-preview__attachments-item">
                            <FileText size={16} />
                            <span className="doc-preview__attachments-name">{f.name}</span>
                            {typeof f.size === 'number' && (
                              <span className="doc-preview__attachments-size">
                                {f.size < 1024
                                  ? `${f.size} B`
                                  : f.size < 1024 * 1024
                                    ? `${(f.size / 1024).toFixed(1)} KB`
                                    : `${(f.size / (1024 * 1024)).toFixed(1)} MB`}
                              </span>
                            )}
                            {(f.dataUrl || f.url) && (
                              <a
                                className="doc-preview__attachments-download"
                                href={f.dataUrl || f.url}
                                download={f.name}
                              >
                                <Download size={14} /> 下载
                              </a>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* 文本型文档也提供整体评论 */}
                  <TextAnnotation
                    targetType="document"
                    targetId={previewDoc.id}
                    contentRef={docContentRef}
                    disabled
                  />
                </div>
              ) : canPreview(previewDoc) ? (
                previewDoc.fileType === 'pdf' ? (
                  <>
                    <iframe
                      src={previewDoc.fileUrl}
                      className="doc-preview__pdf"
                      title={previewDoc.title}
                    />
                    {/* PDF 内无法划词，提供整体评论 */}
                    <TextAnnotation
                      targetType="document"
                      targetId={previewDoc.id}
                      contentRef={docContentRef}
                      disabled
                    />
                  </>
                ) : previewDoc.fileType === 'image' ? (
                  <>
                    <div className="doc-preview__image-wrapper">
                      <img
                        src={previewDoc.fileUrl}
                        alt={previewDoc.title}
                        className="doc-preview__image"
                      />
                    </div>
                    {/* 图片无法划词，提供整体评论 */}
                    <TextAnnotation
                      targetType="document"
                      targetId={previewDoc.id}
                      contentRef={docContentRef}
                      disabled
                    />
                  </>
                ) : previewDoc.fileType === 'docx' ? (
                  /* Word 文档：mammoth 转 HTML，支持划词评论 */
                  <WordPreview
                    fileUrl={previewDoc.fileUrl}
                    docId={previewDoc.id}
                    title={previewDoc.title}
                  />
                ) : null
              ) : (
                <div className="doc-preview__no-preview">
                  <FileIcon fileType={previewDoc.fileType} size={64} />
                  <h3>{previewDoc.title}</h3>
                  <p className="doc-preview__no-preview-desc">{decodePlainText(previewDoc.description)}</p>
                  <div className="doc-preview__no-preview-info">
                    <span><Clock size={14} /> 上传日期: {previewDoc.date}</span>
                    <span><User size={14} /> 贡献者：{resolveContributors(previewDoc)}</span>
                    <span><HardDrive size={14} /> 文件大小: {previewDoc.size}</span>
                    <button
                      type="button"
                      className="views-trigger"
                      onClick={() => setViewLogDoc(previewDoc)}
                      title="查看所有访问记录"
                    >
                      <BarChart3 size={14} /> 浏览次数: {(docViews[previewDoc.id] || 0) + (previewDoc.viewCount || 0)}
                    </button>
                  </div>
                  {previewDoc.fileUrl ? (
                    <p className="doc-preview__no-preview-hint">
                      该文件格式暂不支持在线预览，请下载后使用本地应用打开。
                    </p>
                  ) : (
                    <p className="doc-preview__no-preview-hint">
                      该文档尚未关联文件，请重新上传以启用预览功能。
                    </p>
                  )}
                  {previewDoc.fileUrl && (
                    <button
                      className="btn btn-secondary"
                      onClick={() => handleDownload(previewDoc)}
                    >
                      <Download size={16} /> 下载文件
                    </button>
                  )}
                  {/* 不可预览文档的评论 */}
                  <TextAnnotation
                    targetType="document"
                    targetId={previewDoc.id}
                    contentRef={docContentRef}
                    disabled
                  />
                </div>
              )}
            </div>

            {/* 预览弹窗底部点赞栏 */}
            <div className="doc-preview__footer">
              <button
                className={`doc-preview__like-btn ${hasLiked(previewDoc) ? 'doc-preview__like-btn--active' : ''}`}
                onClick={() => handleLike(previewDoc.id)}
              >
                <ThumbsUp size={16} />
                <span>{hasLiked(previewDoc) ? '已赞' : '点赞'}</span>
              </button>
              {(previewDoc.likes || []).length > 0 && (
                <div className="doc-preview__like-users">
                  <div className="doc-preview__like-names">
                    {(previewDoc.likes || []).map((like, idx) => (
                      <span key={like.userId} className="doc-preview__like-name">
                        {resolveLikeUserName(like)}{idx < (previewDoc.likes || []).length - 1 ? '、' : ''}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 访问记录弹层：点击浏览数小眼睛时弹出 */}
      <ViewLogPopover
        open={Boolean(viewLogDoc)}
        onClose={() => setViewLogDoc(null)}
        totalCount={
          viewLogDoc
            ? (docViews[viewLogDoc.id] || 0) + (viewLogDoc.viewCount || 0)
            : 0
        }
        fetchLog={
          viewLogDoc ? () => fetchViewLog(String(viewLogDoc.id)) : undefined
        }
        resolveName={resolveContributorName}
      />
    </div>
  );
}

function formatSize(bytes) {
  if (!bytes) return '—';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
