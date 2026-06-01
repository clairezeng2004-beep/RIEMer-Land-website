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
  // 并发去重：请求序号 + 当前在途请求，避免"先发后到"的响应覆盖"后发先到"的新状态
  const reqSeqRef = useRef(0);
  const inflightRef = useRef(false);
  // 距上次成功加载的最短间隔（ms），防止 visibilitychange / storage / 轮询同时开火
  const lastLoadAtRef = useRef(0);
  const MIN_RELOAD_INTERVAL_MS = 1500;

  // 用 ref 镜像 user.id / isAdmin，避免它们变化时 useCallback 重建
  // 导致挂载的 effect 重跑、触发额外网络请求（这是"数据忽多忽少"的主因之一）
  const userIdRef = useRef(user?.id || null);
  const isAdminRef = useRef(isAdmin);
  useEffect(() => { userIdRef.current = user?.id || null; }, [user?.id]);
  useEffect(() => { isAdminRef.current = isAdmin; }, [isAdmin]);

  // Supabase 是否"明确不可达"：只有 === false 才走本地；null（检测中）仍乐观走 Supabase
  // 避免首次挂载 supabaseOk 还是 null 时错误走本地 → 拿到模板 5 条 → 再被云端数据覆盖的抖动
  const isSupabaseDown = supabaseOk === false;
  const useSupabase = isSupabaseConfigured && !isSupabaseDown;

  // ---- 加载通知 ----
  // 关键设计：
  // 1) useCallback 依赖极少（只有 useSupabase），不会因 user 对象引用变化/isAdmin 波动被重建
  //    → 挂载用的 effect 不会反复重跑 → 不会产生并发请求风暴
  // 2) 内部通过 reqSeqRef 给每次请求打序号，响应回来时只有"最后发出的那一个"会写入 state
  //    → 旧响应迟到也不会覆盖新状态（这是"刚看到 10 条突然变空"的根因之一）
  // 3) lastLoadAtRef 做 1.5s 节流：visibilitychange / storage / 轮询同时开火时只真正跑一次
  // 4) Supabase 查询成功但表里是空数组 → 就老实显示"没有通知"，不再注入 5 条默认模板
  //    （过去的行为会导致"有时刷出来一堆模板消息"，这是"忽多忽少"最直观的来源）
  const loadNotifications = useCallback(async (options = {}) => {
    const { force = false } = options;

    // 未登录访客不需要消息通知。移动端公开页刷新时跳过这组 Supabase
    // 查询，避免首页还没交互就被内部空间通知链路拖慢。
    if (!userIdRef.current) {
      setNotifications((prev) => (prev.length === 0 ? prev : []));
      setReads(new Set());
      setLoaded(true);
      lastLoadAtRef.current = Date.now();
      return;
    }

    // 节流：距上次加载 < 1.5s 且非 force，直接跳过
    const now = Date.now();
    if (!force && now - lastLoadAtRef.current < MIN_RELOAD_INTERVAL_MS) {
      return;
    }
    // 同一时刻只允许一个请求在飞
    if (inflightRef.current) {
      return;
    }
    inflightRef.current = true;

    const mySeq = ++reqSeqRef.current;
    const isLatest = () => mySeq === reqSeqRef.current;

    try {
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
            console.warn('[Notification] Supabase 加载通知最终失败:', error.message);
            // 失败 → 保持现状（不清空、不塞模板），让用户看到的上一帧数据稳定
            // 过去这里直接 loadLocalNotifications()，会把云端数据替换成 5 条本地模板
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
          if (!authUser && userIdRef.current) {
            console.log('[Notification] supabase.auth.getUser() 返回空，使用 AuthContext 的 user 兜底');
            authUser = { id: userIdRef.current };
          }

          let readSet = new Set();
          // read_at 映射：notification_id -> ISO 时间字符串
          // 用于判定「自动已读」：如果某条通知的 read_at 与 created_at 间隔极短
          // （< 5 秒，正常人不可能这么快手动点击），就判定为系统自动已读。
          // 这样即使换设备登录或清缓存，也能稳定显示「自动已读」而不是「已读」。
          let readAtMap = new Map();
          if (authUser) {
            const { data: readData, error: readErr } = await supabase
              .from('notification_reads')
              .select('notification_id, read_at')
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
              readAtMap = new Map(readData.map((r) => [r.notification_id, r.read_at]));
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

          // 关键修复：Supabase 查询成功但表里就是空的 → 老实显示"没有通知"
          // 过去这里会调用 loadLocalNotifications() 塞 5 条模板进来，是"有时突然出来很多条"的元凶
          const sourceData = Array.isArray(data) ? data : [];

          console.log('[Notification] Supabase 返回', sourceData.length, '条通知, 用户角色:', userRole);

          const filtered = sourceData.filter((n) => {
            if (!n.target_role) return true; // target_role 为 null 表示所有人可见
            return n.target_role === userRole || userRole === 'admin';
          });

          // 转换为前端格式
          const autoReadSet = loadAutoReadIds();
          // 5 秒内自动已读的阈值（单位: 毫秒）
          // 正常用户不可能在一条通知产生后 5 秒内手动点击已读，所以超短间隔一定是系统自动标记的
          const AUTO_READ_THRESHOLD_MS = 5000;
          const mapped = filtered.map((n) => {
            // 先按本地记录判断（老数据兜底）
            let isAuto = autoReadSet.has(String(n.id));
            // 再按云端 read_at 与 created_at 间隔判断（跨设备也可靠）
            if (!isAuto && readSet.has(n.id)) {
              const readAt = readAtMap.get(n.id);
              if (readAt && n.created_at) {
                const diff = Math.abs(new Date(readAt).getTime() - new Date(n.created_at).getTime());
                if (diff <= AUTO_READ_THRESHOLD_MS) {
                  isAuto = true;
                }
              }
            }
            return {
              id: n.id,
              title: n.title,
              message: n.message,
              type: n.type,
              date: n.date,
              read: readSet.has(n.id),
              autoRead: isAuto,
            };
          });

          // 并发保护：如果在等待期间有更新的请求发起了，丢弃本次旧响应
          if (!isLatest()) {
            console.log('[Notification] 本次响应已被更新的请求取代，丢弃');
            return;
          }

          // 只有数据真正变化时才更新 state，避免轮询/可见性变化导致列表重渲染闪动
          setNotifications((prev) => {
            if (notificationsEqual(prev, mapped)) return prev;
            return mapped;
          });
          setReads(readSet);
          setLoaded(true);
          lastLoadAtRef.current = Date.now();

          // 同步到 localStorage，下次刷新时可立即显示
          try {
            localStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(mapped));
          } catch { /* ignore */ }
        } catch (err) {
          console.warn('[Notification] Supabase 通知加载异常:', err.message);
          // 异常也不再塞模板。若当前已有数据就保持，若从未加载过则读 localStorage 缓存
          if (isLatest() && !loaded) {
            loadLocalNotifications({ allowDefault: false });
          }
        }
      } else {
        // 明确处于本地/离线模式
        loadLocalNotifications();
      }
    } finally {
      inflightRef.current = false;
    }
  }, [useSupabase, loaded]);

  // 本地/离线模式加载。
  // 重要：默认 allowDefault=false —— 过去这里会在 localStorage 没数据时注入 5 条 notificationsData 模板，
  // 这是"有时刷新突然冒出很多条通知"的根本原因。现在只有显式 allowDefault=true 才会使用模板。
  const loadLocalNotifications = (options = {}) => {
    const { allowDefault = false } = options;
    let notifs = null;
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
    if (!notifs) {
      if (allowDefault) {
        notifs = notificationsData;
        try {
          localStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(notifs));
        } catch { /* ignore */ }
        console.log('[Notification] 本地模式加载: 无缓存，使用默认模板', notifs.length, '条');
      } else {
        // 既没缓存也不允许默认 → 显示空列表（稳定胜过花哨）
        notifs = [];
        console.log('[Notification] 本地模式加载: 无缓存，显示空列表');
      }
    } else {
      console.log('[Notification] 本地模式加载:', notifs.length, '条通知（来自本地缓存）');
    }
    // 本地模式：过滤 target_role（非管理员看不到 admin-only 通知）
    const filtered = notifs.filter((n) => {
      if (!n.target_role) return true;
      return n.target_role === 'admin' && isAdminRef.current;
    });
    setNotifications((prev) => {
      if (notificationsEqual(prev, filtered)) return prev;
      return filtered;
    });
    setLoaded(true);
    lastLoadAtRef.current = Date.now();
  };

  // ---- 初始化加载 ----
  // 首次加载 force=true 绕过节流；supabaseOk 从 null → true 时也 force 一次，
  // 让"启动时用本地缓存渲染 → 检测到 Supabase 可达后切云端数据"这一步稳定发生一次
  useEffect(() => {
    loadNotifications({ force: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useSupabase, user?.id]);

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

        // 刷新通知列表（绕过节流，确保立即能看到新消息）
        loadNotifications({ force: true });
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
        refreshNotifications: () => loadNotifications({ force: true }),
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
