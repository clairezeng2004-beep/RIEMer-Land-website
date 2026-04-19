import { useState, useCallback, useMemo } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useNotifications } from '../../contexts/NotificationContext';
import { useNotificationRules } from '../../contexts/NotificationRulesContext';
import NotificationRuleEditor from '../../components/NotificationRuleEditor';
import {
  EVENT_CATALOG,
  AUDIENCE_OPTIONS,
  TYPE_OPTIONS,
  describeRule,
} from '../../lib/notificationRuleDSL';
import {
  Bell,
  BellRing,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  Clock,
  Zap,
  BookOpen,
  CheckCircle,
  Info,
  Send,
  Users,
  Shield,
  FileText,
  Filter,
  X,
  Edit3,
  Power,
  RotateCcw,
} from 'lucide-react';
import './NotificationManagement.css';

// 通知类型配置
const typeConfig = {
  progress: { icon: CheckCircle, color: '#5EAD8C', label: '事项进度' },
  sharing: { icon: BookOpen, color: '#5B8C3E', label: '内部分享' },
  other: { icon: Info, color: '#8B5CF6', label: '其他' },
};

// 新建通知表单默认值
const defaultNewNotif = {
  title: '',
  message: '',
  type: 'progress',
  target_role: '', // '' = 所有人
};

export default function NotificationManagement() {
  const { isAuthenticated, isAdmin } = useAuth();
  const {
    notifications,
    addNotification,
    deleteNotification,
    markAsRead,
    refreshNotifications,
  } = useNotifications();

  // 通知规则管理
  const {
    rules,
    cloudAvailable,
    addRule,
    updateRule,
    deleteRule,
    toggleRule,
    resetToDefaults,
  } = useNotificationRules();

  // 规则编辑器状态
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingRule, setEditingRule] = useState(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  // 新建通知表单
  const [showNewForm, setShowNewForm] = useState(false);
  const [newNotif, setNewNotif] = useState({ ...defaultNewNotif });
  const [sending, setSending] = useState(false);
  const [sendSuccess, setSendSuccess] = useState(false);
  // 通知列表筛选
  const [listFilter, setListFilter] = useState('all'); // all | unread | read
  const [typeFilter, setTypeFilter] = useState('all'); // all | progress | sharing | other

  // 统计
  const stats = useMemo(() => {
    const total = notifications.length;
    const unread = notifications.filter((n) => !n.read).length;
    const read = total - unread;
    const byType = { progress: 0, sharing: 0, other: 0 };
    notifications.forEach((n) => {
      if (byType[n.type] !== undefined) byType[n.type]++;
    });
    return { total, unread, read, byType };
  }, [notifications]);

  // 过滤通知列表
  const filteredNotifications = useMemo(() => {
    return notifications.filter((n) => {
      if (listFilter === 'unread' && n.read) return false;
      if (listFilter === 'read' && !n.read) return false;
      if (typeFilter !== 'all' && n.type !== typeFilter) return false;
      return true;
    });
  }, [notifications, listFilter, typeFilter]);

  // 发送新通知
  const handleSendNotification = useCallback(async () => {
    if (!newNotif.title.trim()) return;
    setSending(true);
    try {
      await addNotification({
        title: newNotif.title.trim(),
        message: newNotif.message.trim(),
        type: newNotif.type,
        target_role: newNotif.target_role || null,
        read: false,
      });
      setSendSuccess(true);
      setNewNotif({ ...defaultNewNotif });
      setTimeout(() => {
        setSendSuccess(false);
        setShowNewForm(false);
      }, 1500);
    } catch (err) {
      console.error('发送通知失败:', err);
    } finally {
      setSending(false);
    }
  }, [newNotif, addNotification]);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="notif-mgmt">
      <div className="container">
        {/* ====== 页面头部 ====== */}
        <div className="notif-mgmt__header">
          <div>
            <h1><BellRing size={28} /> 通知管理</h1>
            <p>{isAdmin ? '了解什么时候会收到通知、管理所有通知、发送新通知' : '了解什么时候会收到通知，查看所有通知'}</p>
          </div>
          {isAdmin && (
            <button
              className="btn btn-primary"
              onClick={() => setShowNewForm(true)}
            >
              <Plus size={16} /> 发送新通知
            </button>
          )}
        </div>

        {/* ====== 统计卡片 ====== */}
        <div className="notif-mgmt__stats">
          <div className="notif-mgmt__stat-card">
            <div className="notif-mgmt__stat-value">{stats.total}</div>
            <div className="notif-mgmt__stat-label">总通知数</div>
          </div>
          <div className="notif-mgmt__stat-card notif-mgmt__stat-card--unread">
            <div className="notif-mgmt__stat-value">{stats.unread}</div>
            <div className="notif-mgmt__stat-label">未读</div>
          </div>
          <div className="notif-mgmt__stat-card notif-mgmt__stat-card--read">
            <div className="notif-mgmt__stat-value">{stats.read}</div>
            <div className="notif-mgmt__stat-label">已读</div>
          </div>
          <div className="notif-mgmt__stat-card notif-mgmt__stat-card--rules">
            <div className="notif-mgmt__stat-value">{rules.length}</div>
            <div className="notif-mgmt__stat-label">通知规则</div>
          </div>
        </div>

        {/* ====== 第一部分：通知触发规则（可自定义） ====== */}
        <section className="notif-mgmt__section">
          <div className="notif-mgmt__section-header">
            <h2><Zap size={20} /> 通知触发规则</h2>
            <p>
              你可以自定义"在什么情况下、给谁、发什么样的通知"；系统会自动把你的选择翻译成执行逻辑。
              {!cloudAvailable && (
                <span className="notif-mgmt__rule-hint">
                  （当前规则只保存在本浏览器。如需多端同步，请在 Supabase 中执行 <code>supabase-notification-rules.sql</code>）
                </span>
              )}
            </p>
            {isAdmin && (
              <div className="notif-mgmt__rules-actions">
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    setEditingRule(null);
                    setEditorOpen(true);
                  }}
                >
                  <Plus size={14} /> 新增规则
                </button>
                <button
                  className="btn btn-ghost"
                  onClick={() => setShowResetConfirm(true)}
                  title="把所有规则恢复到系统默认配置"
                >
                  <RotateCcw size={14} /> 恢复默认规则
                </button>
              </div>
            )}
          </div>

          <div className="notif-mgmt__rules">
            {rules.length === 0 && (
              <div className="notif-mgmt__empty">
                <Bell size={36} />
                <p>还没有配置任何规则，点击"新增规则"开始</p>
              </div>
            )}
            {rules.map((rule) => {
              const ev = EVENT_CATALOG.find((e) => e.key === rule.event);
              const typeCfg = typeConfig[rule.type] || typeConfig.other;
              const TypeIcon = typeCfg.icon;
              const audienceLabel =
                AUDIENCE_OPTIONS.find((a) => a.value === rule.audience)?.label
                || '所有人';
              const typeMeta = TYPE_OPTIONS.find((t) => t.value === rule.type);
              const disabled = rule.enabled === false;

              return (
                <div
                  key={rule.id}
                  className={`notif-mgmt__rule card ${disabled ? 'notif-mgmt__rule--disabled' : ''}`}
                >
                  <div className="notif-mgmt__rule-header">
                    <div className="notif-mgmt__rule-left">
                      <div
                        className="notif-mgmt__rule-source-icon"
                        style={{ background: `${typeCfg.color}15`, color: typeCfg.color }}
                      >
                        <TypeIcon size={18} />
                      </div>
                      <div className="notif-mgmt__rule-info">
                        <h4>{rule.title || '（未命名规则）'}</h4>
                        <span className="notif-mgmt__rule-source">
                          {ev ? `【${ev.source}】${ev.label}` : rule.event}
                        </span>
                      </div>
                    </div>
                    <div className="notif-mgmt__rule-right">
                      <span
                        className="notif-mgmt__rule-type"
                        style={{
                          color: typeMeta?.color || typeCfg.color,
                          background: `${typeMeta?.color || typeCfg.color}12`,
                        }}
                      >
                        <TypeIcon size={12} /> {typeCfg.label}
                      </span>
                      <span className="notif-mgmt__rule-audience">
                        <Users size={12} /> {audienceLabel}
                      </span>
                      {isAdmin && (
                        <>
                          <button
                            className={`notif-mgmt__action-btn ${disabled ? '' : 'notif-mgmt__action-btn--on'}`}
                            onClick={() => toggleRule(rule.id)}
                            title={disabled ? '点击启用' : '点击停用'}
                          >
                            <Power size={14} />
                          </button>
                          <button
                            className="notif-mgmt__action-btn"
                            onClick={() => {
                              setEditingRule(rule);
                              setEditorOpen(true);
                            }}
                            title="编辑规则"
                          >
                            <Edit3 size={14} />
                          </button>
                          <button
                            className="notif-mgmt__action-btn notif-mgmt__action-btn--danger"
                            onClick={() => {
                              if (confirm(`确认删除规则「${rule.title}」？`)) {
                                deleteRule(rule.id);
                              }
                            }}
                            title="删除规则"
                          >
                            <Trash2 size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="notif-mgmt__rule-detail">
                    <div className="notif-mgmt__rule-nl">
                      <Info size={12} /> {describeRule(rule)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* ====== 第二部分：所有通知列表 ====== */}
        <section className="notif-mgmt__section">
          <div className="notif-mgmt__section-header">
            <h2><FileText size={20} /> 所有通知</h2>
            <div className="notif-mgmt__list-filters">
              <div className="notif-mgmt__filter-group">
                <Filter size={14} />
                {[
                  { value: 'all', label: '全部' },
                  { value: 'unread', label: '未读' },
                  { value: 'read', label: '已读' },
                ].map((f) => (
                  <button
                    key={f.value}
                    className={`notif-mgmt__filter-btn ${listFilter === f.value ? 'notif-mgmt__filter-btn--active' : ''}`}
                    onClick={() => setListFilter(f.value)}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <div className="notif-mgmt__filter-group">
                {[
                  { value: 'all', label: '全部类型' },
                  { value: 'progress', label: '事项进度' },
                  { value: 'sharing', label: '内部分享' },
                  { value: 'other', label: '其他' },
                ].map((f) => (
                  <button
                    key={f.value}
                    className={`notif-mgmt__filter-btn ${typeFilter === f.value ? 'notif-mgmt__filter-btn--active' : ''}`}
                    onClick={() => setTypeFilter(f.value)}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="notif-mgmt__list">
            {filteredNotifications.length === 0 && (
              <div className="notif-mgmt__empty">
                <Bell size={36} />
                <p>暂无符合条件的通知</p>
              </div>
            )}
            {filteredNotifications.map((notif) => {
              const config = typeConfig[notif.type] || typeConfig.other;
              const Icon = config.icon;
              return (
                <div
                  key={notif.id}
                  className={`notif-mgmt__notif-item card ${!notif.read ? 'notif-mgmt__notif-item--unread' : ''}`}
                >
                  <div
                    className="notif-mgmt__notif-icon"
                    style={{ background: `${config.color}15`, color: config.color }}
                  >
                    <Icon size={18} />
                  </div>
                  <div className="notif-mgmt__notif-body">
                    <div className="notif-mgmt__notif-top">
                      <h4>
                        {!notif.read && <span className="notif-mgmt__notif-dot" />}
                        {notif.title}
                      </h4>
                      <span
                        className="notif-mgmt__notif-type"
                        style={{ color: config.color, background: `${config.color}12` }}
                      >
                        {config.label}
                      </span>
                    </div>
                    {notif.message && (
                      <p className="notif-mgmt__notif-message">{notif.message}</p>
                    )}
                    <div className="notif-mgmt__notif-meta">
                      <span><Clock size={12} /> {notif.date}</span>
                      <span className={notif.read ? `notif-mgmt__notif-status--read${notif.autoRead ? ' notif-mgmt__notif-status--auto' : ''}` : 'notif-mgmt__notif-status--unread'}>
                        {notif.read ? <><CheckCircle size={12} /> {notif.autoRead ? '自动已读' : '已读'}</> : <><EyeOff size={12} /> 未读</>}
                      </span>
                    </div>
                  </div>
                  {isAdmin && (
                    <div className="notif-mgmt__notif-actions">
                      {!notif.read && (
                        <button
                          className="notif-mgmt__action-btn"
                          onClick={() => markAsRead(notif.id)}
                          title="标记已读"
                        >
                          <CheckCircle size={14} />
                        </button>
                      )}
                      <button
                        className="notif-mgmt__action-btn notif-mgmt__action-btn--danger"
                        onClick={() => deleteNotification(notif.id)}
                        title="删除"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* ====== 新建通知弹窗 ====== */}
        {showNewForm && (
          <div className="notif-mgmt__modal-overlay" onClick={() => !sending && setShowNewForm(false)}>
            <div className="notif-mgmt__modal" onClick={(e) => e.stopPropagation()}>
              <div className="notif-mgmt__modal-header">
                <h3><Send size={18} /> 发送新通知</h3>
                <button
                  className="notif-mgmt__modal-close"
                  onClick={() => !sending && setShowNewForm(false)}
                >
                  <X size={18} />
                </button>
              </div>

              {sendSuccess ? (
                <div className="notif-mgmt__modal-success">
                  <CheckCircle size={48} />
                  <h4>通知已发送！</h4>
                </div>
              ) : (
                <div className="notif-mgmt__modal-body">
                  <div className="notif-mgmt__form-group">
                    <label>通知标题 <span className="notif-mgmt__required">*</span></label>
                    <input
                      type="text"
                      value={newNotif.title}
                      onChange={(e) => setNewNotif({ ...newNotif, title: e.target.value })}
                      placeholder="请输入通知标题"
                      maxLength={100}
                    />
                  </div>

                  <div className="notif-mgmt__form-group">
                    <label>通知内容</label>
                    <textarea
                      value={newNotif.message}
                      onChange={(e) => setNewNotif({ ...newNotif, message: e.target.value })}
                      placeholder="请输入通知详细内容（可选）"
                      rows={3}
                      maxLength={500}
                    />
                  </div>

                  <div className="notif-mgmt__form-row">
                    <div className="notif-mgmt__form-group">
                      <label>通知类型</label>
                      <div className="notif-mgmt__type-select">
                        {Object.entries(typeConfig).map(([key, cfg]) => {
                          const TypeIcon = cfg.icon;
                          return (
                            <button
                              key={key}
                              className={`notif-mgmt__type-btn ${newNotif.type === key ? 'notif-mgmt__type-btn--active' : ''}`}
                              style={{
                                '--type-color': cfg.color,
                                borderColor: newNotif.type === key ? cfg.color : undefined,
                                background: newNotif.type === key ? `${cfg.color}12` : undefined,
                                color: newNotif.type === key ? cfg.color : undefined,
                              }}
                              onClick={() => setNewNotif({ ...newNotif, type: key })}
                            >
                              <TypeIcon size={14} /> {cfg.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="notif-mgmt__form-group">
                      <label>发送对象</label>
                      <div className="notif-mgmt__type-select">
                        <button
                          className={`notif-mgmt__type-btn ${newNotif.target_role === '' ? 'notif-mgmt__type-btn--active' : ''}`}
                          style={{
                            '--type-color': '#5B8C3E',
                            borderColor: newNotif.target_role === '' ? '#5B8C3E' : undefined,
                            background: newNotif.target_role === '' ? 'rgba(91,140,62,0.08)' : undefined,
                            color: newNotif.target_role === '' ? '#5B8C3E' : undefined,
                          }}
                          onClick={() => setNewNotif({ ...newNotif, target_role: '' })}
                        >
                          <Users size={14} /> 所有人
                        </button>
                        <button
                          className={`notif-mgmt__type-btn ${newNotif.target_role === 'admin' ? 'notif-mgmt__type-btn--active' : ''}`}
                          style={{
                            '--type-color': '#4FBFC4',
                            borderColor: newNotif.target_role === 'admin' ? '#4FBFC4' : undefined,
                            background: newNotif.target_role === 'admin' ? 'rgba(79,191,196,0.08)' : undefined,
                            color: newNotif.target_role === 'admin' ? '#4FBFC4' : undefined,
                          }}
                          onClick={() => setNewNotif({ ...newNotif, target_role: 'admin' })}
                        >
                          <Shield size={14} /> 仅管理员
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="notif-mgmt__modal-footer">
                    <button
                      className="btn btn-ghost"
                      onClick={() => setShowNewForm(false)}
                      disabled={sending}
                    >
                      取消
                    </button>
                    <button
                      className="btn btn-primary"
                      onClick={handleSendNotification}
                      disabled={sending || !newNotif.title.trim()}
                    >
                      {sending ? (
                        <>发送中…</>
                      ) : (
                        <><Send size={14} /> 发送通知</>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ====== 规则编辑器 ====== */}
        <NotificationRuleEditor
          open={editorOpen}
          rule={editingRule}
          onClose={() => {
            setEditorOpen(false);
            setEditingRule(null);
          }}
          onSave={async (draft) => {
            if (editingRule?.id) {
              await updateRule({ ...editingRule, ...draft });
            } else {
              await addRule(draft);
            }
            setEditorOpen(false);
            setEditingRule(null);
          }}
        />

        {/* ====== 恢复默认确认 ====== */}
        {showResetConfirm && (
          <div
            className="notif-mgmt__modal-overlay"
            onClick={() => setShowResetConfirm(false)}
          >
            <div
              className="notif-mgmt__modal"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="notif-mgmt__modal-header">
                <h3><RotateCcw size={18} /> 恢复默认规则</h3>
                <button
                  className="notif-mgmt__modal-close"
                  onClick={() => setShowResetConfirm(false)}
                >
                  <X size={18} />
                </button>
              </div>
              <div className="notif-mgmt__modal-body">
                <p>
                  这将会<strong>删除所有自定义规则</strong>并恢复为系统默认的 8 条规则。
                  这个操作不可撤销，确定要继续吗？
                </p>
              </div>
              <div className="notif-mgmt__modal-footer">
                <button
                  className="btn btn-ghost"
                  onClick={() => setShowResetConfirm(false)}
                >
                  取消
                </button>
                <button
                  className="btn btn-primary"
                  onClick={async () => {
                    await resetToDefaults();
                    setShowResetConfirm(false);
                  }}
                >
                  确认恢复
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
