import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useSiteContent } from '../../contexts/SiteContentContext';
import { useWysiwyg } from '../../contexts/WysiwygContext';
import EditableText from '../../components/EditableText';
// 把"其他"沉到筛选列表最末，符合产品"所有筛选中'其他'永远最后一位"的约定
import { sortWithOtherLast } from '../../utils/sortWithOtherLast';
import {
  CalendarRange,
  Search,
  Calendar,
  MapPin,
  Video,
  Lock,
  Plus,
  X,
  Check,
  ArrowRight,
  Eye,
  EyeOff,
  ExternalLink,
  AlertCircle,
  Settings2,
  Pencil,
  Trash2,
  CheckSquare,
  Link2,
  Loader2,
  Wand2,
} from 'lucide-react';
import {
  fetchAndParseArticle,
  generateSummaryAI,
  generateSummaryLocal,
} from '../../services/articleService';
import {
  SITE_KEYS,
  fetchSetting,
  saveSetting,
  subscribeSetting,
} from '../../services/siteSettingsService';
import {
  bindExistingTaskToWorkItem,
  createLinkedTask,
  fetchTasksForLinking,
} from '../../services/taskLinkService';
import { isSupabaseConfigured } from '../../lib/supabase';
import '../../components/CrossLinkToast.css';
import './InternalArticles.css';
import './EventPublish.css';

/**
 * 活动发布
 * - 数据源：useSiteContent().events，与首页「最新活动」实时同步（CRUD 走 addEvent）
 * - 筛选分类：独立持久化到 site_settings.event_categories，跨设备同步，所有成员可新增
 * - 排版/输入逻辑：完全沿用「公众号历史文章归档」的 ia- 视觉语言（卡片网格 + 顶部 header + 弹窗表单）
 * - 文案：通过 EditableText 接入 internalConfig.eventPublish
 */

// ---- 分类管理 ----
// 事件分类只有文本（无颜色），存 string[]；本地 key 与 site_settings.event_categories 双写
const EVENT_CATEGORIES_KEY = 'riemer_event_categories';

const DEFAULT_EVENT_LOCATION = '线上腾讯会议';
const EVENT_CATEGORY_RENAMES = {
  腾讯会议分享会: '经验分享',
  腾讯会议分享: '经验分享',
};
const HIDDEN_EVENT_CATEGORIES = new Set(['分享会']);
const DEFAULT_EVENT_CATEGORIES = ['经验分享', '团队招新', '其他'];

function normalizeEventCategory(category) {
  const value = String(category || '').trim();
  if (!value || HIDDEN_EVENT_CATEGORIES.has(value)) return '';
  return EVENT_CATEGORY_RENAMES[value] || value;
}

function normalizeEventCategories(categories) {
  const result = [];
  const seen = new Set();
  categories.forEach((category) => {
    const normalized = normalizeEventCategory(category);
    if (!normalized || seen.has(normalized)) return;
    result.push(normalized);
    seen.add(normalized);
  });
  return result;
}

function loadEventCategories() {
  try {
    const stored = localStorage.getItem(EVENT_CATEGORIES_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'string')) {
        return normalizeEventCategories(parsed);
      }
    }
  } catch { /* ignore */ }
  return [...DEFAULT_EVENT_CATEGORIES];
}

function saveEventCategoriesLocal(data) {
  localStorage.setItem(EVENT_CATEGORIES_KEY, JSON.stringify(data));
}

// 双写：本地 + 云端（site_settings.event_categories），便于跨设备同步
//
// ⚠️ 失败必须显式提示（而非只打 console）：
//   历史版本是 fire-and-forget 且仅 console.warn，用户在管理面板删 / 改 / 加分类
//   后 saveSetting 失败（网络抖动、RLS 拒绝、表不存在…）时，本机 UI 已经按"操作
//   成功"的样子把 UI 刷新了，其它设备却从未收到任何变更 → 报过来的"活动发布筛选
//   项无法跨设备同步"通常就是这里静默失败。改为 alert 让用户第一时间知道需要重试。
//
// 函数本身仍是 async，但上层调用处大多未 await —— 只要失败分支弹了 alert，用户就
// 能知情；改全链路串 await 会传染大量 handler 签名，性价比不高，故保留此形态。
async function persistEventCategories(data, lastSyncRef) {
  saveEventCategoriesLocal(data);
  if (!isSupabaseConfigured) return { success: true, offline: true };
  const res = await saveSetting(SITE_KEYS.EVENT_CATEGORIES, data);
  if (res.success && lastSyncRef) {
    lastSyncRef.current = res.updatedAt;
  } else if (!res.success) {
    console.warn('[EventPublish] 分类云端同步失败:', res.error);
    // 用户可见提示：避免本机假装成功、其它设备看不到改动
    try {
      alert(`活动分类保存到云端失败：${res.error || '未知错误'}\n改动已保存到本设备本地，但其它设备暂时看不到，请检查网络后重试。`);
    } catch { /* SSR 或无 window 环境下忽略 */ }
  }
  return res;
}

// 计算倒计时天数（活动日期晚于今天则返回天数，否则 null）
function getCountdownDays(eventDate) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(eventDate);
  target.setHours(0, 0, 0, 0);
  const diff = Math.ceil((target - today) / (1000 * 60 * 60 * 24));
  return diff > 0 ? diff : null;
}

const EMPTY_EVENT = {
  title: '',
  date: '',
  category: '腾讯会议分享',
  location: DEFAULT_EVENT_LOCATION,
  excerpt: '',
  officialUrl: '',
  hasReplay: false,
  replayUrl: '',
  replayPassword: '',
};

export default function EventPublish() {
  const { isAuthenticated, isAdmin, user } = useAuth();
  // flushSettingToCloud / SITE_KEYS：当我们做"分类改名 / 删除分类"这种需要级联
  // 修改 events[].category 的操作时，events 默认走 context 的 400ms 去抖写云。
  // 如果用户删完立即关 tab，events 的去抖尚未触发就被取消 → B 设备看到分类列表
  // 已同步更新，但某些老活动的 category 字段仍指向旧名 → categories useMemo 又
  // 把它补回成派生分类 → "筛选项删了又冒出来"。所以需要在级联完立即 await
  // flushSettingToCloud(EVENTS) 把 events 强制推上云端。
  const {
    events, addEvent, updateEvent, deleteEvent, internalConfig, updateInternalConfig,
    filterOptions,
    flushSettingToCloud,
    SITE_KEYS: CTX_SITE_KEYS,
  } = useSiteContent();
  const { editing } = useWysiwyg();
  const ep = internalConfig.eventPublish || {};
  const updateEP = useCallback(
    (key, val) => updateInternalConfig({ eventPublish: { [key]: val } }),
    [updateInternalConfig]
  );

  // ---- 列表筛选 ----
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('全部');

  // ---- 分类管理（跨设备同步：事件分类单独存 site_settings.event_categories）----
  const [categoryList, setCategoryList] = useState(loadEventCategories);
  const lastCatSyncRef = useRef(null);

  // 首次拉云 + 订阅变更（与 InternalArticles 的 ARTICLE_CATEGORIES 同款模式）
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;

    fetchSetting(SITE_KEYS.EVENT_CATEGORIES).then(({ value, updatedAt, error }) => {
      if (cancelled || error) return;
      // ⚠️ 允许空数组（[]）原样覆盖本地：表示用户在其它设备已把分类清空，
      // 如果这里加 `value.length > 0` 守卫，B 设备永远看不到 A 设备的"清空"动作，
      // 本地默认三类会一直保留 —— 这就是"跨设备删除不生效"的根因之一。
      // 只要云端返回的是数组（非 null 的合法结构），就以云端为准。
      if (Array.isArray(value) && value.every((x) => typeof x === 'string')) {
        const nextCategories = normalizeEventCategories(value);
        lastCatSyncRef.current = updatedAt;
        setCategoryList(nextCategories);
        saveEventCategoriesLocal(nextCategories);
      }
    });

    const unsub = subscribeSetting(SITE_KEYS.EVENT_CATEGORIES, (value, updatedAt) => {
      if (updatedAt && lastCatSyncRef.current === updatedAt) return; // 自己的回流
      // 同上：realtime 推来的空数组也要原样应用，不能被丢弃。
      if (!Array.isArray(value) || !value.every((x) => typeof x === 'string')) return;
      const nextCategories = normalizeEventCategories(value);
      lastCatSyncRef.current = updatedAt;
      setCategoryList(nextCategories);
      saveEventCategoriesLocal(nextCategories);
    });

    return () => {
      cancelled = true;
      if (unsub) unsub();
    };
  }, []);

  // ---- 普通成员快速新增分类弹窗 ----
  const [showAddCatModal, setShowAddCatModal] = useState(false);
  const [quickCatLabel, setQuickCatLabel] = useState('');
  const [quickCatError, setQuickCatError] = useState('');

  // ---- 管理员（编辑模式）分类管理面板 ----
  const [showCatManager, setShowCatManager] = useState(false);
  const [editingCatLabel, setEditingCatLabel] = useState(null); // 正在编辑的分类原名
  const [editCatDraft, setEditCatDraft] = useState('');
  const [newCatLabel, setNewCatLabel] = useState('');
  // 管理员：就地新增分类（对齐流程模板文件页的"+添加分类"体验，管理员不必先打开面板）
  const [showInlineAddCat, setShowInlineAddCat] = useState(false);

  // ---- 新建活动弹窗 ----
  const [showModal, setShowModal] = useState(false);
  const [draft, setDraft] = useState(EMPTY_EVENT);
  const [formError, setFormError] = useState('');
  const [isPublishingEvent, setIsPublishingEvent] = useState(false);
  // 新建活动弹窗内"其他"自定义分类临时值
  const [customCategoryInput, setCustomCategoryInput] = useState('');

  // ---- 已发布活动编辑弹窗 ----
  const [editingEvent, setEditingEvent] = useState(null);
  const [editCustomCategoryInput, setEditCustomCategoryInput] = useState('');
  const [editFormError, setEditFormError] = useState('');
  const [isSavingEventEdit, setIsSavingEventEdit] = useState(false);

  // ---- 公众号链接一键提取（复用文章归档的抓取/摘要能力）----
  // 用户先粘贴公众号推文链接，点「一键提取」后自动填入标题、日期、活动简介，
  // 仍可手动修改。和「公众号历史文章归档」的提取体验保持一致。
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState('');
  const [taskLinkMode, setTaskLinkMode] = useState('none');
  const [linkableTasks, setLinkableTasks] = useState([]);
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [newLinkedTaskTitle, setNewLinkedTaskTitle] = useState('');
  const [hasEditedNewTaskTitle, setHasEditedNewTaskTitle] = useState(false);
  const [taskLinkError, setTaskLinkError] = useState('');

  const handleExtractFromUrl = async () => {
    const url = (draft.officialUrl || '').trim();
    if (!url) {
      setExtractError('请先填写公众号推文链接');
      return;
    }
    setExtractError('');
    setExtracting(true);
    try {
      const parsed = await fetchAndParseArticle(url);
      // 活动简介：优先走 AI 摘要，失败则回退本地摘要，保证总能填上点东西
      let excerpt = '';
      try {
        excerpt = await generateSummaryAI(parsed.title, parsed.content);
      } catch {
        excerpt = generateSummaryLocal(parsed.content, 120);
      }
      setDraft((prev) => ({
        ...prev,
        // 已手动填过标题就不覆盖，否则用抓取到的标题
        title: prev.title && prev.title.trim() ? prev.title : (parsed.title || ''),
        date: parsed.date || prev.date,
        excerpt: excerpt || prev.excerpt,
        officialUrl: url,
      }));
    } catch (err) {
      setExtractError(err.message || '提取失败，请检查链接是否为公众号文章');
    } finally {
      setExtracting(false);
    }
  };

  // 跨模块预填：Tasks 页"未闭环清单 / 完成弹窗"带 workItemId + suggestedTitle
  // 跳过来时，自动打开新建弹窗并把标题预填上，确认发布时把 workItemId 写入 event。
  // 读一次就 replace 掉 state，避免重复触发。
  const [pendingWorkItemId, setPendingWorkItemId] = useState(null);
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    const s = location.state;
    if (!s || typeof s !== 'object') return;
    if (!s.workItemId && !s.suggestedTitle) return;
    if (s.workItemId) setPendingWorkItemId(s.workItemId);
    const defaultCat = categoryList[0] || '其他';
    setDraft({
      ...EMPTY_EVENT,
      category: defaultCat,
      title: s.suggestedTitle || '',
    });
    setCustomCategoryInput('');
    setFormError('');
    setShowModal(true);
    navigate(location.pathname, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- 回放密码弹窗（点击有回放的卡片）----
  const [replayModal, setReplayModal] = useState(null);
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // 跨模块联动提示：发布一个带 workItemId 的活动之后，引导用户去 Tasks 页
  // 把对应事项标为"已完成"形成闭环。与 InternalArticles 的 taskPrompt 等价。
  const [taskPrompt, setTaskPrompt] = useState(null);

  if (!isAuthenticated) return <Navigate to="/login" replace />;

  // 分类（"全部" + 预设分类 + events 中出现但不在预设里的历史分类）
  // 老活动里的"分享会 / 经验分享"不再作为筛选项展示；其它历史分类保留在列表末尾。
  // 分类按插入顺序去重。
  // 最后再 sortWithOtherLast 把"其他"沉到末尾 —— 需求：所有筛选项中
  // "其他"永远是最后一个，无论它是出现在默认分类、用户新增还是历史
  // 动态补回的位置。"全部"因为不是"其他"会保持在首位不受影响。
  const categories = useMemo(() => {
    const result = ['全部', ...categoryList];
    const set = new Set(result);
    events.forEach((e) => {
      const category = normalizeEventCategory(e.category);
      if (category && !set.has(category)) {
        result.push(category);
        set.add(category);
      }
    });
    return sortWithOtherLast(result);
  }, [events, categoryList]);

  const eventTaskOptions = useMemo(() => {
    const usedWorkItemIds = new Set(events.map((event) => event.workItemId).filter(Boolean));
    return linkableTasks.filter((task) => {
      if (!task) return false;
      if (task.workItemKind && task.workItemKind !== 'event') return false;
      if (task.workItemId && usedWorkItemIds.has(task.workItemId)) return false;
      return true;
    });
  }, [events, linkableTasks]);

  useEffect(() => {
    if (!showModal) return;
    let cancelled = false;
    fetchTasksForLinking().then((tasks) => {
      if (!cancelled) setLinkableTasks(tasks || []);
    });
    return () => { cancelled = true; };
  }, [showModal]);

  useEffect(() => {
    if (taskLinkMode !== 'new' || hasEditedNewTaskTitle) return;
    setNewLinkedTaskTitle(draft.title || '');
  }, [taskLinkMode, hasEditedNewTaskTitle, draft.title]);

  // 排序：未来活动优先（按日期升序），过去活动按降序
  const sortedEvents = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const upcoming = [];
    const past = [];
    events.forEach((e) => {
      const d = new Date(e.date);
      d.setHours(0, 0, 0, 0);
      // 日期缺失/非法 → Invalid Date，统一归到「过去」，避免后续 localeCompare 崩溃
      if (!Number.isNaN(d.getTime()) && d >= today) upcoming.push(e);
      else past.push(e);
    });
    // 用 (x.date || '') 兜底：历史/异常数据里 date 可能为 null/undefined，
    // 直接 a.date.localeCompare 会抛 "Cannot read properties of undefined"，
    // 在 useMemo（渲染期）抛错会被 ErrorBoundary 捕获成「页面加载出错了」。
    upcoming.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    past.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    return [...upcoming, ...past];
  }, [events]);

  // 过滤
  const filtered = useMemo(() => {
    return sortedEvents.filter((e) => {
      const matchesSearch =
        !searchTerm ||
        (e.title || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (e.excerpt || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (e.location || '').toLowerCase().includes(searchTerm.toLowerCase());
      const matchesCat = selectedCategory === '全部' || e.category === selectedCategory;
      return matchesSearch && matchesCat;
    });
  }, [sortedEvents, searchTerm, selectedCategory]);

  // ---- 分类 CRUD ----
  // 普通成员快速新增（打开弹窗）
  const openAddCatModal = () => {
    setQuickCatLabel('');
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
    if (categoryList.includes(label)) {
      setQuickCatError('该分类已存在');
      return;
    }
    const updated = [...categoryList, label];
    setCategoryList(updated);
    persistEventCategories(updated, lastCatSyncRef);
    setShowAddCatModal(false);
  };

  // 管理员在编辑模式下 —— 重命名 / 删除 / 追加
  const startEditCategory = (label) => {
    setEditingCatLabel(label);
    setEditCatDraft(label);
  };
  const saveEditCategory = async () => {
    const next = editCatDraft.trim();
    if (!next) return;
    const prev = editingCatLabel;
    if (next === prev) {
      setEditingCatLabel(null);
      setEditCatDraft('');
      return;
    }
    // 重名校验（与其他托管分类冲突则拒绝）
    if (categoryList.includes(next) && next !== prev) {
      alert('该分类已存在');
      return;
    }

    // 1) 更新 categoryList：
    //    - 若 prev 是托管分类 → 原地改名
    //    - 若 prev 是派生分类（不在 categoryList 里）→ 把新 label 领养进 categoryList
    let updated;
    if (categoryList.includes(prev)) {
      updated = categoryList.map((c) => (c === prev ? next : c));
    } else {
      updated = [...categoryList, next];
    }
    setCategoryList(updated);
    persistEventCategories(updated, lastCatSyncRef);

    // 2) 同步把所有引用旧 label 的活动 category 改成新 label
    //    （托管/派生都要做）
    const affected = events.filter((e) => e.category === prev);
    affected.forEach((e) => updateEvent(e.id, { category: next }));

    // 3) 立即把 events 推上云端 —— 不能依赖 context 的 400ms 去抖：
    //    用户改完名立刻关 tab，去抖 setTimeout 会被 cancel，云端 events 里的
    //    category 字段还停留在旧名，B 设备的 categories useMemo 会把旧名作为
    //    "历史派生分类"自动补回筛选项，造成改名看起来没生效。
    if (affected.length > 0 && flushSettingToCloud && CTX_SITE_KEYS?.EVENTS) {
      // 用最新的 events 计算 nextEvents（此刻 setEvents 还未提交到 state，
      // 这里直接根据快照构造同样的结果）
      const nextEvents = events.map((e) => (e.category === prev ? { ...e, category: next } : e));
      const res = await flushSettingToCloud(CTX_SITE_KEYS.EVENTS, nextEvents);
      if (!res?.success) {
        alert(`分类改名已在本设备生效，但活动列表同步失败：${res?.error || '未知错误'}\n其它设备可能仍显示旧分类名，请检查网络后重试。`);
      }
    }

    // 如果当前选中的正是被改名的分类，同步选中到新名
    if (selectedCategory === prev) setSelectedCategory(next);
    setEditingCatLabel(null);
    setEditCatDraft('');
  };
  const handleDeleteCategory = async (label) => {
    const affected = events.filter((e) => e.category === label);
    const msg = affected.length > 0
      ? `确定要删除分类「${label}」吗？\n该分类下有 ${affected.length} 个活动，删除后这些活动的分类会被清空（活动本身保留）。`
      : `确定要删除分类「${label}」吗？`;
    if (!window.confirm(msg)) return;

    // 1) 从托管列表移除（如果是托管的）
    if (categoryList.includes(label)) {
      const updated = categoryList.filter((c) => c !== label);
      setCategoryList(updated);
      persistEventCategories(updated, lastCatSyncRef);
    }
    // 2) 级联清空受影响活动的 category → 派生分类随之消失
    affected.forEach((e) => updateEvent(e.id, { category: '' }));

    // 3) 立即把 events 推上云端（同 saveEditCategory 的理由，避免派生分类"复活"）
    if (affected.length > 0 && flushSettingToCloud && CTX_SITE_KEYS?.EVENTS) {
      const nextEvents = events.map((e) => (e.category === label ? { ...e, category: '' } : e));
      const res = await flushSettingToCloud(CTX_SITE_KEYS.EVENTS, nextEvents);
      if (!res?.success) {
        alert(`分类已在本设备删除，但活动列表同步失败：${res?.error || '未知错误'}\n其它设备可能仍把该分类显示在筛选中，请检查网络后重试。`);
      }
    }

    if (selectedCategory === label) setSelectedCategory('全部');
  };
  const handleAddCategoryInManager = () => {
    const label = newCatLabel.trim();
    if (!label) {
      setNewCatLabel('');
      return;
    }
    // 重名检测：忽略大小写与前后空白，命中则弹窗提示并保留输入，方便用户改名
    // （原实现是静默清空，用户会误以为添加成功但下方列表没变化）
    const normalized = label.toLowerCase();
    if (categoryList.some((c) => String(c).trim().toLowerCase() === normalized)) {
      alert(`分类「${label}」已存在，请换一个名字。`);
      return;
    }
    const updated = [...categoryList, label];
    setCategoryList(updated);
    persistEventCategories(updated, lastCatSyncRef);
    setNewCatLabel('');
  };

  // ---- 弹窗操作 ----
  const openModal = () => {
    // 新建默认选第一个预设分类
    const defaultCat = categoryList[0] || '其他';
    setDraft({ ...EMPTY_EVENT, category: defaultCat });
    setCustomCategoryInput('');
    setFormError('');
    setExtractError('');
    setExtracting(false);
    setTaskLinkMode('none');
    setSelectedTaskId('');
    setNewLinkedTaskTitle('');
    setHasEditedNewTaskTitle(false);
    setTaskLinkError('');
    setShowModal(true);
  };

  const closeModal = () => {
    if (isPublishingEvent) return;
    setShowModal(false);
    setDraft(EMPTY_EVENT);
    setCustomCategoryInput('');
    setFormError('');
    setExtractError('');
    setExtracting(false);
    setTaskLinkMode('none');
    setSelectedTaskId('');
    setNewLinkedTaskTitle('');
    setHasEditedNewTaskTitle(false);
    setTaskLinkError('');
  };

  const handleSave = async () => {
    if (isPublishingEvent) return;
    if (!draft.title.trim()) {
      setFormError('请填写活动标题');
      return;
    }
    if (!draft.date) {
      setFormError('请选择活动日期');
      return;
    }
    if (draft.hasReplay && !draft.replayUrl.trim()) {
      setFormError('已勾选「有回放」，请填写回放链接');
      return;
    }
    // 如果选了"__custom__"（自定义），用输入的文本作为分类
    let finalCategory = normalizeEventCategory(draft.category);
    if (draft.category === '__custom__') {
      const custom = customCategoryInput.trim();
      if (!custom) {
        setFormError('请输入自定义分类名称');
        return;
      }
      finalCategory = normalizeEventCategory(custom);
      // 若新分类不在分类列表，顺带添加进去（让它成为可筛选项）
      if (!categoryList.includes(finalCategory)) {
        const updated = [...categoryList, finalCategory];
        setCategoryList(updated);
        await persistEventCategories(updated, lastCatSyncRef);
      }
    }
    let linkedWorkItemId = pendingWorkItemId || null;
    if (!linkedWorkItemId && taskLinkMode === 'existing') {
      const task = linkableTasks.find((item) => String(item.id) === String(selectedTaskId));
      if (!task) {
        setTaskLinkError('请选择要绑定的事项');
        return;
      }
      const res = await bindExistingTaskToWorkItem(task, 'event');
      if (!res.success) {
        setTaskLinkError(`事项绑定失败：${res.error || '未知错误'}`);
        return;
      }
      linkedWorkItemId = res.workItemId;
    }
    if (!linkedWorkItemId && taskLinkMode === 'new') {
      const taskTitle = (hasEditedNewTaskTitle ? newLinkedTaskTitle : draft.title).trim();
      if (!taskTitle) {
        setTaskLinkError('请输入新事项标题');
        return;
      }
      const res = await createLinkedTask({
        title: taskTitle,
        kind: 'event',
        category: filterOptions?.taskCategories?.includes('线上分享')
          ? '线上分享'
          : (filterOptions?.taskCategories?.[0] || ''),
        assigneeId: user?.id || null,
        completedAt: draft.date,
        creatorId: user?.id || null,
        creatorName: user?.nickname || user?.name || user?.email || '',
      });
      if (!res.success) {
        setTaskLinkError(`事项创建失败：${res.error || '未知错误'}`);
        return;
      }
      linkedWorkItemId = res.workItemId;
    }

    const newEvent = {
      ...draft,
      category: finalCategory,
      id: `evt-${Date.now()}`,
      title: draft.title.trim(),
      location: draft.location.trim(),
      excerpt: draft.excerpt.trim(),
      officialUrl: draft.officialUrl.trim(),
      replayUrl: draft.replayUrl.trim(),
      replayPassword: draft.replayPassword.trim(),
      createdById: user?.id || null,
      createdBy: user?.nickname || user?.name || user?.email || '',
      // 跨模块关联（见 src/utils/workItem.js）：
      // 从 Tasks 页带过来的 workItemId 写入新 event，让事项/活动两侧形成闭环。
      // events 存在 site_settings.value 的 JSON 数组里，workItemId 作为普通
      // 字段即可，无需 Supabase schema 迁移。
      workItemId: linkedWorkItemId,
    };
    const savedTitle = draft.title.trim();
    const hadWorkItem = !!pendingWorkItemId;
    const nextEvents = [newEvent, ...events];

    setFormError('');
    setIsPublishingEvent(true);
    try {
      const res = await flushSettingToCloud(CTX_SITE_KEYS.EVENTS, nextEvents);
      if (!res?.success) {
        setFormError(`活动没有写入云端：${res?.error || '未知错误'}。请稍后重试。`);
        return;
      }
      addEvent(newEvent);
    } finally {
      setIsPublishingEvent(false);
    }

    setPendingWorkItemId(null);
    closeModal();
    // 发布成功后：如果是带工作项关联进来的 → 弹"去标记事项完成"提示；
    // 否则保持静默（独立发布活动的常规路径不打扰）。
    if (hadWorkItem) {
      setTaskPrompt({ eventTitle: savedTitle });
    }
  };

  const openEventEditor = (event) => {
    setEditingEvent({
      ...EMPTY_EVENT,
      ...event,
      category: normalizeEventCategory(event.category) || (categoryList[0] || '其他'),
      officialUrl: event.officialUrl || '',
      replayUrl: event.replayUrl || '',
      replayPassword: event.replayPassword || '',
      hasReplay: !!event.hasReplay,
    });
    setEditCustomCategoryInput('');
    setEditFormError('');
  };

  const closeEventEditor = () => {
    if (isSavingEventEdit) return;
    setEditingEvent(null);
    setEditCustomCategoryInput('');
    setEditFormError('');
  };

  const handleSaveEventEdit = async () => {
    if (!editingEvent || isSavingEventEdit) return;
    if (!editingEvent.title.trim()) {
      setEditFormError('请填写活动标题');
      return;
    }
    if (!editingEvent.date) {
      setEditFormError('请选择活动日期');
      return;
    }
    if (editingEvent.hasReplay && !editingEvent.replayUrl.trim()) {
      setEditFormError('已勾选「有回放」，请填写回放链接');
      return;
    }

    let finalCategory = normalizeEventCategory(editingEvent.category);
    if (editingEvent.category === '__custom__') {
      const custom = editCustomCategoryInput.trim();
      if (!custom) {
        setEditFormError('请输入自定义分类名称');
        return;
      }
      finalCategory = normalizeEventCategory(custom);
      if (!categoryList.includes(finalCategory)) {
        const updated = [...categoryList, finalCategory];
        setCategoryList(updated);
        await persistEventCategories(updated, lastCatSyncRef);
      }
    }

    const updates = {
      title: editingEvent.title.trim(),
      date: editingEvent.date,
      category: finalCategory,
      location: (editingEvent.location || '').trim(),
      excerpt: (editingEvent.excerpt || '').trim(),
      officialUrl: (editingEvent.officialUrl || '').trim(),
      hasReplay: !!editingEvent.hasReplay,
      replayUrl: (editingEvent.replayUrl || '').trim(),
      replayPassword: (editingEvent.replayPassword || '').trim(),
    };
    const nextEvents = events.map((event) =>
      String(event.id) === String(editingEvent.id) ? { ...event, ...updates } : event,
    );

    setEditFormError('');
    setIsSavingEventEdit(true);
    try {
      const res = await flushSettingToCloud(CTX_SITE_KEYS.EVENTS, nextEvents);
      if (!res?.success) {
        setEditFormError(`活动没有写入云端：${res?.error || '未知错误'}。请稍后重试。`);
        return;
      }
      updateEvent(editingEvent.id, updates);
      setEditingEvent(null);
      setEditCustomCategoryInput('');
      setEditFormError('');
    } finally {
      setIsSavingEventEdit(false);
    }
  };

  const handleDeleteEvent = async (event) => {
    if (!event) return;
    const title = event.title || '未命名活动';
    if (!window.confirm(`确定删除「${title}」这个活动吗？`)) return;

    const nextEvents = events.filter((item) => String(item.id) !== String(event.id));
    const res = await flushSettingToCloud(CTX_SITE_KEYS.EVENTS, nextEvents);
    if (!res?.success) {
      alert(`活动没有从云端删除：${res?.error || '未知错误'}。请稍后重试。`);
      return;
    }
    deleteEvent(event.id);
  };

  // ---- 卡片点击：
  //   1. 优先跳转公众号推文链接（officialUrl）
  //   2. 其次：如果有回放 → 弹密码框
  //   3. 否则不响应
  const handleCardClick = (event) => {
    if (event.officialUrl && /^https?:\/\//i.test(event.officialUrl)) {
      window.open(event.officialUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    if (event.hasReplay && event.replayUrl) {
      setReplayModal(event);
      setPasswordInput('');
      setPasswordError('');
      setShowPassword(false);
    }
  };

  const handlePasswordSubmit = () => {
    if (!replayModal) return;
    if (passwordInput === replayModal.replayPassword) {
      window.open(replayModal.replayUrl, '_blank', 'noopener,noreferrer');
      setReplayModal(null);
    } else {
      setPasswordError('密码不正确，请重试');
    }
  };

  const closeReplayModal = () => {
    setReplayModal(null);
    setPasswordInput('');
    setPasswordError('');
    setShowPassword(false);
  };

  return (
    <div className="ia-list-page">
      <div className="container">
        {/* Header（沿用 ia-list__header 排版） */}
        <div className="ia-list__header">
          <div>
            <h1>
              <CalendarRange size={28} />{' '}
              <EditableText
                as="span"
                value={ep.pageTitle || '活动发布'}
                configKey="eventPublish.pageTitle"
                onChange={(v) => updateEP('pageTitle', v)}
              />
            </h1>
            <EditableText
              as="p"
              value={ep.pageDesc || '发布与维护团队活动，数据与首页「最新活动」实时同步'}
              configKey="eventPublish.pageDesc"
              onChange={(v) => updateEP('pageDesc', v)}
            />
          </div>
          {isAdmin && !editing && (
            <button className="btn btn-primary" onClick={openModal}>
              <Plus size={16} />{' '}
              <EditableText
                as="span"
                value={ep.btnNew || '新建活动'}
                configKey="eventPublish.btnNew"
                onChange={(v) => updateEP('btnNew', v)}
              />
            </button>
          )}
        </div>

        {/* 筛选 */}
        <div className="ia-list__filters">
          <div className="ia-list__search">
            <Search size={18} className="ia-list__search-icon" />
            <input
              type="text"
              placeholder="搜索活动…"
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
                //   - 托管分类：已在 categoryList 数组里
                //   - 动态派生分类：来自 events[].category 但 categoryList 里还没有；
                //     重命名时会自动"领养"进 categoryList；删除时会同步把引用该分类的活动
                //     category 清空，让派生分类真正消失
                const canEditInline = isAdmin;
                const isRenaming = canEditInline && editingCatLabel === cat;

                if (isRenaming) {
                  return (
                    <span key={cat} className="ia-list__cat-rename">
                      <input
                        type="text"
                        className="ia-list__cat-rename-input"
                        value={editCatDraft}
                        onChange={(e) => setEditCatDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveEditCategory();
                          if (e.key === 'Escape') {
                            setEditingCatLabel(null);
                            setEditCatDraft('');
                          }
                        }}
                        autoFocus
                      />
                      <button
                        className="ia-list__cat-rename-confirm"
                        onClick={saveEditCategory}
                        disabled={!editCatDraft.trim()}
                        title="确认"
                      >
                        <Check size={14} />
                      </button>
                      <button
                        className="ia-list__cat-rename-cancel"
                        onClick={() => { setEditingCatLabel(null); setEditCatDraft(''); }}
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
                            startEditCategory(cat);
                          }}
                          title="重命名"
                        >
                          <Pencil size={12} />
                        </button>
                        <button
                          className="ia-list__cat-delete"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteCategory(cat);
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

              {/* 就地新增：管理员 inline 输入（对齐流程模板文件页）；普通成员走原 modal */}
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
                          handleAddCategoryInManager();
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
                        handleAddCategoryInManager();
                        setShowInlineAddCat(false);
                      }}
                      disabled={!newCatLabel.trim() || categoryList.includes(newCatLabel.trim())}
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
            {/* 管理员编辑模式：进入分类管理（面板式批量管理，作为就地编辑的备用入口） */}
            {isAdmin && editing && (
              <button
                className={`ia-list__manage-btn ${showCatManager ? 'ia-list__manage-btn--active' : ''}`}
                onClick={() => setShowCatManager(!showCatManager)}
                title="管理筛选分类（批量）"
              >
                <Settings2 size={16} />
              </button>
            )}
          </div>

          {/* 分类管理面板（仅管理员 + 编辑模式）*/}
          {isAdmin && editing && showCatManager && (
            <div className="ia-cat-manager card">
              <div className="ia-cat-manager__header">
                <h4><Settings2 size={16} /> 筛选分类管理</h4>
                <button className="ia-cat-manager__close" onClick={() => setShowCatManager(false)}>
                  <X size={16} />
                </button>
              </div>

              {/* 现有分类列表 */}
              <div className="ia-cat-manager__list">
                {categoryList.map((label) => (
                  <div key={label} className="ia-cat-item">
                    {editingCatLabel === label ? (
                      <div className="ia-cat-item__edit">
                        <div className="ia-cat-item__edit-row">
                          <input
                            type="text"
                            className="ia-cat-item__edit-input"
                            value={editCatDraft}
                            onChange={(e) => setEditCatDraft(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && saveEditCategory()}
                            autoFocus
                          />
                          <button
                            className="ia-cat-item__action ia-cat-item__action--save"
                            onClick={saveEditCategory}
                            title="保存"
                          >
                            <Check size={14} />
                          </button>
                          <button
                            className="ia-cat-item__action"
                            onClick={() => { setEditingCatLabel(null); setEditCatDraft(''); }}
                            title="取消"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="ia-cat-item__display">
                        <span className="ia-cat-item__label">{label}</span>
                        <div className="ia-cat-item__actions">
                          <button
                            className="ia-cat-item__action"
                            onClick={() => startEditCategory(label)}
                            title="重命名"
                          >
                            <Pencil size={12} />
                          </button>
                          <button
                            className="ia-cat-item__action ia-cat-item__action--danger"
                            onClick={() => handleDeleteCategory(label)}
                            title="删除"
                          >
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
                  <input
                    type="text"
                    className="ia-cat-manager__add-input"
                    placeholder="输入新分类名称..."
                    value={newCatLabel}
                    onChange={(e) => setNewCatLabel(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddCategoryInManager()}
                  />
                  <button
                    className="ia-cat-manager__add-btn"
                    onClick={handleAddCategoryInManager}
                    disabled={!newCatLabel.trim() || categoryList.includes(newCatLabel.trim())}
                  >
                    <Plus size={14} /> 添加
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 活动卡片列表（沿用 ia-card 视觉） */}
        <div className="ia-list__grid">
          {filtered.map((event) => {
            const countdownDays = getCountdownDays(event.date);
            const hasOfficial = !!(event.officialUrl && /^https?:\/\//i.test(event.officialUrl));
            const clickable = hasOfficial || (event.hasReplay && event.replayUrl);
            const canManageEvent = isAdmin || (
              event.createdById && String(event.createdById) === String(user?.id)
            );
            return (
              <div
                key={event.id}
                className={`ia-card card ep-card ${clickable ? 'ep-card--clickable' : ''}`}
                onClick={() => handleCardClick(event)}
                style={clickable ? { cursor: 'pointer' } : undefined}
              >
                {canManageEvent && (
                  <button
                    type="button"
                    className="ia-card__edit-btn"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      openEventEditor(event);
                    }}
                    title="编辑活动信息"
                  >
                    <Pencil size={14} />
                  </button>
                )}
                {canManageEvent && (
                  <button
                    type="button"
                    className="ia-card__edit-btn ia-card__delete-btn"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleDeleteEvent(event);
                    }}
                    title="删除活动"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
                <div className="ia-card__body">
                  {countdownDays && (
                    <div className="ep-card__top">
                      <span className="ep-card__badge ep-card__badge--upcoming">
                        <Calendar size={12} /> {countdownDays} 天后
                      </span>
                    </div>
                  )}
                  <h3 className="ia-card__title">{event.title}</h3>
                  {event.excerpt && (
                    <p className="ia-card__excerpt">{event.excerpt}</p>
                  )}
                  {/* 信息标签统一排布（与首页一致）：日期 · 地点 · 回放 · 是否需密码 */}
                  <div className="ia-card__footer ep-card__info">
                    <span className="ia-card__meta">
                      <Calendar size={13} /> {event.date}
                    </span>
                    {event.location && (
                      <span className="ia-card__meta">
                        <MapPin size={13} /> {event.location}
                      </span>
                    )}
                    {event.hasReplay && (
                      <span className="ep-card__badge ep-card__badge--replay">
                        <Video size={12} /> 回放
                      </span>
                    )}
                    {event.hasReplay && event.replayPassword && (
                      <span className="ia-card__meta ep-card__meta--lock">
                        <Lock size={12} /> 需密码
                      </span>
                    )}
                  </div>
                  {normalizeEventCategory(event.category) && (
                    <div className="ep-card__category-row">
                      <span className="ia-card__category">{normalizeEventCategory(event.category)}</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {filtered.length === 0 && (
          <div className="ia-list__empty">
            <CalendarRange size={48} />
            <h3>{events.length === 0 ? '还没有活动' : '未找到匹配的活动'}</h3>
            <p>
              {events.length === 0
                ? '点击右上角「新建活动」开始发布'
                : '尝试更换搜索关键词或分类'}
            </p>
          </div>
        )}
      </div>

      {/* ========== 新建活动弹窗（沿用 ia-modal 排版） ========== */}
      {showModal && (
        <div className="ia-modal-overlay" onClick={closeModal}>
          <div className="ia-modal" onClick={(e) => e.stopPropagation()}>
            <div className="ia-modal__header">
              <h2>新建活动</h2>
              <button className="ia-modal__close" onClick={closeModal}>
                <X size={20} />
              </button>
            </div>

            <div className="ia-modal__body">
              <div className="ia-modal__step-confirm">
                {/* 跨模块来源提示：从 Tasks 页跳过来时顶部横幅说明 */}
                {pendingWorkItemId && (
                  <div
                    className="ia-modal__error"
                    style={{
                      background: '#E3F2FD',
                      color: '#0D47A1',
                      border: '1px solid #90CAF9',
                      marginBottom: 'var(--space-md)',
                    }}
                  >
                    <Check size={14} />
                    <span>
                      正在为事项「{draft.title || '未命名事项'}」发布对应活动，
                      保存后会自动标记为闭环。
                    </span>
                  </div>
                )}
                {formError && (
                  <div className="ia-modal__error ep-modal__top-error">
                    <AlertCircle size={16} /> {formError}
                  </div>
                )}

                {/* 公众号推文链接 + 一键提取 */}
                <div className="ia-modal__field">
                  <label className="ia-modal__label">
                    <ExternalLink size={14} /> 公众号推文链接
                  </label>
                  <div className="ia-modal__url-row">
                    <div className="ia-modal__url-input-wrap">
                      <Link2 size={18} className="ia-modal__url-icon" />
                      <input
                        type="url"
                        className="ia-modal__url-input"
                        placeholder="https://mp.weixin.qq.com/s/…（填写后点击卡片将直接跳转）"
                        value={draft.officialUrl}
                        onChange={(e) => {
                          setDraft({ ...draft, officialUrl: e.target.value });
                          setFormError('');
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !extracting && draft.officialUrl.trim()) {
                            e.preventDefault();
                            handleExtractFromUrl();
                          }
                        }}
                        disabled={extracting}
                      />
                    </div>
                    <button
                      type="button"
                      className="btn btn-primary ia-modal__fetch-btn"
                      onClick={handleExtractFromUrl}
                      disabled={extracting || !draft.officialUrl.trim()}
                    >
                      {extracting ? (
                        <>
                          <Loader2 size={14} className="ia-modal__spinner" />
                          <span>提取中</span>
                        </>
                      ) : (
                        <>
                          <Wand2 size={14} />
                          <span>一键提取</span>
                        </>
                      )}
                    </button>
                  </div>
                  {extractError && (
                    <div className="ia-modal__error" style={{ marginTop: 8 }}>
                      <AlertCircle size={16} /> {extractError}
                    </div>
                  )}
                  <p style={{
                    fontSize: 12,
                    color: 'var(--color-text-muted)',
                    marginTop: 8,
                    lineHeight: 1.6,
                  }}>
                    粘贴公众号推文链接后点「一键提取」，系统会自动填入标题、活动日期与活动简介；提取后仍可手动修改。
                  </p>
                </div>

                {/* 标题 */}
                <div className="ia-modal__field">
                  <label className="ia-modal__label">活动标题 *</label>
                  <input
                    type="text"
                    className="ia-modal__text-input"
                    placeholder="请输入活动标题…"
                    value={draft.title}
                    onChange={(e) => {
                      setDraft({ ...draft, title: e.target.value });
                      setFormError('');
                    }}
                    autoFocus
                  />
                </div>

                {/* 日期 + 分类 同行 */}
                <div className="ep-modal__row">
                  <div className="ia-modal__field">
                    <label className="ia-modal__label">活动日期 *</label>
                    <input
                      type="date"
                      className="ia-modal__text-input"
                      value={draft.date}
                      onChange={(e) => {
                        setDraft({ ...draft, date: e.target.value });
                        setFormError('');
                      }}
                    />
                  </div>
                  <div className="ia-modal__field">
                    <label className="ia-modal__label">分类</label>
                    <select
                      className="ia-modal__text-input"
                      value={draft.category}
                      onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                    >
                      {categoryList.map((cat) => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                      {/* 若当前 draft.category 是历史分类（不在预设里），先把它显示为选项 */}
                      {draft.category &&
                        !categoryList.includes(draft.category) &&
                        draft.category !== '__custom__' && (
                          <option value={draft.category}>{draft.category}</option>
                        )}
                      <option value="__custom__">＋ 自定义…</option>
                    </select>
                    {draft.category === '__custom__' && (
                      <input
                        type="text"
                        className="ia-modal__text-input"
                        placeholder="请输入新分类名称，保存时将自动加入筛选项"
                        value={customCategoryInput}
                        onChange={(e) => setCustomCategoryInput(e.target.value)}
                        style={{ marginTop: 8 }}
                        maxLength={20}
                      />
                    )}
                  </div>
                </div>

                {/* 事项绑定 */}
                <div className="ia-modal__field">
                  <label className="ia-modal__label">
                    <CheckSquare size={16} /> 对应事项
                  </label>
                  {pendingWorkItemId ? (
                    <div className="ia-work-link__notice">
                      已从事项追踪带入关联：「{draft.title || '未命名事项'}」
                    </div>
                  ) : (
                    <div className="ia-work-link">
                      <div className="ia-work-link__modes">
                        <label className="ia-work-link__mode">
                          <input
                            type="radio"
                            name="eventTaskLinkMode"
                            value="none"
                            checked={taskLinkMode === 'none'}
                            onChange={() => setTaskLinkMode('none')}
                          />
                          不绑定
                        </label>
                        <label className="ia-work-link__mode">
                          <input
                            type="radio"
                            name="eventTaskLinkMode"
                            value="existing"
                            checked={taskLinkMode === 'existing'}
                            onChange={() => setTaskLinkMode('existing')}
                          />
                          绑定已有事项
                        </label>
                        <label className="ia-work-link__mode">
                          <input
                            type="radio"
                            name="eventTaskLinkMode"
                            value="new"
                            checked={taskLinkMode === 'new'}
                            onChange={() => {
                              setTaskLinkMode('new');
                              if (!hasEditedNewTaskTitle) setNewLinkedTaskTitle(draft.title || '');
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
                          <option value="">选择一个未绑定活动发布的事项</option>
                          {eventTaskOptions.map((task) => (
                            <option key={task.id} value={task.id}>
                              {task.title || '未命名事项'}{task.status ? `（${task.status}）` : ''}
                            </option>
                          ))}
                        </select>
                      )}

                      {taskLinkMode === 'new' && (
                        <div className="ia-work-link__new">
                          <input
                            type="text"
                            className="ia-modal__text-input"
                            value={newLinkedTaskTitle}
                            onChange={(e) => {
                              setNewLinkedTaskTitle(e.target.value);
                              setHasEditedNewTaskTitle(true);
                              setTaskLinkError('');
                            }}
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

                {/* 地点 */}
                <div className="ia-modal__field">
                  <label className="ia-modal__label">地点</label>
                  <input
                    type="text"
                    className="ia-modal__text-input"
                    placeholder="如：线上腾讯会议 / 西南财经大学"
                    value={draft.location}
                    onChange={(e) => setDraft({ ...draft, location: e.target.value })}
                  />
                </div>

                {/* 摘要 */}
                <div className="ia-modal__field">
                  <label className="ia-modal__label">活动简介</label>
                  <textarea
                    className="ia-modal__textarea"
                    placeholder="简要介绍活动内容…"
                    value={draft.excerpt}
                    onChange={(e) => setDraft({ ...draft, excerpt: e.target.value })}
                    rows={3}
                  />
                </div>

                {/* 回放设置 */}
                <div className="ia-modal__field">
                  <label className="ia-modal__label">
                    <input
                      type="checkbox"
                      checked={draft.hasReplay}
                      onChange={(e) => setDraft({ ...draft, hasReplay: e.target.checked })}
                      style={{ marginRight: 6 }}
                    />
                    <Video size={14} /> 提供活动回放（需设置链接与访问密码）
                  </label>
                </div>

                {draft.hasReplay && (
                  <>
                    <div className="ia-modal__field">
                      <label className="ia-modal__label">设置回放链接 *</label>
                      <input
                        type="url"
                        className="ia-modal__text-input"
                        placeholder="https://meeting.tencent.com/…"
                        value={draft.replayUrl}
                        onChange={(e) => {
                          setDraft({ ...draft, replayUrl: e.target.value });
                          setFormError('');
                        }}
                      />
                    </div>
                    <div className="ia-modal__field">
                      <label className="ia-modal__label">设置访问密码</label>
                      <input
                        type="text"
                        className="ia-modal__text-input"
                        placeholder="为回放设置访问密码，留空则无需密码即可访问"
                        value={draft.replayPassword}
                        onChange={(e) => setDraft({ ...draft, replayPassword: e.target.value })}
                      />
                    </div>
                  </>
                )}

              </div>
            </div>

            <div className="ia-modal__footer">
              <button className="btn btn-ghost" onClick={closeModal} disabled={isPublishingEvent}>
                取消
              </button>
              <button className="btn btn-primary" onClick={handleSave} disabled={isPublishingEvent}>
                <Check size={16} /> {isPublishingEvent ? '发布中...' : '确认发布'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========== 编辑活动弹窗 ========== */}
      {editingEvent && (
        <div className="ia-modal-overlay" onClick={closeEventEditor}>
          <div className="ia-modal" onClick={(e) => e.stopPropagation()}>
            <div className="ia-modal__header">
              <h2>编辑活动信息</h2>
              <button className="ia-modal__close" onClick={closeEventEditor} disabled={isSavingEventEdit}>
                <X size={20} />
              </button>
            </div>

            <div className="ia-modal__body">
              <div className="ia-modal__step-confirm">
                <div className="ia-modal__field">
                  <label className="ia-modal__label">
                    <ExternalLink size={14} /> 公众号推文链接
                  </label>
                  <input
                    type="url"
                    className="ia-modal__text-input"
                    value={editingEvent.officialUrl || ''}
                    onChange={(e) => setEditingEvent({ ...editingEvent, officialUrl: e.target.value })}
                    placeholder="https://mp.weixin.qq.com/s/…（填写后点击卡片将直接跳转）"
                  />
                </div>

                <div className="ia-modal__field">
                  <label className="ia-modal__label">活动标题 *</label>
                  <input
                    type="text"
                    className="ia-modal__text-input"
                    value={editingEvent.title}
                    onChange={(e) => setEditingEvent({ ...editingEvent, title: e.target.value })}
                    autoFocus
                  />
                </div>

                <div className="ep-modal__row">
                  <div className="ia-modal__field">
                    <label className="ia-modal__label">活动日期 *</label>
                    <input
                      type="date"
                      className="ia-modal__text-input"
                      value={editingEvent.date || ''}
                      onChange={(e) => setEditingEvent({ ...editingEvent, date: e.target.value })}
                    />
                  </div>
                  <div className="ia-modal__field">
                    <label className="ia-modal__label">分类</label>
                    <select
                      className="ia-modal__text-input"
                      value={editingEvent.category}
                      onChange={(e) => setEditingEvent({ ...editingEvent, category: e.target.value })}
                    >
                      {categoryList.map((cat) => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                      {editingEvent.category &&
                        !categoryList.includes(editingEvent.category) &&
                        editingEvent.category !== '__custom__' && (
                          <option value={editingEvent.category}>{editingEvent.category}</option>
                        )}
                      <option value="__custom__">＋ 自定义…</option>
                    </select>
                    {editingEvent.category === '__custom__' && (
                      <input
                        type="text"
                        className="ia-modal__text-input"
                        placeholder="请输入新分类名称，保存时将自动加入筛选项"
                        value={editCustomCategoryInput}
                        onChange={(e) => setEditCustomCategoryInput(e.target.value)}
                        style={{ marginTop: 8 }}
                        maxLength={20}
                      />
                    )}
                  </div>
                </div>

                <div className="ia-modal__field">
                  <label className="ia-modal__label">地点</label>
                  <input
                    type="text"
                    className="ia-modal__text-input"
                    value={editingEvent.location || ''}
                    onChange={(e) => setEditingEvent({ ...editingEvent, location: e.target.value })}
                    placeholder="如：线上腾讯会议 / 西南财经大学"
                  />
                </div>

                <div className="ia-modal__field">
                  <label className="ia-modal__label">活动简介</label>
                  <textarea
                    className="ia-modal__textarea"
                    value={editingEvent.excerpt || ''}
                    onChange={(e) => setEditingEvent({ ...editingEvent, excerpt: e.target.value })}
                    rows={3}
                    placeholder="简要介绍活动内容…"
                  />
                </div>

                <div className="ia-modal__field">
                  <label className="ia-modal__label">
                    <input
                      type="checkbox"
                      checked={!!editingEvent.hasReplay}
                      onChange={(e) => setEditingEvent({ ...editingEvent, hasReplay: e.target.checked })}
                      style={{ marginRight: 6 }}
                    />
                    <Video size={14} /> 提供活动回放（需设置链接与访问密码）
                  </label>
                </div>

                {editingEvent.hasReplay && (
                  <>
                    <div className="ia-modal__field">
                      <label className="ia-modal__label">设置回放链接 *</label>
                      <input
                        type="url"
                        className="ia-modal__text-input"
                        value={editingEvent.replayUrl || ''}
                        onChange={(e) => setEditingEvent({ ...editingEvent, replayUrl: e.target.value })}
                        placeholder="https://meeting.tencent.com/…"
                      />
                    </div>
                    <div className="ia-modal__field">
                      <label className="ia-modal__label">设置访问密码</label>
                      <input
                        type="text"
                        className="ia-modal__text-input"
                        value={editingEvent.replayPassword || ''}
                        onChange={(e) => setEditingEvent({ ...editingEvent, replayPassword: e.target.value })}
                        placeholder="为回放设置访问密码，留空则无需密码即可访问"
                      />
                    </div>
                  </>
                )}

                {editFormError && (
                  <div className="ia-modal__error">
                    <AlertCircle size={16} /> {editFormError}
                  </div>
                )}
              </div>
            </div>

            <div className="ia-modal__footer">
              <button className="btn btn-ghost" onClick={closeEventEditor} disabled={isSavingEventEdit}>
                取消
              </button>
              <button
                className="btn btn-primary"
                onClick={handleSaveEventEdit}
                disabled={isSavingEventEdit || !editingEvent.title.trim()}
              >
                <Check size={16} /> {isSavingEventEdit ? '保存中...' : '保存修改'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 回放密码弹窗 */}
      {replayModal && (
        <div className="replay-modal-overlay" onClick={closeReplayModal}>
          <div className="replay-modal" onClick={(e) => e.stopPropagation()}>
            <button className="replay-modal__close" onClick={closeReplayModal} title="关闭">
              <X size={18} />
            </button>
            <div className="replay-modal__icon">
              <Lock size={24} />
            </div>
            <h3 className="replay-modal__title">回放访问验证</h3>
            <p className="replay-modal__desc">
              该活动回放受密码保护，请输入密码后查看
            </p>
            <div className="replay-modal__event-info">
              <div className="replay-modal__event-title">{replayModal.title}</div>
              <div className="replay-modal__event-date">
                <Calendar size={12} /> {replayModal.date}
              </div>
            </div>
            <div className="replay-modal__field">
              <div className="replay-modal__input-wrap">
                <input
                  type={showPassword ? 'text' : 'password'}
                  className="replay-modal__input"
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handlePasswordSubmit();
                  }}
                  placeholder="请输入回放密码"
                  autoFocus
                />
                <button
                  className="replay-modal__eye-btn"
                  onClick={() => setShowPassword(!showPassword)}
                  type="button"
                  title={showPassword ? '隐藏密码' : '显示密码'}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {passwordError && (
                <div className="replay-modal__error">
                  <AlertCircle size={14} />
                  <span>{passwordError}</span>
                </div>
              )}
            </div>
            <div className="replay-modal__actions">
              <button
                className="btn btn-primary"
                disabled={!passwordInput.trim()}
                onClick={handlePasswordSubmit}
              >
                <ExternalLink size={16} /> 验证并打开回放
              </button>
              <button className="btn btn-ghost" onClick={closeReplayModal}>
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========== 普通成员快速新增分类弹窗 ========== */}
      {showAddCatModal && (
        <div className="ia-modal-overlay" onClick={closeAddCatModal}>
          <div
            className="ia-modal"
            style={{ maxWidth: 420 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="ia-modal__header">
              <h2><Plus size={18} /> 新增筛选分类</h2>
              <button className="ia-modal__close" onClick={closeAddCatModal}>
                <X size={20} />
              </button>
            </div>
            <div className="ia-modal__body">
              <div className="ia-modal__field">
                <label className="ia-modal__label">分类名称</label>
                <input
                  type="text"
                  className="ia-modal__text-input"
                  placeholder="例如：读书会、线下聚会…"
                  value={quickCatLabel}
                  onChange={(e) => {
                    setQuickCatLabel(e.target.value);
                    setQuickCatError('');
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && handleQuickAddCategory()}
                  autoFocus
                  maxLength={20}
                />
                {quickCatError && (
                  <div className="ia-modal__error" style={{ marginTop: 8 }}>
                    <AlertCircle size={14} /> {quickCatError}
                  </div>
                )}
                <p style={{
                  fontSize: 12,
                  color: 'var(--color-text-muted)',
                  marginTop: 8,
                  lineHeight: 1.6,
                }}>
                  新增的分类会立即同步给所有成员。只有管理员在编辑模式下才能重命名或删除分类。
                </p>
              </div>
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

      {/* 跨模块联动提示：发布带 workItemId 的活动后 → 引导去 Tasks 标记完成 */}
      {taskPrompt && (
        <div className="cross-link-overlay" onClick={() => setTaskPrompt(null)}>
          <div className="cross-link-toast" onClick={(e) => e.stopPropagation()}>
            <div className="cross-link-toast__icon">
              <CalendarRange size={22} />
            </div>
            <div className="cross-link-toast__body">
              <p className="cross-link-toast__title">活动发布成功 🎉</p>
              <p className="cross-link-toast__desc">
                「{taskPrompt.eventTitle}」已发布，是否前往
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
