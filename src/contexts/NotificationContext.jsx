import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { useAuth } from './AuthContext';
import { useSiteContent } from './SiteContentContext';
import { notificationsData } from '../data/siteData';
import { buildDocumentTitle } from '../lib/pageTitle';

const NotificationContext = createContext(null);

const NOTIFICATIONS_KEY = 'riemer_notifications';
const LAST_EMAIL_KEY = 'riemer_last_email_reminder';
// 记录「系统自动已读」的通知 ID（区别于用户手动点击已读），列表里会显示为"自动已读"
const AUTO_READ_IDS_KEY = 'riemer_auto_read_ids';

function loadAutoReadIds() {
  try {
    const raw = localStorage.getItem(AUTO_READ_IDS_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr.map(String)) : new Set();
  } catch { return new Set(); }
}

function addAutoReadId(id) {
  try {
    const set = loadAutoReadIds();
    set.add(String(id));
    localStorage.setItem(AUTO_READ_IDS_KEY, JSON.stringify([...set]));
  } catch { /* ignore */ }
}

// 清理历史遗留的冗余缓存 key（曾导致初始加载与刷新后数据不一致）
try {
  localStorage.removeItem('riemer_unread_count');
  localStorage.removeItem('riemer_notifications_cache');
} catch { /* ignore */ }

// 获取当前周的起始日期（周一）
function getWeekStart(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

// 比较两个通知数组是否等价（避免无变化时触发 setState 导致闪动）
function notificationsEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id || a[i].read !== b[i].read || a[i].title !== b[i].title || a[i].message !== b[i].message || a[i].type !== b[i].type || a[i].date !== b[i].date) {
      return false;
    }
  }
  return true;
}

// 从 localStorage 读取已有通知列表用于初始化（避免刷新时列表从空闪到有数据）
function getStoredNotifications() {
  try {
    const stored = localStorage.getItem(NOTIFICATIONS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch { /* ignore */ }
  return [];
}

export function NotificationProvider({ children }) {
  const location = useLocation();
  const { user, isAdmin, supabaseOk } = useAuth();
  const { internalConfig } = useSiteContent();
  const [notifications, setNotifications] = useState(getStoredNotifications);
  const [reads, setReads] = useState(new Set()); // 当前用户已读的通知 ID 集合
  const [emailReminderSent, setEmailReminderSent] = useState(false);
  const [loaded, setLoaded] = useState(() => getStoredNotifications().length > 0);
  const pollRef = useRef(null);

  // 判断是否使用 Supabase —— 只有 supabaseOk === true 时才走 Supabase 路径
  // supabaseOk: null=检测中, true=可达, false=不可达
  const useSupabase = isSupabaseConfigured && supabaseOk === true;

  // ---- 加载通知 ----
  const loadNotifications = useCallback(async () => {
    if (useSupabase) {
      try {
        console.log('[Notification] 尝试从 Supabase 加载通知...');

        // 查询通知
        let { data, error } = await supabase
          .from('notifications')
          .select('*')
          .order('created_at', { ascending: false });

        // 查询失败（可能 401/session 过期），尝试刷新 session 后重试
        if (error) {
          console.warn('[Notification] Supabase 通知查询失败:', error.message, '，尝试刷新 session...');
          try {
            const { data: refreshData } = await supabase.auth.refreshSession();
            if (refreshData?.session) {
              console.log('[Notification] Session 刷新成功，重试查询...');
              const retry = await supabase
                .from('notifications')
                .select('*')
                .order('created_at', { ascending: false });
              data = retry.data;
              error = retry.error;
            }
          } catch (refreshErr) {
            console.warn('[Notification] Session 刷新异常:', refreshErr.message);
          }
        }

        if (error) {
          console.warn('[Notification] Supabase 加载通知最终失败，降级本地:', error.message);
          loadLocalNotifications();
          return;
        }

        // 加载当前用户的已读状态
        // 优先用 supabase.auth.getUser() 拿到最新认证用户；若失败（比如
        // 偶发的 session 读取异常）再 fallback 到 AuthContext 里已确认的 user。
        // 这样能避免"Session 偶发读不出来 → 以为未登录 → 所有消息变未读"。
        let authUser = null;
        try {
          const { data: userData } = await supabase.auth.getUser();
          authUser = userData?.user || null;
        } catch (e) {
          console.warn('[Notification] supabase.auth.getUser() 异常:', e.message);
        }
        if (!authUser && user) {
          console.log('[Notification] supabase.auth.getUser() 返回空，使用 AuthContext 的 user 兜底');
          authUser = user;
        }

        let readSet = new Set();
        if (authUser) {
          const { data: readData, error: readErr } = await supabase
            .from('notification_reads')
            .select('notification_id')
            .eq('user_id', authUser.id);
          if (readErr) {
            // 查询已读状态失败 —— 不要直接把所有通知视为未读，
            // 否则会导致"另一设备登录后消息又变未读"的错觉。
            // 这时退回到 localStorage 里缓存的已读状态做兜底。
            console.warn('[Notification] 已读状态查询失败，使用本地缓存兜底:', readErr.message);
            try {
              const cached = localStorage.getItem(NOTIFICATIONS_KEY);
              if (cached) {
                const parsed = JSON.parse(cached);
                if (Array.isArray(parsed)) {
                  readSet = new Set(parsed.filter((n) => n.read).map((n) => n.id));
                }
              }
            } catch { /* ignore */ }
          } else if (readData) {
            readSet = new Set(readData.map((r) => r.notification_id));
            console.log('[Notification] 云端已读记录:', readData.length, '条');
          }
        } else {
          console.warn('[Notification] 当前未登录 Supabase，无法获取云端已读状态');
        }

        // 根据用户角色过滤通知（管理员看所有，普通成员只看非 admin-only）
        // 获取当前用户的角色
        let userRole = 'member';
        if (authUser) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', authUser.id)
            .single();
          if (profile) userRole = profile.role;
        }

        // 如果 Supabase 通知表为空，使用默认通知数据兜底
        const sourceData = (data && data.length > 0) ? data : null;

        if (!sourceData) {
          console.info('[Notification] Supabase 通知表为空，降级本地模板数据');
          loadLocalNotifications();
          return;
        }

        console.log('[Notification] Supabase 返回', data.length, '条通知, 用户角色:', userRole);

        const filtered = sourceData.filter((n) => {
          if (!n.target_role) return true; // target_role 为 null 表示所有人可见
          return n.target_role === userRole || userRole === 'admin';
        });

        // 转换为前端格式
        const autoReadSet = loadAutoReadIds();
        const mapped = filtered.map((n) => ({
          id: n.id,
          title: n.title,
          message: n.message,
          type: n.type,
          date: n.date,
          read: readSet.has(n.id),
          autoRead: autoReadSet.has(String(n.id)),
        }));

        // 只有数据真正变化时才更新 state，避免轮询/可见性变化导致列表重渲染闪动
        setNotifications((prev) => {
          if (notificationsEqual(prev, mapped)) return prev;
          return mapped;
        });
        setReads(readSet);
        setLoaded(true);

        // 同步到 localStorage，下次刷新时可立即显示
        try {
          localStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(mapped));
        } catch { /* ignore */ }
      } catch (err) {
        console.warn('[Notification] Supabase 通知加载异常，降级本地:', err.message);
        loadLocalNotifications();
      }
    } else {
      loadLocalNotifications();
    }
  }, [useSupabase, isAdmin, user]);

  const loadLocalNotifications = () => {
    let notifs = null;
    let fromDefault = false;
    try {
      const stored = localStorage.getItem(NOTIFICATIONS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        // 只有解析后确实有数据才使用，空数组视为无数据
        if (Array.isArray(parsed) && parsed.length > 0) {
          notifs = parsed;
        }
      }
    } catch {
      // 解析失败，忽略
    }
    // 无有效本地数据时，使用默认模板数据并写入 localStorage
    if (!notifs) {
      notifs = notificationsData;
      fromDefault = true;
    }
    console.log('[Notification] 本地模式加载:', notifs.length, '条通知', fromDefault ? '(来自默认数据)' : '');
    // 如果使用了默认数据，立即写入 localStorage，确保后续 markAsRead 等操作能正确持久化
    if (fromDefault) {
      try {
        localStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(notifs));
      } catch { /* ignore */ }
    }
    // 本地模式：过滤 target_role（非管理员看不到 admin-only 通知）
    const filtered = notifs.filter((n) => {
      if (!n.target_role) return true;
      return n.target_role === 'admin' && isAdmin;
    });
    setNotifications((prev) => {
      if (notificationsEqual(prev, filtered)) return prev;
      return filtered;
    });
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

  // 未读消息数 + 当前路由 + 侧栏 Tab 名 → 同步到网页标题
  // 规则详见 src/lib/pageTitle.js：
  //   公共站: "RIEMer Land" 或 "RIEMer Land — 分享回顾/关于我们/…"
  //   内部空间: "内部空间 — <Tab>" 或 "内部空间 — <Tab> — 新建文件"
  //   有未读消息时整体前面加 "(N条未读消息) "
  useEffect(() => {
    document.title = buildDocumentTitle(
      location.pathname,
      internalConfig?.sidebar,
      unreadCount
    );
  }, [unreadCount, location.pathname, internalConfig?.sidebar]);

  // ---- 标记单条已读 ----
  const markAsRead = useCallback(async (id) => {
    // 立即更新本地状态
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    );

    if (useSupabase) {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          console.warn('[Notification] 标记已读：当前未登录，云端同步跳过');
          return;
        }
        // 复合主键表必须显式指定 onConflict，否则部分 PostgREST 版本
        // 会把 upsert 降级成 INSERT → 撞主键冲突 → RLS 检查失败 →
        // 前端看着"已读"但云端根本没写成功，另一台设备登录就还是未读。
        const { error } = await supabase
          .from('notification_reads')
          .upsert(
            { notification_id: id, user_id: user.id, read_at: new Date().toISOString() },
            { onConflict: 'notification_id,user_id' }
          );
        if (error) {
          console.warn('[Notification] 云端已读写入失败:', error.message, error.code);
        } else {
          console.log('[Notification] 云端已读写入成功, notification_id:', id);
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
        if (!user) {
          console.warn('[Notification] 全部标记已读：当前未登录，云端同步跳过');
          return;
        }
        const unread = notifications.filter((n) => !n.read);
        if (unread.length > 0) {
          const now = new Date().toISOString();
          const rows = unread.map((n) => ({
            notification_id: n.id,
            user_id: user.id,
            read_at: now,
          }));
          // 同样需要显式 onConflict，否则复合主键 upsert 可能失败
          const { error } = await supabase
            .from('notification_reads')
            .upsert(rows, { onConflict: 'notification_id,user_id' });
          if (error) {
            console.warn('[Notification] 全部标记已读：云端写入失败:', error.message, error.code);
          } else {
            console.log('[Notification] 全部标记已读：云端写入成功, 共', rows.length, '条');
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
          type: notification.type || 'other',
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
              .upsert(
                { notification_id: data.id, user_id: user.id, read_at: new Date().toISOString() },
                { onConflict: 'notification_id,user_id' }
              );
            // 本地记录此 ID 为「自动已读」，列表显示时与手动已读区分
            addAutoReadId(data.id);
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
      // 如果发通知时就带 read: true，说明是系统自动已读（发起人自己不打扰）
      autoRead: notification.read === true,
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
        loaded,
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
