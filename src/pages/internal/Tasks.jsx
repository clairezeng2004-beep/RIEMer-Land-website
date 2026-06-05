import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useSiteContent } from '../../contexts/SiteContentContext';
import { useWysiwyg } from '../../contexts/WysiwygContext';
import { useNotifications } from '../../contexts/NotificationContext';
import { emitNotificationEvent } from '../../lib/notificationRuleEngine';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import EditableText from '../../components/EditableText';
import {
  CheckSquare,
  Plus,
  X,
  CheckCircle2,
  FileText,
  ArrowRight,
  UserCheck,
  Filter,
  Check,
} from 'lucide-react';
import { initialTasks } from '../../data/siteData';
import CustomSelect from '../../components/CustomSelect';
// 把"其他"沉到筛选列表最末，符合产品"所有筛选中'其他'永远最后一位"的约定
import { sortWithOtherLast } from '../../utils/sortWithOtherLast';
import { getCachedAllUsers } from '../../lib/userDirectoryCache';
// 工作项关联（WorkItem）：让事项追踪 ↔ 公众号归档 ↔ 活动发布三者可以通过
// 共享的 workItemId 串成"同一件工作"。详见 src/utils/workItem.js。
import { genWorkItemId, collectOpenWorkItems } from '../../utils/workItem';
import '../../components/CrossLinkToast.css';
import './Tasks.css';

const statusColors = {
  '待启动': '#8A9A8C',
  '进行中': '#6B8F3C',
  '已完成': '#3A6B35',
  '已取消': '#C0392B',
};

/**
 * TaskColumnFilter — 表头列筛选器
 *
 * 表格"状态 / 分类 / 负责人"三列都复用这个组件：表头文字右侧显示一个
 * 漏斗图标，点击后在表头正下方弹出一个小面板，允许用户从候选项里挑选
 * 一个或多个值来过滤本列（"全部"表示清空该列筛选）。
 *
 * Props:
 *   value        当前选中值（字符串/数组；空数组或 '全部' 表示未筛选）
 *   onChange     选择回调 (nextValue) => void
 *   options      选项数组 [{ value, label }]，调用方自行在头部拼接 '全部'
 *   title        漏斗按钮的 title 提示（屏幕朗读 / hover 提示）
 *
 * 设计要点：
 *  - 已筛选（value !== '全部'）时漏斗图标变主色 + 右上角红点，提示当前列有筛选；
 *  - 点击图标切换开合；点击外部关闭；按 ESC 关闭；
 *  - ⚠️ 下拉面板用 React Portal 渲染到 document.body，原因是
 *    .tasks-table-wrapper 设了 overflow: auto（承载水平/垂直滚动 + sticky thead），
 *    如果面板留在 th 内部 DOM，会被 wrapper 的 overflow 裁切。
 *    定位靠按钮的 getBoundingClientRect，滚动/窗口变化时重新计算。
 */
function TaskColumnFilter({ value, onChange, options, title }) {
  const [open, setOpen] = useState(false);
  const [panelPos, setPanelPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef(null);
  const panelRef = useRef(null);
  const selectedValues = Array.isArray(value)
    ? value
    : value && value !== '全部' ? [value] : [];
  const active = selectedValues.length > 0;

  // 计算面板位置：紧贴按钮下方、右对齐到按钮右边缘
  const recalcPosition = useCallback(() => {
    const btn = btnRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const PANEL_MIN_WIDTH = 160;
    // 右对齐：panel.right = btn.right；换算成 left
    const left = Math.max(8, rect.right - PANEL_MIN_WIDTH);
    const top = rect.bottom + 6;
    setPanelPos({ top, left });
  }, []);

  useEffect(() => {
    if (!open) return;
    recalcPosition();
    const onScroll = () => recalcPosition();
    const onResize = () => recalcPosition();
    // 表格 wrapper 滚动时也要跟随 —— 监听 true 捕获阶段即可捕到任意祖先滚动
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open, recalcPosition]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      // 点击按钮本身或面板内部都不关闭；点击其它地方关闭
      if (btnRef.current && btnRef.current.contains(e.target)) return;
      if (panelRef.current && panelRef.current.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <span className="tasks-column-filter">
      <button
        ref={btnRef}
        type="button"
        className={`tasks-column-filter__btn ${active ? 'tasks-column-filter__btn--active' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title={title || '筛选'}
        aria-label={title || '筛选'}
        aria-expanded={open}
      >
        <Filter size={13} />
        {active && <span className="tasks-column-filter__dot" />}
      </button>
      {open && createPortal(
        <div
          ref={panelRef}
          className="tasks-column-filter__panel"
          role="menu"
          style={{ top: panelPos.top, left: panelPos.left }}
        >
          {options.map((opt) => {
            const isAll = opt.value === '全部';
            const isSelected = isAll ? selectedValues.length === 0 : selectedValues.includes(opt.value);
            return (
              <button
                key={opt.value}
                type="button"
                role="menuitemradio"
                aria-checked={isSelected}
                className={`tasks-column-filter__option ${isSelected ? 'tasks-column-filter__option--active' : ''}`}
                onClick={() => {
                  if (isAll) {
                    onChange([]);
                    setOpen(false);
                    return;
                  }
                  const next = selectedValues.includes(opt.value)
                    ? selectedValues.filter((item) => item !== opt.value)
                    : [...selectedValues, opt.value];
                  onChange(next);
                }}
                title={opt.label}
              >
                <span className="tasks-column-filter__option-label">{opt.label}</span>
                {isSelected && <Check size={13} className="tasks-column-filter__option-check" />}
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </span>
  );
}

// 持久化键：本地缓存 + 是否已初始化示例数据的标记
const TASKS_LS_KEY = 'riemer_tasks';
const TASKS_SEEDED_KEY = 'riemer_tasks_seeded';
// 一次性迁移标记：清理旧版错误写入的示例数据 + seed 标记
const TASKS_MIGRATION_KEY = 'riemer_tasks_migrated_v2';
// 旧版示例数据的固定 id，用于识别并清理
const LEGACY_SEED_IDS = new Set(['1', '2', '3', '4', '5']);

/** 一次性迁移：清掉旧版误写入的示例数据 + seed 标记（幂等） */
const runTasksMigration = () => {
  try {
    if (localStorage.getItem(TASKS_MIGRATION_KEY) === '1') return;
    // 清理本地缓存里 id 为 '1'~'5' 的示例数据
    const raw = localStorage.getItem(TASKS_LS_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const cleaned = parsed.filter((t) => !LEGACY_SEED_IDS.has(String(t?.id)));
          if (cleaned.length !== parsed.length) {
            console.log('[Tasks][migration] 清理本地缓存中的旧示例数据',
              parsed.length - cleaned.length, '条');
          }
          localStorage.setItem(TASKS_LS_KEY, JSON.stringify(cleaned));
        }
      } catch { /* ignore */ }
    }
    // 清除旧的 seeded 标记，让"未登录的降级模式"有机会重新按新逻辑处理
    localStorage.removeItem(TASKS_SEEDED_KEY);
    localStorage.setItem(TASKS_MIGRATION_KEY, '1');
    console.log('[Tasks][migration] ✅ v2 迁移完成');
  } catch (err) {
    console.warn('[Tasks][migration] 迁移失败（忽略）:', err.message);
  }
};

/** 从 localStorage 读取 tasks（解析失败返回 null） */
const readLocalTasks = () => {
  try {
    const raw = localStorage.getItem(TASKS_LS_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const writeLocalTasks = (list) => {
  try {
    localStorage.setItem(TASKS_LS_KEY, JSON.stringify(list));
  } catch (err) {
    console.warn('[Tasks] 写入本地缓存失败:', err.message);
  }
};

/** Supabase 行 → 前端 task（兼容历史字段）
 * highlights / reflections 是 v3 新增字段（亮点总结 / 经验复盘），
 * 老数据里不存在时统一补成空串，防止 input 的 value 从 undefined 切到 '' 触发受控/非受控切换警告。
 */
const rowToTask = (r) => ({
  id: r.id,
  title: r.title || '',
  description: r.description || '',
  category: r.category || '',
  status: r.status || '待启动',
  assignee: Array.isArray(r.assignee) ? r.assignee : [],
  helpers: Array.isArray(r.helpers) ? r.helpers : [],
  statusHistory: Array.isArray(r.status_history) ? r.status_history : [],
  highlights: r.highlights || '',
  reflections: r.reflections || '',
  createdById: r.created_by_id || r.createdById || null,
  createdBy: r.created_by || r.createdBy || '',
  // 工作项关联（WorkItem）：与文章归档 / 活动发布共享同一个 workItemId 时代表同一件工作。
  // 详见 src/utils/workItem.js。老数据没有这些列 → 统一归一成 null。
  workItemId: r.work_item_id || null,
  workItemKind: r.work_item_kind || null,
  createdAt: r.created_at ? String(r.created_at).slice(0, 10) : '',
});

const taskToRow = (t) => ({
  id: t.id,
  title: t.title || '',
  description: t.description || '',
  category: t.category || '',
  status: t.status || '待启动',
  assignee: Array.isArray(t.assignee) ? t.assignee : (t.assignee ? [t.assignee] : []),
  helpers: Array.isArray(t.helpers) ? t.helpers : [],
  status_history: Array.isArray(t.statusHistory) ? t.statusHistory : [],
  highlights: t.highlights || '',
  reflections: t.reflections || '',
  created_by_id: t.createdById || null,
  created_by: t.createdBy || '',
  // 工作项关联：允许把 null 显式写回数据库以解除关联。
  work_item_id: t.workItemId || null,
  work_item_kind: t.workItemKind || null,
});

const formatCompactTaskDate = (date) => {
  const value = String(date || '');
  return /^\d{4}-/.test(value) ? value.slice(2) : value;
};

const stripOptionalTaskColumns = (row) => {
  const { created_by_id, created_by, ...rest } = row;
  return rest;
};

export default function Tasks() {
  const { isAuthenticated, isAdmin, user, getAllUsers, supabaseOk } = useAuth();
  const {
    filterOptions, updateFilterOptions, internalConfig, updateInternalConfig,
    flushSettingToCloud, SITE_KEYS,
    // 读取 userArticles / events 用于：
    //   1) 判断 task 完成时对应侧是否已经归档/发布，决定 CrossLinkToast 的走向；
    //   2) 计算 Tasks 页面顶部"未闭环清单"卡片的内容。
    userArticles, events,
  } = useSiteContent();
  const { editing } = useWysiwyg();
  // useNotifications 保留引用以确保 NotificationProvider 已就绪；
  // 实际通知派发已统一走规则引擎 emitNotificationEvent。
  useNotifications();
  const navigate = useNavigate();
  const tc = internalConfig.tasks || {};

  const updateTasks = useCallback(
    (key, val) => updateInternalConfig({ tasks: { [key]: val } }),
    [updateInternalConfig]
  );

  // 从 context 读取筛选选项
  const taskCategories = filterOptions.taskCategories;
  const taskStatuses = filterOptions.taskStatuses;
  const teamMembers = filterOptions.teamMembers;

  // 渲染用的分类列表：把"其他"沉到末尾。
  // 注意：这里只是展示层的顺序调整，taskCategories 原顺序依旧保存在
  // filterOptions 里（内容管理页编辑的原始顺序），不会被覆写。
  // 新建事项弹窗的下拉和顶部筛选条复用同一份排序结果，保证两处观感一致。
  const orderedTaskCategories = useMemo(
    () => sortWithOtherLast(taskCategories),
    [taskCategories],
  );

  // 已注册已授权用户列表（动态获取）
  const [authorizedMembers, setAuthorizedMembers] = useState([]);
  const [authorizedMembersLoading, setAuthorizedMembersLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const fetchUsers = async () => {
      setAuthorizedMembersLoading(true);
      try {
        const allUsers = await getCachedAllUsers(getAllUsers);
        if (!cancelled) {
          const authorized = (allUsers || [])
            .filter((u) => u.authorized)
            .map((u) => ({
              id: u.id,
              name: u.name || u.email?.split('@')[0] || '未命名',
            }));
          setAuthorizedMembers(authorized);
        }
      } catch {
        // 出错时回退到硬编码 teamMembers
        if (!cancelled) {
          setAuthorizedMembers(
            teamMembers.map((m) => ({ id: m.id, name: m.name }))
          );
        }
      } finally {
        if (!cancelled) setAuthorizedMembersLoading(false);
      }
    };
    fetchUsers();
    return () => { cancelled = true; };
  }, [getAllUsers, teamMembers]);

  // 添加新标签状态
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  // 添加新状态
  const [showAddStatus, setShowAddStatus] = useState(false);
  const [newStatusName, setNewStatusName] = useState('');

  // memberMap 合并硬编码和动态用户
  const memberMap = useMemo(() => {
    const map = Object.fromEntries(teamMembers.map((m) => [m.id, m]));
    // 把动态获取的已授权用户也加进去（用于表格显示名称）
    authorizedMembers.forEach((m) => {
      if (!map[m.id]) {
        map[m.id] = { id: m.id, name: m.name, profileUrl: '' };
      }
    });
    return map;
  }, [teamMembers, authorizedMembers]);

  // ---- Tasks 状态（持久化） ----
  // 云端可用时云端才是真源；未登录或 Supabase 不可达才考虑 seed 示例数据
  const [tasks, setTasks] = useState(() => {
    // 先跑一次性迁移：清掉旧版错误塞入的示例数据
    runTasksMigration();

    const cached = readLocalTasks();
    if (cached && cached.length > 0) {
      console.log('[Tasks] 从本地缓存恢复', cached.length, '条数据');
      return cached;
    }
    // 本地缓存为空：
    //  - 如果 Supabase 配置了，就先显示空，等异步拉取结果（不 seed 示例数据）
    //  - 如果 Supabase 未配置（纯本地模式），才 seed 一次示例数据作为演示
    if (!isSupabaseConfigured && !localStorage.getItem(TASKS_SEEDED_KEY)) {
      try {
        localStorage.setItem(TASKS_SEEDED_KEY, '1');
        writeLocalTasks(initialTasks);
      } catch { /* ignore */ }
      console.log('[Tasks] 纯本地模式首次使用，载入示例数据', initialTasks.length, '条');
      return initialTasks;
    }
    console.log('[Tasks] 本地无缓存，等待云端拉取…');
    return [];
  });

  // 每次 tasks 变化都同步写回 localStorage（作为所有写操作的兜底）
  // ⚠️ 避免把空数组写入覆盖真实数据：仅当长度 > 0 或明确是用户清空动作时才写
  const hasInitializedRef = useRef(false);
  useEffect(() => {
    // 初次挂载时不写（已在 useState 初始化里写过）
    if (!hasInitializedRef.current) {
      hasInitializedRef.current = true;
      return;
    }
    writeLocalTasks(tasks);
  }, [tasks]);

  // 启动后异步尝试从 Supabase 拉取最新数据（如配置且可用）
  const loadedFromServerRef = useRef(false);
  useEffect(() => {
    if (!isAuthenticated) return;
    if (!(isSupabaseConfigured && supabaseOk === true)) return;
    if (loadedFromServerRef.current) return;
    loadedFromServerRef.current = true;

    (async () => {
      try {
        console.log('[Tasks] 开始从 Supabase 拉取 tasks...');
        const { data, error } = await supabase
          .from('tasks')
          .select('*')
          .order('created_at', { ascending: false });
        if (error) throw error;
        const remote = (data || []).map(rowToTask);
        console.log('[Tasks] Supabase 返回', remote.length, '条数据');

        // --- 云端即真源：不再做"本地独有自动回传"，避免已删除的旧示例或旧缓存被"复活" ---
        // 只把云端返回的数据作为最终状态；如果本地还有云端已删除的行，会被覆盖。
        const local = readLocalTasks() || [];
        const remoteIds = new Set(remote.map((t) => t.id));
        const localOnly = local.filter((t) => t.id && !remoteIds.has(t.id));

        if (localOnly.length > 0) {
          // 识别是不是"本地用户刚新建、还没同步到云端"的条目：
          // - 固定 id 的旧示例（'1'~'5'）→ 直接丢弃
          // - 其他 id（通常是 UUID）→ 也丢弃，因为新增逻辑里已经在 handleAddTask 里同步 upsert 过；
          //   如果 upsert 失败，用户应该能看到报错并重试，而不是让陈年残留数据无限复活。
          const legacyCount = localOnly.filter((t) => LEGACY_SEED_IDS.has(String(t.id))).length;
          console.log('[Tasks] 本地有', localOnly.length, '条云端没有的条目（其中旧示例',
            legacyCount, '条），一律以云端为准丢弃');
        }

        setTasks(remote);
      } catch (err) {
        // 表可能未创建 / 网络失败 —— 静默，继续使用本地数据
        console.warn('[Tasks] ❌ 从 Supabase 加载失败:', err);
      }
    })();
  }, [isAuthenticated, supabaseOk]);

  const [showForm, setShowForm] = useState(false);
  const [filterStatus, setFilterStatus] = useState([]);
  const [filterCategory, setFilterCategory] = useState([]);
  // 表头「负责人」列筛选：'全部' 表示不筛选；否则为某个 user.id，仅展示该人为负责人的事项。
  // 和「只看我负责的」是互斥维度：
  //   - 选择某个具体负责人 → 自动关闭 filterMineOnly（否则两层条件可能矛盾）；
  //   - 开启 filterMineOnly → 自动清空 filterAssignee。
  // 两个 setter 对应的切换在各自的 onChange 里处理。
  const [filterAssignee, setFilterAssignee] = useState([]);
  // 「只看我负责的」开关：开启后仅展示当前登录用户作为负责人（assignee）的事项。
  // 协助人（helpers）不计入——产品口径里"我负责的"= 我被指派为主 owner 的事项。
  // 未登录场景下这个开关不会出现（isAuthenticated 早就重定向到 /login 了）。
  const [filterMineOnly, setFilterMineOnly] = useState(false);
  const [newTask, setNewTask] = useState({
    title: '',
    description: '',
    category: taskCategories[0] || '',
    status: '待启动',
    assignee: [],
    helpers: [],
    // 关联目标（见 src/utils/workItem.js）：
    //   'none'    → 不关联（纯内部事项）
    //   'article' → 这件事最终会产出一篇公众号文章（期望稍后归档）
    //   'event'   → 这件事最终会落地一场活动（期望稍后发布）
    // 默认 'none'——保持旧行为，用户如果不选就不会强行生成 workItemId。
    workItemKind: 'none',
  });

  // 负责人选项列表（已授权用户真名）。用户目录加载完成前，不把已选 user id 原样显示出来。
  const assigneeOptions = useMemo(() => {
    const optionMap = new Map();
    authorizedMembers.forEach((m) => {
      optionMap.set(m.id, { value: m.id, label: m.name });
    });
    teamMembers.forEach((m) => {
      if (!optionMap.has(m.id)) {
        optionMap.set(m.id, { value: m.id, label: m.name });
      }
    });
    tasks.forEach((task) => {
      const ids = [
        ...(Array.isArray(task.assignee) ? task.assignee : task.assignee ? [task.assignee] : []),
        ...(Array.isArray(task.helpers) ? task.helpers : []),
      ];
      ids.forEach((id) => {
        if (id && !optionMap.has(id)) {
          optionMap.set(id, {
            value: id,
            label: authorizedMembersLoading ? '加载成员…' : '未知成员',
          });
        }
      });
    });
    return Array.from(optionMap.values());
  }, [authorizedMembers, authorizedMembersLoading, teamMembers, tasks]);
  // 亮点总结 / 经验复盘 的 Supabase 写入防抖计时器
  // 结构：{ [taskId]: { [field]: number(timerId) } }
  const writeTimersRef = useRef({});
  // 组件卸载时清理所有未触发的防抖定时器，避免 setState on unmounted 或孤儿请求
  useEffect(() => {
    const timers = writeTimersRef.current;
    return () => {
      Object.values(timers).forEach((perTask) => {
        Object.values(perTask || {}).forEach((tid) => clearTimeout(tid));
      });
    };
  }, []);
  // 跨模块联动提示
  const [archivePrompt, setArchivePrompt] = useState(null);

  // ⚠️ 下面这些 hooks 必须放在 early return 之前，否则未登录用户命中 Navigate 后
  // 下次渲染 hook 数量会与已登录时不一致，触发 React "Rendered fewer hooks than
  // expected" 错误（Rules of Hooks）。
  //
  // 未闭环工作项清单：
  //   - 管理员：全量（不限 assignee/helpers）
  //   - 普通成员：只看自己为 assignee/helpers 的 task
  // 判定由 collectOpenWorkItems 统一完成，这里只负责按角色切分数据。
  const openWorkItems = useMemo(
    () => collectOpenWorkItems({
      tasks,
      articles: userArticles || [],
      events: events || [],
      isAdmin: !!isAdmin,
      currentUserId: user?.id || null,
    }),
    [tasks, userArticles, events, isAdmin, user?.id],
  );
  // 默认折叠以免顶部太重；有未闭环项时右上角显示角标引导展开
  const [showOpenList, setShowOpenList] = useState(false);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  const canUseSupabase = isSupabaseConfigured && supabaseOk === true;

  const filtered = tasks.filter((task) => {
    const matchesStatus = filterStatus.length === 0 || filterStatus.includes(task.status);
    const matchesCategory = filterCategory.length === 0 || filterCategory.includes(task.category);
    // 统一把 assignee 规范成数组，负责人筛选和「只看我负责的」都基于此。
    // 兼容历史数据里 assignee 为单个字符串 id 的情况。
    const assigneeIds = Array.isArray(task.assignee)
      ? task.assignee
      : task.assignee ? [task.assignee] : [];
    // 表头「负责人」筛选：选中某个 user.id 时，只保留 assignee 包含该 id 的事项。
    const matchesAssignee =
      filterAssignee.length === 0 || filterAssignee.some((id) => assigneeIds.includes(id));
    // 「只看我负责的」：仅保留 assignee 包含当前登录 user.id 的事项。
    const matchesMine =
      !filterMineOnly || (!!user?.id && assigneeIds.includes(user.id));
    return matchesStatus && matchesCategory && matchesAssignee && matchesMine;
  });

  // 排序规则：
  // 1) 未结束事项（未标记"已完成/已取消"）优先；
  // 2) 未结束事项内部、已结束事项内部，都按最近一次状态更新时间从新到旧；
  // 3) 没有状态变更历史时回退到创建时间。
  const lastStatusUpdate = (task) => {
    const hist = Array.isArray(task.statusHistory) ? task.statusHistory : [];
    if (hist.length > 0) return hist[hist.length - 1].date || task.createdAt || '';
    return task.createdAt || '';
  };
  const isClosedTask = (task) => task.status === '已完成' || task.status === '已取消';
  filtered.sort((a, b) => {
    const closedDelta = Number(isClosedTask(a)) - Number(isClosedTask(b));
    if (closedDelta !== 0) return closedDelta;
    return lastStatusUpdate(b).localeCompare(lastStatusUpdate(a));
  });

  const handleAddTask = async (e) => {
    e.preventDefault();
    if (!newTask.title) return;
    // 生成 UUID（Supabase id 列是 uuid；localStorage 也兼容）
    const genId = () => (
      (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : Date.now().toString() + Math.random().toString(36).slice(2, 8)
    );
    // 关联目标：用户选了 article/event 就立刻生成 workItemId；选了 none 不生成。
    // 这样即便用户"先立项、稍后再去归档/发活动"，也有一把钥匙等着另一侧来对齐。
    const kind = newTask.workItemKind === 'none' ? null : (newTask.workItemKind || null);
    const workItemId = kind ? genWorkItemId() : null;

    const task = {
      ...newTask,
      id: genId(),
      assignee: Array.isArray(newTask.assignee) ? newTask.assignee : [],
      createdById: user?.id || null,
      createdBy: user?.nickname || user?.name || user?.email || '',
      // 新任务的"亮点总结 / 经验复盘"初始化为空串（而不是 undefined），
      // 避免受控 input 的 value 在首次输入时从 undefined 变成 '' 触发 React 警告。
      highlights: '',
      reflections: '',
      // 覆盖 newTask.workItemKind，把 UI 侧的 'none' 归一成真实落库值（null）
      workItemId,
      workItemKind: kind,
      createdAt: new Date().toISOString().split('T')[0],
    };
    // 乐观更新 UI + 本地缓存
    setTasks((prev) => [task, ...prev]);
    setNewTask({
      title: '',
      description: '',
      category: taskCategories[0] || '',
      status: '待启动',
      assignee: [],
      helpers: [],
      workItemKind: 'none',
    });
    setShowForm(false);

    // 发送"新事项创建"通知（由规则引擎按用户自定义规则触发）
    try {
      const creator = user?.nickname || user?.name || '某成员';
      emitNotificationEvent('task.new', {
        operator: creator,
        operatorUserId: user?.id,
        title: task.title,
        category: task.category || '',
        status: task.status,
      });
    } catch (err) {
      console.warn('[Tasks] 发送新事项通知失败:', err?.message || err);
    }

    // 异步同步到 Supabase
    if (canUseSupabase) {
      try {
        const row = taskToRow(task);
        console.log('[Tasks] 向 Supabase 插入新事项:', row);
        let { data, error } = await supabase.from('tasks').insert(row).select();
        if (error && /created_by/i.test(error.message || '')) {
          console.warn('[Tasks] tasks 表缺少创建人字段，降级写入:', error.message);
          const fallback = await supabase.from('tasks').insert(stripOptionalTaskColumns(row)).select();
          data = fallback.data;
          error = fallback.error;
        }
        if (error) throw error;
        console.log('[Tasks] ✅ Supabase 插入成功:', data);
      } catch (err) {
        console.error('[Tasks] ❌ 新增同步到 Supabase 失败（已保留在本地）:', err.message, err);
      }
    } else {
      console.log('[Tasks] Supabase 不可用，仅本地保存。canUseSupabase=', canUseSupabase,
        ' isSupabaseConfigured=', isSupabaseConfigured, ' supabaseOk=', supabaseOk);
    }
  };

  const updateTaskStatus = async (id, newStatus) => {
    const targetTask = tasks.find((t) => t.id === id);
    if (!targetTask) return;
    const record = {
      from: targetTask.status,
      to: newStatus,
      // reason 字段保留，供后续扩展（如弹窗填写状态变更原因）。
      // 当前的"亮点总结 / 经验复盘"是任务级持久字段，不在状态切换时消费。
      reason: '',
      date: new Date().toISOString().split('T')[0],
    };
    const nextHistory = [...(targetTask.statusHistory || []), record];
    setTasks((prev) => prev.map((t) => (t.id === id
      ? { ...t, status: newStatus, statusHistory: nextHistory }
      : t
    )));
    // 跨模块联动提示（基于 workItemId 的新逻辑，见 src/utils/workItem.js）：
    //   - task 标记完成 且 声明了 workItemKind='article'/'event'
    //   - 并且对应侧（article/event）还没落地 → 弹提示引导去补登
    //
    // 兼容旧口径：如果 task 没有 workItemId 但分类是"公众号文章"，仍走原有
    // 的"去归档"提示，避免历史数据失去提醒。
    if (
      newStatus === '已完成' &&
      targetTask.status !== '已完成'
    ) {
      const wid = targetTask.workItemId;
      const kind = targetTask.workItemKind;
      if (wid && kind === 'article') {
        const hasArticle = (userArticles || []).some((a) => a.workItemId === wid);
        if (!hasArticle) {
          setArchivePrompt({
            taskTitle: targetTask.title,
            target: 'article',
            workItemId: wid,
            missingPayload: { title: targetTask.title },
          });
        }
      } else if (wid && kind === 'event') {
        const hasEvent = (events || []).some((e) => e.workItemId === wid);
        if (!hasEvent) {
          setArchivePrompt({
            taskTitle: targetTask.title,
            target: 'event',
            workItemId: wid,
            missingPayload: { title: targetTask.title },
          });
        }
      } else if (!wid && targetTask.category === '公众号文章') {
        // 旧口径兜底：没关联但分类匹配时，仍弹去归档页
        setArchivePrompt({ taskTitle: targetTask.title, target: 'article' });
      }
    }
    // 发送"事项状态变更"通知（由规则引擎按用户自定义规则触发）
    if (targetTask.status !== newStatus) {
      try {
        const operator = user?.nickname || user?.name || '某成员';
        emitNotificationEvent('task.status_change', {
          operator,
          operatorUserId: user?.id,
          title: targetTask.title,
          from: targetTask.status,
          to: newStatus,
        });
      } catch (err) {
        console.warn('[Tasks] 发送状态变更通知失败:', err?.message || err);
      }
    }
    if (canUseSupabase) {
      try {
        const { data, error } = await supabase
          .from('tasks')
          .update({ status: newStatus, status_history: nextHistory })
          .eq('id', id)
          .select();
        if (error) throw error;
        console.log('[Tasks] ✅ 状态更新已同步到 Supabase:', data);
      } catch (err) {
        console.error('[Tasks] ❌ 更新状态同步到 Supabase 失败:', err.message, err);
      }
    }
  };

  /** 更新任务的"亮点总结 / 经验复盘"（或将来其它纯文本字段）。
   *  - 本地 state 立刻更新（受控 input 不卡顿）；
   *  - 向 Supabase 的同步按 (taskId, field) 维度做 500ms 防抖，避免连续打字产生大量 UPDATE。
   *  - 出错时仅告警，不回滚本地（本地缓存会被 tasks useEffect 持久化，用户下次刷新仍能看到）。
   */
  const updateTaskField = (id, field, value) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, [field]: value } : t)));

    if (!canUseSupabase) return;
    const timers = writeTimersRef.current;
    if (!timers[id]) timers[id] = {};
    if (timers[id][field]) clearTimeout(timers[id][field]);
    timers[id][field] = setTimeout(async () => {
      try {
        const { error } = await supabase
          .from('tasks')
          .update({ [field]: value })
          .eq('id', id);
        if (error) throw error;
      } catch (err) {
        console.error(`[Tasks] ❌ 同步 ${field} 到 Supabase 失败:`, err.message, err);
      } finally {
        if (timers[id]) delete timers[id][field];
      }
    }, 500);
  };

  const canDeleteTask = (task) => (
    !!isAdmin ||
    (!!user?.id && !!task?.createdById && String(task.createdById) === String(user.id))
  );

  const deleteTask = async (task) => {
    if (!canDeleteTask(task)) return;
    const id = task.id;
    if (!window.confirm('确定要删除这个事项吗？')) return;
    setTasks((prev) => prev.filter((t) => t.id !== id));
    if (canUseSupabase) {
      try {
        const { error } = await supabase.from('tasks').delete().eq('id', id);
        if (error) throw error;
        console.log('[Tasks] ✅ 删除已同步到 Supabase:', id);
      } catch (err) {
        console.error('[Tasks] ❌ 删除同步到 Supabase 失败:', err.message, err);
      }
    }
  };

  // 提交中标记：防止用户在 await 期间重复点"确认"按钮触发双推
  const [addingCategory, setAddingCategory] = useState(false);
  // 同上，状态栏自己的增/删也要有一把锁，避免并发双推
  const [addingStatus, setAddingStatus] = useState(false);
  const [deletingStatusName, setDeletingStatusName] = useState(null);
  const [deletingCategoryName, setDeletingCategoryName] = useState(null);

  // 添加新分类标签
  //
  // 关键设计（与 EventPublish 同款三连坑的对齐修复）：
  //   ① 乐观更新在前：立即 updateFilterOptions，让用户看到新分类马上出现，
  //      体验流畅；失败时再回滚并提示，用户可以决定重试还是放弃。
  //   ② 立即推云 + await：用 flushSettingToCloud 绕开 400ms 去抖，关 tab / 刷新
  //      的场景下也能保证写入云端。await 返回后再根据结果决定回滚/成功。
  //   ③ 提交中禁用按钮：await 返回前再次点击会产生重复 insert，且第二次调用
  //      flushSettingToCloud 传的 value 是"已包含自己的本地乐观态"，会把第一次
  //      还没确认的值重复推一遍。用 addingCategory 守住这个窗口。
  //   ④ 失败时精确回滚该条分类：不能直接 setFilterOptions(prev)，因为用户可能
  //      在 await 期间编辑了 filterOptions 的其它字段，整体覆盖会丢掉这些修改。
  const handleAddCategory = async () => {
    if (addingCategory) return;
    const trimmed = newCategoryName.trim();
    if (!trimmed) return;
    // 重名检测：忽略大小写与前后空白，命中则弹窗提示并保留输入框内容，
    // 让用户知道原因、可以直接改名（原实现是静默清空关闭，用户会误以为添加成功）
    const normalized = trimmed.toLowerCase();
    if (taskCategories.some((c) => String(c).trim().toLowerCase() === normalized)) {
      alert(`分类「${trimmed}」已存在，请换一个名字。`);
      return;
    }

    setAddingCategory(true);
    // 先乐观更新本地 UI（用户立即看到新分类）
    const nextFilterOptions = {
      ...filterOptions,
      taskCategories: [...taskCategories, trimmed],
    };
    updateFilterOptions(nextFilterOptions);
    // 清空输入框、关闭弹层，避免用户反复点确认按钮
    setNewCategoryName('');
    setShowAddCategory(false);

    // 立即推送到云端并 await；失败时精确回滚这条新分类并提示
    try {
      const res = await flushSettingToCloud(SITE_KEYS.FILTER_OPTIONS, nextFilterOptions);
      if (!res?.success) {
        // 精确回滚：只移除本次新增的 trimmed，不整体覆盖，避免丢掉用户在 await
        // 期间对 filterOptions 其它字段（teamMembers / taskStatuses）的并发编辑
        updateFilterOptions({
          taskCategories: taskCategories.filter((c) => c !== trimmed),
        });
        alert(
          `新增分类「${trimmed}」失败，已回滚。原因：${res?.error || '未知错误'}\n` +
          `请检查网络后重试；如问题持续，请联系管理员。`,
        );
      }
    } finally {
      setAddingCategory(false);
    }
  };

  // 添加新状态（与 handleAddCategory 完全同构，见其注释里的"三连坑"说明）
  const handleAddStatus = async () => {
    if (addingStatus) return;
    const trimmed = newStatusName.trim();
    if (!trimmed) return;
    if (trimmed === '全部') {
      alert('「全部」是系统保留项，不能作为自定义状态名。');
      return;
    }
    const normalized = trimmed.toLowerCase();
    if (taskStatuses.some((s) => String(s).trim().toLowerCase() === normalized)) {
      alert(`状态「${trimmed}」已存在，请换一个名字。`);
      return;
    }

    setAddingStatus(true);
    const nextFilterOptions = {
      ...filterOptions,
      taskStatuses: [...taskStatuses, trimmed],
    };
    updateFilterOptions(nextFilterOptions);
    setNewStatusName('');
    setShowAddStatus(false);

    try {
      const res = await flushSettingToCloud(SITE_KEYS.FILTER_OPTIONS, nextFilterOptions);
      if (!res?.success) {
        updateFilterOptions({
          taskStatuses: taskStatuses.filter((s) => s !== trimmed),
        });
        alert(
          `新增状态「${trimmed}」失败，已回滚。原因：${res?.error || '未知错误'}\n` +
          `请检查网络后重试；如问题持续，请联系管理员。`,
        );
      }
    } finally {
      setAddingStatus(false);
    }
  };

  // 删除状态
  //
  // 数据契约：taskStatuses 只决定"快捷筛选条 / 下拉选项 / 新建弹窗"里能选到哪些状态；
  // 事项本身的 status 字段仍然是**字符串字面值**存储。删除一个状态后：
  //   - 已有事项的 status 字段不动（保留字面值，不丢数据）；
  //   - 这些事项在"状态"筛选栏里不再出现对应按钮；但表头列筛选器仍能看到它们
  //     （因为列筛选器是从当前 tasks 的实际 status 值里去重生成的）；
  //   - 若当前正选中被删除的状态为 filterStatus，自动切回"全部"，避免筛出空结果。
  const handleDeleteStatus = async (name) => {
    if (deletingStatusName) return;
    const inUseCount = tasks.filter((t) => t.status === name).length;
    const confirmMsg =
      inUseCount > 0
        ? `确认删除状态「${name}」？\n\n当前有 ${inUseCount} 条事项正在使用这个状态。\n删除后，这些事项的状态字段不会被清除，但不会再出现在快捷筛选条里。重新添加同名状态后，仍需检查相关事项的绑定关系。`
        : `确认删除状态「${name}」？\n\n当前没有事项使用此状态。`;
    if (!window.confirm(confirmMsg)) return;

    setDeletingStatusName(name);
    const nextStatuses = taskStatuses.filter((s) => s !== name);
    const nextFilterOptions = { ...filterOptions, taskStatuses: nextStatuses };
    updateFilterOptions(nextFilterOptions);
    // 如果正选中被删的状态，回退到"全部"避免空白结果
    setFilterStatus((prev) => prev.filter((item) => item !== name));

    try {
      const res = await flushSettingToCloud(SITE_KEYS.FILTER_OPTIONS, nextFilterOptions);
      if (!res?.success) {
        // 精确回滚：把被删除的状态加回去，位置追加到末尾（原顺序无法恢复，但数据不丢）
        updateFilterOptions({
          taskStatuses: [...nextStatuses, name],
        });
        alert(
          `删除状态「${name}」失败，已回滚。原因：${res?.error || '未知错误'}\n` +
          `请检查网络后重试。`,
        );
      }
    } finally {
      setDeletingStatusName(null);
    }
  };

  // 删除分类（逻辑与 handleDeleteStatus 同构，只是落到 taskCategories）
  const handleDeleteCategory = async (name) => {
    if (deletingCategoryName) return;
    const inUseCount = tasks.filter((t) => t.category === name).length;
    const confirmMsg =
      inUseCount > 0
        ? `确认删除分类「${name}」？\n\n当前有 ${inUseCount} 条事项属于这个分类。\n删除后，这些事项的分类字段不会被清除，但不会再出现在快捷筛选条里。重新添加同名标签后，仍需检查相关事项的绑定关系。`
        : `确认删除分类「${name}」？\n\n当前没有事项使用此分类。`;
    if (!window.confirm(confirmMsg)) return;

    setDeletingCategoryName(name);
    const nextCategories = taskCategories.filter((c) => c !== name);
    const nextFilterOptions = { ...filterOptions, taskCategories: nextCategories };
    updateFilterOptions(nextFilterOptions);
    setFilterCategory((prev) => prev.filter((item) => item !== name));

    try {
      const res = await flushSettingToCloud(SITE_KEYS.FILTER_OPTIONS, nextFilterOptions);
      if (!res?.success) {
        updateFilterOptions({
          taskCategories: [...nextCategories, name],
        });
        alert(
          `删除分类「${name}」失败，已回滚。原因：${res?.error || '未知错误'}\n` +
          `请检查网络后重试。`,
        );
      }
    } finally {
      setDeletingCategoryName(null);
    }
  };

  // Stats
  const stats = {
    total: tasks.length,
    pending: tasks.filter((t) => t.status === '待启动').length,
    inProgress: tasks.filter((t) => t.status === '进行中').length,
    completed: tasks.filter((t) => t.status === '已完成').length,
  };

  // 点击未闭环项的 CTA：
  //   - 缺 article → 跳公众号历史文章归档，带 workItemId + 建议标题
  //   - 缺 event   → 跳活动发布，带 workItemId + 建议标题
  //   - 缺 task    → 只滚动到对应 task 行，没有 task 是不会出现在 openWorkItems 里的
  const handleOpenWorkItemCTA = (wi) => {
    if (wi.missingKind === 'article') {
      navigate('/internal/articles', {
        state: {
          workItemId: wi.workItemId,
          suggestedTitle: wi.title || '',
        },
      });
    } else if (wi.missingKind === 'event') {
      navigate('/internal/event-publish', {
        state: {
          workItemId: wi.workItemId,
          suggestedTitle: wi.title || '',
        },
      });
    }
  };

  return (
    <div className="tasks-page">
      <div className="container">
        <div className="tasks-page__header">
          <div>
            <h1>
              <CheckSquare size={28} /> <EditableText
                value={tc.pageTitle}
                onChange={(v) => updateTasks('pageTitle', v)}
                configKey="tasks.pageTitle"
                as="span"
              />
            </h1>
            <p><EditableText
              value={tc.pageDesc}
              onChange={(v) => updateTasks('pageDesc', v)}
              configKey="tasks.pageDesc"
              as="span"
            /></p>
          </div>
          <button
            className="btn btn-primary"
            onClick={() => setShowForm(!showForm)}
          >
            {showForm ? <X size={18} /> : <Plus size={18} />}
            {showForm ? '取消' : <EditableText
              value={tc.newTaskBtn}
              onChange={(v) => updateTasks('newTaskBtn', v)}
              configKey="tasks.newTaskBtn"
              as="span"
            />}
          </button>
        </div>

        {/* 未闭环工作项清单：task 声明了 workItemKind 但对应侧（article/event）
            还没落地。管理员全量，普通成员仅含自己 assignee/helpers 的事项。 */}
        {openWorkItems.length > 0 && (
          <div className="tasks-open-workitems">
            <div className="tasks-open-workitems__header">
              <span className="tasks-open-workitems__title">
                <ArrowRight size={14} />
                未闭环的工作项
                <span className="tasks-open-workitems__count">{openWorkItems.length}</span>
              </span>
              <button
                type="button"
                className="tasks-open-workitems__toggle"
                onClick={() => setShowOpenList((v) => !v)}
                title={showOpenList ? '收起' : '展开'}
              >
                {showOpenList ? '收起' : '展开'}
              </button>
            </div>
            {showOpenList && (
              <ul className="tasks-open-workitems__list">
                {openWorkItems.map((wi) => {
                  const tagLabel =
                    wi.missingKind === 'article' ? '缺公众号归档' :
                    wi.missingKind === 'event' ? '缺活动发布' :
                    '待标记完成';
                  const tagClass =
                    wi.missingKind === 'article' ? 'tasks-open-workitems__tag--missing-article' :
                    wi.missingKind === 'event' ? 'tasks-open-workitems__tag--missing-event' :
                    'tasks-open-workitems__tag--missing-task';
                  return (
                    <li key={wi.workItemId} className="tasks-open-workitems__item">
                      <div className="tasks-open-workitems__item-main">
                        <span className={`tasks-open-workitems__tag ${tagClass}`}>
                          {tagLabel}
                        </span>
                        <span className="tasks-open-workitems__item-title" title={wi.title}>
                          {wi.title}
                        </span>
                      </div>
                      {(wi.missingKind === 'article' || wi.missingKind === 'event') && (
                        <button
                          type="button"
                          className="tasks-open-workitems__cta"
                          onClick={() => handleOpenWorkItemCTA(wi)}
                        >
                          {wi.missingKind === 'article' ? '去归档' : '去发布'}
                          <ArrowRight size={12} />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {/* Stats */}
        <div className="tasks-stats">
          <div className="tasks-stat">
            <div className="tasks-stat__value">{stats.total}</div>
            <div className="tasks-stat__label">全部事项</div>
          </div>
          <div className="tasks-stat tasks-stat--pending">
            <div className="tasks-stat__value">{stats.pending}</div>
            <div className="tasks-stat__label">待启动</div>
          </div>
          <div className="tasks-stat tasks-stat--progress">
            <div className="tasks-stat__value">{stats.inProgress}</div>
            <div className="tasks-stat__label">进行中</div>
          </div>
          <div className="tasks-stat tasks-stat--done">
            <div className="tasks-stat__value">{stats.completed}</div>
            <div className="tasks-stat__label">已完成</div>
          </div>
        </div>

        {/* New Task Form */}
        {showForm && (
          <div className="tasks-form card">
            <h3>
              <Plus size={18} /> 创建新事项
            </h3>
            <form onSubmit={handleAddTask} className="tasks-form__body">
              <div className="tasks-form__row">
                <div className="tasks-form__field tasks-form__field--wide">
                  <label>标题</label>
                  <input
                    type="text"
                    value={newTask.title}
                    onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
                    placeholder="事项标题"
                    className="tasks-form__input"
                    required
                  />
                </div>
                <div className="tasks-form__field">
                  <label>负责人（可不选）</label>
                  <CustomSelect
                    value={newTask.assignee}
                    onChange={(vals) => setNewTask({ ...newTask, assignee: vals })}
                    options={assigneeOptions}
                    placeholder="可不选择负责人…"
                    multiple
                  />
                </div>
              </div>
              <div className="tasks-form__field">
                <label>描述</label>
                <textarea
                  value={newTask.description}
                  onChange={(e) => setNewTask({ ...newTask, description: e.target.value })}
                  placeholder="详细描述"
                  className="tasks-form__input tasks-form__textarea"
                  rows={2}
                />
              </div>
              <div className="tasks-form__field">
                <label>分类</label>
                <CustomSelect
                  value={newTask.category}
                  onChange={(val) => setNewTask({ ...newTask, category: val })}
                  options={orderedTaskCategories}
                />
              </div>
              <button type="submit" className="btn btn-primary">
                <Plus size={16} /> 创建事项
              </button>
            </form>
          </div>
        )}

        {/* Filters */}
        <div className="tasks-filters">
          {/* 「只看我负责的」视图切换：开启后仅展示 assignee 包含当前登录用户的事项。
              产品上这是一个独立维度，跟「状态 / 分类」是 AND 关系，所以单独成组。 */}
          <div className="tasks-filters__group">
            <span className="tasks-filters__label">视图：</span>
            <button
              type="button"
              className={`tasks-filters__btn ${filterMineOnly ? 'tasks-filters__btn--active' : ''}`}
              onClick={() => setFilterMineOnly((v) => {
                // 开启「只看我负责的」时，清除表头「负责人」列上可能已有的具体筛选，
                // 避免两层语义冲突（例如选了"张三"又勾上"只看我负责的"）。
                if (!v) setFilterAssignee([]);
                return !v;
              })}
              title="只看我作为负责人的事项"
            >
              <UserCheck size={14} style={{ verticalAlign: '-2px', marginRight: 4 }} />
              只看我负责的
            </button>
          </div>
          <div className="tasks-filters__group">
            <span className="tasks-filters__label">状态：</span>
            {/* "全部"是系统伪项，不允许删除 */}
            <button
              key="__all__"
              className={`tasks-filters__btn ${filterStatus.length === 0 ? 'tasks-filters__btn--active' : ''}`}
              onClick={() => setFilterStatus([])}
            >
              全部
            </button>
            {/*
              状态按钮：鼠标悬停（.tasks-filters__chip:hover）时显示右上角小"×"；
              点击"×"时 stopPropagation 阻止触发按钮本身的选中动作。
              注意：这里不再像旧实现那样只渲染"tasks 里实际存在的状态"，而是
              渲染完整的 taskStatuses 列表——否则刚建出来还没被任何事项使用的状态
              不会显现，用户也就没法点"×"删除它。
            */}
            {taskStatuses.map((s) => (
              <span key={s} className="tasks-filters__chip">
                <button
                  className={`tasks-filters__btn ${filterStatus.includes(s) ? 'tasks-filters__btn--active' : ''}`}
                  onClick={() => setFilterStatus((prev) => (
                    prev.includes(s) ? prev.filter((item) => item !== s) : [...prev, s]
                  ))}
                >
                  {s}
                </button>
                <button
                  type="button"
                  className="tasks-filters__chip-remove"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteStatus(s);
                  }}
                  disabled={deletingStatusName === s}
                  title={deletingStatusName === s ? '删除中…' : `删除状态「${s}」`}
                  aria-label={`删除状态「${s}」`}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
            {showAddStatus ? (
              <div className="tasks-filters__add-category">
                <input
                  type="text"
                  className="tasks-filters__add-input"
                  placeholder="新状态名称"
                  value={newStatusName}
                  onChange={(e) => setNewStatusName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAddStatus();
                    if (e.key === 'Escape') { setShowAddStatus(false); setNewStatusName(''); }
                  }}
                  autoFocus
                />
                <button
                  className="tasks-filters__add-confirm"
                  onClick={handleAddStatus}
                  disabled={!newStatusName.trim() || addingStatus}
                  title={addingStatus ? '正在同步到云端…' : '确认添加'}
                >
                  <CheckCircle2 size={14} />
                </button>
                <button
                  className="tasks-filters__add-cancel"
                  onClick={() => { setShowAddStatus(false); setNewStatusName(''); }}
                  title="取消"
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <button
                className="tasks-filters__btn tasks-filters__btn--add"
                onClick={() => setShowAddStatus(true)}
                title="添加新状态"
              >
                <Plus size={14} /> 添加状态
              </button>
            )}
          </div>
          <div className="tasks-filters__group">
            <span className="tasks-filters__label">分类：</span>
            <button
              key="__all__"
              className={`tasks-filters__btn ${filterCategory.length === 0 ? 'tasks-filters__btn--active' : ''}`}
              onClick={() => setFilterCategory([])}
            >
              全部
            </button>
            {orderedTaskCategories.map((c) => (
              <span key={c} className="tasks-filters__chip">
                <button
                  className={`tasks-filters__btn ${filterCategory.includes(c) ? 'tasks-filters__btn--active' : ''}`}
                  onClick={() => setFilterCategory((prev) => (
                    prev.includes(c) ? prev.filter((item) => item !== c) : [...prev, c]
                  ))}
                >
                  {c}
                </button>
                <button
                  type="button"
                  className="tasks-filters__chip-remove"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteCategory(c);
                  }}
                  disabled={deletingCategoryName === c}
                  title={deletingCategoryName === c ? '删除中…' : `删除分类「${c}」`}
                  aria-label={`删除分类「${c}」`}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
            {showAddCategory ? (
              <div className="tasks-filters__add-category">
                <input
                  type="text"
                  className="tasks-filters__add-input"
                  placeholder="新标签名称"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAddCategory();
                    if (e.key === 'Escape') { setShowAddCategory(false); setNewCategoryName(''); }
                  }}
                  autoFocus
                />
                <button
                  className="tasks-filters__add-confirm"
                  onClick={handleAddCategory}
                  disabled={!newCategoryName.trim() || addingCategory}
                  title={addingCategory ? '正在同步到云端…' : '确认添加'}
                >
                  <CheckCircle2 size={14} />
                </button>
                <button
                  className="tasks-filters__add-cancel"
                  onClick={() => { setShowAddCategory(false); setNewCategoryName(''); }}
                  title="取消"
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <button
                className="tasks-filters__btn tasks-filters__btn--add"
                onClick={() => setShowAddCategory(true)}
                title="添加新标签"
              >
                <Plus size={14} /> 添加标签
              </button>
            )}
          </div>
        </div>

        {/* Task Table */}
        <div className="tasks-table-wrapper">
          <table className="tasks-table">
            <thead>
              <tr>
                <th>
                  <span className="tasks-th">
                    <span>状态</span>
                    <TaskColumnFilter
                      value={filterStatus}
                      onChange={setFilterStatus}
                      options={[
                        { value: '全部', label: '全部状态' },
                        ...taskStatuses.map((s) => ({ value: s, label: s })),
                      ]}
                      title="按状态筛选"
                    />
                  </span>
                </th>
                <th>
                  <span className="tasks-th">
                    <span>分类</span>
                    <TaskColumnFilter
                      value={filterCategory}
                      onChange={setFilterCategory}
                      options={[
                        { value: '全部', label: '全部分类' },
                        ...orderedTaskCategories.map((c) => ({ value: c, label: c })),
                      ]}
                      title="按分类筛选"
                    />
                  </span>
                </th>
                <th>标题</th>
                <th>
                  <span className="tasks-th">
                    <span>负责人</span>
                    <TaskColumnFilter
                      value={filterAssignee}
                      onChange={(val) => {
                        setFilterAssignee(val);
                        // 选中具体负责人时，关闭「只看我负责的」开关，避免两个维度打架
                        if (val.length > 0) setFilterMineOnly(false);
                      }}
                      options={[
                        { value: '全部', label: '全部负责人' },
                        ...assigneeOptions,
                      ]}
                      title="按负责人筛选"
                    />
                  </span>
                </th>
                <th>协助人</th>
                <th>亮点总结</th>
                <th>经验复盘</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((task) => {
                // 兼容旧数据（assignee 为单个 id 字符串）和新数据（数组）
                const assigneeIds = Array.isArray(task.assignee)
                  ? task.assignee
                  : task.assignee ? [task.assignee] : [];
                const latestStatusChange = Array.isArray(task.statusHistory) && task.statusHistory.length > 0
                  ? task.statusHistory[task.statusHistory.length - 1]
                  : null;
                const statusDisplayDate = latestStatusChange?.date || task.createdAt || '';
                const compactStatusDisplayDate = formatCompactTaskDate(statusDisplayDate);
                return (
                <tr key={task.id} className={`tasks-table__row tasks-table__row--${task.status === '已完成' ? 'done' : ''}`}>
                  <td>
                    <div className="tasks-table__status-cell">
                      <CustomSelect
                        value={task.status}
                        onChange={(val) => updateTaskStatus(task.id, val)}
                        options={taskStatuses.map((s) => ({
                          value: s,
                          label: s,
                        }))}
                        size="sm"
                        style={{ color: statusColors[task.status] }}
                      />
                      {statusDisplayDate && (
                        <div className="tasks-table__history">
                          <div className="tasks-table__history-item">
                            <span className="tasks-table__history-date">{compactStatusDisplayDate}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </td>
                  <td>
                    <CustomSelect
                      value={task.category || ''}
                      onChange={(val) => updateTaskField(task.id, 'category', val)}
                      options={taskCategories.map((c) => ({ value: c, label: c }))}
                      placeholder="选择分类"
                      size="sm"
                    />
                  </td>
                  <td>
                    <div className="tasks-table__title-cell">
                      <input
                        type="text"
                        className="tasks-table__inline-input tasks-table__inline-input--title"
                        value={task.title || ''}
                        onChange={(e) => updateTaskField(task.id, 'title', e.target.value)}
                        placeholder="事项标题"
                      />
                    </div>
                  </td>
                  <td>
                    <CustomSelect
                      value={assigneeIds}
                      onChange={(vals) => updateTaskField(task.id, 'assignee', vals)}
                      options={assigneeOptions}
                      placeholder="可不选择负责人"
                      multiple
                      size="sm"
                      searchable
                      searchPlaceholder="搜索负责人…"
                    />
                  </td>
                  <td>
                    <CustomSelect
                      value={(task.helpers || [])}
                      onChange={(vals) => updateTaskField(task.id, 'helpers', vals)}
                      options={assigneeOptions}
                      placeholder="选择协助人"
                      multiple
                      size="sm"
                      searchable
                      searchPlaceholder="搜索协助人…"
                    />
                  </td>
                  <td>
                    <div className="tasks-table__note-cell">
                      <input
                        type="text"
                        className="tasks-table__reason-input"
                        placeholder="如：规模大、参与人数多、主题热门、嘉宾准备细心…"
                        title="可以从规模大、参与人数多、主题热门、嘉宾准备细心等方向总结"
                        value={task.highlights || ''}
                        onChange={(e) => updateTaskField(task.id, 'highlights', e.target.value)}
                      />
                    </div>
                  </td>
                  <td>
                    <div className="tasks-table__note-cell">
                      <input
                        type="text"
                        className="tasks-table__reason-input"
                        placeholder="如：设备调试、时间策划、宣传力度、嘉宾跟进节奏…"
                        title="可以从设备调试、时间策划、宣传力度、嘉宾跟进节奏等方面总结"
                        value={task.reflections || ''}
                        onChange={(e) => updateTaskField(task.id, 'reflections', e.target.value)}
                      />
                      {canDeleteTask(task) && (
                        <button
                          onClick={() => deleteTask(task)}
                          className="tasks-table__delete"
                          title="删除"
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {filtered.length === 0 && (
          <div className="tasks-empty">
            <CheckSquare size={48} />
            <h3>暂无事项</h3>
            <p>
              {filterMineOnly
                ? '当前没有以你为负责人的事项，可以关闭「只看我负责的」查看全部，或点击「新建事项」创建。'
                : (filterAssignee.length > 0
                    ? '所选负责人暂无匹配事项，可以在表头「负责人」列切换为"全部负责人"。'
                    : '点击"新建事项"按钮创建新任务')}
            </p>
          </div>
        )}
      </div>

      {/* 跨模块联动提示：事项完成 → 根据 workItemKind 引导去归档 / 发布活动 */}
      {archivePrompt && (
        <div className="cross-link-overlay" onClick={() => setArchivePrompt(null)}>
          <div className="cross-link-toast" onClick={(e) => e.stopPropagation()}>
            <div className="cross-link-toast__icon">
              <CheckSquare size={22} />
            </div>
            <div className="cross-link-toast__body">
              <p className="cross-link-toast__title">事项已标记为完成 🎉</p>
              <p className="cross-link-toast__desc">
                「{archivePrompt.taskTitle}」已完成，是否前往
                <strong>
                  {archivePrompt.target === 'event'
                    ? '活动发布'
                    : '公众号文字分享归档'}
                </strong>
                页面补登{archivePrompt.target === 'event' ? '对应的活动' : '对应的文章'}？
              </p>
            </div>
            <div className="cross-link-toast__actions">
              <button
                className="cross-link-toast__btn cross-link-toast__btn--primary"
                onClick={() => {
                  // 跳转时把 workItemId + 期望的标题通过 state 传过去，
                  // 目标页可据此预填表单并在保存时回写同一个 workItemId。
                  // 路由路径来自 src/App.jsx：
                  //   /internal/articles       → InternalArticles
                  //   /internal/event-publish  → EventPublish
                  const path = archivePrompt.target === 'event'
                    ? '/internal/event-publish'
                    : '/internal/articles';
                  setArchivePrompt(null);
                  navigate(path, {
                    state: {
                      workItemId: archivePrompt.workItemId || null,
                      suggestedTitle: archivePrompt.taskTitle || '',
                    },
                  });
                }}
              >
                {archivePrompt.target === 'event' ? (
                  <>去发布活动<ArrowRight size={14} /></>
                ) : (
                  <><FileText size={15} /> 去归档<ArrowRight size={14} /></>
                )}
              </button>
              <button
                className="cross-link-toast__btn cross-link-toast__btn--ghost"
                onClick={() => setArchivePrompt(null)}
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
