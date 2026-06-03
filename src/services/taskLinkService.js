import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { genWorkItemId } from '../utils/workItem';

const TASKS_LS_KEY = 'riemer_tasks';

function genTaskId() {
  return (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
}

function rowToTask(row) {
  return {
    id: row.id,
    title: row.title || '',
    description: row.description || '',
    category: row.category || '',
    status: row.status || '待启动',
    assignee: Array.isArray(row.assignee) ? row.assignee : [],
    helpers: Array.isArray(row.helpers) ? row.helpers : [],
    statusHistory: Array.isArray(row.status_history) ? row.status_history : [],
    highlights: row.highlights || '',
    reflections: row.reflections || '',
    workItemId: row.work_item_id || null,
    workItemKind: row.work_item_kind || null,
    createdAt: row.created_at ? String(row.created_at).slice(0, 10) : '',
  };
}

function taskToRow(task) {
  return {
    id: task.id,
    title: task.title || '',
    description: task.description || '',
    category: task.category || '',
    status: task.status || '待启动',
    assignee: Array.isArray(task.assignee) ? task.assignee : [],
    helpers: Array.isArray(task.helpers) ? task.helpers : [],
    status_history: Array.isArray(task.statusHistory) ? task.statusHistory : [],
    highlights: task.highlights || '',
    reflections: task.reflections || '',
    work_item_id: task.workItemId || null,
    work_item_kind: task.workItemKind || null,
  };
}

function getLocalTasks() {
  try {
    const raw = localStorage.getItem(TASKS_LS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLocalTasks(tasks) {
  try {
    localStorage.setItem(TASKS_LS_KEY, JSON.stringify(tasks));
  } catch { /* ignore */ }
}

export async function fetchTasksForLinking() {
  if (!isSupabaseConfigured || !supabase) return getLocalTasks();
  try {
    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(rowToTask);
  } catch (err) {
    console.warn('[TaskLink] 获取事项失败，回退本地:', err.message);
    return getLocalTasks();
  }
}

export async function bindExistingTaskToWorkItem(task, kind) {
  const workItemId = task.workItemId || genWorkItemId();
  const updates = { workItemId, workItemKind: kind };

  if (!isSupabaseConfigured || !supabase) {
    const next = getLocalTasks().map((item) =>
      String(item.id) === String(task.id) ? { ...item, ...updates } : item,
    );
    saveLocalTasks(next);
    return { success: true, workItemId, task: { ...task, ...updates }, offline: true };
  }

  try {
    const { error } = await supabase
      .from('tasks')
      .update({ work_item_id: workItemId, work_item_kind: kind })
      .eq('id', task.id);
    if (error) throw error;
    return { success: true, workItemId, task: { ...task, ...updates } };
  } catch (err) {
    return { success: false, error: err.message || '事项绑定失败' };
  }
}

export async function createLinkedTask({ title, kind, category, assigneeId }) {
  const workItemId = genWorkItemId();
  const now = new Date().toISOString();
  const task = {
    id: genTaskId(),
    title: (title || '').trim() || '未命名事项',
    description: '',
    category: category || '',
    status: '已完成',
    assignee: assigneeId ? [assigneeId] : [],
    helpers: [],
    statusHistory: [],
    highlights: '',
    reflections: '',
    workItemId,
    workItemKind: kind,
    createdAt: now.slice(0, 10),
  };

  if (!isSupabaseConfigured || !supabase) {
    saveLocalTasks([task, ...getLocalTasks()]);
    return { success: true, workItemId, task, offline: true };
  }

  try {
    const { data, error } = await supabase
      .from('tasks')
      .insert(taskToRow(task))
      .select()
      .single();
    if (error) throw error;
    return { success: true, workItemId, task: data ? rowToTask(data) : task };
  } catch (err) {
    return { success: false, error: err.message || '事项创建失败' };
  }
}
