import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

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
  if (stored) return JSON.parse(stored);
  const defaultUsers = [
    {
      id: '1',
      email: 'admin@riemerland.org',
      password: 'admin123',
      name: 'Admin',
      nickname: '',
      avatar: null,
      role: 'admin',
      authorized: true,
      createdAt: new Date().toISOString(),
    },
  ];
  localStorage.setItem(USERS_DB_KEY, JSON.stringify(defaultUsers));
  return defaultUsers;
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

    // Supabase 模式：监听 auth state 变化
    const initSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          await fetchProfile(session.user);
        }
      } catch (err) {
        console.error('[Auth] Failed to get session:', err);
      } finally {
        setLoading(false);
      }
    };

    initSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        if (session?.user) {
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

      if (error && error.code === 'PGRST116') {
        // profile 不存在，创建默认 profile（新注册用户）
        const newProfile = {
          id: authUser.id,
          email: authUser.email,
          name: authUser.user_metadata?.name || authUser.email.split('@')[0],
          nickname: '',
          avatar: null,
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
    if (!isSupabaseConfigured) {
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

    // Supabase 模式
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      if (error.message === 'Email not confirmed') {
        return { success: false, message: '邮箱尚未验证。请到 Supabase Dashboard → Authentication → Users 中手动确认该邮箱，或关闭邮箱验证（Providers → Email → Confirm email 关闭）' };
      }
      return { success: false, message: error.message === 'Invalid login credentials' ? '邮箱或密码错误（若邮箱未确认也会出现此错误，请检查 Supabase 邮箱确认设置）' : error.message };
    }
    // 检查 authorized 状态
    const { data: profile } = await supabase
      .from('profiles')
      .select('authorized')
      .eq('id', data.user.id)
      .single();
    if (profile && !profile.authorized) {
      await supabase.auth.signOut();
      return { success: false, message: '您的账号尚未被授权，请联系管理员' };
    }
    return { success: true };
  }, []);

  // ---- 注册 ----
  const register = useCallback(async (email, password, name) => {
    if (!isSupabaseConfigured) {
      // 本地模式
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
        role: 'member',
        authorized: false,
        createdAt: new Date().toISOString(),
      };
      users.push(newUser);
      saveLocalUsers(users);
      return { success: true, message: '注册成功！请等待管理员授权后方可登录内部系统。' };
    }

    // Supabase 模式
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name } },
    });
    if (error) {
      if (error.message.includes('already registered')) {
        return { success: false, message: '该邮箱已被注册' };
      }
      return { success: false, message: error.message };
    }
    // 创建 profile 记录
    if (data.user) {
      await supabase.from('profiles').insert({
        id: data.user.id,
        email,
        name,
        nickname: '',
        avatar: null,
        role: 'member',
        authorized: false,
        created_at: new Date().toISOString(),
      });
    }
    return { success: true, message: '注册成功！请等待管理员授权后方可登录内部系统。' };
  }, []);

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
    if (!isSupabaseConfigured) {
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
  }, []);

  // ---- 修改密码（已登录用户） ----
  const changePassword = useCallback(async (currentPassword, newPassword) => {
    if (!user) return { success: false, message: '未登录' };
    if (!newPassword || newPassword.length < 6) {
      return { success: false, message: '新密码至少需要 6 个字符' };
    }

    if (!isSupabaseConfigured) {
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
  }, [user]);

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
    if (!isSupabaseConfigured) {
      return getLocalUsers();
    }
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: true });
    return error ? [] : data;
  }, []);

  // ---- 授权用户 ----
  const authorizeUser = useCallback(async (userId) => {
    if (!isSupabaseConfigured) {
      const users = getLocalUsers();
      const idx = users.findIndex((u) => u.id === userId);
      if (idx >= 0) {
        users[idx].authorized = true;
        saveLocalUsers(users);
      }
      return;
    }
    await supabase.from('profiles').update({ authorized: true }).eq('id', userId);
  }, []);

  // ---- 撤销授权 ----
  const revokeUser = useCallback(async (userId) => {
    if (!isSupabaseConfigured) {
      const users = getLocalUsers();
      const idx = users.findIndex((u) => u.id === userId);
      if (idx >= 0) {
        users[idx].authorized = false;
        saveLocalUsers(users);
        if (user?.id === userId) {
          logout();
        }
      }
      return;
    }
    await supabase.from('profiles').update({ authorized: false }).eq('id', userId);
    if (user?.id === userId) {
      await logout();
    }
  }, [user, logout]);

  // ---- 更改用户角色 ----
  const changeUserRole = useCallback(async (userId, newRole) => {
    if (!ROLES.includes(newRole)) return;

    if (!isSupabaseConfigured) {
      const users = getLocalUsers();
      const idx = users.findIndex((u) => u.id === userId);
      if (idx >= 0) {
        users[idx].role = newRole;
        saveLocalUsers(users);
      }
      return;
    }
    await supabase.from('profiles').update({ role: newRole }).eq('id', userId);
  }, []);

  // ---- 更新用户个人资料（昵称、头像等） ----
  const updateProfile = useCallback(async (updates) => {
    if (!user) return { success: false, message: '未登录' };

    if (!isSupabaseConfigured) {
      const users = getLocalUsers();
      const idx = users.findIndex((u) => u.id === user.id);
      if (idx >= 0) {
        if (updates.nickname !== undefined) users[idx].nickname = updates.nickname;
        if (updates.avatar !== undefined) users[idx].avatar = updates.avatar;
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
      return { success: true };
    }

    // Supabase 模式
    const updateData = {};
    if (updates.nickname !== undefined) updateData.nickname = updates.nickname;
    if (updates.avatar !== undefined) updateData.avatar = updates.avatar;
    const { error } = await supabase
      .from('profiles')
      .update(updateData)
      .eq('id', user.id);
    if (error) return { success: false, message: error.message };
    setUser((prev) => ({ ...prev, ...updateData }));
    return { success: true };
  }, [user]);

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
