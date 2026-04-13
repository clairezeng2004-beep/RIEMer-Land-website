import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { notificationsData } from '../data/siteData';

const NotificationContext = createContext(null);

const NOTIFICATIONS_KEY = 'riemer_notifications';
const LAST_EMAIL_KEY = 'riemer_last_email_reminder';

// 获取当前周的起始日期（周一）
function getWeekStart(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function NotificationProvider({ children }) {
  const location = useLocation();
  const [notifications, setNotifications] = useState(() => {
    const stored = localStorage.getItem(NOTIFICATIONS_KEY);
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch {
        return notificationsData;
      }
    }
    return notificationsData;
  });

  const [emailReminderSent, setEmailReminderSent] = useState(false);

  // 持久化
  useEffect(() => {
    localStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(notifications));
  }, [notifications]);

  // 检查本周是否需要发邮件提醒
  useEffect(() => {
    const lastEmail = localStorage.getItem(LAST_EMAIL_KEY);
    const weekStart = getWeekStart();
    const unreadCount = notifications.filter((n) => !n.read).length;

    if (unreadCount > 0) {
      if (!lastEmail || new Date(lastEmail) < weekStart) {
        // 模拟"邮件提醒已发送"（实际生产环境中这里会调用邮件 API）
        setEmailReminderSent(true);
        localStorage.setItem(LAST_EMAIL_KEY, new Date().toISOString());
        console.log(
          `[RIEMer Notification] 本周邮件提醒触发：${unreadCount} 条未读消息`
        );
      }
    }
  }, [notifications]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  // 未读消息数同步到网页标题
  useEffect(() => {
    const isInternal = location.pathname.startsWith('/internal');
    const baseTitle = isInternal ? '内部空间' : 'RIEMer Land';
    document.title = unreadCount > 0 ? `(${unreadCount}条未读消息) ${baseTitle}` : baseTitle;
  }, [unreadCount, location.pathname]);

  const markAsRead = useCallback((id) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    );
  }, []);

  const markAllAsRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);

  const addNotification = useCallback((notification) => {
    const newNotif = {
      id: Date.now().toString(),
      date: new Date().toISOString().split('T')[0],
      read: false,
      ...notification,
    };
    setNotifications((prev) => [newNotif, ...prev]);
  }, []);

  const deleteNotification = useCallback((id) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        unreadCount,
        markAsRead,
        markAllAsRead,
        addNotification,
        deleteNotification,
        emailReminderSent,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
}

export const useNotifications = () => {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return context;
};
