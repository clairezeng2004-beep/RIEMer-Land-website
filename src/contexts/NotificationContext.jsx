import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase, isSupabaseConfigured, getReachable } from '../lib/supabase';
import { useAuth } from './AuthContext';
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
  const { user, isAdmin } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [reads, setReads] = useState(new Set()); // 当前用户已读的通知 ID 集合
  const [emailReminderSent, setEmailReminderSent] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const pollRef = useRef(null);

  // 判断是否使用 Supabase
  const useSupabase = isSupabaseConfigured && getReachable() !== false;

  // ---- 加载通知 ----
  const loadNotifications = useCallback(async () => {
    if (useSupabase) {
      try {
        // 从 Supabase 加载通知
        const { data, error } = await supabase
          .from('notifications')
          .select('*')
          .order('created_at', { ascending: false });

        if (error) {
          console.warn('[Notification] Supabase 加载通知失败，降级本地:', error.message);
          loadLocalNotifications();
          return;
        }

        // 加载当前用户的已读状态
        const { data: { user } } = await supabase.auth.getUser();
        let readSet = new Set();
        if (user) {
          const { data: readData } = await supabase
            .from('notification_reads')
            .select('notification_id')
            .eq('user_id', user.id);
          if (readData) {
            readSet = new Set(readData.map((r) => r.notification_id));
          }
        }

        // 根据用户角色过滤通知（管理员看所有，普通成员只看非 admin-only）
        // 获取当前用户的角色
        let userRole = 'member';
        if (user) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', user.id)
            .single();
          if (profile) userRole = profile.role;
        }

        const filtered = (data || []).filter((n) => {
          if (!n.target_role) return true; // target_role 为 null 表示所有人可见
          return n.target_role === userRole || userRole === 'admin';
        });

        // 转换为前端格式
        const mapped = filtered.map((n) => ({
          id: n.id,
          title: n.title,
          message: n.message,
          type: n.type,
          date: n.date,
          read: readSet.has(n.id),
        }));

        setNotifications(mapped);
        setReads(readSet);
        setLoaded(true);
      } catch (err) {
        console.warn('[Notification] Supabase 通知加载异常，降级本地:', err.message);
        loadLocalNotifications();
      }
    } else {
      loadLocalNotifications();
    }
  }, [useSupabase, isAdmin]);

  const loadLocalNotifications = () => {
    const stored = localStorage.getItem(NOTIFICATIONS_KEY);
    let notifs;
    if (stored) {
      try {
        notifs = JSON.parse(stored);
      } catch {
        notifs = notificationsData;
      }
    } else {
      notifs = notificationsData;
    }
    // 本地模式：过滤 target_role（非管理员看不到 admin-only 通知）
    const filtered = notifs.filter((n) => {
      if (!n.target_role) return true;
      return n.target_role === 'admin' && isAdmin;
    });
    setNotifications(filtered);
    setLoaded(true);
  };

  // ---- 初始化加载 ----
  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  // ---- 定时轮询 Supabase（每 30 秒刷新一次） ----
  useEffect(() => {
    if (!useSupabase) return;

    pollRef.current = setInterval(() => {
      loadNotifications();
    }, 30000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [useSupabase, loadNotifications]);

  // ---- 跨标签页同步 & 页面可见时刷新 ----
  useEffect(() => {
    // 监听 localStorage 变化（同浏览器不同标签页）
    const handleStorageChange = (e) => {
      if (e.key === NOTIFICATIONS_KEY) {
        loadNotifications();
      }
    };

    // 用户切回此标签页时，重新加载通知
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        loadNotifications();
      }
    };

    window.addEventListener('storage', handleStorageChange);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [loadNotifications]);

  // ---- 本地模式持久化（仅在非 Supabase 模式下） ----
  // 注意：不直接用 notifications state 覆盖 localStorage，因为 state 是角色过滤后的子集。
  // 持久化由 addLocalNotification 和 deleteNotification 直接操作 localStorage。

  // 检查本周是否需要发邮件提醒
  useEffect(() => {
    const lastEmail = localStorage.getItem(LAST_EMAIL_KEY);
    const weekStart = getWeekStart();
    const unreadCount = notifications.filter((n) => !n.read).length;

    if (unreadCount > 0) {
      if (!lastEmail || new Date(lastEmail) < weekStart) {
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

  // ---- 标记单条已读 ----
  const markAsRead = useCallback(async (id) => {
    // 立即更新本地状态
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    );

    if (useSupabase) {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          await supabase
            .from('notification_reads')
            .upsert({ notification_id: id, user_id: user.id });
        }
      } catch (err) {
        console.warn('[Notification] 标记已读失败:', err.message);
      }
    } else {
      // 本地模式：同步更新 localStorage
      try {
        const stored = localStorage.getItem(NOTIFICATIONS_KEY);
        const all = stored ? JSON.parse(stored) : [];
        const updated = all.map((n) => (n.id === id ? { ...n, read: true } : n));
        localStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(updated));
      } catch (err) {
        console.warn('[Notification] 本地标记已读持久化失败:', err.message);
      }
    }
  }, [useSupabase]);

  // ---- 全部标记已读 ----
  const markAllAsRead = useCallback(async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));

    if (useSupabase) {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const unread = notifications.filter((n) => !n.read);
          if (unread.length > 0) {
            const rows = unread.map((n) => ({
              notification_id: n.id,
              user_id: user.id,
            }));
            await supabase.from('notification_reads').upsert(rows);
          }
        }
      } catch (err) {
        console.warn('[Notification] 全部标记已读失败:', err.message);
      }
    } else {
      // 本地模式：同步更新 localStorage
      try {
        const stored = localStorage.getItem(NOTIFICATIONS_KEY);
        const all = stored ? JSON.parse(stored) : [];
        const updated = all.map((n) => ({ ...n, read: true }));
        localStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(updated));
      } catch (err) {
        console.warn('[Notification] 本地全部标记已读持久化失败:', err.message);
      }
    }
  }, [useSupabase, notifications]);

  // ---- 添加通知 ----
  const addNotification = useCallback(async (notification) => {
    if (useSupabase) {
      try {
        const newNotif = {
          title: notification.title,
          message: notification.message || '',
          type: notification.type || 'system',
          date: notification.date || new Date().toISOString().split('T')[0],
          target_role: notification.target_role || null,
        };
        const { data, error } = await supabase
          .from('notifications')
          .insert(newNotif)
          .select()
          .single();

        if (error) {
          console.warn('[Notification] Supabase 插入通知失败:', error.message);
          // 降级到本地
          addLocalNotification(notification);
          return;
        }

        // 如果是自动已读的通知，立即标记
        if (notification.read) {
          const { data: { user } } = await supabase.auth.getUser();
          if (user && data) {
            await supabase
              .from('notification_reads')
              .upsert({ notification_id: data.id, user_id: user.id });
          }
        }

        // 刷新通知列表
        loadNotifications();
      } catch (err) {
        console.warn('[Notification] 添加通知异常:', err.message);
        addLocalNotification(notification);
      }
    } else {
      addLocalNotification(notification);
    }
  }, [useSupabase, loadNotifications]);

  const addLocalNotification = (notification) => {
    const newNotif = {
      id: Date.now().toString(),
      date: new Date().toISOString().split('T')[0],
      read: false,
      ...notification,
    };
    // 直接更新 localStorage（保留完整列表）
    try {
      const stored = localStorage.getItem(NOTIFICATIONS_KEY);
      const all = stored ? JSON.parse(stored) : [];
      all.unshift(newNotif);
      localStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(all));
    } catch (err) {
      console.warn('[Notification] 本地通知持久化失败:', err.message);
    }
    // 更新 state（已过滤）
    if (!newNotif.target_role || (newNotif.target_role === 'admin' && isAdmin)) {
      setNotifications((prev) => [newNotif, ...prev]);
    }
  };

  // ---- 删除通知 ----
  const deleteNotification = useCallback(async (id) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));

    if (useSupabase) {
      try {
        await supabase.from('notifications').delete().eq('id', id);
      } catch (err) {
        console.warn('[Notification] 删除通知失败:', err.message);
      }
    } else {
      // 本地模式：同步更新 localStorage
      try {
        const stored = localStorage.getItem(NOTIFICATIONS_KEY);
        const all = stored ? JSON.parse(stored) : [];
        const updated = all.filter((n) => n.id !== id);
        localStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(updated));
      } catch (err) {
        console.warn('[Notification] 本地通知删除持久化失败:', err.message);
      }
    }
  }, [useSupabase]);

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
        refreshNotifications: loadNotifications,
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
