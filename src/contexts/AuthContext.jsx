import { createContext, useContext, useState, useEffect } from 'react';

const AuthContext = createContext(null);

// Simulated user database
const USERS_DB_KEY = 'riemer_users';
const AUTH_KEY = 'riemer_auth';

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
      const parsed = JSON.parse(stored);
      const users = getUsers();
      const found = users.find((u) => u.id === parsed.id);
      if (found && found.authorized) {
        setUser(found);
      } else {
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
    localStorage.setItem(AUTH_KEY, JSON.stringify({ id: found.id }));
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
