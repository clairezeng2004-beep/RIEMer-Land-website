import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { supabase, isSupabaseConfigured, checkSupabaseHealth, getReachable, onReachableChange } from '../lib/supabase';

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

// ============================================
// AuthProvider
// ============================================
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  // Supabase 是否可达：null=检测中, true=可达, false=不可达（降级本地模式）
  const [supabaseOk, setSupabaseOk] = useState(isSupabaseConfigured ? null : false);

  // ---- 本地模式：从 localStorage 恢复登录态的辅助函数 ----
  const restoreLocalAuth = useCallback(() => {
    const stored = localStorage.getItem(AUTH_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        const users = getLocalUsers();
        const found = users.find((u) => u.id === parsed.id);
        if (found && found.authorized) {
          setUser(found);
          return true;
        } else {
          localStorage.removeItem(AUTH_KEY);
          setUser(null);
          return false;
        }
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
          const users = getLocalUsers();
          const found = users.find((u) => u.id === parsed.id);
          if (found && found.authorized) {
            setUser(found);
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
            localStorage.removeItem(AUTH_KEY);
          }
        } catch {
          localStorage.removeItem(AUTH_KEY);
        }
      }
      setLoading(false);
      return;
    }

    // Supabase 模式：先做健康检查，不通则降级本地模式
    const SESSION_TIMEOUT_MS = 6000; // 6 秒超时（缩短）

    const initSession = async () => {
      // 1. 先快速检测 Supabase 是否可达（3 秒超时）
      const reachable = await checkSupabaseHealth();
      if (!reachable) {
        console.warn('[Auth] Supabase 不可达，自动降级到本地模式');
        setSupabaseOk(false);
        // 降级：从 localStorage 恢复登录态
        restoreLocalAuth();
        setLoading(false);
        return;
      }
      setSupabaseOk(true);

      // 2. Supabase 可达，正常获取 session
      const timeout = setTimeout(() => {
        console.warn('[Auth] Session 初始化超时（6s），降级本地模式');
        setSupabaseOk(false);
        restoreLocalAuth();
        setLoading(false);
      }, SESSION_TIMEOUT_MS);

      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          await fetchProfile(session.user);
        }
      } catch (err) {
        console.error('[Auth] Failed to get session:', err);
        // 网络错误 → 降级
        setSupabaseOk(false);
        restoreLocalAuth();
      } finally {
        clearTimeout(timeout);
        setLoading(false);
      }
    };

    initSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        console.log('[Auth] onAuthStateChange:', event);
        // 如果 Supabase 已标记不可达，跳过
        if (getReachable() === false) return;
        if (session?.user) {
          // 如果 login 函数已经设置了 user，跳过重复查询
          // 只在 SIGNED_IN 以外的事件（如 TOKEN_REFRESHED）或初始加载时查询
          if (event === 'SIGNED_IN') {
            // login() 里已经 setUser 了，不需要重复 fetchProfile
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
      } else if (data) {
        setUser(data);
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
      if (!found.authorized) return { success: false, message: '您的账号尚未被授权，请联系管理员' };
      setUser(found);
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
      if (!found.authorized) return { success: false, message: '您的账号尚未被授权，请联系管理员' };
      setUser(found);
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
            return { success: false, message: '邮箱尚未验证。请到 Supabase Dashboard → Authentication → Users 中手动确认该邮箱，或关闭邮箱验证（Providers → Email → Confirm email 关闭）' };
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
        console.time('[Auth] profile 查询');
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('id, email, name, nickname, avatar, role, authorized')
          .eq('id', data.user.id)
          .single();
        console.timeEnd('[Auth] profile 查询');

        console.log('[Auth] 登录用户 profile 查询结果:', { profile, profileError });

        if (profileError) {
          console.error('[Auth] Profile 查询失败，不阻止登录:', profileError);
          return { success: true };
        }

        if (!profile) {
          return { success: true };
        }

        if (!profile.authorized) {
          await supabase.auth.signOut();
          return {
            success: false,
            message: `您的账号尚未被授权，请联系管理员。(debug: role=${profile.role}, authorized=${profile.authorized})`,
          };
        }

        // 直接设置用户状态，避免 onAuthStateChange 再次查询 profile
        setUser(profile);
        return { success: true };
      })();

      // 超时竞争：loginPromise vs 8 秒超时
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('登录请求超时，请检查网络连接后重试')), LOGIN_TIMEOUT_MS)
      );

      return await Promise.race([loginPromise, timeoutPromise]);
    } catch (err) {
      console.error('[Auth] Supabase 登录异常:', err);
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
    const newUser = {
      id: Date.now().toString(),
      email,
      password,
      name,
      nickname: '',
      avatar: null,
      signature: '',
      role: 'member',
      authorized: false,
      createdAt: new Date().toISOString(),
    };
    users.push(newUser);
    saveLocalUsers(users);

    // 本地模式：在 localStorage 通知列表中添加授权通知
    try {
      const NOTIFICATIONS_KEY = 'riemer_notifications';
      const stored = localStorage.getItem(NOTIFICATIONS_KEY);
      const notifications = stored ? JSON.parse(stored) : [];
      const newNotif = {
        id: 'reg_' + Date.now().toString(),
        title: '新成员注册申请',
        message: `${name}（${email}）已注册账号，请前往用户管理页面进行授权。`,
        type: 'system',
        date: new Date().toISOString().split('T')[0],
        read: false,
        target_role: 'admin',
      };
      notifications.unshift(newNotif);
      localStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(notifications));
    } catch (err) {
      console.warn('[Auth] 本地通知写入失败:', err.message);
    }

    return { success: true, message: '注册成功！请等待管理员授权后方可登录内部系统。' };
  };

  // ---- 注册 ----
  const register = useCallback(async (email, password, name) => {
    const useLocal = !isSupabaseConfigured || supabaseOk === false;
    if (useLocal) {
      return registerLocal(email, password, name);
    }

    // Supabase 模式 — 同时也写入本地用户数据库作为备份
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { name } },
      });
      if (error) {
        if (error.message.includes('already registered')) {
          return { success: false, message: '该邮箱已被注册' };
        }
        // Supabase 注册失败，回退到本地注册
        console.warn('[Auth] Supabase 注册失败，回退本地注册:', error.message);
        return registerLocal(email, password, name);
      }
      // 创建 profile 记录
      if (data.user) {
        await supabase.from('profiles').insert({
          id: data.user.id,
          email,
          name,
          nickname: '',
          avatar: null,
          signature: '',
          role: 'member',
          authorized: false,
          created_at: new Date().toISOString(),
        });

        // 显式插入授权通知到 notifications 表
        // （如果数据库触发器已存在会产生两条，用 title+email 去重即可；
        //   如果触发器尚未部署，这里保证通知一定会被创建）
        try {
          await supabase.from('notifications').insert({
            title: '新成员注册申请',
            message: `${name}（${email}）已注册账号，请前往用户管理页面进行授权。`,
            type: 'system',
            date: new Date().toISOString().split('T')[0],
            target_role: 'admin',
          });
        } catch (notifErr) {
          console.warn('[Auth] Supabase 通知插入失败（触发器可能已处理）:', notifErr.message);
        }
      }
      // 同时写入本地用户数据库备份
      registerLocal(email, password, name);
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
  }, []);

  // ---- 忘记密码 / 重置密码 ----
  const resetPassword = useCallback(async (email, newPassword) => {
    const useLocal = !isSupabaseConfigured || supabaseOk === false;
    if (useLocal) {
      // 本地模式：直接用邮箱查找用户，设置新密码
      if (!email) return { success: false, message: '请输入邮箱地址' };
      if (!newPassword || newPassword.length < 6) {
        return { success: false, message: '新密码至少需要 6 个字符' };
      }
      const users = getLocalUsers();
      const idx = users.findIndex((u) => u.email === email);
      if (idx < 0) return { success: false, message: '未找到该邮箱对应的账号' };
      users[idx].password = newPassword;
      saveLocalUsers(users);
      // 如果之前保存了凭据，清除旧的
      localStorage.removeItem('riemer_saved_credentials');
      return { success: true, message: '密码重置成功！请使用新密码登录。' };
    }

    // Supabase 模式：发送重置密码邮件
    if (!email) return { success: false, message: '请输入邮箱地址' };
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) {
      return { success: false, message: error.message };
    }
    return { success: true, message: '密码重置邮件已发送，请查看您的邮箱。' };
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
    const useLocal = !isSupabaseConfigured || supabaseOk === false;
    if (useLocal) {
      return getLocalUsers();
    }
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: true });
      if (error || !data || data.length === 0) {
        // Supabase 查询失败或无数据，回退本地
        console.warn('[Auth] Supabase profiles 查询失败或为空，回退本地用户列表');
        return getLocalUsers();
      }
      return data;
    } catch {
      return getLocalUsers();
    }
  }, [supabaseOk]);

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

  // ---- 更新用户个人资料（昵称、头像等） ----
  const updateProfile = useCallback(async (updates) => {
    if (!user) return { success: false, message: '未登录' };

    // 始终更新本地用户数据库
    const users = getLocalUsers();
    const idx = users.findIndex((u) => u.id === user.id);
    if (idx >= 0) {
      if (updates.name !== undefined) users[idx].name = updates.name;
      if (updates.nickname !== undefined) users[idx].nickname = updates.nickname;
      if (updates.avatar !== undefined) users[idx].avatar = updates.avatar;
      if (updates.signature !== undefined) users[idx].signature = updates.signature;
      saveLocalUsers(users);
      setUser({ ...users[idx] });
      // 同步 AUTH_KEY
      localStorage.setItem(
        AUTH_KEY,
        JSON.stringify({
          id: users[idx].id,
          name: users[idx].name,
          email: users[idx].email,
          role: users[idx].role,
          deviceId: getDeviceId(),
          loginAt: new Date().toISOString(),
          persistent: true,
        })
      );
    }

    const useLocal = !isSupabaseConfigured || supabaseOk === false;
    if (!useLocal) {
      // Supabase 模式：同时更新远端
      try {
        const updateData = {};
        if (updates.name !== undefined) updateData.name = updates.name;
        if (updates.nickname !== undefined) updateData.nickname = updates.nickname;
        if (updates.avatar !== undefined) updateData.avatar = updates.avatar;
        if (updates.signature !== undefined) updateData.signature = updates.signature;
        const { error } = await supabase
          .from('profiles')
          .update(updateData)
          .eq('id', user.id);
        if (error) {
          console.warn('[Auth] Supabase profile 更新失败:', error.message);
        }
      } catch (err) {
        console.warn('[Auth] Supabase profile 更新异常:', err.message);
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
        login,
        register,
        logout,
        updateProfile,
        resetPassword,
        changePassword,
        updatePasswordFromReset,
        isAuthenticated,
        isAdmin,
        isMember,
        hasMinRole,
        supabaseOk,
        getAllUsers,
        authorizeUser,
        revokeUser,
        changeUserRole,
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
