import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { supabase, isSupabaseConfigured, checkSupabaseHealth, recheckSupabaseHealth, getReachable, onReachableChange } from '../lib/supabase';

const AuthContext = createContext(null);

// ============================================
// 角色层级定义
// ============================================
// admin  — 管理员，可编辑网站内容、授权用户、管理成员
// member — 成员，可访问内部文件资料
const ROLES = ['admin', 'member'];
const ROLE_LABELS = { admin: '管理员', member: '成员' };

function hasRole(userRole, requiredRole) {
  const userLevel = ROLES.indexOf(userRole);
  const requiredLevel = ROLES.indexOf(requiredRole);
  if (userLevel === -1 || requiredLevel === -1) return false;
  return userLevel <= requiredLevel; // 数字越小权限越高
}

// ============================================
// localStorage 本地模式（Supabase 未配置时使用）
// ============================================
const USERS_DB_KEY = 'riemer_users';
const AUTH_KEY = 'riemer_auth';
const DEVICE_KEY = 'riemer_device_id';
// 独立缓存当前登录用户的完整 profile（解决 Supabase 用户不在 riemer_users 中的问题）
const PROFILE_CACHE_KEY = 'riemer_profile_cache';
// 预授权邮箱列表（管理员直接输入邮箱授权，用户注册后自动拥有权限）
const PRE_AUTH_EMAILS_KEY = 'riemer_pre_authorized_emails';

const getDeviceId = () => {
  let deviceId = localStorage.getItem(DEVICE_KEY);
  if (!deviceId) {
    deviceId = 'device_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
    localStorage.setItem(DEVICE_KEY, deviceId);
  }
  return deviceId;
};

const getLocalUsers = () => {
  const stored = localStorage.getItem(USERS_DB_KEY);
  if (stored) {
    // 移除旧的 admin 示例账号（如果存在）
    const users = JSON.parse(stored);
    const filtered = users.filter((u) => u.email !== 'admin@riemerland.org');
    if (filtered.length !== users.length) {
      localStorage.setItem(USERS_DB_KEY, JSON.stringify(filtered));
    }
    return filtered;
  }
  localStorage.setItem(USERS_DB_KEY, JSON.stringify([]));
  return [];
};

const saveLocalUsers = (users) => {
  localStorage.setItem(USERS_DB_KEY, JSON.stringify(users));
};

/** 缓存当前登录用户的完整 profile 到 localStorage */
const cacheProfile = (profile) => {
  if (!profile?.id) return;
  try {
    localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(profile));
  } catch (err) {
    console.warn('[Auth] profile 缓存写入失败:', err.message);
  }
};

/** 读取缓存的 profile */
const getCachedProfile = (userId) => {
  try {
    const stored = localStorage.getItem(PROFILE_CACHE_KEY);
    if (!stored) return null;
    const cached = JSON.parse(stored);
    if (cached?.id === userId) return cached;
    return null;
  } catch {
    return null;
  }
};

/** 清除 profile 缓存 */
const clearProfileCache = () => {
  localStorage.removeItem(PROFILE_CACHE_KEY);
};

/** 获取本地预授权邮箱列表 */
const getLocalPreAuthEmails = () => {
  try {
    const stored = localStorage.getItem(PRE_AUTH_EMAILS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
};

/** 保存本地预授权邮箱列表 */
const saveLocalPreAuthEmails = (emails) => {
  localStorage.setItem(PRE_AUTH_EMAILS_KEY, JSON.stringify(emails));
};

/** 检查邮箱是否在预授权列表中 */
const isEmailPreAuthorized = (email) => {
  const list = getLocalPreAuthEmails();
  return list.some((item) => item.email.toLowerCase() === email.toLowerCase());
};

/** 从预授权列表中移除邮箱（用户已注册并授权后） */
const removePreAuthEmail = (email) => {
  const list = getLocalPreAuthEmails();
  const filtered = list.filter((item) => item.email.toLowerCase() !== email.toLowerCase());
  saveLocalPreAuthEmails(filtered);
};

// ============================================
// AuthProvider
// ============================================
export function AuthProvider({ children }) {
  // 同步从 localStorage 读取缓存的 profile，避免刷新时 loading 阶段 user 为 null 导致 UI 跳动
  const [user, setUser] = useState(() => {
    try {
      const cached = localStorage.getItem(PROFILE_CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed?.id) return parsed;
      }
    } catch { /* ignore */ }
    return null;
  });
  // 快速加载优化：如果有缓存的用户 profile，直接跳过 loading 让用户先进入页面
  // 后台再静默验证 session（如果验证失败会自动登出）
  const [loading, setLoading] = useState(() => {
    try {
      const cached = localStorage.getItem(PROFILE_CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed?.id && parsed?.authorized) {
          console.log('[Auth] 检测到缓存用户，跳过 loading 等待');
          return false; // 有缓存的已授权用户 → 不需要等待
        }
      }
    } catch { /* ignore */ }
    return true; // 没有缓存 → 需要等待验证
  });
  // 后台 session 验证是否正在进行中
  const [bgVerifying, setBgVerifying] = useState(false);
  // Supabase 是否可达：null=检测中, true=可达, false=不可达（降级本地模式）
  const [supabaseOk, setSupabaseOk] = useState(isSupabaseConfigured ? null : false);

  // 用 ref 同步镜像当前 user，方便在事件回调里判断是否需要兜底 fetchProfile
  const userRef = useRef(user);
  useEffect(() => { userRef.current = user; }, [user]);

  // ---- 本地模式：从 localStorage 恢复登录态的辅助函数 ----
  const restoreLocalAuth = useCallback(() => {
    const stored = localStorage.getItem(AUTH_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        // 优先从 riemer_users 查找（本地注册的用户）
        const users = getLocalUsers();
        const found = users.find((u) => u.id === parsed.id);
        if (found && found.authorized) {
          setUser(found);
          cacheProfile(found);
          return true;
        }
        // riemer_users 找不到（Supabase 用户）→ 尝试 profile 缓存
        const cached = getCachedProfile(parsed.id);
        if (cached && cached.authorized) {
          setUser(cached);
          return true;
        }
        // 都找不到 → 清除登录态
        localStorage.removeItem(AUTH_KEY);
        setUser(null);
        return false;
      } catch {
        localStorage.removeItem(AUTH_KEY);
        setUser(null);
        return false;
      }
    } else {
      setUser(null);
      return false;
    }
  }, []);

  // ---- 初始化 ----
  useEffect(() => {
    if (!isSupabaseConfigured) {
      // 本地模式：从 localStorage 恢复登录态
      const stored = localStorage.getItem(AUTH_KEY);
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          // 优先从 riemer_users 查找
          const users = getLocalUsers();
          const found = users.find((u) => u.id === parsed.id);
          if (found && found.authorized) {
            setUser(found);
            cacheProfile(found);
            localStorage.setItem(
              AUTH_KEY,
              JSON.stringify({
                id: found.id,
                name: found.name,
                email: found.email,
                role: found.role,
                deviceId: getDeviceId(),
                loginAt: parsed.loginAt || new Date().toISOString(),
                persistent: true,
              })
            );
          } else {
            // riemer_users 找不到 → 尝试 profile 缓存（Supabase 用户降级场景）
            const cached = getCachedProfile(parsed.id);
            if (cached && cached.authorized) {
              setUser(cached);
            } else {
              localStorage.removeItem(AUTH_KEY);
            }
          }
        } catch {
          localStorage.removeItem(AUTH_KEY);
        }
      }
      setLoading(false);
      return;
    }

    // Supabase 模式：先做健康检查，不通则降级本地模式
    let sessionResolved = false; // 防止超时回调和正常回调重复执行

    // 判断是否有缓存用户（决定是否走后台静默验证模式）
    let hasCachedUser = false;
    try {
      const cached = localStorage.getItem(PROFILE_CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed?.id && parsed?.authorized) hasCachedUser = true;
      }
    } catch { /* ignore */ }

    /** 带超时的 Promise 包装器 */
    const withTimeout = (promise, ms, label) => {
      return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} 超时 (${ms/1000}s)`)), ms)),
      ]);
    };

    const initSession = async () => {
      const startTime = Date.now();
      const isBgMode = hasCachedUser; // 有缓存用户 → 后台模式（loading 已经是 false）

      if (isBgMode) {
        console.log('[Auth] 后台静默验证模式（缓存用户已可用）');
        setBgVerifying(true);
      }

      // 1. 先快速检测 Supabase 是否可达（3 秒超时）
      const reachable = await checkSupabaseHealth();
      if (!reachable) {
        console.warn('[Auth] Supabase 不可达，自动降级到本地模式');
        setSupabaseOk(false);
        if (!isBgMode) {
          restoreLocalAuth();
          setLoading(false);
        }
        setBgVerifying(false);
        return;
      }
      console.log('[Auth] Supabase 服务可达，开始恢复 session...', isBgMode ? '(后台)' : '');

      try {
        // 2. 尝试获取 session（独立 5 秒超时，不依赖全局 fetch 超时）
        // 用两个明确状态区分：sessionTimedOut = 真正超时/网络错误；sessionMissing = 明确返回空 session
        let session = null;
        let sessionUser = null;
        let sessionTimedOut = false;
        try {
          const { data, error: sessionError } = await withTimeout(
            supabase.auth.getSession(), 5000, 'getSession'
          );
          if (sessionError) {
            console.warn('[Auth] getSession 返回错误:', sessionError.message);
          }
          session = data?.session;
          sessionUser = session?.user;
        } catch (e) {
          console.warn('[Auth] getSession 失败:', e.message);
          sessionTimedOut = true; // 区分超时 vs 明确返回 null
        }

        if (sessionUser) {
          console.log('[Auth] Session 恢复成功，用户:', sessionUser.email, '耗时:', Date.now() - startTime, 'ms');
          if (!sessionResolved) {
            sessionResolved = true;
            setSupabaseOk(true);
            await fetchProfile(sessionUser);
            setLoading(false);
          }
          setBgVerifying(false);
          return;
        }

        // 3. session 为空或失败，尝试刷新 token（独立 5 秒超时）
        console.log('[Auth] getSession 返回空 session，尝试 refreshSession...');
        let refreshTimedOut = false;
        try {
          const { data: refreshData, error: refreshError } = await withTimeout(
            supabase.auth.refreshSession(), 5000, 'refreshSession'
          );
          if (refreshError) {
            console.warn('[Auth] refreshSession 失败:', refreshError.message);
          }
          if (refreshData?.session?.user) {
            console.log('[Auth] refreshSession 成功，用户:', refreshData.session.user.email, '耗时:', Date.now() - startTime, 'ms');
            if (!sessionResolved) {
              sessionResolved = true;
              setSupabaseOk(true);
              await fetchProfile(refreshData.session.user);
              setLoading(false);
            }
            setBgVerifying(false);
            return;
          }
        } catch (e) {
          console.warn('[Auth] refreshSession 失败:', e.message);
          refreshTimedOut = true;
        }

        // 4. session 和 refresh 都没拿到用户
        // 关键区分：
        //   - 如果是「超时/网络错误」→ 不能判定 session 失效，保留当前用户（避免误踢）
        //   - 只有「明确返回空/明确返回错误但无超时」→ 才认定 session 已过期
        const bothTimedOut = sessionTimedOut && refreshTimedOut;
        const definitelyInvalid = !sessionTimedOut && !refreshTimedOut; // 两次都明确返回但都没拿到 user

        console.warn('[Auth] Session 恢复和刷新均未拿到 user。',
          'sessionTimedOut:', sessionTimedOut, 'refreshTimedOut:', refreshTimedOut,
          '总耗时:', Date.now() - startTime, 'ms');

        if (!sessionResolved) {
          sessionResolved = true;
          setSupabaseOk(true); // 服务可达

          if (isBgMode) {
            if (bothTimedOut) {
              // 网络抖动导致两次都超时 —— 不清用户，本地缓存的 user 继续可用
              console.warn('[Auth] 后台验证：两次都超时，保留当前用户（下次请求会再次尝试刷新 token）');
            } else if (definitelyInvalid) {
              // 服务端明确告诉我们 session 无效 → 登出
              console.warn('[Auth] 后台验证：session 明确失效，需重新登录');
              setUser(null);
              localStorage.removeItem(AUTH_KEY);
              clearProfileCache();
            } else {
              // 一次超时一次明确 —— 保守：保留用户
              console.warn('[Auth] 后台验证：结果不一致（一次超时一次明确），保守保留当前用户');
            }
          } else {
            // 非后台模式（首次加载，无缓存用户），可以正常走降级流程
            restoreLocalAuth();
          }
          setLoading(false);
        }
        setBgVerifying(false);
      } catch (err) {
        console.error('[Auth] initSession 异常:', err, '总耗时:', Date.now() - startTime, 'ms');
        if (!sessionResolved) {
          sessionResolved = true;
          // 网络错误 → 降级（保留缓存用户，不强制登出）
          setSupabaseOk(false);
          if (!isBgMode) {
            restoreLocalAuth();
          }
          setLoading(false);
        }
        setBgVerifying(false);
      }
    };

    initSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        console.log('[Auth] onAuthStateChange:', event);
        // 如果 Supabase 已标记不可达，跳过
        if (getReachable() === false) return;
        if (session?.user) {
          // SIGNED_IN: login() 可能已经 setUser（真 profile 或 _fallback 降级 profile）
          // 但有些邮箱/网络场景下 login() 提前返回或 setUser 未执行 → 这里兜底补一次
          if (event === 'SIGNED_IN') {
            // 延迟一个 tick，等 login() 里的 setUser 先生效
            setTimeout(() => {
              if (!userRef.current || userRef.current.id !== session.user.id) {
                console.log('[Auth] SIGNED_IN 后发现 user 未同步，兜底 fetchProfile');
                fetchProfile(session.user).catch(() => {
                  // fetchProfile 失败也要 setUser，避免一直卡在登录页
                  const cached = getCachedProfile(session.user.id);
                  const fb = cached ? { ...cached, authorized: true } : {
                    id: session.user.id,
                    email: session.user.email,
                    role: 'member',
                    authorized: true,
                    name: session.user.email?.split('@')[0] || '用户',
                    _fallback: true,
                  };
                  setUser(fb);
                  cacheProfile(fb);
                });
              }
            }, 200);
            return;
          }
          await fetchProfile(session.user);
        } else {
          setUser(null);
        }
      }
    );

    return () => subscription?.unsubscribe();
  }, []);

  // ---- 页面可见时自动重检 Supabase 可达性（从离线模式恢复） ----
  useEffect(() => {
    if (!isSupabaseConfigured) return;

    const handleVisibilityChange = async () => {
      if (document.visibilityState !== 'visible') return;
      // 仅当当前处于离线模式（supabaseOk === false）时才重新检测
      if (getReachable() === false) {
        console.log('[Auth] 页面可见 + 当前离线模式，重新检测 Supabase...');
        const ok = await recheckSupabaseHealth();
        if (ok) {
          console.log('[Auth] Supabase 恢复可达，切换回在线模式');
          setSupabaseOk(true);
          // 重新获取 profile
          try {
            const { data: { session } } = await supabase.auth.getSession();
            if (session?.user) {
              await fetchProfile(session.user);
            }
          } catch (err) {
            console.warn('[Auth] 恢复在线模式后 fetchProfile 失败:', err.message);
          }
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  // ---- 跨窗口 / 跨标签页同步登录状态 ----
  useEffect(() => {
    if (isSupabaseConfigured) return; // Supabase 模式有自己的监听机制

    // 监听其他窗口/标签页对 localStorage 的修改
    const handleStorageChange = (e) => {
      if (e.key === AUTH_KEY) {
        if (!e.newValue) {
          // 另一个窗口执行了登出（删除了 AUTH_KEY）
          setUser(null);
        } else {
          // 另一个窗口执行了登录或更新
          restoreLocalAuth();
        }
      }
      if (e.key === USERS_DB_KEY) {
        // 用户数据库被更新（如授权状态变化），重新检查当前登录态
        restoreLocalAuth();
      }
    };

    // 当用户切回此标签页时，重新从 localStorage 检查登录态
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        restoreLocalAuth();
      }
    };

    window.addEventListener('storage', handleStorageChange);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [restoreLocalAuth]);

  // 获取 Supabase profiles 表中的用户配置
  const fetchProfile = async (authUser) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', authUser.id)
        .single();

      console.log('[Auth] fetchProfile 结果:', { authUserId: authUser.id, data, error });

      if (error && error.code === 'PGRST116') {
        // profile 不存在，创建默认 profile（新注册用户）
        const newProfile = {
          id: authUser.id,
          email: authUser.email,
          name: authUser.user_metadata?.name || authUser.email.split('@')[0],
          nickname: '',
          avatar: null,
          signature: '',
          role: 'member',
          authorized: false,
          created_at: new Date().toISOString(),
        };
        await supabase.from('profiles').insert(newProfile);
        setUser(newProfile);
        cacheProfile(newProfile);
      } else if (data) {
        setUser(data);
        cacheProfile(data);
        // 同步写入 AUTH_KEY（确保降级时有登录凭证）
        localStorage.setItem(
          AUTH_KEY,
          JSON.stringify({
            id: data.id,
            name: data.name,
            email: data.email,
            role: data.role,
            deviceId: getDeviceId(),
            loginAt: new Date().toISOString(),
            persistent: true,
          })
        );
      }
    } catch (err) {
      console.error('[Auth] Failed to fetch profile:', err);
    }
  };

  // ---- 登录 ----
  const login = useCallback(async (email, password) => {
    // 如果 Supabase 未配置，或已确认不可达，走本地模式
    const useLocal = !isSupabaseConfigured || supabaseOk === false;

    if (useLocal) {
      // 本地模式
      const users = getLocalUsers();
      const found = users.find((u) => u.email === email && u.password === password);
      if (!found) return { success: false, message: '邮箱或密码错误' };
      if (!found.authorized) {
        // 补救检查：如果该邮箱在预授权列表中，自动补授权
        if (isEmailPreAuthorized(email)) {
          found.authorized = true;
          saveLocalUsers(users);
          removePreAuthEmail(email);
          console.log('[Auth] 本地登录：检测到预授权邮箱，自动授权:', email);
        } else {
          return { success: false, message: '您的账号尚未被授权，请联系管理员' };
        }
      }
      setUser(found);
      cacheProfile(found);
      localStorage.setItem(
        AUTH_KEY,
        JSON.stringify({
          id: found.id,
          name: found.name,
          email: found.email,
          role: found.role,
          deviceId: getDeviceId(),
          loginAt: new Date().toISOString(),
          persistent: true,
        })
      );
      return { success: true };
    }

    // ---- 本地用户数据库回退登录（辅助函数） ----
    const tryLocalFallback = (email, password) => {
      const users = getLocalUsers();
      const found = users.find((u) => u.email === email && u.password === password);
      if (!found) return null;
      if (!found.authorized) {
        if (isEmailPreAuthorized(email)) {
          found.authorized = true;
          saveLocalUsers(users);
          removePreAuthEmail(email);
        } else {
          return { success: false, message: '您的账号尚未被授权，请联系管理员' };
        }
      }
      setUser(found);
      cacheProfile(found);
      localStorage.setItem(
        AUTH_KEY,
        JSON.stringify({
          id: found.id,
          name: found.name,
          email: found.email,
          role: found.role,
          deviceId: getDeviceId(),
          loginAt: new Date().toISOString(),
          persistent: true,
        })
      );
      return { success: true };
    };

    // Supabase 模式
    const LOGIN_TIMEOUT_MS = 8000; // 8 秒登录超时（缩短）

    try {
      const loginPromise = (async () => {
        console.time('[Auth] signInWithPassword');
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        console.timeEnd('[Auth] signInWithPassword');

        if (error) {
          if (error.message === 'Email not confirmed') {
            // ============================================
            // 邮箱未确认 → 通过服务端 admin-login API 彻底处理
            // 服务端会：1) Admin API 强制确认邮箱  2) 直接登录返回 session
            // ============================================
            console.log('[Auth] 邮箱未确认，调用 admin-login API 处理:', email);
            try {
              const adminLoginRes = await fetch('/api/admin-login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password }),
              });

              console.log('[Auth] admin-login 响应状态:', adminLoginRes.status);

              if (adminLoginRes.ok) {
                const { session } = await adminLoginRes.json();

                if (session?.access_token && session?.refresh_token) {
                  // 使用服务端返回的 session 设置客户端会话
                  const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
                    access_token: session.access_token,
                    refresh_token: session.refresh_token,
                  });

                  if (sessionError) {
                    console.error('[Auth] setSession 失败:', sessionError.message);
                    return { success: false, message: '登录会话设置失败，请重试。' };
                  }

                  const sessionUser = sessionData?.user || session.user;
                  if (sessionUser) {
                    // 获取 profile
                    const { data: profile } = await supabase
                      .from('profiles')
                      .select('*')
                      .eq('id', sessionUser.id)
                      .single();

                    if (profile) {
                      if (!profile.authorized) {
                        // 检查预授权列表
                        let shouldAuto = isEmailPreAuthorized(profile.email);
                        if (!shouldAuto) {
                          try {
                            const { data: pr } = await supabase
                              .from('pre_authorized_emails')
                              .select('email')
                              .ilike('email', profile.email)
                              .maybeSingle();
                            if (pr) shouldAuto = true;
                          } catch { /* ignore */ }
                        }
                        if (shouldAuto) {
                          await supabase.from('profiles').update({ authorized: true }).eq('id', profile.id);
                          removePreAuthEmail(profile.email);
                          try { await supabase.from('pre_authorized_emails').delete().ilike('email', profile.email); } catch { /* ignore */ }
                          profile.authorized = true;
                        } else {
                          await supabase.auth.signOut();
                          return { success: false, message: '您的账号尚未被授权，请联系管理员。' };
                        }
                      }
                      setUser(profile);
                      cacheProfile(profile);
                      return { success: true };
                    }
                    // profile 不存在但用户已登录（可能是新用户，trigger 会自动创建 profile）
                    // 等待一下再查一次
                    await new Promise(r => setTimeout(r, 500));
                    const { data: retryProfile } = await supabase
                      .from('profiles')
                      .select('*')
                      .eq('id', sessionUser.id)
                      .single();
                    if (retryProfile) {
                      setUser(retryProfile);
                      cacheProfile(retryProfile);
                      return { success: true };
                    }
                    return { success: true };
                  }
                }

                // session 格式不对但 API 返回了 ok
                console.warn('[Auth] admin-login 返回 ok 但 session 格式异常');
                return { success: false, message: '登录异常，请重试。' };
              }

              // admin-login API 返回了错误
              const errBody = await adminLoginRes.json().catch(() => ({}));
              console.warn('[Auth] admin-login 失败:', adminLoginRes.status, errBody);

              if (adminLoginRes.status === 401) {
                return { success: false, message: errBody.error || '邮箱或密码错误' };
              }

              return { success: false, message: errBody.error || '邮箱验证服务暂时不可用，请稍后重试。' };
            } catch (adminLoginErr) {
              console.error('[Auth] admin-login 调用异常:', adminLoginErr.message);
              return { success: false, message: '登录服务暂时不可用，请稍后重试。' };
            }
          }
          // Supabase 认证失败（如用户不存在），回退到本地用户数据库尝试
          if (error.message === 'Invalid login credentials') {
            console.warn('[Auth] Supabase 认证失败，尝试本地用户数据库回退');
            const localResult = tryLocalFallback(email, password);
            if (localResult) return localResult;
            return { success: false, message: '邮箱或密码错误' };
          }
          return { success: false, message: error.message };
        }

        // signInWithPassword 返回的 data 已经包含 session，不需要再调 getSession
        console.log('[Auth] 登录后 session 状态:', {
          hasSession: !!data?.session,
          userId: data?.user?.id,
        });

        // 检查 authorized 状态
        // 注意：profile 查询走独立的 3s 超时，不让它拖垮整个登录流程。
        // 如果 PostgREST 卡住（可能 RLS 策略或连接问题），已经成功登录的用户
        // 仍然视为登录成功，并用 auth user + 缓存构造降级 profile 立即进站，
        // 后台 onAuthStateChange / 下次会话再补真 profile。
        const profileTimeLabel = `[Auth] profile 查询 ${Date.now()}`;
        console.time(profileTimeLabel);
        let profile = null;
        let profileError = null;
        try {
          const profileRes = await Promise.race([
            supabase.from('profiles').select('*').eq('id', data.user.id).single(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('profile 查询超时 (6s)')), 6000)),
          ]);
          profile = profileRes.data;
          profileError = profileRes.error;
          console.timeEnd(profileTimeLabel);
        } catch (e) {
          console.warn('[Auth] profile 查询超时或异常，用降级 profile 放行:', e.message);
          // 构造降级 profile：优先用上次缓存（必须是同一个 user），否则用 auth user 里的最小信息
          const cachedProfile = getCachedProfile(data.user.id);
          const fallbackProfile = cachedProfile
            ? { ...cachedProfile, authorized: true }
            : {
                id: data.user.id,
                email: data.user.email,
                role: 'user',
                authorized: true,           // profile 查询失败时默认放行，避免把合法用户卡住
                name: data.user.email?.split('@')[0] || '用户',
                _fallback: true,            // 标记是降级 profile，稍后可以刷新
              };
          setUser(fallbackProfile);
          cacheProfile(fallbackProfile);
          // 后台异步重试一次 profile 查询（不阻塞登录流程）
          setTimeout(() => {
            supabase.from('profiles').select('*').eq('id', data.user.id).single()
              .then(({ data: realProfile }) => {
                if (realProfile) {
                  console.log('[Auth] 后台补拿到真 profile，刷新 user 状态');
                  setUser(realProfile);
                  cacheProfile(realProfile);
                }
              })
              .catch(() => { /* ignore */ });
          }, 500);
          return { success: true };
        }

        console.log('[Auth] 登录用户 profile 查询结果:', { profile, profileError });

        if (profileError) {
          console.error('[Auth] Profile 查询失败，不阻止登录:', profileError);
          // 兜底：即使 profile 查询失败，也要 setUser，避免 isAuthenticated 一直为 false
          const fallbackProfile = getCachedProfile(data.user.id) || {
            id: data.user.id,
            email: data.user.email,
            role: 'member',
            authorized: true,
            name: data.user.email?.split('@')[0] || '用户',
            _fallback: true,
          };
          setUser(fallbackProfile);
          cacheProfile(fallbackProfile);
          return { success: true };
        }

        if (!profile) {
          // profile 不存在（可能 trigger 还没跑，或 RLS 把查询过滤为空）
          // 兜底：用 auth user 构造降级 profile 让登录生效，稍后后台补真
          console.warn('[Auth] profile 查询返回空，使用降级 profile 放行');
          const cachedProfile = getCachedProfile(data.user.id);
          const fallbackProfile = cachedProfile
            ? { ...cachedProfile, authorized: true }
            : {
                id: data.user.id,
                email: data.user.email,
                role: 'member',
                authorized: true,
                name: data.user.email?.split('@')[0] || '用户',
                _fallback: true,
              };
          setUser(fallbackProfile);
          cacheProfile(fallbackProfile);
          // 后台异步重试一次 profile 查询
          setTimeout(() => {
            supabase.from('profiles').select('*').eq('id', data.user.id).single()
              .then(({ data: realProfile }) => {
                if (realProfile) {
                  console.log('[Auth] 后台补拿到真 profile，刷新 user 状态');
                  setUser(realProfile);
                  cacheProfile(realProfile);
                }
              })
              .catch(() => { /* ignore */ });
          }, 800);
          return { success: true };
        }

        if (!profile.authorized) {
          // 补救检查：看看该邮箱是否在预授权列表中（管理员已授权但 profiles 未同步的情况）
          let shouldAutoAuthorize = isEmailPreAuthorized(profile.email);
          if (!shouldAutoAuthorize) {
            try {
              const { data: preAuthRow } = await supabase
                .from('pre_authorized_emails')
                .select('email')
                .ilike('email', profile.email)
                .maybeSingle();
              if (preAuthRow) shouldAutoAuthorize = true;
            } catch { /* 表可能不存在 */ }
          }

          if (shouldAutoAuthorize) {
            // 自动授权：更新 profiles 表 + 清理预授权列表
            console.log('[Auth] 检测到预授权邮箱，自动授权:', profile.email);
            await supabase.from('profiles').update({ authorized: true }).eq('id', profile.id);
            removePreAuthEmail(profile.email);
            try {
              await supabase.from('pre_authorized_emails').delete().ilike('email', profile.email);
            } catch { /* ignore */ }
            profile.authorized = true;
            setUser(profile);
            cacheProfile(profile);
            return { success: true };
          }

          await supabase.auth.signOut();
          return {
            success: false,
            message: `您的账号尚未被授权，请联系管理员。(debug: role=${profile.role}, authorized=${profile.authorized})`,
          };
        }

        // 直接设置用户状态，避免 onAuthStateChange 再次查询 profile
        setUser(profile);
        cacheProfile(profile);
        return { success: true };
      })();

      // 超时竞争：loginPromise vs 8 秒超时
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('登录请求超时，请检查网络连接后重试')), LOGIN_TIMEOUT_MS)
      );

      return await Promise.race([loginPromise, timeoutPromise]);
    } catch (err) {
      console.error('[Auth] Supabase 登录异常:', err);

      // 关键：如果此时 Supabase 其实已经登录成功（session 存在），
      // 说明只是后续的业务查询（如 profiles）超时/失败，不应该降级到离线模式，
      // 也不应该返回"登录失败"，否则用户输入的正确密码会被错误提示。
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          console.warn('[Auth] 登录异常但 session 已存在，按已登录处理:', session.user.email);
          // 必须 setUser，否则 isAuthenticated 一直 false，页面会卡在登录页
          const cachedProfile = getCachedProfile(session.user.id);
          const fallbackProfile = cachedProfile
            ? { ...cachedProfile, authorized: true }
            : {
                id: session.user.id,
                email: session.user.email,
                role: 'member',
                authorized: true,
                name: session.user.email?.split('@')[0] || '用户',
                _fallback: true,
              };
          setUser(fallbackProfile);
          cacheProfile(fallbackProfile);
          // 后台静默补真 profile
          setTimeout(() => {
            supabase.from('profiles').select('*').eq('id', session.user.id).single()
              .then(({ data: realProfile }) => {
                if (realProfile) {
                  setUser(realProfile);
                  cacheProfile(realProfile);
                }
              })
              .catch(() => { /* ignore */ });
          }, 800);
          return { success: true };
        }
      } catch { /* ignore */ }

      // 任何异常（超时、网络错误等）都回退到本地模式
      console.warn('[Auth] Supabase 登录异常，降级到本地模式重试');
      setSupabaseOk(false);
      const localResult = tryLocalFallback(email, password);
      if (localResult) {
        if (localResult.success) localResult.message = '已使用离线模式登录';
        return localResult;
      }
      const isTimeout = err.message?.includes('超时') || err.name === 'AbortError';
      return {
        success: false,
        message: isTimeout
          ? '服务连接超时，已切换到离线模式。请使用本地账号登录'
          : `登录服务异常：${err.message}`,
      };
    }
  }, [supabaseOk]);

  // ---- 本地注册辅助函数 ----
  const registerLocal = (email, password, name) => {
    const users = getLocalUsers();
    if (users.find((u) => u.email === email)) {
      return { success: false, message: '该邮箱已被注册' };
    }
    // 检查该邮箱是否已被管理员预授权
    const preAuthorized = isEmailPreAuthorized(email);
    const newUser = {
      id: Date.now().toString(),
      email,
      password,
      name,
      nickname: '',
      avatar: null,
      signature: '',
      role: 'member',
      authorized: preAuthorized,
      createdAt: new Date().toISOString(),
    };
    users.push(newUser);
    saveLocalUsers(users);

    if (preAuthorized) {
      // 预授权邮箱注册后，从预授权列表中移除
      removePreAuthEmail(email);
      return { success: true, message: '注册成功！您的邮箱已被管理员预授权，可直接登录。' };
    }

    return { success: true, message: '注册成功！请等待管理员授权后方可登录内部系统。' };
  };

  // ---- 注册 ----
  const register = useCallback(async (email, password, name) => {
    const useLocal = !isSupabaseConfigured || supabaseOk === false;
    if (useLocal) {
      return registerLocal(email, password, name);
    }

    // Supabase 模式 — 通过服务端 Admin API 注册用户（不发送确认邮件）
    try {
      // 检查该邮箱是否已被管理员预授权（本地 + Supabase）
      let preAuthorized = isEmailPreAuthorized(email);
      if (!preAuthorized) {
        try {
          const { data: preAuthRow } = await supabase
            .from('pre_authorized_emails')
            .select('email')
            .ilike('email', email)
            .maybeSingle();
          if (preAuthRow) preAuthorized = true;
        } catch { /* 表可能不存在，忽略 */ }
      }

      // 使用服务端 Admin API 创建用户（email_confirm: true，不会发送确认邮件）
      const registerRes = await fetch('/api/register-preauth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name }),
      });
      const registerData = await registerRes.json();

      if (!registerRes.ok) {
        if (registerRes.status === 409) {
          return { success: false, message: '该邮箱已被注册' };
        }
        // 服务端注册失败，回退到本地注册
        console.warn('[Auth] 服务端注册失败，回退本地注册:', registerData.error);
        return registerLocal(email, password, name);
      }

      const userId = registerData.user?.id;

      // 创建/更新 profile 记录
      if (userId) {
        const profileData = {
          id: userId,
          email,
          name,
          nickname: '',
          avatar: null,
          signature: '',
          role: 'member',
          authorized: preAuthorized,
          created_at: new Date().toISOString(),
        };

        const { error: insertError } = await supabase.from('profiles').insert(profileData);
        if (insertError) {
          // 触发器可能已创建记录，用 update 设置正确的字段
          await supabase.from('profiles').update({
            name,
            authorized: preAuthorized,
          }).eq('id', userId);
        }

        if (preAuthorized) {
          // 预授权邮箱：从预授权列表移除 + Supabase pre_authorized_emails 表也清理
          removePreAuthEmail(email);
          try {
            await supabase.from('pre_authorized_emails').delete().ilike('email', email);
          } catch { /* 表可能不存在，忽略 */ }
        }
      }
      // 同时写入本地用户数据库备份
      registerLocal(email, password, name);
      if (preAuthorized) {
        return { success: true, message: '注册成功！您的邮箱已被管理员预授权，可直接登录。' };
      }
      return { success: true, message: '注册成功！请等待管理员授权后方可登录内部系统。' };
    } catch (err) {
      console.warn('[Auth] Supabase 注册异常，回退本地注册:', err.message);
      return registerLocal(email, password, name);
    }
  }, [supabaseOk]);

  // ---- 登出 ----
  const logout = useCallback(async () => {
    if (isSupabaseConfigured) {
      await supabase.auth.signOut();
    }
    setUser(null);
    localStorage.removeItem(AUTH_KEY);
    clearProfileCache();
  }, []);

  // ---- 发送密码重置验证码（通过 Resend） ----
  const sendResetCode = useCallback(async (email) => {
    if (!email || !email.trim()) return { success: false, message: '请输入邮箱地址' };

    try {
      const res = await fetch('/api/send-reset-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'send', email: email.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, message: data.error || '发送失败' };
      }
      // 验证码只会通过邮件送达用户邮箱，前端绝不持有验证码明文（安全基线）
      return { success: true, message: data.message };
    } catch (err) {
      return { success: false, message: '网络错误：' + err.message };
    }
  }, []);

  // ---- 验证密码重置验证码 ----
  const verifyResetCode = useCallback(async (email, code) => {
    if (!email || !code) return { success: false, message: '请输入邮箱和验证码' };

    try {
      const res = await fetch('/api/send-reset-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'verify', email: email.trim(), code: code.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, message: data.error || '验证失败' };
      }
      return { success: true, message: data.message };
    } catch (err) {
      return { success: false, message: '网络错误：' + err.message };
    }
  }, []);

  // ---- 忘记密码 / 重置密码（验证码方式） ----
  const resetPassword = useCallback(async (email, newPassword) => {
    const useLocal = !isSupabaseConfigured || supabaseOk === false;

    if (!email) return { success: false, message: '请输入邮箱地址' };
    if (!newPassword || newPassword.length < 6) {
      return { success: false, message: '新密码至少需要 6 个字符' };
    }

    // 先尝试通过服务端 API 重置（Supabase Admin API）
    try {
      const res = await fetch('/api/send-reset-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset', email: email.trim(), newPassword }),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        if (data.target === 'supabase') {
          // Supabase 已重置成功
          localStorage.removeItem('riemer_saved_credentials');
          return { success: true, message: data.message || '密码重置成功！请使用新密码登录。' };
        }
        // target === 'local' → 继续本地重置
      } else if (!res.ok) {
        return { success: false, message: data.error || '重置失败' };
      }
    } catch (err) {
      console.warn('[Auth] 服务端重置请求失败，尝试本地重置:', err.message);
    }

    // 本地模式兜底
    const users = getLocalUsers();
    const idx = users.findIndex((u) => u.email.toLowerCase() === email.trim().toLowerCase());
    if (idx < 0) return { success: false, message: '未找到该邮箱对应的账号' };
    users[idx].password = newPassword;
    saveLocalUsers(users);
    localStorage.removeItem('riemer_saved_credentials');
    return { success: true, message: '密码重置成功！请使用新密码登录。' };
  }, [supabaseOk]);

  // ---- 修改密码（已登录用户） ----
  const changePassword = useCallback(async (currentPassword, newPassword) => {
    if (!user) return { success: false, message: '未登录' };
    if (!newPassword || newPassword.length < 6) {
      return { success: false, message: '新密码至少需要 6 个字符' };
    }

    const useLocal = !isSupabaseConfigured || supabaseOk === false;
    if (useLocal) {
      // 本地模式：验证当前密码后修改
      const users = getLocalUsers();
      const idx = users.findIndex((u) => u.id === user.id);
      if (idx < 0) return { success: false, message: '用户不存在' };
      if (users[idx].password !== currentPassword) {
        return { success: false, message: '当前密码不正确' };
      }
      if (currentPassword === newPassword) {
        return { success: false, message: '新密码不能与当前密码相同' };
      }
      users[idx].password = newPassword;
      saveLocalUsers(users);
      // 清除保存的凭据
      localStorage.removeItem('riemer_saved_credentials');
      return { success: true, message: '密码修改成功！' };
    }

    // Supabase 模式：先验证当前密码，再更新密码
    // 验证当前密码：尝试用当前密码重新登录
    const { error: verifyError } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: currentPassword,
    });
    if (verifyError) {
      return { success: false, message: '当前密码不正确' };
    }
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      return { success: false, message: error.message };
    }
    return { success: true, message: '密码修改成功！' };
  }, [user, supabaseOk]);

  // ---- 更新 Supabase 密码（从重置链接回调） ----
  const updatePasswordFromReset = useCallback(async (newPassword) => {
    if (!newPassword || newPassword.length < 6) {
      return { success: false, message: '新密码至少需要 6 个字符' };
    }
    if (!isSupabaseConfigured) {
      return { success: false, message: '本地模式不支持此操作' };
    }
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      return { success: false, message: error.message };
    }
    return { success: true, message: '密码重置成功！即将跳转到登录页面。' };
  }, []);

  // ---- 获取所有用户 ----
  const getAllUsers = useCallback(async () => {
    /**
     * 合并多个数据源的用户列表，按 id 去重。
     * 前面的列表优先级更高（不会被后面的覆盖）。
     */
    const mergeLists = (...lists) => {
      const seen = new Map();
      for (const list of lists) {
        if (!Array.isArray(list)) continue;
        for (const u of list) {
          if (!u || !u.id) continue;
          if (!seen.has(u.id)) {
            seen.set(u.id, u);
          }
        }
      }
      return Array.from(seen.values());
    };

    // 构造当前用户的 profile 对象（兜底）
    const currentUserProfile = user ? [{
      id: user.id,
      email: user.email,
      name: user.name || user.nickname || '',
      nickname: user.nickname || '',
      avatar: user.avatar || null,
      signature: user.signature || '',
      role: user.role || 'member',
      authorized: user.authorized !== undefined ? user.authorized : true,
      created_at: user.created_at || user.createdAt || new Date().toISOString(),
    }] : [];

    // supabaseOk: null=检测中, true=可达, false=不可达
    // 明确为 false 或未配置 Supabase 时走本地模式
    // null（检测中）时也尝试走 Supabase，避免因检测延迟导致只显示本地缓存数据
    const useLocal = !isSupabaseConfigured || supabaseOk === false;
    if (useLocal) {
      console.log('[Auth] getAllUsers: 本地模式 (supabaseOk=' + supabaseOk + ')');
      return mergeLists(getLocalUsers(), currentUserProfile);
    }

    // Supabase 模式（supabaseOk === true 或 null 检测中都尝试）
    try {
      console.log('[Auth] getAllUsers: 尝试 Supabase 查询... (supabaseOk=' + supabaseOk + ')');

      // 设置独立超时：8 秒（手机端网络可能慢）
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      // 第一次尝试查询
      let { data, error } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: true });

      clearTimeout(timeoutId);

      // 如果查询失败（可能是 401/session 过期），尝试刷新 session 后重试
      if (error) {
        console.warn('[Auth] Supabase profiles 第一次查询失败:', error.message, error.code, '，尝试刷新 session...');
        try {
          const { data: refreshData } = await supabase.auth.refreshSession();
          if (refreshData?.session) {
            console.log('[Auth] Session 刷新成功，重试查询...');
            const retry = await supabase
              .from('profiles')
              .select('*')
              .order('created_at', { ascending: true });
            data = retry.data;
            error = retry.error;
            if (error) {
              console.warn('[Auth] 重试查询仍然失败:', error.message);
            }
          } else {
            console.warn('[Auth] Session 刷新失败，无法重试');
          }
        } catch (refreshErr) {
          console.warn('[Auth] Session 刷新异常:', refreshErr.message);
        }
      }

      if (error) {
        console.warn('[Auth] Supabase profiles 查询最终失败:', error.message, error.code);
        return mergeLists(getLocalUsers(), currentUserProfile);
      }

      if (!data || data.length === 0) {
        console.warn('[Auth] Supabase profiles 查询为空（可能是 RLS/session 问题）');
        return mergeLists(getLocalUsers(), currentUserProfile);
      }

      console.log('[Auth] getAllUsers: Supabase 返回', data.length, '条记录, authorized 分布:',
        data.filter(u => u.authorized).length, '已授权 /',
        data.filter(u => !u.authorized).length, '未授权'
      );
      // Supabase 查询成功 → 确认可达（如果之前还在检测中）
      if (supabaseOk !== true) setSupabaseOk(true);
      // 合并 Supabase 数据 + 当前用户
      return mergeLists(data, currentUserProfile);
    } catch (err) {
      console.warn('[Auth] getAllUsers 异常:', err.message);
      // 如果是首次检测，标记为不可达
      if (supabaseOk === null) setSupabaseOk(false);
      return mergeLists(getLocalUsers(), currentUserProfile);
    }
  }, [supabaseOk, user]);

  // ---- 授权用户 ----
  const authorizeUser = useCallback(async (userId) => {
    // 始终同步更新本地用户数据库
    const users = getLocalUsers();
    const idx = users.findIndex((u) => u.id === userId);
    if (idx >= 0) {
      users[idx].authorized = true;
      saveLocalUsers(users);
    }

    const useLocal = !isSupabaseConfigured || supabaseOk === false;
    if (!useLocal) {
      try {
        await supabase.from('profiles').update({ authorized: true }).eq('id', userId);
      } catch (err) {
        console.warn('[Auth] Supabase 授权更新失败:', err.message);
      }

      // 同时自动确认该用户的邮箱（解决 Supabase Auth 层面 email_confirmed_at 为空的问题）
      // 查询该用户的邮箱地址
      try {
        const { data: profile } = await supabase
          .from('profiles')
          .select('email')
          .eq('id', userId)
          .single();
        if (profile?.email) {
          fetch('/api/confirm-email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: profile.email }),
          }).then((res) => {
            if (res.ok) {
              console.log('[Auth] 授权用户时自动确认邮箱成功:', profile.email);
            } else {
              console.warn('[Auth] 授权用户时自动确认邮箱失败:', res.status);
            }
          }).catch((err) => {
            console.warn('[Auth] 授权用户时自动确认邮箱异常:', err.message);
          });
        }
      } catch (err) {
        console.warn('[Auth] 获取用户邮箱失败:', err.message);
      }
    }
  }, [supabaseOk]);

  // ---- 撤销授权 ----
  const revokeUser = useCallback(async (userId) => {
    // 始终同步更新本地用户数据库
    const users = getLocalUsers();
    const localIdx = users.findIndex((u) => u.id === userId);
    if (localIdx >= 0) {
      users[localIdx].authorized = false;
      saveLocalUsers(users);
    }

    const useLocal = !isSupabaseConfigured || supabaseOk === false;
    if (!useLocal) {
      try {
        await supabase.from('profiles').update({ authorized: false }).eq('id', userId);
      } catch (err) {
        console.warn('[Auth] Supabase 撤销授权失败:', err.message);
      }
    }
    if (user?.id === userId) {
      await logout();
    }
  }, [user, logout, supabaseOk]);

  // ---- 彻底删除用户 ----
  // 会同时清理：Supabase auth.users（需要服务端 Admin API）、profiles、pre_authorized_emails、本地 localStorage
  // 只能由管理员调用；不允许删除自己。
  const deleteUser = useCallback(async (userId, emailHint) => {
    if (!userId && !emailHint) {
      return { success: false, message: '缺少 userId 或 email' };
    }
    if (user?.id && userId && user.id === userId) {
      return { success: false, message: '不能删除自己' };
    }

    // 先从本地用户数据库中查一次，拿到 email（用于兜底清预授权）
    const localUsers = getLocalUsers();
    const localMatch = localUsers.find((u) => u.id === userId) || (emailHint
      ? localUsers.find((u) => (u.email || '').toLowerCase() === emailHint.trim().toLowerCase())
      : null);
    const targetEmail = (emailHint || localMatch?.email || '').trim().toLowerCase();

    // 1) 调服务端 Admin 接口（优先）
    let serverOk = false;
    let serverWarnings = [];
    try {
      const resp = await fetch('/api/delete-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: userId || undefined, email: targetEmail || undefined }),
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data?.success) {
        serverOk = true;
        if (Array.isArray(data.warnings)) serverWarnings = data.warnings;
      } else {
        serverWarnings.push(data?.error || `服务端删除失败（HTTP ${resp.status}）`);
      }
    } catch (err) {
      serverWarnings.push('服务端删除接口不可用：' + err.message);
    }

    // 2) 无论服务端结果如何，都同步清理客户端可感知的本地状态
    try {
      const updated = localUsers.filter((u) => {
        if (userId && u.id === userId) return false;
        if (targetEmail && (u.email || '').toLowerCase() === targetEmail) return false;
        return true;
      });
      if (updated.length !== localUsers.length) saveLocalUsers(updated);
    } catch (err) {
      console.warn('[Auth] 清理本地 users 失败:', err.message);
    }
    if (targetEmail) {
      try { removePreAuthEmail(targetEmail); } catch { /* ignore */ }
    }
    // 若当前登录的正是被删的账号，则注销
    if (user?.id && userId && user.id === userId) {
      try { await logout(); } catch { /* ignore */ }
    }

    if (serverOk) {
      return {
        success: true,
        message: '已删除该用户（auth / profile / 预授权 均已同步清理）',
        warnings: serverWarnings,
      };
    }
    // 服务端没成功，但本地已尽力清理 —— 提示管理员去 Supabase 后台确认
    return {
      success: false,
      message: '服务端删除失败，Supabase 侧可能仍保留记录，请前往 Supabase Dashboard 手动检查 auth.users。',
      warnings: serverWarnings,
    };
  }, [user, logout]);

  // ---- 更改用户角色 ----
  const changeUserRole = useCallback(async (userId, newRole) => {
    if (!ROLES.includes(newRole)) return;

    // 始终同步更新本地用户数据库
    const users = getLocalUsers();
    const idx = users.findIndex((u) => u.id === userId);
    if (idx >= 0) {
      users[idx].role = newRole;
      saveLocalUsers(users);
    }

    const useLocal = !isSupabaseConfigured || supabaseOk === false;
    if (!useLocal) {
      try {
        await supabase.from('profiles').update({ role: newRole }).eq('id', userId);
      } catch (err) {
        console.warn('[Auth] Supabase 角色更新失败:', err.message);
      }
    }
  }, [supabaseOk]);

  // ---- 预授权邮箱：管理员直接输入邮箱授权 ----
  const preAuthorizeByEmail = useCallback(async (email) => {
    if (!email || !email.trim()) return { success: false, message: '请输入邮箱地址' };
    const normalizedEmail = email.trim().toLowerCase();

    // 1. 检查该邮箱是否已注册
    const useLocal = !isSupabaseConfigured || supabaseOk === false;
    if (useLocal) {
      const users = getLocalUsers();
      const existingUser = users.find((u) => u.email.toLowerCase() === normalizedEmail);
      if (existingUser) {
        // 已注册：直接授权
        if (existingUser.authorized) {
          return { success: false, message: '该用户已被授权' };
        }
        existingUser.authorized = true;
        saveLocalUsers(users);
        return {
          success: true,
          message: `已授权用户「${existingUser.name}」（${normalizedEmail}）`,
        };
      }
    } else {
      // Supabase 模式：查询 profiles 表（使用 maybeSingle 避免 PGRST116 异常）
      try {
        const { data: existingProfile, error: profileQueryError } = await supabase
          .from('profiles')
          .select('*')
          .ilike('email', normalizedEmail)
          .maybeSingle();
        if (profileQueryError) {
          console.warn('[Auth] preAuthorizeByEmail: profiles 查询失败:', profileQueryError.message);
        }
        if (existingProfile) {
          if (existingProfile.authorized) {
            return { success: false, message: '该用户已被授权' };
          }
          // 已注册但未授权：直接授权
          const { error: updateError } = await supabase.from('profiles').update({ authorized: true }).eq('id', existingProfile.id);
          if (updateError) {
            console.error('[Auth] preAuthorizeByEmail: 授权更新失败:', updateError.message);
            return { success: false, message: `授权更新失败：${updateError.message}` };
          }
          // 同步本地
          const users = getLocalUsers();
          const localIdx = users.findIndex((u) => u.email.toLowerCase() === normalizedEmail);
          if (localIdx >= 0) {
            users[localIdx].authorized = true;
            saveLocalUsers(users);
          }
          return {
            success: true,
            message: `已授权用户「${existingProfile.name}」（${normalizedEmail}）`,
          };
        }
      } catch (err) {
        console.error('[Auth] preAuthorizeByEmail: 查询/授权异常:', err.message);
      }
    }

    // 2. 用户尚未注册：添加到预授权列表
    const list = getLocalPreAuthEmails();
    if (list.some((item) => item.email.toLowerCase() === normalizedEmail)) {
      return { success: false, message: '该邮箱已在预授权列表中' };
    }
    const newItem = { email: normalizedEmail, addedAt: new Date().toISOString() };
    list.push(newItem);
    saveLocalPreAuthEmails(list);

    // Supabase 模式：同步到 pre_authorized_emails 表
    if (!useLocal) {
      try {
        const { error: insertErr } = await supabase.from('pre_authorized_emails').insert({ email: normalizedEmail });
        if (insertErr) {
          console.warn('[Auth] preAuthorizeByEmail: Supabase 插入预授权邮箱失败（本地已保存）:', insertErr.message);
        }
      } catch (err) {
        console.warn('[Auth] preAuthorizeByEmail: Supabase 同步异常（本地已保存）:', err.message);
      }
    }

    // 发送"邀请注册"邮件
    return {
      success: true,
      message: `已将「${normalizedEmail}」加入预授权列表，该邮箱注册后将自动获得权限`,
    };
  }, [supabaseOk]);

  // ---- 获取预授权邮箱列表 ----
  const getPreAuthorizedEmails = useCallback(async () => {
    const useLocal = !isSupabaseConfigured || supabaseOk === false;
    const localList = getLocalPreAuthEmails();

    if (!useLocal) {
      try {
        const { data, error: fetchErr } = await supabase
          .from('pre_authorized_emails')
          .select('*')
          .order('added_at', { ascending: false });

        if (fetchErr) {
          console.warn('[Auth] getPreAuthorizedEmails: Supabase 查询失败，使用本地数据:', fetchErr.message);
          return localList;
        }

        // 合并 Supabase 数据和本地数据（以邮箱为 key 去重，Supabase 优先）
        const remoteList = (data || []).map((d) => ({ email: d.email, addedAt: d.added_at }));
        const remoteSet = new Set(remoteList.map((r) => r.email.toLowerCase()));
        // 本地有但 Supabase 没有的邮箱，也保留（可能是 Supabase insert 失败的）
        const localOnly = localList.filter((item) => !remoteSet.has(item.email.toLowerCase()));
        const merged = [...remoteList, ...localOnly];

        // 将本地缺失的邮箱同步到 Supabase（后台静默）
        if (localOnly.length > 0) {
          for (const item of localOnly) {
            try {
              await supabase.from('pre_authorized_emails').upsert({ email: item.email }, { onConflict: 'email' });
            } catch { /* 忽略 */ }
          }
        }

        // 更新本地缓存为合并后的完整列表
        saveLocalPreAuthEmails(merged);
        return merged;
      } catch {
        // 网络异常，回退本地
        console.warn('[Auth] getPreAuthorizedEmails: Supabase 异常，使用本地数据');
      }
    }
    return localList;
  }, [supabaseOk]);

  // ---- 移除预授权邮箱 ----
  const removePreAuthorizedEmail = useCallback(async (email) => {
    const normalizedEmail = email.trim().toLowerCase();
    removePreAuthEmail(normalizedEmail);

    const useLocal = !isSupabaseConfigured || supabaseOk === false;
    if (!useLocal) {
      try {
        await supabase.from('pre_authorized_emails').delete().ilike('email', normalizedEmail);
      } catch { /* ignore */ }
    }
  }, [supabaseOk]);

  // ---- 更新用户个人资料（昵称、头像等） ----
  const updateProfile = useCallback(async (updates) => {
    if (!user) return { success: false, message: '未登录' };

    console.log('[Auth] updateProfile 开始:', { userId: user.id, updates: Object.keys(updates), supabaseOk, isSupabaseConfigured });

    // 构造更新后的用户对象（前端状态）
    const updatedUser = { ...user };
    if (updates.name !== undefined) updatedUser.name = updates.name;
    if (updates.nickname !== undefined) updatedUser.nickname = updates.nickname;
    if (updates.avatar !== undefined) updatedUser.avatar = updates.avatar;
    if (updates.signature !== undefined) updatedUser.signature = updates.signature;

    // 始终更新本地用户数据库（如果用户存在于其中）
    const users = getLocalUsers();
    const idx = users.findIndex((u) => u.id === user.id);
    if (idx >= 0) {
      if (updates.name !== undefined) users[idx].name = updates.name;
      if (updates.nickname !== undefined) users[idx].nickname = updates.nickname;
      if (updates.avatar !== undefined) users[idx].avatar = updates.avatar;
      if (updates.signature !== undefined) users[idx].signature = updates.signature;
      saveLocalUsers(users);
    }

    // 始终更新前端 user 状态（不论是否在本地用户库中找到）
    setUser(updatedUser);

    // 缓存完整 profile 到 localStorage（保证刷新后可恢复）
    cacheProfile(updatedUser);

    // 同步 AUTH_KEY
    localStorage.setItem(
      AUTH_KEY,
      JSON.stringify({
        id: updatedUser.id,
        name: updatedUser.name,
        email: updatedUser.email,
        role: updatedUser.role,
        deviceId: getDeviceId(),
        loginAt: new Date().toISOString(),
        persistent: true,
      })
    );

    const useLocal = !isSupabaseConfigured || supabaseOk !== true;
    if (!useLocal) {
      // Supabase 模式：同时更新远端
      try {
        // 先检查 session 是否有效
        const { data: sessionData } = await supabase.auth.getSession();
        if (!sessionData?.session) {
          console.warn('[Auth] Supabase session 无效，无法同步远端');
          return { success: true, message: '已保存到本地（云端 session 已过期，请重新登录后再试）' };
        }

        const updateData = {};
        if (updates.name !== undefined) updateData.name = updates.name;
        if (updates.nickname !== undefined) updateData.nickname = updates.nickname;
        if (updates.avatar !== undefined) updateData.avatar = updates.avatar;
        if (updates.signature !== undefined) updateData.signature = updates.signature;

        console.log('[Auth] Supabase 更新 profiles 表:', { userId: user.id, fields: Object.keys(updateData) });

        let { error, data: returnedData } = await supabase
          .from('profiles')
          .update(updateData)
          .eq('id', user.id)
          .select();

        // 如果是因为 signature 列不存在导致失败，去掉 signature 再试一次
        if (error && error.message?.includes('signature')) {
          console.warn('[Auth] profiles 表缺少 signature 列，去掉 signature 重试');
          delete updateData.signature;
          if (Object.keys(updateData).length > 0) {
            const retry = await supabase
              .from('profiles')
              .update(updateData)
              .eq('id', user.id)
              .select();
            error = retry.error;
            returnedData = retry.data;
          } else {
            error = null;
            returnedData = [{}];
          }
          if (!error) {
            console.log('[Auth] Supabase profiles 更新成功（跳过 signature）');
            return { success: true, message: '已保存到本地，云端同步成功（个性签名暂不支持云端同步，请联系管理员执行数据库修复脚本）' };
          }
        }

        if (error) {
          console.error('[Auth] Supabase profiles 更新失败:', error.message, error.code, error.details, error.hint);
          return { success: true, message: '已保存到本地，云端同步失败：' + error.message };
        }

        // 检查是否实际更新了行（RLS 可能导致 0 行受影响但不报错）
        if (returnedData && returnedData.length === 0) {
          console.warn('[Auth] Supabase profiles 更新返回 0 行（可能是 RLS 策略阻止）');
          return { success: true, message: '已保存到本地，云端同步可能未生效（RLS 策略阻止）' };
        }

        console.log('[Auth] Supabase profiles 更新成功:', returnedData?.length, '行');
      } catch (err) {
        console.error('[Auth] Supabase profile 更新异常:', err);
        return { success: true, message: '已保存到本地，云端同步异常：' + err.message };
      }
    }

    return { success: true };
  }, [user, supabaseOk]);

  // ---- 权限判断工具 ----
  const userRole = user?.role || 'member';
  const isAuthenticated = !!user;
  const isAdmin = userRole === 'admin';
  const isMember = isAuthenticated;

  // 检查用户是否有某个最低角色权限
  const hasMinRole = useCallback((requiredRole) => {
    return hasRole(userRole, requiredRole);
  }, [userRole]);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        bgVerifying,
        login,
        register,
        logout,
        updateProfile,
        resetPassword,
        changePassword,
        updatePasswordFromReset,
        sendResetCode,
        verifyResetCode,
        isAuthenticated,
        isAdmin,
        isMember,
        hasMinRole,
        supabaseOk,
        getAllUsers,
        authorizeUser,
        revokeUser,
        deleteUser,
        changeUserRole,
        preAuthorizeByEmail,
        getPreAuthorizedEmails,
        removePreAuthorizedEmail,
        ROLES,
        ROLE_LABELS,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
