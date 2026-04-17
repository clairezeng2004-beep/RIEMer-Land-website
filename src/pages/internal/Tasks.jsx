import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Navigate, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useSiteContent } from '../../contexts/SiteContentContext';
import { useWysiwyg } from '../../contexts/WysiwygContext';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import EditableText from '../../components/EditableText';
import {
  CheckSquare,
  Plus,
  X,
  CheckCircle2,
  FileText,
  ArrowRight,
} from 'lucide-react';
import { initialTasks } from '../../data/siteData';
import CustomSelect from '../../components/CustomSelect';
import '../../components/CrossLinkToast.css';
import './Tasks.css';

const statusColors = {
  '待启动': '#8A9A8C',
  '进行中': '#6B8F3C',
  '已完成': '#3A6B35',
  '已取消': '#C0392B',
};

// 持久化键：本地缓存 + 是否已初始化示例数据的标记
const TASKS_LS_KEY = 'riemer_tasks';
const TASKS_SEEDED_KEY = 'riemer_tasks_seeded';

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

/** Supabase 行 → 前端 task（兼容历史字段） */
const rowToTask = (r) => ({
  id: r.id,
  title: r.title || '',
  description: r.description || '',
  category: r.category || '',
  status: r.status || '待启动',
  assignee: Array.isArray(r.assignee) ? r.assignee : [],
  helpers: Array.isArray(r.helpers) ? r.helpers : [],
  statusHistory: Array.isArray(r.status_history) ? r.status_history : [],
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
});

export default function Tasks() {
  const { isAuthenticated, user, getAllUsers, supabaseOk } = useAuth();
  const { filterOptions, updateFilterOptions, internalConfig, updateInternalConfig } = useSiteContent();
  const { editing } = useWysiwyg();
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

  // 已注册已授权用户列表（动态获取）
  const [authorizedMembers, setAuthorizedMembers] = useState([]);

  useEffect(() => {
    let cancelled = false;
    const fetchUsers = async () => {
      try {
        const allUsers = await getAllUsers();
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
      }
    };
    fetchUsers();
    return () => { cancelled = true; };
  }, [getAllUsers, teamMembers]);

  // 负责人选项列表（已授权用户真名）
  const assigneeOptions = useMemo(
    () => authorizedMembers.map((m) => ({ value: m.id, label: m.name })),
    [authorizedMembers]
  );

  // 添加新标签状态
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');

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
  // 初始值优先读本地缓存；若无缓存且从未初始化过，则用示例数据 seeds 一次
  const [tasks, setTasks] = useState(() => {
    const cached = readLocalTasks();
    if (cached && cached.length > 0) {
      console.log('[Tasks] 从本地缓存恢复', cached.length, '条数据');
      return cached;
    }
    // 首次使用 或 本地为空：种下示例数据
    if (!localStorage.getItem(TASKS_SEEDED_KEY)) {
      try {
        localStorage.setItem(TASKS_SEEDED_KEY, '1');
        writeLocalTasks(initialTasks);
      } catch { /* ignore */ }
      console.log('[Tasks] 首次使用，载入示例数据', initialTasks.length, '条');
      return initialTasks;
    }
    console.log('[Tasks] 本地缓存为空（已 seeded 过）');
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

        // --- 合并策略（避免"云端覆盖本地"导致的数据丢失） ---
        // 读取"此刻"的本地缓存（不依赖 state，避免闭包）
        const local = readLocalTasks() || [];
        console.log('[Tasks] 本地缓存当前有', local.length, '条数据');

        const remoteIds = new Set(remote.map((t) => t.id));
        // 本地独有的事项：云端没有，需要补传
        const localOnly = local.filter((t) => t.id && !remoteIds.has(t.id));

        if (localOnly.length > 0) {
          console.log('[Tasks] 🆙 检测到', localOnly.length, '条本地独有事项，自动补传到 Supabase');
          try {
            const rows = localOnly.map(taskToRow);
            const { error: upErr } = await supabase.from('tasks').upsert(rows);
            if (upErr) throw upErr;
            console.log('[Tasks] ✅ 本地独有事项补传成功');
          } catch (upErr) {
            console.warn('[Tasks] ⚠️ 本地独有事项补传失败（继续用合并结果显示）:', upErr);
          }
        }

        // 合并后的完整列表：云端优先 + 本地独有在后
        const merged = [...remote, ...localOnly];
        console.log('[Tasks] 合并后共', merged.length, '条数据');

        if (merged.length > 0) {
          setTasks(merged);
        } else {
          console.log('[Tasks] 远端和本地都无数据，保留当前 state');
        }
      } catch (err) {
        // 表可能未创建 / 网络失败 —— 静默，继续使用本地数据
        console.warn('[Tasks] ❌ 从 Supabase 加载失败:', err);
      }
    })();
  }, [isAuthenticated, supabaseOk]);

  const [showForm, setShowForm] = useState(false);
  const [filterStatus, setFilterStatus] = useState('全部');
  const [filterCategory, setFilterCategory] = useState('全部');
  const [newTask, setNewTask] = useState({
    title: '',
    description: '',
    category: taskCategories[0] || '',
    status: '待启动',
    assignee: [],
    helpers: [],
  });
  const [notes, setNotes] = useState({});
  // 跨模块联动提示
  const [archivePrompt, setArchivePrompt] = useState(null);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  const canUseSupabase = isSupabaseConfigured && supabaseOk === true;

  const filtered = tasks.filter((task) => {
    const matchesStatus = filterStatus === '全部' || task.status === filterStatus;
    const matchesCategory = filterCategory === '全部' || task.category === filterCategory;
    return matchesStatus && matchesCategory;
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
    const task = {
      ...newTask,
      id: genId(),
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
    });
    setShowForm(false);

    // 异步同步到 Supabase
    if (canUseSupabase) {
      try {
        const row = taskToRow(task);
        console.log('[Tasks] 向 Supabase 插入新事项:', row);
        const { data, error } = await supabase.from('tasks').insert(row).select();
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
    const note = notes[id] || '';
    const targetTask = tasks.find((t) => t.id === id);
    if (!targetTask) return;
    const record = {
      from: targetTask.status,
      to: newStatus,
      reason: note,
      date: new Date().toISOString().split('T')[0],
    };
    const nextHistory = [...(targetTask.statusHistory || []), record];
    setTasks((prev) => prev.map((t) => (t.id === id
      ? { ...t, status: newStatus, statusHistory: nextHistory }
      : t
    )));
    // 清空该任务的备注
    setNotes((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    // 公众号文章分类的事项标记为"已完成"时，提示用户是否去归档页面
    if (
      targetTask.category === '公众号文章' &&
      newStatus === '已完成' &&
      targetTask.status !== '已完成'
    ) {
      setArchivePrompt({ taskTitle: targetTask.title });
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

  const updateNote = (id, value) => {
    setNotes((prev) => ({ ...prev, [id]: value }));
  };

  const deleteTask = async (id) => {
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

  // 添加新分类标签
  const handleAddCategory = () => {
    const trimmed = newCategoryName.trim();
    if (!trimmed) return;
    if (taskCategories.includes(trimmed)) {
      setNewCategoryName('');
      setShowAddCategory(false);
      return;
    }
    updateFilterOptions({
      ...filterOptions,
      taskCategories: [...taskCategories, trimmed],
    });
    setNewCategoryName('');
    setShowAddCategory(false);
  };

  // Stats
  const stats = {
    total: tasks.length,
    pending: tasks.filter((t) => t.status === '待启动').length,
    inProgress: tasks.filter((t) => t.status === '进行中').length,
    completed: tasks.filter((t) => t.status === '已完成').length,
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
                  <label>负责人</label>
                  <CustomSelect
                    value={newTask.assignee}
                    onChange={(vals) => setNewTask({ ...newTask, assignee: vals })}
                    options={assigneeOptions}
                    placeholder="选择负责人…"
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
                  options={taskCategories}
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
          <div className="tasks-filters__group">
            <span className="tasks-filters__label">状态：</span>
            {['全部', ...taskStatuses.filter((s) => tasks.some((t) => t.status === s))].map((s) => (
              <button
                key={s}
                className={`tasks-filters__btn ${filterStatus === s ? 'tasks-filters__btn--active' : ''}`}
                onClick={() => setFilterStatus(s)}
              >
                {s}
              </button>
            ))}
          </div>
          <div className="tasks-filters__group">
            <span className="tasks-filters__label">分类：</span>
            {['全部', ...taskCategories].map((c) => (
              <button
                key={c}
                className={`tasks-filters__btn ${filterCategory === c ? 'tasks-filters__btn--active' : ''}`}
                onClick={() => setFilterCategory(c)}
              >
                {c}
              </button>
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
                  disabled={!newCategoryName.trim()}
                  title="确认添加"
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
                <th>状态</th>
                <th>分类</th>
                <th>标题</th>
                <th>负责人</th>
                <th>协助人</th>
                <th>备注</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((task) => {
                // 兼容旧数据（assignee 为单个 id 字符串）和新数据（数组）
                const assigneeIds = Array.isArray(task.assignee)
                  ? task.assignee
                  : task.assignee ? [task.assignee] : [];
                const assigneeMembers = assigneeIds
                  .map((aId) => memberMap[aId])
                  .filter(Boolean);
                const helperMembers = (task.helpers || [])
                  .map((hId) => memberMap[hId])
                  .filter(Boolean);
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
                      {task.statusHistory && task.statusHistory.length > 0 && (
                        <div className="tasks-table__history">
                          {task.statusHistory.map((h, idx) => (
                            <div key={idx} className="tasks-table__history-item">
                              <span className="tasks-table__history-change">
                                {h.from} → {h.to}
                              </span>
                              {h.reason && (
                                <span className="tasks-table__history-reason">
                                  {h.reason}
                                </span>
                              )}
                              <span className="tasks-table__history-date">{h.date}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </td>
                  <td>
                    <span className="badge badge-secondary">{task.category}</span>
                  </td>
                  <td>
                    <div className="tasks-table__title-cell">
                      <span className="tasks-table__title">{task.title}</span>
                      {task.description && (
                        <span className="tasks-table__desc">{task.description}</span>
                      )}
                    </div>
                  </td>
                  <td>
                    {assigneeMembers.length > 0 ? (
                      <div className="tasks-table__helpers">
                        {assigneeMembers.map((m) => (
                          m.profileUrl ? (
                            <Link key={m.id} to={m.profileUrl} className="tasks-table__member-link">
                              @{m.name}
                            </Link>
                          ) : (
                            <span key={m.id} className="tasks-table__member-link">
                              @{m.name}
                            </span>
                          )
                        ))}
                      </div>
                    ) : (
                      <span className="tasks-table__assignee">
                        {(Array.isArray(task.assignee) ? task.assignee.join(', ') : task.assignee) || '—'}
                      </span>
                    )}
                  </td>
                  <td>
                    {helperMembers.length > 0 ? (
                      <div className="tasks-table__helpers">
                        {helperMembers.map((h) => (
                          <Link key={h.id} to={h.profileUrl} className="tasks-table__member-link">
                            @{h.name}
                          </Link>
                        ))}
                      </div>
                    ) : (
                      <span className="tasks-table__assignee">—</span>
                    )}
                  </td>
                  <td>
                    <div className="tasks-table__note-cell">
                      <input
                        type="text"
                        className="tasks-table__reason-input"
                        placeholder="备注…"
                        value={notes[task.id] || ''}
                        onChange={(e) => updateNote(task.id, e.target.value)}
                      />
                      <button
                        onClick={() => deleteTask(task.id)}
                        className="tasks-table__delete"
                        title="删除"
                      >
                        <X size={14} />
                      </button>
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
            <p>点击"新建事项"按钮创建新任务</p>
          </div>
        )}
      </div>

      {/* 跨模块联动提示：公众号文章事项完成 → 引导归档 */}
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
                <strong>公众号历史文章归档</strong>页面归档对应的文章？
              </p>
            </div>
            <div className="cross-link-toast__actions">
              <button
                className="cross-link-toast__btn cross-link-toast__btn--primary"
                onClick={() => {
                  setArchivePrompt(null);
                  navigate('/internal/articles');
                }}
              >
                <FileText size={15} /> 去归档
                <ArrowRight size={14} />
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
