import { useState, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useNotifications } from '../../contexts/NotificationContext';
import { useSiteContent } from '../../contexts/SiteContentContext';
import { useWysiwyg } from '../../contexts/WysiwygContext';
import EditableText from '../../components/EditableText';
import {
  Bell,
  BellOff,
  CheckCheck,
  Trash2,
  BookOpen,
  Info,
  Clock,
  Mail,
  CheckCircle,
} from 'lucide-react';
import './Notifications.css';

const typeConfig = {
  progress: { icon: CheckCircle, color: '#5EAD8C', label: '事项进度' },
  sharing: { icon: BookOpen, color: '#5B8C3E', label: '内部分享' },
  other: { icon: Info, color: '#8B5CF6', label: '其他' },
  info: { icon: Info, color: '#8B5CF6', label: '通知' },
};

export default function Notifications() {
  const { isAuthenticated } = useAuth();
  const {
    notifications,
    unreadCount,
    loaded,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    emailReminderSent,
  } = useNotifications();
  const { internalConfig, updateInternalConfig } = useSiteContent();
  const { editing } = useWysiwyg();
  const nc = internalConfig.notifications || { pageTitle: '消息通知', markAllReadBtn: '全部已读' };

  const updateNotifs = useCallback(
    (key, val) => updateInternalConfig({ notifications: { [key]: val } }),
    [updateInternalConfig]
  );
  const [filter, setFilter] = useState('全部'); // 全部 | 未读 | 已读

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  const filtered = notifications.filter((n) => {
    if (filter === '未读') return !n.read;
    if (filter === '已读') return n.read;
    return true;
  });

  return (
    <div className="notifications-page">
      <div className="container">
        <div className="notifications-page__header">
          <div>
            <h1>
              <Bell size={28} /> <EditableText
                value={nc.pageTitle}
                onChange={(v) => updateNotifs('pageTitle', v)}
                configKey="notifications.pageTitle"
                as="span"
              />
            </h1>
            <p>
              {unreadCount > 0
                ? `你有 ${unreadCount} 条未读消息`
                : '所有消息已读'}
            </p>
          </div>
          {unreadCount > 0 && (
            <button className="btn btn-ghost" onClick={markAllAsRead}>
              <CheckCheck size={16} /> {nc.markAllReadBtn}
            </button>
          )}
        </div>

        {/* 邮件提醒状态 */}
        {emailReminderSent && (
          <div className="notifications-email-banner">
            <Mail size={18} />
            <div>
              <strong>本周邮件提醒已触发</strong>
              <p>系统已检测到未读消息，按周为单位的邮件提醒将自动发送至成员邮箱。</p>
            </div>
          </div>
        )}

        {/* 筛选 */}
        <div className="notifications-filters">
          {['全部', '未读', '已读'].map((f) => (
            <button
              key={f}
              className={`notifications-filter ${filter === f ? 'notifications-filter--active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f}
              {f === '未读' && unreadCount > 0 && (
                <span className="notifications-filter__count">{unreadCount}</span>
              )}
            </button>
          ))}
        </div>

        {/* 通知列表 */}
        <div className={`notifications-list ${loaded ? 'notifications-list--loaded' : ''}`}>
          {filtered.map((notif) => {
            const config = typeConfig[notif.type] || typeConfig.other;
            const Icon = config.icon;
            return (
              <div
                key={notif.id}
                className={`notification-item card ${!notif.read ? 'notification-item--unread' : ''}`}
                onClick={() => !notif.read && markAsRead(notif.id)}
              >
                <div
                  className="notification-item__icon"
                  style={{ background: `${config.color}15`, color: config.color }}
                >
                  <Icon size={20} />
                </div>
                <div className="notification-item__body">
                  <div className="notification-item__top">
                    <h4 className="notification-item__title">
                      {!notif.read && <span className="notification-item__dot" />}
                      {notif.title}
                    </h4>
                    <span
                      className="notification-item__type"
                      style={{ color: config.color, background: `${config.color}12` }}
                    >
                      {config.label}
                    </span>
                  </div>
                  <p className="notification-item__message">{notif.message}</p>
                  <div className="notification-item__meta">
                    <span className="notification-item__date">
                      <Clock size={12} /> {notif.date}
                    </span>
                    {notif.read && (
                      <span className="notification-item__read">
                        <CheckCircle size={12} /> 已读
                      </span>
                    )}
                    <div className="notification-item__actions">
                      {!notif.read && (
                        <button
                          className="notification-item__action"
                          onClick={(e) => { e.stopPropagation(); markAsRead(notif.id); }}
                          title="标记已读"
                        >
                          <CheckCheck size={14} />
                        </button>
                      )}
                      <button
                        className="notification-item__action notification-item__action--danger"
                        onClick={(e) => { e.stopPropagation(); deleteNotification(notif.id); }}
                        title="删除"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          {filtered.length === 0 && loaded && (
            <div className="notifications-empty">
              <BellOff size={48} />
              <h3>{filter === '未读' ? '没有未读消息' : '暂无消息'}</h3>
              <p>{filter === '未读' ? '所有消息已查看' : '还没有收到任何通知'}</p>
            </div>
          )}
        </div>

        {/* 邮件提醒说明 */}
        <div className="notifications-info card">
          <h4><Mail size={16} /> 邮件提醒机制</h4>
          <p>
            当本周有未读消息时，系统会自动以<strong>周为单位</strong>向成员邮箱发送一封提醒邮件，
            汇总本周的未读通知。每周最多发送一次，避免打扰。
          </p>
        </div>
      </div>
    </div>
  );
}
