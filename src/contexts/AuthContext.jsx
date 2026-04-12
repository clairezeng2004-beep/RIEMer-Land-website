import { createContext, useContext, useState, useEffect } from 'react';

const AuthContext = createContext(null);

// Simulated user database
const USERS_DB_KEY = 'riemer_users';
const AUTH_KEY = 'riemer_auth';
const DEVICE_KEY = 'riemer_device_id';

// 生成或获取设备唯一标识，确保同一设备可以长期保持登录
const getDeviceId = () => {
  let deviceId = localStorage.getItem(DEVICE_KEY);
  if (!deviceId) {
    deviceId = 'device_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
    localStorage.setItem(DEVICE_KEY, deviceId);
  }
  return deviceId;
};

const getUsers = () => {
  const stored = localStorage.getItem(USERS_DB_KEY);
  if (stored) return JSON.parse(stored);
  // Default admin user
  const defaultUsers = [
    {
      id: '1',
      email: 'admin@riemerland.org',
      password: 'admin123',
      name: 'Admin',
      role: 'admin',
      authorized: true,
      createdAt: new Date().toISOString(),
    },
  ];
  localStorage.setItem(USERS_DB_KEY, JSON.stringify(defaultUsers));
  return defaultUsers;
};

const saveUsers = (users) => {
  localStorage.setItem(USERS_DB_KEY, JSON.stringify(users));
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem(AUTH_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        const users = getUsers();
        const found = users.find((u) => u.id === parsed.id);
        if (found && found.authorized) {
          // 用数据库中最新的用户信息更新（如角色变更等）
          setUser(found);
          // 同步更新 localStorage 中的用户信息快照
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
        } else if (parsed.persistent && parsed.id) {
          // 用户数据库可能被重置但 localStorage 仍在，清除登录态
          localStorage.removeItem(AUTH_KEY);
        } else {
          localStorage.removeItem(AUTH_KEY);
        }
      } catch {
        localStorage.removeItem(AUTH_KEY);
      }
    }
    setLoading(false);
  }, []);

  const login = (email, password) => {
    const users = getUsers();
    const found = users.find(
      (u) => u.email === email && u.password === password
    );
    if (!found) {
      return { success: false, message: '邮箱或密码错误' };
    }
    if (!found.authorized) {
      return { success: false, message: '您的账号尚未被授权，请联系管理员' };
    }
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

  const register = (email, password, name) => {
    const users = getUsers();
    if (users.find((u) => u.email === email)) {
      return { success: false, message: '该邮箱已被注册' };
    }
    const newUser = {
      id: Date.now().toString(),
      email,
      password,
      name,
      role: 'member',
      authorized: false,
      createdAt: new Date().toISOString(),
    };
    users.push(newUser);
    saveUsers(users);
    return {
      success: true,
      message: '注册成功！请等待管理员授权后方可登录内部系统。',
    };
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem(AUTH_KEY);
  };

  const getAllUsers = () => getUsers();

  const authorizeUser = (userId) => {
    const users = getUsers();
    const idx = users.findIndex((u) => u.id === userId);
    if (idx >= 0) {
      users[idx].authorized = true;
      saveUsers(users);
    }
  };

  const revokeUser = (userId) => {
    const users = getUsers();
    const idx = users.findIndex((u) => u.id === userId);
    if (idx >= 0) {
      users[idx].authorized = false;
      saveUsers(users);
      if (user?.id === userId) {
        logout();
      }
    }
  };

  const isAdmin = user?.role === 'admin';
  const isAuthenticated = !!user;

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        register,
        logout,
        isAuthenticated,
        isAdmin,
        getAllUsers,
        authorizeUser,
        revokeUser,
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
