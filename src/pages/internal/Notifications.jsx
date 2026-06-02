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

const defaultNotificationsConfig = {
  pageTitle: '消息通知',
  markAllReadBtn: '全部已读',
};

const toText = (value, fallback = '') => {
  if (value == null) return fallback;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
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
  const rawConfig = internalConfig?.notifications;
  const nc = {
    pageTitle: toText(rawConfig?.pageTitle, defaultNotificationsConfig.pageTitle),
    markAllReadBtn: toText(rawConfig?.markAllReadBtn, defaultNotificationsConfig.markAllReadBtn),
  };

  const updateNotifs = useCallback(
    (key, val) => updateInternalConfig({ notifications: { [key]: val } }),
    [updateInternalConfig]
  );
  const [filter, setFilter] = useState('全部'); // 全部 | 未读 | 已读

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  const notificationList = Array.isArray(notifications) ? notifications : [];
  const filtered = notificationList.filter(Boolean).filter((n) => {
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
              <strong>本周的邮件提醒已发出</strong>
              <p>系统发现你有未读消息，已自动给你的邮箱发了一封提醒邮件，帮你汇总本周的消息。</p>
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
            const config = typeConfig[notif?.type] || typeConfig.other;
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
                      {notif.title || '消息通知'}
                    </h4>
                    <span
                      className="notification-item__type"
                      style={{ color: config.color, background: `${config.color}12` }}
                    >
                      {config.label}
                    </span>
                  </div>
                  <p className="notification-item__message">{notif.message || ''}</p>
                  <div className="notification-item__meta">
                    <span className="notification-item__date">
                      <Clock size={12} /> {notif.date || ''}
                    </span>
                    {notif.read && (
                      <span className={`notification-item__read${(notif.autoRead || notif.title?.startsWith('文档已删除')) ? ' notification-item__read--auto' : ''}`}>
                        <CheckCircle size={12} /> {(notif.autoRead || notif.title?.startsWith('文档已删除')) ? '自动已读' : '已读'}
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
          <h4><Mail size={16} /> 关于邮件提醒</h4>
          <p>
            如果你有还没看的消息，系统会<strong>每周最多一次</strong>自动给你的邮箱发一封提醒邮件，
            帮你汇总本周的未读消息。放心，不会频繁打扰你 😊
          </p>
        </div>
      </div>
    </div>
  );
}
