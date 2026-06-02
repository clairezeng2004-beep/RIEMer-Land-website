import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { Link, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useSiteContent } from '../../contexts/SiteContentContext';
import { useWysiwyg } from '../../contexts/WysiwygContext';
import { useNotifications } from '../../contexts/NotificationContext';
import { emitNotificationEvent } from '../../lib/notificationRuleEngine';
import EditableText from '../../components/EditableText';
import CustomSelect from '../../components/CustomSelect';
import { articlesData } from '../../data/siteData';
import { getCommentCount } from '../../services/commentService';
import {
  fetchAndParseArticle,
  generateSummaryAI,
  inferCategory,
  inferTags,
  cleanTitle,
} from '../../services/articleService';
import {
  FileText, Search, MessageSquare, Calendar, ArrowRight,
  Plus, Link2, Loader2, X, Check, Tag, AlertCircle,
  ChevronDown, ChevronUp, Pencil, Settings2, Trash2, Palette,
  CheckSquare, Sparkles, Eye, ClipboardPaste, Wand2, ImagePlus,
} from 'lucide-react';
import '../../components/CrossLinkToast.css';
import './InternalArticles.css';
import { fetchSetting, saveSetting, subscribeSetting, SITE_KEYS } from '../../services/siteSettingsService';
import { isSupabaseConfigured } from '../../lib/supabase';
import {
  bindExistingTaskToWorkItem,
  createLinkedTask,
  fetchTasksForLinking,
} from '../../services/taskLinkService';

// ---- 分类管理 ----
const ARTICLE_CATEGORIES_KEY = 'riemer_article_categories';

const PRESET_COLORS = [
  '#5EAD8C', '#4FBFC4', '#EC4899', '#F59E0B', '#8B5CF6',
  '#EF4444', '#3B82F6', '#10B981', '#F97316', '#6366F1',
  '#14B8A6', '#E11D48', '#0EA5E9', '#84CC16', '#A855F7',
];

const DEFAULT_ARTICLE_CATEGORIES = [
  { key: 'riemer-say', label: '听 RIEMer 说系列', color: '#5EAD8C' },
  { key: 'course-review', label: '课程测评', color: '#4FBFC4' },
  { key: 'campus-event', label: '校园活动', color: '#EC4899' },
  { key: 'experience', label: '经验分享', color: '#F59E0B' },
];

const DEFAULT_ARTICLE_TAGS = [
  '保研', '考研', '留学', '求职', '实习', '课程测评',
  '经验分享', '互联网', '金融', '经济学', '学术', '数学建模',
  '辩论赛', '招新',
];

function loadArticleCategories() {
  try {
    const stored = localStorage.getItem(ARTICLE_CATEGORIES_KEY);
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return DEFAULT_ARTICLE_CATEGORIES;
}

function saveArticleCategories(data) {
  localStorage.setItem(ARTICLE_CATEGORIES_KEY, JSON.stringify(data));
}

// ---- 封面图片上传 ----
// 封面直接存 base64 Data URL，随文章的 coverImage/cover_image 字段一起保存。
// 限制 2MB，避免单条记录过大撑爆 localStorage / 云端字段。
const COVER_MAX_SIZE = 2 * 1024 * 1024;

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// 读取并校验封面图片，返回 Data URL；不合法时 alert 并返回 null
async function readCoverImage(file) {
  if (!file) return null;
  if (!file.type || !file.type.startsWith('image/')) {
    alert('请选择图片文件（jpg / png / webp 等）');
    return null;
  }
  if (file.size > COVER_MAX_SIZE) {
    alert('封面图片需小于 2MB，请压缩后再上传');
    return null;
  }
  try {
    return await fileToDataUrl(file);
  } catch {
    alert('图片读取失败，请重试');
    return null;
  }
}

// 双写：本地 + 云端（site_settings.article_categories），便于跨设备同步
// lastSyncRef 用于记录最近一次自己 push 的 updated_at，订阅回流时可据此跳过
//
// ⚠️ 失败必须显式提示（与 EventPublish 的 persistEventCategories 对齐）：
//   历史版本是 fire-and-forget 且只 console.warn —— 用户在 A 设备新增/删除/
//   改名分类，saveSetting 因网络抖动 / RLS 拒绝 / 表不存在等原因失败时，
//   本机 UI 已经按"操作成功"把 Tab 更新完了，云端却什么都没写；B 设备
//   刷新或实时订阅都收不到变化，用户反馈就是"公众号文章归档 Tab 跨设备
//   不同步"。改为 alert 显式提示，让用户第一时间知道需要重试。
//
// 函数本身仍是 async，但上层调用处大多没有 await —— 只要失败分支弹了 alert，
// 用户就能知情；改成全链路 await 会传染大量 handler 签名，性价比不高。
async function persistCategories(data, lastSyncRef) {
  saveArticleCategories(data);
  if (!isSupabaseConfigured) return { success: true, offline: true };
  const res = await saveSetting(SITE_KEYS.ARTICLE_CATEGORIES, data);
  if (res.success && lastSyncRef) {
    lastSyncRef.current = res.updatedAt;
  } else if (!res.success) {
    console.warn('[InternalArticles] 分类云端同步失败:', res.error);
    try {
      alert(
        `文章分类保存到云端失败：${res.error || '未知错误'}\n` +
        `改动已保存到本设备本地，但其它设备暂时看不到，请检查网络后重试。`,
      );
    } catch { /* SSR 或无 window 环境下忽略 */ }
  }
  return res;
}

function buildCategoryMaps(cats) {
  const labels = {};
  const colors = {};
  cats.forEach((c) => {
    labels[c.label] = c.label;
    colors[c.label] = c.color;
  });
  return { labels, colors };
}

// ==========================================================
//  批量粘贴解析：公众号后台复制的阅读量文本 → { 阅读数, 文本 }
// ==========================================================
//
// 典型可粘贴格式（多种来源都兼容）：
//   1) 每行一条：标题 + 数字；数字可带千分位逗号
//        "春日随笔                      1,234"
//        "清明诗歌会实录   2026-04-10    890"
//   2) 表格复制（Excel/网页表格）：以 Tab 分隔或多空格分隔
//        "春日随笔\t2026-04-15\t1234\t890"
//   3) 多行合并：用户手动粘贴后换行符可能丢失 → 按"标题-数字"对尝试
//
// 策略：
//   - 按行切
//   - 每行从中抽所有数字（带逗号），取其中 **最大值** 作为阅读数
//     （避免把日期里的 "2026"、"04" 当阅读数，通常阅读数更大；
//      若阅读数确实 < 年份则用户自己改）
//   - 剔除明显不是标题的字符（日期、纯数字、Tab 等）后，剩余文本作为"标题候选"
// 返回：[{ rawLine, titleText, readNum }]
function parseReadNumsFromPaste(text) {
  if (!text || typeof text !== 'string') return [];
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const rows = [];
  for (const line of lines) {
    // 1. 抽出所有"带千分位/纯数字"的 token
    const numberTokens = line.match(/\d{1,3}(?:,\d{3})+|\d+/g) || [];
    if (numberTokens.length === 0) continue;

    // 2. 转成整数，过滤像年份(1900~2100)这种明显是日期的 → 用不到可忽略
    const numbers = numberTokens
      .map((t) => parseInt(t.replace(/,/g, ''), 10))
      .filter((n) => Number.isFinite(n) && n >= 0);

    if (numbers.length === 0) continue;

    // 3. 优先取 "不像年份/月份" 的最大值
    //    年份：1900-2099；月/日：1-31；阅读数通常要么 < 31 要么远大于 2099
    //    简单规则：取最大值，但若最大值落在 [1900, 2099] 且还有其它候选，换第二大
    let readNum = Math.max(...numbers);
    if (numbers.length > 1 && readNum >= 1900 && readNum <= 2099) {
      const others = numbers.filter((n) => n !== readNum);
      const second = Math.max(...others);
      if (second >= 0) readNum = second;
    }

    // 4. 剔除数字 token + 常见日期格式 → 剩下的是标题候选
    let titleText = line;
    numberTokens.forEach((t) => {
      titleText = titleText.split(t).join(' ');
    });
    // 去掉 "YYYY-MM-DD" / "YYYY/MM/DD" / "MM-DD" 这类残留连字符
    titleText = titleText
      .replace(/[-/.]+/g, ' ')
      .replace(/\t+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!titleText) continue;

    rows.push({ rawLine: line, titleText, readNum });
  }
  return rows;
}

// 模糊匹配：粘贴行的"标题文本" → 已归档文章
//   - 归一化：去标点、去空白、小写
//   - 包含关系（任一方包含另一方即算匹配）
//   - 返回第一个命中的 article.id，否则 null
function findMatchingArticleId(titleText, articles) {
  const normalize = (s) =>
    (s || '')
      .toLowerCase()
      .replace(/[\s\u3000]+/g, '')
      .replace(/[·・,.，。、!?！？:：;；'"'""()（）\[\]【】《》<>]/g, '');

  const needle = normalize(titleText);
  if (!needle) return null;

  // 先找完全相等 / 包含命中
  for (const a of articles) {
    const hay = normalize(a.title);
    if (!hay) continue;
    if (hay === needle || hay.includes(needle) || needle.includes(hay)) {
      return a.id;
    }
  }
  return null;
}

export default function InternalArticles() {
  const { isAuthenticated, isAdmin, user } = useAuth();
  const {
    userArticles, addArticle, updateArticle, internalConfig, updateInternalConfig,
    filterOptions,
  } = useSiteContent();
  const { addNotification } = useNotifications();
  const { editing } = useWysiwyg();
  const navigate = useNavigate();
  const location = useLocation();
  // 跨模块预填（来自 Tasks 页的 navigate state）的缓存——
  // 会在 showModal 声明之后的 useEffect 里消费。
  const [pendingWorkItemId, setPendingWorkItemId] = useState(null);
  const [pendingSuggestedTitle, setPendingSuggestedTitle] = useState('');
  const ia = internalConfig.internalArticles || {};
  const updateIA = useCallback((key, val) => updateInternalConfig({ internalArticles: { [key]: val } }), [updateInternalConfig]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('全部');

  // ---- 分类管理状态 ----
  const [categoryList, setCategoryList] = useState(loadArticleCategories);
  const { labels: categoryLabels, colors: categoryColors } = buildCategoryMaps(categoryList);
  const [showCatManager, setShowCatManager] = useState(false);
  const [newCatLabel, setNewCatLabel] = useState('');
  const [newCatColor, setNewCatColor] = useState(PRESET_COLORS[0]);
  const [editingCatKey, setEditingCatKey] = useState(null);
  const [editCatLabel, setEditCatLabel] = useState('');
  const [editCatColor, setEditCatColor] = useState('');
  // 普通成员"新增筛选"弹窗
  const [showAddCatModal, setShowAddCatModal] = useState(false);
  const [quickCatLabel, setQuickCatLabel] = useState('');
  const [quickCatColor, setQuickCatColor] = useState(PRESET_COLORS[0]);
  const [quickCatError, setQuickCatError] = useState('');
  // 管理员：就地新增分类（对齐流程模板文件页的"+添加分类"体验，管理员不必先打开面板）
  const [showInlineAddCat, setShowInlineAddCat] = useState(false);

  // 记录本设备最近一次 push 的 updated_at，避免 realtime 回流覆盖自己
  const lastCatSyncRef = useRef(null);

  // 挂载时从云端拉取一次，并订阅变更（跨设备同步）
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;

    fetchSetting(SITE_KEYS.ARTICLE_CATEGORIES).then(({ value, updatedAt, error }) => {
      if (cancelled || error) return;
      // ⚠️ 允许空数组（[]）原样覆盖本地：代表用户在其它设备把分类全部删了。
      // 以前这里写的是 `value.length > 0` —— 只要云端是 []（全删状态），B 设备
      // 就会以为"云端没数据"而保留本地默认的 4 个预置分类；然后 B 设备任何一次
      // 对分类的修改都会把"本地默认 + 这次新增"整体回推云端，等于把 A 设备的
      // 删除动作撤销了，跨设备完全失配。这里只要是合法数组就以云端为准。
      if (Array.isArray(value)) {
        lastCatSyncRef.current = updatedAt;
        setCategoryList(value);
        saveArticleCategories(value);
      }
    });

    const unsub = subscribeSetting(SITE_KEYS.ARTICLE_CATEGORIES, (value, updatedAt) => {
      if (updatedAt && lastCatSyncRef.current === updatedAt) return; // 自己的回流，跳过
      // 同上：realtime 推来的空数组也要原样应用，不能被丢弃。
      if (!Array.isArray(value)) return;
      lastCatSyncRef.current = updatedAt;
      setCategoryList(value);
      saveArticleCategories(value);
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  // ---- 新建归档弹窗状态 ----
  const [showModal, setShowModal] = useState(false);
  // 流程：'input'（输入链接 + 抓取中）→ 'confirm'（确认信息）
  // 抓取阶段不再用独立 step，按钮自身 loading 即可
  const [step, setStep] = useState('input'); // 'input' | 'confirm'
  const [urlInput, setUrlInput] = useState('');
  const [fetchError, setFetchError] = useState('');
  const [fetching, setFetching] = useState(false);

  // 跨模块预填：Tasks 页弹窗 / 未闭环清单带 workItemId + suggestedTitle 跳过来时，
  // 在这里消费一次 navigate state：自动打开新建弹窗，并缓存 workItemId / 建议标题
  // 等用户抓取完成后写入。读完立即把 state 清空，避免刷新或再次进入时重复触发。
  useEffect(() => {
    const s = location.state;
    if (!s || typeof s !== 'object') return;
    if (!s.workItemId && !s.suggestedTitle) return;
    if (s.workItemId) setPendingWorkItemId(s.workItemId);
    if (s.suggestedTitle) setPendingSuggestedTitle(s.suggestedTitle);
    setShowModal(true);
    setStep('input');
    navigate(location.pathname, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // AI 摘要生成状态（仅在确认页使用）
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');

  // 抓取后的文章数据（待确认）
  const [draft, setDraft] = useState(null);
  // 用户可编辑的标签
  const [editTags, setEditTags] = useState([]);
  const [editTitle, setEditTitle] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [confirmNewCategory, setConfirmNewCategory] = useState('');
  const [editExcerpt, setEditExcerpt] = useState('');
  const [showTagsEditor, setShowTagsEditor] = useState(true);
  // 跨模块联动提示
  const [taskPrompt, setTaskPrompt] = useState(null);
  const [taskLinkMode, setTaskLinkMode] = useState('none');
  const [linkableTasks, setLinkableTasks] = useState([]);
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [newLinkedTaskTitle, setNewLinkedTaskTitle] = useState('');
  const [syncNewTaskTitle, setSyncNewTaskTitle] = useState(true);
  const [taskLinkError, setTaskLinkError] = useState('');

  // ---- 已归档文章编辑弹窗状态 ----
  const [editingArchive, setEditingArchive] = useState(null);
  const [archiveEditCategory, setArchiveEditCategory] = useState('');
  const [archiveNewCategory, setArchiveNewCategory] = useState('');
  const [archiveEditTags, setArchiveEditTags] = useState([]);

  // ---- 批量阅读量录入弹窗 ----
  const [showReadNumModal, setShowReadNumModal] = useState(false);
  // { [articleId]: string }  保存用户输入的字符串，方便校验
  const [readNumDraft, setReadNumDraft] = useState({});
  const [readNumSaving, setReadNumSaving] = useState(false);
  const [readNumSaved, setReadNumSaved] = useState(false);

  // ---- 从公众号后台批量粘贴导入 ----
  const [showPastePanel, setShowPastePanel] = useState(false);
  const [pasteText, setPasteText] = useState('');
  // 解析结果：{ matched: [{id,title,readNum}], unmatched: [{titleText,readNum}] }
  const [pasteResult, setPasteResult] = useState(null);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  const allArticles = useMemo(
    () => [...userArticles, ...articlesData].sort((a, b) => b.date.localeCompare(a.date)),
    [userArticles]
  );

  const archivedArticleIds = useMemo(
    () => new Set(userArticles.map((article) => article.id)),
    [userArticles],
  );

  // ---- 异步批量加载每篇文章的评论数 ----
  const [commentCounts, setCommentCounts] = useState({});
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ids = allArticles.map((a) => a.id);
      const entries = await Promise.all(
        ids.map(async (id) => {
          try {
            const n = await getCommentCount('article', id);
            return [id, n];
          } catch {
            return [id, 0];
          }
        }),
      );
      if (!cancelled) {
        setCommentCounts(Object.fromEntries(entries));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [allArticles]);

  // 从所有文章中提取已有标签（按频次降序，用于标签建议）
  const existingTags = useMemo(() => {
    const tagCount = {};
    allArticles.forEach((a) => {
      (a.tags || []).forEach((t) => {
        tagCount[t] = (tagCount[t] || 0) + 1;
      });
    });
    return Object.entries(tagCount)
      .sort((a, b) => b[1] - a[1])
      .map(([tag, count]) => ({ tag, count }));
  }, [allArticles]);

  const articleTagOptions = useMemo(() => {
    const tags = [
      ...DEFAULT_ARTICLE_TAGS,
      ...existingTags.map(({ tag }) => tag),
      ...editTags,
      ...archiveEditTags,
    ];
    return [...new Set(tags.filter(Boolean))]
      .map((tag) => ({ value: tag, label: tag }));
  }, [archiveEditTags, editTags, existingTags]);

  const articleTaskOptions = useMemo(() => {
    const usedWorkItemIds = new Set(
      userArticles.map((article) => article.workItemId).filter(Boolean),
    );
    return linkableTasks.filter((task) => {
      if (!task) return false;
      if (task.workItemKind && task.workItemKind !== 'article') return false;
      if (task.workItemId && usedWorkItemIds.has(task.workItemId)) return false;
      return true;
    });
  }, [linkableTasks, userArticles]);

  useEffect(() => {
    if (!showModal || step !== 'confirm') return;
    let cancelled = false;
    fetchTasksForLinking().then((tasks) => {
      if (!cancelled) setLinkableTasks(tasks || []);
    });
    return () => { cancelled = true; };
  }, [showModal, step]);

  useEffect(() => {
    if (!syncNewTaskTitle) return;
    setNewLinkedTaskTitle(editTitle || draft?.title || pendingSuggestedTitle || '');
  }, [syncNewTaskTitle, editTitle, draft?.title, pendingSuggestedTitle]);

  // 合并持久化分类 + 文章中动态提取的分类（去重）
  const categories = useMemo(() => {
    const managedLabels = new Set(categoryList.map((c) => c.label));
    const dynamicCats = allArticles
      .map((a) => a.category)
      .filter((cat) => cat && !managedLabels.has(cat));
    const uniqueDynamic = [...new Set(dynamicCats)];
    return ['全部', ...categoryList.map((c) => c.label), ...uniqueDynamic];
  }, [allArticles, categoryList]);

  const articleCategoryOptions = useMemo(() => {
    const options = categories
      .filter((cat) => cat && cat !== '全部')
      .map((cat) => ({ value: cat, label: cat }));
    return [{ value: '', label: '无分类' }, ...options, { value: '__new__', label: '＋ 新建分类…' }];
  }, [categories]);

  const seriesTitlePrefixes = useMemo(
    () => categoryList.map((cat) => cat.label).filter((label) => label && label.includes('系列')),
    [categoryList],
  );

  // ---- 分类 CRUD ----
  const handleAddCategory = () => {
    const label = newCatLabel.trim();
    if (!label) return;
    if (categoryList.some((c) => c.label === label)) {
      alert('该分类名称已存在');
      return;
    }
    const key = 'acat_' + Date.now();
    const updated = [...categoryList, { key, label, color: newCatColor }];
    setCategoryList(updated);
    persistCategories(updated, lastCatSyncRef);
    setNewCatLabel('');
    setNewCatColor(PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)]);
  };

  const startEditCategory = (cat) => {
    // cat 可能是 categoryList 里的托管项（有 key/color），
    // 也可能是从文章 article.category 动态派生的"裸 label"（没 key，构造一个 __dyn__ 占位 key）
    setEditingCatKey(cat.key);
    setEditCatLabel(cat.label);
    setEditCatColor(cat.color || PRESET_COLORS[0]);
  };

  const saveEditCategory = async () => {
    const nextLabel = editCatLabel.trim();
    if (!nextLabel) return;

    // 找到当前被编辑的分类（托管分类走 key 匹配；动态派生分类 key 以 __dyn__ 打头）
    const isDynamic = typeof editingCatKey === 'string' && editingCatKey.startsWith('__dyn__');
    const managed = !isDynamic ? categoryList.find((c) => c.key === editingCatKey) : null;
    // 改名前的旧 label（用于同步更新 article.category）
    const prevLabel = isDynamic
      ? editingCatKey.slice('__dyn__'.length)
      : managed?.label;

    if (!prevLabel) { setEditingCatKey(null); return; }

    // 重名校验（和其他分类冲突时拒绝）
    const clash =
      (nextLabel !== prevLabel) &&
      (
        categoryList.some((c) => c.label === nextLabel && c.key !== editingCatKey) ||
        allArticles.some((a) => a.category === nextLabel && a.category !== prevLabel)
      );
    if (clash) {
      alert('该分类名称已存在');
      return;
    }

    // 1) 更新/补齐 categoryList
    if (managed) {
      // 托管分类：原地改名 + 可选的 color
      const updated = categoryList.map((c) =>
        c.key === editingCatKey ? { ...c, label: nextLabel, color: editCatColor } : c,
      );
      setCategoryList(updated);
      persistCategories(updated, lastCatSyncRef);
    } else if (isDynamic) {
      // 动态派生分类被改名：把这个 label 正式"领养"进 categoryList，
      // 这样下次就能直接作为托管分类参与批量管理
      const key = 'acat_' + Date.now();
      const updated = [...categoryList, { key, label: nextLabel, color: editCatColor }];
      setCategoryList(updated);
      persistCategories(updated, lastCatSyncRef);
    }

    // 2) 同步改写所有旧 label 的文章 article.category（托管 & 派生都要做，
    //    这样筛选项、文章明细上的分类标签才会真正改名）
    if (nextLabel !== prevLabel) {
      const affected = allArticles.filter((a) => a.category === prevLabel);
      await Promise.all(
        affected.map((a) => updateArticle(a.id, { category: nextLabel })),
      );
      // 如果当前选中的正是被改名的分类，把选中项同步切到新名
      if (selectedCategory === prevLabel) setSelectedCategory(nextLabel);
    }

    setEditingCatKey(null);
  };

  // 通过 label 删除分类（既适用于托管分类，也适用于动态派生分类）
  const handleDeleteCategoryByLabel = async (label) => {
    if (!label) return;
    const managed = categoryList.find((c) => c.label === label);
    const affected = allArticles.filter((a) => a.category === label);
    const msg = affected.length > 0
      ? `确定要删除分类「${label}」吗？\n该分类下有 ${affected.length} 篇文章，删除后这些文章的分类会被清空（文章本身保留）。`
      : `确定要删除分类「${label}」吗？`;
    if (!window.confirm(msg)) return;

    // 1) 从 categoryList 中移除（如果是托管项）
    if (managed) {
      const updated = categoryList.filter((c) => c.key !== managed.key);
      setCategoryList(updated);
      persistCategories(updated, lastCatSyncRef);
    }
    // 2) 把所有引用该分类的文章 category 清空，使派生分类真正消失
    await Promise.all(
      affected.map((a) => updateArticle(a.id, { category: '' })),
    );
    if (selectedCategory === label) setSelectedCategory('全部');
  };

  // 旧签名（按 key 删）保留给齿轮面板等已有调用点，内部委托到 byLabel
  const handleDeleteCategory = (key) => {
    const cat = categoryList.find((c) => c.key === key);
    if (!cat) return;
    handleDeleteCategoryByLabel(cat.label);
  };

  // ---- 普通成员快速新增分类（所有登录成员可用） ----
  const openAddCatModal = () => {
    setQuickCatLabel('');
    setQuickCatColor(PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)]);
    setQuickCatError('');
    setShowAddCatModal(true);
  };

  const closeAddCatModal = () => {
    setShowAddCatModal(false);
    setQuickCatError('');
  };

  const handleQuickAddCategory = () => {
    const label = quickCatLabel.trim();
    if (!label) {
      setQuickCatError('请输入分类名称');
      return;
    }
    // 同时查"已管理"和"动态派生（来自文章 category）"，避免重复
    if (categoryList.some((c) => c.label === label) || categories.includes(label)) {
      setQuickCatError('该分类名称已存在');
      return;
    }
    const key = 'acat_' + Date.now();
    const updated = [...categoryList, { key, label, color: quickCatColor }];
    setCategoryList(updated);
    persistCategories(updated, lastCatSyncRef);
    setSelectedCategory(label); // 新增后自动选中
    closeAddCatModal();
  };

  const filtered = useMemo(() => {
    return allArticles.filter((a) => {
      const matchesSearch =
        !searchTerm ||
        a.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        a.excerpt.toLowerCase().includes(searchTerm.toLowerCase()) ||
        a.tags.some((t) => t.toLowerCase().includes(searchTerm.toLowerCase()));
      const matchesCat =
        selectedCategory === '全部' || a.category === selectedCategory;
      return matchesSearch && matchesCat;
    });
  }, [allArticles, searchTerm, selectedCategory]);

  // ---- 打开新建弹窗 ----
  const openModal = () => {
    setShowModal(true);
    setStep('input');
    setUrlInput('');
    setFetchError('');
    setDraft(null);
  };

  const closeModal = () => {
    setShowModal(false);
    setStep('input');
    setUrlInput('');
    setFetchError('');
    setDraft(null);
    setEditTags([]);
    setConfirmNewCategory('');
    setFetching(false);
    setAiLoading(false);
    setAiError('');
    setTaskLinkMode('none');
    setSelectedTaskId('');
    setNewLinkedTaskTitle('');
    setSyncNewTaskTitle(true);
    setTaskLinkError('');
  };

  // ---- 抓取文章 ----
  // 改动要点：
  // 1. 不再切到独立的 'loading' step，按钮自身 loading 即可
  // 2. 抓取不再在后端拉 AI 摘要
  // 3. 抓取成功 → 直接进入 confirm 弹窗；摘要留空由用户手动点「AI 生成」
  const handleFetch = async () => {
    const url = urlInput.trim();
    if (!url) {
      setFetchError('请输入文章链接');
      return;
    }

    setFetchError('');
    setFetching(true);

    try {
      const parsed = await fetchAndParseArticle(url);
      const cleanedTitle = cleanTitle(parsed.rawTitle || parsed.title, [
        ...seriesTitlePrefixes,
        parsed.category,
      ]);
      const parsedWithCleanTitle = { ...parsed, title: cleanedTitle || parsed.title };
      setDraft(parsedWithCleanTitle);
      // 如果是从 Tasks 页带着 suggestedTitle 跳过来的，优先用抓取到的标题；
      // 抓取标题为空时用 suggestedTitle 兜底，避免用户要手动再输一次。
      setEditTitle(parsedWithCleanTitle.title || pendingSuggestedTitle || '');
      setEditCategory(parsed.category);
      setConfirmNewCategory('');
      // 不再用推断标签预选：留空让用户自行从「已有标签」里挑或手动新增
      setEditTags([]);
      setEditExcerpt(parsed.excerpt || '');
      setAiError('');
      if (pendingWorkItemId) {
        setTaskLinkMode('none');
      } else {
        setTaskLinkMode('none');
        setSelectedTaskId('');
        setNewLinkedTaskTitle(parsedWithCleanTitle.title || pendingSuggestedTitle || '');
        setSyncNewTaskTitle(true);
      }
      setStep('confirm');
    } catch (err) {
      setFetchError(err.message || '抓取失败，请检查链接');
    } finally {
      setFetching(false);
    }
  };

  // ---- 手动触发 AI 生成摘要 ----
  // 严格走 AI，不做本地兜底；失败显示错误提示
  const handleGenerateSummary = async () => {
    if (!draft) return;
    const content = draft.content || '';
    if (content.trim().length < 20) {
      setAiError('正文内容过短，无法生成摘要');
      return;
    }
    setAiLoading(true);
    setAiError('');
    try {
      const summary = await generateSummaryAI(editTitle || draft.title, content);
      setEditExcerpt(summary);
    } catch (err) {
      setAiError(err.message || 'AI 生成失败，请稍后重试');
    } finally {
      setAiLoading(false);
    }
  };

  // ---- 确认保存 ----
  const handleConfirmSave = async () => {
    if (!draft) return;

    const newCategoryLabel = confirmNewCategory.trim();
    if (editCategory === '__new__' && !newCategoryLabel) {
      alert('请输入新分类名称');
      return;
    }

    let finalCategory = editCategory === '__new__'
      ? newCategoryLabel
      : (editCategory || '');

    if (editCategory === '__new__' && newCategoryLabel) {
      const exists = categories.some(
        (cat) => cat !== '全部' && cat.trim().toLowerCase() === newCategoryLabel.toLowerCase(),
      );
      if (exists) {
        finalCategory = categories.find(
          (cat) => cat !== '全部' && cat.trim().toLowerCase() === newCategoryLabel.toLowerCase(),
        ) || newCategoryLabel;
      } else {
        const updated = [
          ...categoryList,
          {
            key: 'acat_' + Date.now(),
            label: newCategoryLabel,
            color: PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)],
          },
        ];
        setCategoryList(updated);
        persistCategories(updated, lastCatSyncRef);
      }
    }

    let linkedWorkItemId = pendingWorkItemId || null;
    if (!linkedWorkItemId && taskLinkMode === 'existing') {
      const task = linkableTasks.find((item) => String(item.id) === String(selectedTaskId));
      if (!task) {
        setTaskLinkError('请选择要绑定的事项');
        return;
      }
      const res = await bindExistingTaskToWorkItem(task, 'article');
      if (!res.success) {
        setTaskLinkError(`事项绑定失败：${res.error || '未知错误'}`);
        return;
      }
      linkedWorkItemId = res.workItemId;
    }
    if (!linkedWorkItemId && taskLinkMode === 'new') {
      const taskTitle = (syncNewTaskTitle ? editTitle : newLinkedTaskTitle).trim();
      if (!taskTitle) {
        setTaskLinkError('请输入新事项标题');
        return;
      }
      const res = await createLinkedTask({
        title: taskTitle,
        kind: 'article',
        category: filterOptions?.taskCategories?.includes('公众号文章')
          ? '公众号文章'
          : (filterOptions?.taskCategories?.[0] || ''),
        assigneeId: user?.id || null,
      });
      if (!res.success) {
        setTaskLinkError(`事项创建失败：${res.error || '未知错误'}`);
        return;
      }
      linkedWorkItemId = res.workItemId;
    }

    const newArticle = {
      id: `user-${Date.now()}`,
      title: editTitle.trim() || draft.title,
      rawTitle: draft.rawTitle || '',
      author: draft.author || 'RIEMer Land',
      avatar: null,
      coverImage: draft.coverImage || null,
      date: draft.date,
      category: finalCategory,
      tags: editTags,
      excerpt: editExcerpt.trim() || draft.excerpt,
      outline: [],
      url: draft.url,
      content: draft.content,
      archivedBy: user?.name || user?.nickname || '未知',
      archivedAt: new Date().toISOString(),
      // 跨模块关联（见 src/utils/workItem.js）：
      // 从 Tasks 页跳转带过来的 workItemId 写入新归档，完成"姿势 C"的回填闭环。
      // 不带时为 null，不影响独立新建流程。
      workItemId: linkedWorkItemId,
    };

    const articleTitle = newArticle.title;
    const savedArticle = await addArticle(newArticle, user?.id);
    if (savedArticle?._localOnly) {
      alert(
        `文章没有写入云端 articles 表：${savedArticle._saveError || '未知错误'}\n` +
        '这条归档暂时只在本机缓存里，刷新或跨设备可能看不到。请检查 Supabase 表结构 / RLS 权限后重试。'
      );
      return;
    }

    // 发送"公众号文章归档"通知（由规则引擎按用户自定义规则触发）
    try {
      emitNotificationEvent('article.archive', {
        operator: newArticle.archivedBy,
        operatorUserId: user?.id,
        title: articleTitle,
        category: newArticle.category || '',
      });
    } catch (err) {
      console.warn('[InternalArticles] 发送归档通知失败:', err?.message || err);
    }

    closeModal();
    // 归档成功后，清空从 Tasks 页带过来的预填缓存，避免下次新建时意外沿用
    setPendingWorkItemId(null);
    setPendingSuggestedTitle('');
    // 归档成功后提示用户是否去事项追踪标记对应事项为"已完成"
    setTaskPrompt({ articleTitle });
  };

  // ---- 批量录入阅读量 ----
  const openReadNumModal = () => {
    // 以"按日期倒序"为默认展示顺序，方便最新文章优先填写
    const draft = {};
    allArticles.forEach((a) => {
      draft[a.id] = a.readNum != null ? String(a.readNum) : '';
    });
    setReadNumDraft(draft);
    setReadNumSaved(false);
    setShowPastePanel(false);
    setPasteText('');
    setPasteResult(null);
    setShowReadNumModal(true);
  };

  const closeReadNumModal = () => {
    if (readNumSaving) return;
    setShowReadNumModal(false);
    setReadNumDraft({});
    setReadNumSaved(false);
    setShowPastePanel(false);
    setPasteText('');
    setPasteResult(null);
  };

  const handleReadNumChange = (id, val) => {
    // 仅保留数字
    const cleaned = val.replace(/[^0-9]/g, '');
    setReadNumDraft((prev) => ({ ...prev, [id]: cleaned }));
  };

  // 解析粘贴文本 → 匹配文章 → 自动填入 readNumDraft
  const handleParsePaste = () => {
    const rows = parseReadNumsFromPaste(pasteText);
    if (rows.length === 0) {
      setPasteResult({ matched: [], unmatched: [], emptyInput: true });
      return;
    }

    const matched = [];
    const unmatched = [];
    const nextDraft = { ...readNumDraft };

    for (const row of rows) {
      const articleId = findMatchingArticleId(row.titleText, allArticles);
      if (articleId) {
        const art = allArticles.find((a) => a.id === articleId);
        nextDraft[articleId] = String(row.readNum);
        matched.push({
          id: articleId,
          title: art?.title || row.titleText,
          readNum: row.readNum,
        });
      } else {
        unmatched.push({
          titleText: row.titleText,
          readNum: row.readNum,
          rawLine: row.rawLine,
        });
      }
    }

    setReadNumDraft(nextDraft);
    setPasteResult({ matched, unmatched, emptyInput: false });
  };

  const handleClearPaste = () => {
    setPasteText('');
    setPasteResult(null);
  };

  const handleSaveReadNums = async () => {
    setReadNumSaving(true);
    try {
      // 仅更新实际发生变化的条目
      const changes = [];
      allArticles.forEach((a) => {
        const next = Number(readNumDraft[a.id] ?? 0) || 0;
        const prev = Number(a.readNum ?? 0) || 0;
        if (next !== prev) {
          changes.push({ id: a.id, readNum: next });
        }
      });
      await Promise.all(
        changes.map((c) => updateArticle(c.id, { readNum: c.readNum })),
      );
      setReadNumSaved(true);
      // 延迟关闭，给用户短暂反馈
      setTimeout(() => {
        setShowReadNumModal(false);
        setReadNumSaved(false);
      }, 800);
    } finally {
      setReadNumSaving(false);
    }
  };

  const openArchiveEditor = (article) => {
    setEditingArchive({ ...article });
    setArchiveEditCategory(article.category || '');
    setArchiveNewCategory('');
    setArchiveEditTags(article.tags || []);
  };

  const closeArchiveEditor = () => {
    setEditingArchive(null);
    setArchiveEditCategory('');
    setArchiveNewCategory('');
    setArchiveEditTags([]);
  };

  const handleSaveArchiveEdit = async () => {
    if (!editingArchive) return;

    const newCategoryLabel = archiveNewCategory.trim();
    if (archiveEditCategory === '__new__' && !newCategoryLabel) {
      alert('请输入新分类名称');
      return;
    }

    let finalCategory = archiveEditCategory === '__new__'
      ? newCategoryLabel
      : (archiveEditCategory || '');

    if (archiveEditCategory === '__new__' && newCategoryLabel) {
      const existing = categories.find(
        (cat) => cat !== '全部' && cat.trim().toLowerCase() === newCategoryLabel.toLowerCase(),
      );
      if (existing) {
        finalCategory = existing;
      } else {
        const updated = [
          ...categoryList,
          {
            key: 'acat_' + Date.now(),
            label: newCategoryLabel,
            color: PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)],
          },
        ];
        setCategoryList(updated);
        persistCategories(updated, lastCatSyncRef);
      }
    }

    const updates = {
      title: editingArchive.title.trim(),
      date: editingArchive.date,
      category: finalCategory,
      tags: archiveEditTags,
      excerpt: editingArchive.excerpt.trim(),
      url: editingArchive.url || '',
      author: editingArchive.author || 'RIEMer Land',
      coverImage: editingArchive.coverImage || null,
    };

    if (!updates.title) {
      alert('请输入文章标题');
      return;
    }

    await updateArticle(editingArchive.id, updates);
    closeArchiveEditor();
  };

  // 总阅读量（用于弹窗顶部汇总展示）
  const totalReadNum = useMemo(() => {
    return Object.values(readNumDraft).reduce(
      (sum, v) => sum + (Number(v) || 0),
      0,
    );
  }, [readNumDraft]);

  return (
    <div className="ia-list-page">
      <div className="container">
        <div className="ia-list__header">
          <div>
            <h1>
              <FileText size={28} /> <EditableText as="span" value={ia.pageTitle || '公众号历史文章归档'} configKey="internalArticles.pageTitle" onChange={v => updateIA('pageTitle', v)} />
            </h1>
            <EditableText as="p" value={ia.pageDesc || '浏览公众号历史推送内容，回顾与归档'} configKey="internalArticles.pageDesc" onChange={v => updateIA('pageDesc', v)} />
          </div>
          <div className="ia-list__header-actions">
            {isAdmin && (
              <button
                className="btn btn-ghost"
                onClick={openReadNumModal}
                title="批量录入/更新公众号阅读量"
              >
                <Eye size={16} /> 更新阅读量
              </button>
            )}
            <button className="btn btn-primary" onClick={openModal}>
              <Plus size={16} /> 新建归档
            </button>
          </div>
        </div>

        {/* 筛选 */}
        <div className="ia-list__filters">
          <div className="ia-list__search">
            <Search size={18} className="ia-list__search-icon" />
            <input
              type="text"
              placeholder="搜索文章…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="ia-list__filter-bar">
            <div className="ia-list__categories">
              {categories.map((cat) => {
                if (cat === '全部') {
                  return (
                    <button
                      key={cat}
                      className={`ia-list__cat ${selectedCategory === cat ? 'ia-list__cat--active' : ''}`}
                      onClick={() => setSelectedCategory(cat)}
                    >
                      全部
                    </button>
                  );
                }
                // 管理员对所有非"全部"的分类都可就地编辑/删除：
                //   - 托管分类：从 categoryList 找到，有稳定 key
                //   - 动态派生分类：从文章 article.category 派生而来，没有 key；
                //     此时构造一个 __dyn__<label> 的占位 key，重命名时会自动"领养"进 categoryList，
                //     删除时批量把引用该分类的文章 category 清空。
                const managedReal = categoryList.find((c) => c.label === cat);
                const managed = managedReal || {
                  key: '__dyn__' + cat,
                  label: cat,
                  color: PRESET_COLORS[0],
                };
                const canEditInline = isAdmin;
                const isRenaming = canEditInline && editingCatKey === managed.key;

                // 就地重命名：沿用 editCatLabel / saveEditCategory，只是 UI 从面板搬到标签原位
                if (isRenaming) {
                  return (
                    <span key={managed.key} className="ia-list__cat-rename">
                      <input
                        type="text"
                        className="ia-list__cat-rename-input"
                        value={editCatLabel}
                        onChange={(e) => setEditCatLabel(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveEditCategory();
                          if (e.key === 'Escape') setEditingCatKey(null);
                        }}
                        autoFocus
                      />
                      <button
                        className="ia-list__cat-rename-confirm"
                        onClick={saveEditCategory}
                        disabled={!editCatLabel.trim()}
                        title="确认"
                      >
                        <Check size={14} />
                      </button>
                      <button
                        className="ia-list__cat-rename-cancel"
                        onClick={() => setEditingCatKey(null)}
                        title="取消"
                      >
                        <X size={14} />
                      </button>
                    </span>
                  );
                }

                return (
                  <div key={cat} className="ia-list__cat-wrapper">
                    <button
                      className={`ia-list__cat ${selectedCategory === cat ? 'ia-list__cat--active' : ''}`}
                      onClick={() => setSelectedCategory(cat)}
                    >
                      {cat}
                    </button>
                    {canEditInline && (
                      <div className="ia-list__cat-actions">
                        <button
                          className="ia-list__cat-edit"
                          onClick={(e) => {
                            e.stopPropagation();
                            startEditCategory(managed);
                          }}
                          title="重命名"
                        >
                          <Pencil size={12} />
                        </button>
                        <button
                          className="ia-list__cat-delete"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteCategoryByLabel(managed.label);
                          }}
                          title="删除分类"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* 就地新增分类：管理员走 inline 输入（与流程模板文件页一致）；
                  非管理员继续走原 modal（所有成员可新增，但不能改/删别人建的） */}
              {isAdmin ? (
                showInlineAddCat ? (
                  <span className="ia-list__cat-add-inline">
                    <input
                      type="text"
                      className="ia-list__cat-add-input"
                      placeholder="新分类名称"
                      value={newCatLabel}
                      onChange={(e) => setNewCatLabel(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleAddCategory();
                          setShowInlineAddCat(false);
                        }
                        if (e.key === 'Escape') {
                          setShowInlineAddCat(false);
                          setNewCatLabel('');
                        }
                      }}
                      autoFocus
                    />
                    <button
                      className="ia-list__cat-add-confirm"
                      onClick={() => {
                        handleAddCategory();
                        setShowInlineAddCat(false);
                      }}
                      disabled={!newCatLabel.trim()}
                      title="确认添加"
                    >
                      <Check size={14} />
                    </button>
                    <button
                      className="ia-list__cat-add-cancel"
                      onClick={() => {
                        setShowInlineAddCat(false);
                        setNewCatLabel('');
                      }}
                      title="取消"
                    >
                      <X size={14} />
                    </button>
                  </span>
                ) : (
                  <button
                    className="ia-list__cat ia-list__cat--add"
                    onClick={() => setShowInlineAddCat(true)}
                    title="添加新分类"
                  >
                    <Plus size={14} /> 添加分类
                  </button>
                )
              ) : (
                <button
                  className="ia-list__cat ia-list__cat--add"
                  onClick={openAddCatModal}
                  title="新增筛选分类（所有成员可用）"
                >
                  <Plus size={14} /> 新增筛选
                </button>
              )}
            </div>
            {editing && (
              <button
                className={`ia-list__manage-btn ${showCatManager ? 'ia-list__manage-btn--active' : ''}`}
                onClick={() => setShowCatManager(!showCatManager)}
                title="管理筛选分类（含颜色/批量）"
              >
                <Settings2 size={16} />
              </button>
            )}
          </div>

          {/* 分类管理面板 */}
          {editing && showCatManager && (
            <div className="ia-cat-manager card">
              <div className="ia-cat-manager__header">
                <h4><Settings2 size={16} /> 筛选分类管理</h4>
                <button className="ia-cat-manager__close" onClick={() => setShowCatManager(false)}>
                  <X size={16} />
                </button>
              </div>

              {/* 现有分类列表 */}
              <div className="ia-cat-manager__list">
                {categoryList.map((cat) => (
                  <div key={cat.key} className="ia-cat-item">
                    {editingCatKey === cat.key ? (
                      <div className="ia-cat-item__edit">
                        <div className="ia-cat-item__edit-row">
                          <span
                            className="ia-cat-item__color-dot"
                            style={{ background: editCatColor }}
                          />
                          <input
                            type="text"
                            className="ia-cat-item__edit-input"
                            value={editCatLabel}
                            onChange={(e) => setEditCatLabel(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && saveEditCategory()}
                            autoFocus
                          />
                          <button className="ia-cat-item__action ia-cat-item__action--save" onClick={saveEditCategory} title="保存">
                            <Check size={14} />
                          </button>
                          <button className="ia-cat-item__action" onClick={() => setEditingCatKey(null)} title="取消">
                            <X size={14} />
                          </button>
                        </div>
                        <div className="ia-cat-item__colors">
                          {PRESET_COLORS.map((c) => (
                            <button
                              key={c}
                              className={`ia-cat-item__color-btn ${editCatColor === c ? 'ia-cat-item__color-btn--active' : ''}`}
                              style={{ background: c }}
                              onClick={() => setEditCatColor(c)}
                            />
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="ia-cat-item__display">
                        <span
                          className="ia-cat-item__color-dot"
                          style={{ background: cat.color }}
                        />
                        <span className="ia-cat-item__label">{cat.label}</span>
                        <div className="ia-cat-item__actions">
                          <button className="ia-cat-item__action" onClick={() => startEditCategory(cat)} title="编辑">
                            <Pencil size={12} />
                          </button>
                          <button className="ia-cat-item__action ia-cat-item__action--danger" onClick={() => handleDeleteCategory(cat.key)} title="删除">
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* 新建分类 */}
              <div className="ia-cat-manager__add">
                <div className="ia-cat-manager__add-row">
                  <span
                    className="ia-cat-item__color-dot"
                    style={{ background: newCatColor }}
                  />
                  <input
                    type="text"
                    className="ia-cat-manager__add-input"
                    placeholder="输入新分类名称..."
                    value={newCatLabel}
                    onChange={(e) => setNewCatLabel(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddCategory()}
                  />
                  <button
                    className="ia-cat-manager__add-btn"
                    onClick={handleAddCategory}
                    disabled={!newCatLabel.trim()}
                  >
                    <Plus size={14} /> 添加
                  </button>
                </div>
                <div className="ia-cat-item__colors">
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c}
                      className={`ia-cat-item__color-btn ${newCatColor === c ? 'ia-cat-item__color-btn--active' : ''}`}
                      style={{ background: c }}
                      onClick={() => setNewCatColor(c)}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 文章列表 */}
        <div className="ia-list__grid">
          {filtered.map((article) => {
            const commentCount = getCommentCount('article', article.id);
            // 归档文章卡片：优先跳转公众号原链接；如无原链接则回退站内详情页
            const hasExternal = !!(article.url && /^https?:\/\//i.test(article.url));
            const canEditArchive = archivedArticleIds.has(article.id);
            const commonInner = (
              <div className="ia-card__body">
                <span className="ia-card__category">{article.category}</span>
                <h3 className="ia-card__title">{article.title}</h3>
                <p className="ia-card__excerpt">{article.excerpt}</p>
                <div className="ia-card__footer">
                  <span className="ia-card__meta">
                    <Calendar size={13} /> {article.date}
                  </span>
                  {commentCount > 0 && (
                    <span className="ia-card__comments">
                      <MessageSquare size={13} /> {commentCount}
                    </span>
                  )}
                  <span className="ia-card__arrow">
                    <ArrowRight size={14} />
                  </span>
                </div>
              </div>
            );
            return (
              <article key={article.id} className="ia-card card">
                {canEditArchive && (
                  <button
                    type="button"
                    className="ia-card__edit-btn"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      openArchiveEditor(article);
                    }}
                    title="编辑归档信息"
                  >
                    <Pencil size={14} />
                  </button>
                )}
                {hasExternal ? (
                  <a
                    href={article.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ia-card__link"
                  >
                    {commonInner}
                  </a>
                ) : (
                  <Link
                    to={`/internal/article/${article.id}`}
                    className="ia-card__link"
                  >
                    {commonInner}
                  </Link>
                )}
              </article>
            );
          })}
        </div>

        {filtered.length === 0 && (
          <div className="ia-list__empty">
            <FileText size={48} />
            <h3>未找到匹配的文章</h3>
            <p>尝试更换搜索关键词</p>
          </div>
        )}
      </div>

      {/* ========== 新建归档弹窗 ========== */}
      {showModal && (
        <div className="ia-modal-overlay" onClick={closeModal}>
          <div className="ia-modal" onClick={(e) => e.stopPropagation()}>
            <div className="ia-modal__header">
              <h2>
                {step === 'input' && '新建文章归档'}
                {step === 'confirm' && '确认归档信息'}
              </h2>
              <button className="ia-modal__close" onClick={closeModal}>
                <X size={20} />
              </button>
            </div>

            <div className="ia-modal__body">
              {/* 跨模块来源提示：从 Tasks 页"未闭环清单"或完成提示跳过来时，
                  顶部显示一条横幅让用户知道"这次归档会关联到事项 X"。 */}
              {(pendingWorkItemId || pendingSuggestedTitle) && (
                <div
                  className="ia-modal__error"
                  style={{
                    background: '#E6F4EA',
                    color: '#1B5E20',
                    border: '1px solid #A5D6A7',
                    marginBottom: 'var(--space-md)',
                  }}
                >
                  <Check size={14} />
                  <span>
                    正在为事项「{pendingSuggestedTitle || '未命名事项'}」归档对应文章，
                    保存后会自动标记为闭环。
                  </span>
                </div>
              )}
              {/* Step 1: 输入链接 */}
              {step === 'input' && (
                <div className="ia-modal__step-input">
                  <p className="ia-modal__hint">
                    请输入微信公众号文章链接，系统将自动提取标题、分类、日期和标签。
                    摘要需在下一步手动点击「AI 生成」。
                  </p>
                  <div className="ia-modal__url-row">
                    <div className="ia-modal__url-input-wrap">
                      <Link2 size={18} className="ia-modal__url-icon" />
                      <input
                        type="url"
                        className="ia-modal__url-input"
                        placeholder="粘贴微信公众号文章链接…"
                        value={urlInput}
                        onChange={(e) => setUrlInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && !fetching && handleFetch()}
                        autoFocus
                        disabled={fetching}
                      />
                    </div>
                    <button
                      className="btn btn-primary ia-modal__fetch-btn"
                      onClick={handleFetch}
                      disabled={!urlInput.trim() || fetching}
                    >
                      {fetching ? (
                        <>
                          <Loader2 size={14} className="ia-modal__spinner" />
                          <span>提取文章</span>
                        </>
                      ) : (
                        <span>提取文章</span>
                      )}
                    </button>
                  </div>
                  {fetchError && (
                    <div className="ia-modal__error">
                      <AlertCircle size={16} /> {fetchError}
                    </div>
                  )}
                </div>
              )}

              {/* Step 2: 确认 */}
              {step === 'confirm' && draft && (
                <div className="ia-modal__step-confirm">
                  {/* 标题 */}
                  <div className="ia-modal__field">
                    <label className="ia-modal__label">标题</label>
                    <input
                      type="text"
                      className="ia-modal__text-input"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                    />
                  </div>

                  {/* 分类 */}
                  <div className="ia-modal__field">
                    <label className="ia-modal__label">分类</label>
                    {/* 进入「新建分类」输入态后，隐藏上面显示「＋ 新建分类…」的下拉框，
                        只留输入行 + 取消，避免输入行上方再出现一行「新建分类」造成误导 */}
                    {editCategory === '__new__' ? (
                      <div className="ia-modal__new-cat-row">
                        <input
                          type="text"
                          className="ia-modal__text-input"
                          value={confirmNewCategory}
                          onChange={(e) => setConfirmNewCategory(e.target.value)}
                          placeholder="输入新分类名称，保存后会加入分类列表"
                          maxLength={24}
                          autoFocus
                        />
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => { setEditCategory(''); setConfirmNewCategory(''); }}
                        >
                          取消
                        </button>
                      </div>
                    ) : (
                      <CustomSelect
                        className="ia-modal__category-select"
                        value={editCategory}
                        onChange={(value) => {
                          setEditCategory(value);
                          if (value !== '__new__') setConfirmNewCategory('');
                        }}
                        options={articleCategoryOptions}
                        placeholder="选择分类"
                        searchable
                        searchPlaceholder="搜索分类…"
                      />
                    )}
                  </div>

                  {/* 事项绑定 */}
                  <div className="ia-modal__field">
                    <label className="ia-modal__label">
                      <CheckSquare size={16} /> 对应事项
                    </label>
                    {pendingWorkItemId ? (
                      <div className="ia-work-link__notice">
                        已从事项追踪带入关联：「{pendingSuggestedTitle || editTitle || '未命名事项'}」
                      </div>
                    ) : (
                      <div className="ia-work-link">
                        <div className="ia-work-link__modes">
                          <label className="ia-work-link__mode">
                            <input
                              type="radio"
                              name="articleTaskLinkMode"
                              value="none"
                              checked={taskLinkMode === 'none'}
                              onChange={() => setTaskLinkMode('none')}
                            />
                            不绑定
                          </label>
                          <label className="ia-work-link__mode">
                            <input
                              type="radio"
                              name="articleTaskLinkMode"
                              value="existing"
                              checked={taskLinkMode === 'existing'}
                              onChange={() => setTaskLinkMode('existing')}
                            />
                            绑定已有事项
                          </label>
                          <label className="ia-work-link__mode">
                            <input
                              type="radio"
                              name="articleTaskLinkMode"
                              value="new"
                              checked={taskLinkMode === 'new'}
                              onChange={() => {
                                setTaskLinkMode('new');
                                if (!newLinkedTaskTitle) setNewLinkedTaskTitle(editTitle || draft.title || '');
                              }}
                            />
                            新建事项
                          </label>
                        </div>

                        {taskLinkMode === 'existing' && (
                          <select
                            className="ia-modal__text-input"
                            value={selectedTaskId}
                            onChange={(e) => {
                              setSelectedTaskId(e.target.value);
                              setTaskLinkError('');
                            }}
                          >
                            <option value="">选择一个未绑定公众号归档的事项</option>
                            {articleTaskOptions.map((task) => (
                              <option key={task.id} value={task.id}>
                                {task.title || '未命名事项'}{task.status ? `（${task.status}）` : ''}
                              </option>
                            ))}
                          </select>
                        )}

                        {taskLinkMode === 'new' && (
                          <div className="ia-work-link__new">
                            <label className="ia-work-link__sync">
                              <input
                                type="checkbox"
                                checked={syncNewTaskTitle}
                                onChange={(e) => setSyncNewTaskTitle(e.target.checked)}
                              />
                              事项标题同步为当前文章标题
                            </label>
                            <input
                              type="text"
                              className="ia-modal__text-input"
                              value={syncNewTaskTitle ? (editTitle || draft.title || '') : newLinkedTaskTitle}
                              onChange={(e) => setNewLinkedTaskTitle(e.target.value)}
                              disabled={syncNewTaskTitle}
                              placeholder="新事项标题"
                            />
                          </div>
                        )}
                      </div>
                    )}
                    {taskLinkError && (
                      <div className="ia-modal__error" style={{ marginTop: 8 }}>
                        <AlertCircle size={14} /> {taskLinkError}
                      </div>
                    )}
                  </div>

                  {/* 摘要 */}
                  <div className="ia-modal__field">
                    <div className="ia-modal__label-row">
                      <label className="ia-modal__label">摘要</label>
                      <button
                        type="button"
                        className="ia-modal__ai-btn"
                        onClick={handleGenerateSummary}
                        disabled={aiLoading || !(draft.content && draft.content.trim().length >= 20)}
                        title="把全文喂给 AI，生成卡片摘要"
                      >
                        {aiLoading ? (
                          <>
                            <Loader2 size={12} className="ia-modal__spinner" /> 生成中…
                          </>
                        ) : (
                          <>
                            <Sparkles size={12} /> AI 生成
                          </>
                        )}
                      </button>
                    </div>
                    <textarea
                      className="ia-modal__textarea"
                      value={editExcerpt}
                      onChange={(e) => setEditExcerpt(e.target.value)}
                      placeholder="点击上方「AI 生成」按钮，由 AI 根据文章全文生成摘要。也可手动编辑。"
                      rows={3}
                    />
                    {aiError && (
                      <div className="ia-modal__error" style={{ marginTop: 6 }}>
                        <AlertCircle size={14} />
                        <div>
                          <div>{aiError}</div>
                          <div style={{ fontSize: 12, opacity: 0.75, marginTop: 2 }}>
                            你可以直接在下方输入框手动填写摘要，不影响保存。
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 标签 */}
                  <div className="ia-modal__field">
                    <div
                      className="ia-modal__label-row ia-modal__label-row--toggle"
                      onClick={() => setShowTagsEditor(!showTagsEditor)}
                    >
                      <label className="ia-modal__label">
                        <Tag size={16} /> 标签
                        <span className="ia-modal__count">（{editTags.length} 个）</span>
                      </label>
                      {showTagsEditor ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </div>
                    {showTagsEditor && (
                      <div className="ia-modal__tags-editor">
                        <CustomSelect
                          className="ia-modal__tag-select"
                          value={editTags}
                          onChange={setEditTags}
                          options={articleTagOptions}
                          placeholder="选择标签"
                          multiple
                          searchable
                          searchPlaceholder="搜索标签…"
                        />
                      </div>
                    )}
                  </div>

                  {/* 封面图片：首页/文章列表卡片展示用 */}
                  <div className="ia-modal__field">
                    <label className="ia-modal__label">
                      <ImagePlus size={16} /> 封面图片
                    </label>
                    {draft.coverImage ? (
                      <div className="ia-cover-uploader__preview">
                        <img src={draft.coverImage} alt="封面预览" />
                        <button
                          type="button"
                          className="ia-cover-uploader__remove"
                          onClick={() => setDraft((prev) => ({ ...prev, coverImage: '' }))}
                        >
                          <X size={14} /> 移除
                        </button>
                      </div>
                    ) : (
                      <label className="ia-cover-uploader__drop">
                        <input
                          type="file"
                          accept="image/*"
                          hidden
                          onChange={async (e) => {
                            const dataUrl = await readCoverImage(e.target.files?.[0]);
                            if (dataUrl) setDraft((prev) => ({ ...prev, coverImage: dataUrl }));
                            e.target.value = '';
                          }}
                        />
                        <ImagePlus size={22} />
                        <span>点击上传封面图片</span>
                        <span className="ia-cover-uploader__hint">支持 jpg / png / webp，小于 2MB</span>
                      </label>
                    )}
                  </div>

                  {/* 元信息 */}
                  <div className="ia-modal__meta-row">
                    <span><Calendar size={14} /> {draft.date}</span>
                    <span>来源：{draft.author}</span>
                  </div>
                </div>
              )}
            </div>

            {/* 底部按钮 */}
            {step === 'confirm' && (
              <div className="ia-modal__footer">
                <button className="btn btn-ghost" onClick={() => { setStep('input'); setFetchError(''); }}>
                  重新输入
                </button>
                <button className="btn btn-primary" onClick={handleConfirmSave}>
                  <Check size={16} /> 确认归档
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========== 编辑归档弹窗 ========== */}
      {editingArchive && (
        <div className="ia-modal-overlay" onClick={closeArchiveEditor}>
          <div className="ia-modal" onClick={(e) => e.stopPropagation()}>
            <div className="ia-modal__header">
              <h2>编辑归档信息</h2>
              <button className="ia-modal__close" onClick={closeArchiveEditor}>
                <X size={20} />
              </button>
            </div>

            <div className="ia-modal__body">
              <div className="ia-modal__step-confirm">
                <div className="ia-modal__field">
                  <label className="ia-modal__label">标题</label>
                  <input
                    type="text"
                    className="ia-modal__text-input"
                    value={editingArchive.title}
                    onChange={(e) => setEditingArchive({ ...editingArchive, title: e.target.value })}
                  />
                </div>

                <div className="ia-modal__field-row">
                  <div className="ia-modal__field">
                    <label className="ia-modal__label">
                      <Calendar size={14} /> 发布日期
                    </label>
                    <input
                      type="date"
                      className="ia-modal__text-input"
                      value={editingArchive.date || ''}
                      onChange={(e) => setEditingArchive({ ...editingArchive, date: e.target.value })}
                    />
                  </div>
                  <div className="ia-modal__field">
                    <label className="ia-modal__label">分类</label>
                    {archiveEditCategory === '__new__' ? (
                      <div className="ia-modal__new-cat-row">
                        <input
                          type="text"
                          className="ia-modal__text-input"
                          value={archiveNewCategory}
                          onChange={(e) => setArchiveNewCategory(e.target.value)}
                          placeholder="输入新分类名称，保存后会加入分类列表"
                          maxLength={24}
                          autoFocus
                        />
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => { setArchiveEditCategory(''); setArchiveNewCategory(''); }}
                        >
                          取消
                        </button>
                      </div>
                    ) : (
                      <CustomSelect
                        className="ia-modal__category-select"
                        value={archiveEditCategory}
                        onChange={(value) => {
                          setArchiveEditCategory(value);
                          if (value !== '__new__') setArchiveNewCategory('');
                        }}
                        options={articleCategoryOptions}
                        placeholder="选择分类"
                        searchable
                        searchPlaceholder="搜索分类…"
                      />
                    )}
                  </div>
                </div>

                <div className="ia-modal__field">
                  <label className="ia-modal__label">
                    <Tag size={14} /> 标签
                  </label>
                  <CustomSelect
                    className="ia-modal__tag-select"
                    value={archiveEditTags}
                    onChange={setArchiveEditTags}
                    options={articleTagOptions}
                    placeholder="选择标签"
                    multiple
                    searchable
                    searchPlaceholder="搜索标签…"
                  />
                </div>

                <div className="ia-modal__field">
                  <label className="ia-modal__label">摘要</label>
                  <textarea
                    className="ia-modal__textarea"
                    value={editingArchive.excerpt || ''}
                    onChange={(e) => setEditingArchive({ ...editingArchive, excerpt: e.target.value })}
                    rows={3}
                    placeholder="编辑文章卡片展示摘要"
                  />
                </div>

                <div className="ia-modal__field">
                  <label className="ia-modal__label">
                    <Link2 size={14} /> 原文链接
                  </label>
                  <input
                    type="url"
                    className="ia-modal__text-input"
                    value={editingArchive.url || ''}
                    onChange={(e) => setEditingArchive({ ...editingArchive, url: e.target.value })}
                    placeholder="公众号文章链接"
                  />
                </div>

                {/* 封面图片：首页/文章列表卡片展示用 */}
                <div className="ia-modal__field">
                  <label className="ia-modal__label">
                    <ImagePlus size={14} /> 封面图片
                  </label>
                  {editingArchive.coverImage ? (
                    <div className="ia-cover-uploader__preview">
                      <img src={editingArchive.coverImage} alt="封面预览" />
                      <button
                        type="button"
                        className="ia-cover-uploader__remove"
                        onClick={() => setEditingArchive({ ...editingArchive, coverImage: '' })}
                      >
                        <X size={14} /> 移除
                      </button>
                    </div>
                  ) : (
                    <label className="ia-cover-uploader__drop">
                      <input
                        type="file"
                        accept="image/*"
                        hidden
                        onChange={async (e) => {
                          const dataUrl = await readCoverImage(e.target.files?.[0]);
                          if (dataUrl) setEditingArchive((prev) => ({ ...prev, coverImage: dataUrl }));
                          e.target.value = '';
                        }}
                      />
                      <ImagePlus size={22} />
                      <span>点击上传封面图片</span>
                      <span className="ia-cover-uploader__hint">支持 jpg / png / webp，小于 2MB</span>
                    </label>
                  )}
                </div>
              </div>
            </div>

            <div className="ia-modal__footer">
              <button className="btn btn-ghost" onClick={closeArchiveEditor}>
                取消
              </button>
              <button
                className="btn btn-primary"
                onClick={handleSaveArchiveEdit}
                disabled={!editingArchive.title.trim()}
              >
                <Check size={16} /> 保存修改
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========== 批量录入阅读量弹窗 ========== */}
      {showReadNumModal && (
        <div className="ia-modal-overlay" onClick={closeReadNumModal}>
          <div
            className="ia-modal ia-modal--readnum"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="ia-modal__header">
              <h2>
                <Eye size={20} /> 公众号阅读量管理
              </h2>
              <button
                className="ia-modal__close"
                onClick={closeReadNumModal}
                disabled={readNumSaving}
              >
                <X size={20} />
              </button>
            </div>

            <div className="ia-modal__body">
              <p className="ia-modal__hint">
                录入各篇公众号推送的阅读量。首页"公众号累计阅读"将自动基于所有文章的阅读量求和。
              </p>

              {/* ==== 批量粘贴面板（折叠展开式） ==== */}
              <div className={`ia-paste-panel ${showPastePanel ? 'ia-paste-panel--open' : ''}`}>
                <button
                  type="button"
                  className="ia-paste-panel__toggle"
                  onClick={() => setShowPastePanel(!showPastePanel)}
                >
                  <ClipboardPaste size={15} />
                  <span>从公众号后台批量粘贴</span>
                  {showPastePanel ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>

                {showPastePanel && (
                  <div className="ia-paste-panel__body">
                    <p className="ia-paste-panel__tip">
                      打开 <code>mp.weixin.qq.com</code> → 左侧菜单「统计」→「图文分析」→
                      选中文章列表 → <kbd>Ctrl/Cmd</kbd> + <kbd>C</kbd> 复制 → 粘贴到下方。
                      系统会按<strong>标题 + 阅读数</strong>自动匹配到已归档的文章。
                    </p>
                    <textarea
                      className="ia-paste-panel__textarea"
                      placeholder={
                        '示例（每行一条）：\n春日随笔        2026-04-15       1,234\n清明诗歌会实录  2026-04-10       890\n新晋成员访谈    2026-04-05       567'
                      }
                      value={pasteText}
                      onChange={(e) => {
                        setPasteText(e.target.value);
                        if (pasteResult) setPasteResult(null);
                      }}
                      rows={6}
                      spellCheck={false}
                    />
                    <div className="ia-paste-panel__actions">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={handleClearPaste}
                        disabled={!pasteText}
                      >
                        <X size={14} /> 清空
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={handleParsePaste}
                        disabled={!pasteText.trim()}
                      >
                        <Wand2 size={14} /> 解析并填入
                      </button>
                    </div>

                    {/* 解析结果反馈 */}
                    {pasteResult && (
                      <div className="ia-paste-panel__result">
                        {pasteResult.emptyInput && (
                          <div className="ia-paste-panel__msg ia-paste-panel__msg--warn">
                            <AlertCircle size={14} />
                            <span>未识别出任何有效行，请检查粘贴内容格式。</span>
                          </div>
                        )}
                        {pasteResult.matched.length > 0 && (
                          <div className="ia-paste-panel__msg ia-paste-panel__msg--success">
                            <Check size={14} />
                            <span>
                              匹配成功 <strong>{pasteResult.matched.length}</strong> 篇，已自动填入下方输入框。
                              请核对后点击"保存"。
                            </span>
                          </div>
                        )}
                        {pasteResult.unmatched.length > 0 && (
                          <div className="ia-paste-panel__msg ia-paste-panel__msg--warn">
                            <AlertCircle size={14} />
                            <div style={{ flex: 1 }}>
                              <div style={{ marginBottom: 4 }}>
                                未匹配 <strong>{pasteResult.unmatched.length}</strong> 条（可能是未归档的文章，请手动添加或忽略）：
                              </div>
                              <ul className="ia-paste-panel__unmatched-list">
                                {pasteResult.unmatched.slice(0, 5).map((u, i) => (
                                  <li key={i}>
                                    <span className="ia-paste-panel__unmatched-title">{u.titleText}</span>
                                    <span className="ia-paste-panel__unmatched-num">{u.readNum.toLocaleString()}</span>
                                  </li>
                                ))}
                                {pasteResult.unmatched.length > 5 && (
                                  <li style={{ opacity: 0.6 }}>…另 {pasteResult.unmatched.length - 5} 条</li>
                                )}
                              </ul>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="ia-readnum-summary">
                <span className="ia-readnum-summary__label">当前累计：</span>
                <span className="ia-readnum-summary__value">
                  {totalReadNum.toLocaleString()}
                </span>
                <span className="ia-readnum-summary__sub">
                  （共 {allArticles.length} 篇）
                </span>
              </div>

              <div className="ia-readnum-list">
                {allArticles.length === 0 ? (
                  <div className="ia-readnum-empty">
                    <FileText size={32} />
                    <p>暂无归档文章</p>
                  </div>
                ) : (
                  allArticles.map((a) => (
                    <div key={a.id} className="ia-readnum-item">
                      <div className="ia-readnum-item__info">
                        <div className="ia-readnum-item__title">{a.title}</div>
                        <div className="ia-readnum-item__meta">
                          <Calendar size={12} /> {a.date}
                          <span className="ia-readnum-item__sep">·</span>
                          <span>{a.category}</span>
                        </div>
                      </div>
                      <div className="ia-readnum-item__input-wrap">
                        <Eye size={14} className="ia-readnum-item__input-icon" />
                        <input
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          className="ia-readnum-item__input"
                          placeholder="0"
                          value={readNumDraft[a.id] ?? ''}
                          onChange={(e) =>
                            handleReadNumChange(a.id, e.target.value)
                          }
                          disabled={readNumSaving}
                        />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="ia-modal__footer">
              <button
                className="btn btn-ghost"
                onClick={closeReadNumModal}
                disabled={readNumSaving}
              >
                取消
              </button>
              <button
                className="btn btn-primary"
                onClick={handleSaveReadNums}
                disabled={readNumSaving || allArticles.length === 0}
              >
                {readNumSaving ? (
                  <>
                    <Loader2 size={14} className="ia-modal__spinner" /> 保存中…
                  </>
                ) : readNumSaved ? (
                  <>
                    <Check size={14} /> 已保存
                  </>
                ) : (
                  <>
                    <Check size={14} /> 保存
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========== 普通成员快速新增分类弹窗 ========== */}
      {showAddCatModal && (
        <div className="ia-modal-overlay" onClick={closeAddCatModal}>
          <div
            className="ia-modal ia-modal--quick-cat"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="ia-modal__header">
              <h2>
                <Palette size={18} /> 新增筛选分类
              </h2>
              <button className="ia-modal__close" onClick={closeAddCatModal}>
                <X size={20} />
              </button>
            </div>
            <div className="ia-modal__body">
              <p className="ia-modal__hint">
                所有成员都可以新增筛选分类，新增后立即同步到所有设备，大家都能看到。
              </p>
              <div className="ia-modal__field">
                <label className="ia-modal__label">分类名称</label>
                <div className="ia-cat-manager__add-row">
                  <span
                    className="ia-cat-item__color-dot"
                    style={{ background: quickCatColor }}
                  />
                  <input
                    type="text"
                    className="ia-modal__text-input"
                    placeholder="例如：学习笔记、求职经验…"
                    value={quickCatLabel}
                    onChange={(e) => {
                      setQuickCatLabel(e.target.value);
                      setQuickCatError('');
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && handleQuickAddCategory()}
                    autoFocus
                    maxLength={20}
                  />
                </div>
              </div>
              <div className="ia-modal__field">
                <label className="ia-modal__label">分类颜色</label>
                <div className="ia-cat-item__colors">
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c}
                      className={`ia-cat-item__color-btn ${quickCatColor === c ? 'ia-cat-item__color-btn--active' : ''}`}
                      style={{ background: c }}
                      onClick={() => setQuickCatColor(c)}
                    />
                  ))}
                </div>
              </div>
              {quickCatError && (
                <div className="ia-modal__error">
                  <AlertCircle size={14} /> {quickCatError}
                </div>
              )}
            </div>
            <div className="ia-modal__footer">
              <button className="btn btn-ghost" onClick={closeAddCatModal}>
                取消
              </button>
              <button
                className="btn btn-primary"
                onClick={handleQuickAddCategory}
                disabled={!quickCatLabel.trim()}
              >
                <Plus size={16} /> 新增
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 跨模块联动提示：归档成功 → 引导去事项追踪 */}
      {taskPrompt && (
        <div className="cross-link-overlay" onClick={() => setTaskPrompt(null)}>
          <div className="cross-link-toast" onClick={(e) => e.stopPropagation()}>
            <div className="cross-link-toast__icon cross-link-toast__icon--archive">
              <FileText size={22} />
            </div>
            <div className="cross-link-toast__body">
              <p className="cross-link-toast__title">文章归档成功 🎉</p>
              <p className="cross-link-toast__desc">
                「{taskPrompt.articleTitle}」已成功归档，是否前往
                <strong>事项追踪</strong>页面将对应的事项标记为"已完成"？
              </p>
            </div>
            <div className="cross-link-toast__actions">
              <button
                className="cross-link-toast__btn cross-link-toast__btn--primary"
                onClick={() => {
                  setTaskPrompt(null);
                  navigate('/internal/tasks');
                }}
              >
                <CheckSquare size={15} /> 去标记完成
                <ArrowRight size={14} />
              </button>
              <button
                className="cross-link-toast__btn cross-link-toast__btn--ghost"
                onClick={() => setTaskPrompt(null)}
              >
                暂不需要
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
