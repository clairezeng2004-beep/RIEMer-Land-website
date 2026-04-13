import { useState, useMemo } from 'react';
import { Navigate, Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useSiteContent } from '../../contexts/SiteContentContext';
import {
  CheckSquare,
  Plus,
  X,
  Clock,
  CheckCircle2,
  Circle,
  Ban,
  Compass,
} from 'lucide-react';
import { initialTasks } from '../../data/siteData';
import CustomSelect from '../../components/CustomSelect';
import './Tasks.css';

const statusIcons = {
  '规划中': <Compass size={16} />,
  '进行中': <Clock size={16} />,
  '已完成': <CheckCircle2 size={16} />,
  '已取消': <Ban size={16} />,
};

const statusColors = {
  '规划中': '#8A9A8C',
  '进行中': '#6B8F3C',
  '已完成': '#3A6B35',
  '已取消': '#C0392B',
};

export default function Tasks() {
  const { isAuthenticated, user } = useAuth();
  const { filterOptions, updateFilterOptions, internalConfig } = useSiteContent();
  const tc = internalConfig.tasks;

  // 从 context 读取筛选选项
  const taskCategories = filterOptions.taskCategories;
  const taskStatuses = filterOptions.taskStatuses;
  const teamMembers = filterOptions.teamMembers;

  // 添加新标签状态
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const memberMap = useMemo(
    () => Object.fromEntries(teamMembers.map((m) => [m.id, m])),
    [teamMembers]
  );

  const [tasks, setTasks] = useState(initialTasks);
  const [showForm, setShowForm] = useState(false);
  const [filterStatus, setFilterStatus] = useState('全部');
  const [filterCategory, setFilterCategory] = useState('全部');
  const [newTask, setNewTask] = useState({
    title: '',
    description: '',
    category: taskCategories[0] || '',
    status: '规划中',
    assignee: '',
    helpers: [],
  });
  const [notes, setNotes] = useState({});

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  const filtered = tasks.filter((task) => {
    const matchesStatus = filterStatus === '全部' || task.status === filterStatus;
    const matchesCategory = filterCategory === '全部' || task.category === filterCategory;
    return matchesStatus && matchesCategory;
  });

  const handleAddTask = (e) => {
    e.preventDefault();
    if (!newTask.title) return;
    const task = {
      ...newTask,
      id: Date.now().toString(),
      createdAt: new Date().toISOString().split('T')[0],
    };
    setTasks([task, ...tasks]);
    setNewTask({
      title: '',
      description: '',
      category: taskCategories[0] || '',
      status: '规划中',
      assignee: '',
      helpers: [],
    });
    setShowForm(false);
  };

  const updateTaskStatus = (id, newStatus) => {
    const note = notes[id] || '';
    setTasks(
      tasks.map((t) => {
        if (t.id !== id) return t;
        const record = {
          from: t.status,
          to: newStatus,
          reason: note,
          date: new Date().toISOString().split('T')[0],
        };
        return {
          ...t,
          status: newStatus,
          statusHistory: [...(t.statusHistory || []), record],
        };
      })
    );
    // 清空该任务的备注
    setNotes((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const updateNote = (id, value) => {
    setNotes((prev) => ({ ...prev, [id]: value }));
  };

  const deleteTask = (id) => {
    if (window.confirm('确定要删除这个事项吗？')) {
      setTasks(tasks.filter((t) => t.id !== id));
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
    pending: tasks.filter((t) => t.status === '规划中').length,
    inProgress: tasks.filter((t) => t.status === '进行中').length,
    completed: tasks.filter((t) => t.status === '已完成').length,
  };

  return (
    <div className="tasks-page">
      <div className="container">
        <div className="tasks-page__header">
          <div>
            <h1>
              <CheckSquare size={28} /> {tc.pageTitle}
            </h1>
            <p>{tc.pageDesc}</p>
          </div>
          <button
            className="btn btn-primary"
            onClick={() => setShowForm(!showForm)}
          >
            {showForm ? <X size={18} /> : <Plus size={18} />}
            {showForm ? '取消' : tc.newTaskBtn}
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
            <div className="tasks-stat__label">规划中</div>
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
                    value={newTask.assignee ? (memberMap[newTask.assignee]?.name || newTask.assignee) : '请选择'}
                    onChange={(val) => {
                      const member = teamMembers.find((m) => m.name === val);
                      setNewTask({ ...newTask, assignee: member ? member.id : '' });
                    }}
                    options={teamMembers.map((m) => m.name)}
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
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((task) => {
                const member = memberMap[task.assignee];
                const helperMembers = (task.helpers || [])
                  .map((hId) => memberMap[hId])
                  .filter(Boolean);
                return (
                <tr key={task.id} className={`tasks-table__row tasks-table__row--${task.status === '已完成' ? 'done' : ''}`}>
                  <td>
                    <div
                      className="tasks-table__status"
                      style={{ color: statusColors[task.status] }}
                    >
                      {statusIcons[task.status]}
                      <span>{task.status}</span>
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
                    {member ? (
                      <Link to={member.profileUrl} className="tasks-table__member-link">
                        @{member.name}
                      </Link>
                    ) : (
                      <span className="tasks-table__assignee">{task.assignee || '—'}</span>
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
                    <div className="tasks-table__actions">
                      <CustomSelect
                        value={task.status}
                        onChange={(val) => updateTaskStatus(task.id, val)}
                        options={taskStatuses}
                        size="sm"
                      />
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
    </div>
  );
}
