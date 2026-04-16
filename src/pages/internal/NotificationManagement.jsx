import { useState, useCallback, useMemo } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useNotifications } from '../../contexts/NotificationContext';
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
  MessageSquarePlus,
  Upload,
  Filter,
  ChevronDown,
  ChevronUp,
  X,
} from 'lucide-react';
import './NotificationManagement.css';

// 通知类型配置
const typeConfig = {
  progress: { icon: CheckCircle, color: '#5EAD8C', label: '事项进度' },
  sharing: { icon: BookOpen, color: '#5B8C3E', label: '内部分享' },
  other: { icon: Info, color: '#8B5CF6', label: '其他' },
};

// ====== 通知触发规则定义 ======
const TRIGGER_RULES = [
  {
    id: 'doc-upload',
    source: '文档管理',
    sourceIcon: Upload,
    trigger: '成员上传新文档',
    title: '新内部分享',
    message: '「{上传者}」上传了文档「{文档名}」（{文档类型}）',
    type: 'sharing',
    autoRead: true,
    autoReadReason: '上传者自动已读，不打扰操作者本人',
    file: 'Documents.jsx',
  },
  {
    id: 'suggestion-new',
    source: '建设建议',
    sourceIcon: MessageSquarePlus,
    trigger: '成员提交新的建设建议',
    title: '新建设建议',
    message: '「{提议人}」提出了建议：{建议内容前40字}',
    type: 'progress',
    autoRead: true,
    autoReadReason: '建议提交者自动已读，仅作为记录',
    file: 'Suggestions.jsx',
  },
  {
    id: 'suggestion-status',
    source: '建设建议',
    sourceIcon: MessageSquarePlus,
    trigger: '管理员修改建议的状态',
    title: '建设建议状态变更',
    message: '建议「{建议内容}」状态：{旧状态} → {新状态}',
    type: 'progress',
    autoRead: true,
    autoReadReason: '状态变更操作者自动已读',
    file: 'Suggestions.jsx',
  },
  {
    id: 'weekly-email',
    source: '系统自动',
    sourceIcon: Clock,
    trigger: '本周存在未读消息时（每周最多一次）',
    title: '—（不创建通知，仅触发邮件提醒）',
    message: '系统检测到未读消息，自动向成员邮箱发送一封周度汇总提醒',
    type: 'other',
    autoRead: false,
    autoReadReason: '非通知，仅控制邮件发送频率',
    file: 'NotificationContext.jsx',
  },
];

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

  // 展开的触发规则
  const [expandedRule, setExpandedRule] = useState(null);
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
            <p>{isAdmin ? '查看通知触发规则、管理所有通知、发送新通知' : '查看通知触发规则和所有通知'}</p>
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
            <div className="notif-mgmt__stat-value">{TRIGGER_RULES.length}</div>
            <div className="notif-mgmt__stat-label">触发规则</div>
          </div>
        </div>

        {/* ====== 第一部分：通知触发规则 ====== */}
        <section className="notif-mgmt__section">
          <div className="notif-mgmt__section-header">
            <h2><Zap size={20} /> 通知触发规则</h2>
            <p>以下是系统内所有自动触发通知的逻辑，点击展开查看详情</p>
          </div>

          <div className="notif-mgmt__rules">
            {TRIGGER_RULES.map((rule) => {
              const SourceIcon = rule.sourceIcon;
              const config = typeConfig[rule.type];
              const TypeIcon = config.icon;
              const isExpanded = expandedRule === rule.id;

              return (
                <div
                  key={rule.id}
                  className={`notif-mgmt__rule card ${isExpanded ? 'notif-mgmt__rule--expanded' : ''}`}
                >
                  <div
                    className="notif-mgmt__rule-header"
                    onClick={() => setExpandedRule(isExpanded ? null : rule.id)}
                  >
                    <div className="notif-mgmt__rule-left">
                      <div className="notif-mgmt__rule-source-icon" style={{ background: `${config.color}15`, color: config.color }}>
                        <SourceIcon size={18} />
                      </div>
                      <div className="notif-mgmt__rule-info">
                        <h4>{rule.trigger}</h4>
                        <span className="notif-mgmt__rule-source">{rule.source}</span>
                      </div>
                    </div>
                    <div className="notif-mgmt__rule-right">
                      <span
                        className="notif-mgmt__rule-type"
                        style={{ color: config.color, background: `${config.color}12` }}
                      >
                        <TypeIcon size={12} /> {config.label}
                      </span>
                      {rule.autoRead ? (
                        <span className="notif-mgmt__rule-badge notif-mgmt__rule-badge--read">
                          <CheckCircle size={12} /> 自动已读
                        </span>
                      ) : (
                        <span className="notif-mgmt__rule-badge notif-mgmt__rule-badge--unread">
                          <Bell size={12} /> 未读
                        </span>
                      )}
                      {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="notif-mgmt__rule-detail">
                      <div className="notif-mgmt__rule-detail-grid">
                        <div className="notif-mgmt__rule-detail-item">
                          <label>通知标题</label>
                          <span>{rule.title}</span>
                        </div>
                        <div className="notif-mgmt__rule-detail-item">
                          <label>消息内容模板</label>
                          <span className="notif-mgmt__rule-template">{rule.message}</span>
                        </div>
                        <div className="notif-mgmt__rule-detail-item">
                          <label>初始状态</label>
                          <span>
                            {rule.autoRead ? (
                              <span className="notif-mgmt__detail-tag notif-mgmt__detail-tag--green">
                                <CheckCircle size={12} /> 自动标记为已读
                              </span>
                            ) : (
                              <span className="notif-mgmt__detail-tag notif-mgmt__detail-tag--orange">
                                <Bell size={12} /> 默认未读，需用户手动标记
                              </span>
                            )}
                          </span>
                        </div>
                        <div className="notif-mgmt__rule-detail-item">
                          <label>设为已读/未读的原因</label>
                          <span>{rule.autoReadReason}</span>
                        </div>
                        <div className="notif-mgmt__rule-detail-item">
                          <label>触发来源文件</label>
                          <code>{rule.file}</code>
                        </div>
                      </div>
                    </div>
                  )}
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
                  { value: 'reminder', label: '提醒' },
                  { value: 'info', label: '通知' },
                  { value: 'system', label: '系统' },
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
                      <span className={notif.read ? 'notif-mgmt__notif-status--read' : 'notif-mgmt__notif-status--unread'}>
                        {notif.read ? <><CheckCircle size={12} /> 已读</> : <><EyeOff size={12} /> 未读</>}
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
      </div>
    </div>
  );
}
