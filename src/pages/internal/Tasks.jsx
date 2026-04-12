import { useState, useMemo } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import {
  CheckSquare,
  Plus,
  X,
  Clock,
  CheckCircle2,
  Circle,
  Ban,
} from 'lucide-react';
import { initialTasks, taskCategories, taskStatuses, teamMembers } from '../../data/siteData';
import CustomSelect from '../../components/CustomSelect';
import './Tasks.css';

const statusIcons = {
  '待办': <Circle size={16} />,
  '进行中': <Clock size={16} />,
  '已完成': <CheckCircle2 size={16} />,
  '已取消': <Ban size={16} />,
};

const statusColors = {
  '待办': '#8A9A8C',
  '进行中': '#4FBFC4',
  '已完成': '#27AE60',
  '已取消': '#C0392B',
};

// 成员 id → 名称 映射
const memberMap = Object.fromEntries(teamMembers.map((m) => [m.id, m]));

export default function Tasks() {
  const { isAuthenticated, user } = useAuth();
  const [tasks, setTasks] = useState(initialTasks);
  const [showForm, setShowForm] = useState(false);
  const [filterStatus, setFilterStatus] = useState('全部');
  const [filterCategory, setFilterCategory] = useState('全部');
  const [newTask, setNewTask] = useState({
    title: '',
    description: '',
    category: '线上分享',
    status: '待办',
    assignee: '',
  });
  const [changeReasons, setChangeReasons] = useState({});

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
      category: '线上分享',
      status: '待办',
      assignee: '',
    });
    setShowForm(false);
  };

  const updateTaskStatus = (id, newStatus) => {
    const reason = changeReasons[id] || '';
    setTasks(
      tasks.map((t) => {
        if (t.id !== id) return t;
        const record = {
          from: t.status,
          to: newStatus,
          reason,
          date: new Date().toISOString().split('T')[0],
        };
        return {
          ...t,
          status: newStatus,
          statusHistory: [...(t.statusHistory || []), record],
        };
      })
    );
    // 清空该任务的变更理由
    setChangeReasons((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const updateChangeReason = (id, reason) => {
    setChangeReasons((prev) => ({ ...prev, [id]: reason }));
  };

  const deleteTask = (id) => {
    if (window.confirm('确定要删除这个事项吗？')) {
      setTasks(tasks.filter((t) => t.id !== id));
    }
  };

  // Stats
  const stats = {
    total: tasks.length,
    pending: tasks.filter((t) => t.status === '待办').length,
    inProgress: tasks.filter((t) => t.status === '进行中').length,
    completed: tasks.filter((t) => t.status === '已完成').length,
  };

  return (
    <div className="tasks-page">
      <div className="container">
        <div className="tasks-page__header">
          <div>
            <h1>
              <CheckSquare size={28} /> 事项追踪
            </h1>
            <p>管理和追踪社团各项工作任务的进展</p>
          </div>
          <button
            className="btn btn-primary"
            onClick={() => setShowForm(!showForm)}
          >
            {showForm ? <X size={18} /> : <Plus size={18} />}
            {showForm ? '取消' : '新建事项'}
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
            <div className="tasks-stat__label">待办</div>
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
            {['全部', ...taskStatuses].map((s) => (
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
          </div>
        </div>

        {/* Task Table */}
        <div className="tasks-table-wrapper">
          <table className="tasks-table">
            <thead>
              <tr>
                <th>状态</th>
                <th>标题</th>
                <th>分类</th>
                <th>负责人</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((task) => {
                const member = memberMap[task.assignee];
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
                    <div className="tasks-table__title-cell">
                      <span className="tasks-table__title">{task.title}</span>
                      {task.description && (
                        <span className="tasks-table__desc">{task.description}</span>
                      )}
                    </div>
                  </td>
                  <td>
                    <span className="badge badge-secondary">{task.category}</span>
                  </td>
                  <td>
                    {member ? (
                      <div className="tasks-table__member">
                        <span className="tasks-table__member-name">{member.name}</span>
                        <span className="tasks-table__member-role">{member.role}</span>
                      </div>
                    ) : (
                      <span className="tasks-table__assignee">{task.assignee || '—'}</span>
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
                        placeholder="变更理由…"
                        value={changeReasons[task.id] || ''}
                        onChange={(e) => updateChangeReason(task.id, e.target.value)}
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
