import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { authRequest, getAuthToken, setAuthToken } from '@/lib/auth-api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [demo, setDemo] = useState(null);
  const [configurationReady, setConfigurationReady] = useState(false);
  const [loading, setLoading] = useState(Boolean(getAuthToken()));

  const refresh = useCallback(async () => {
    if (!getAuthToken()) {
      setUser(null);
      setLoading(false);
      return null;
    }
    setLoading(true);
    try {
      const data = await authRequest('/auth/me');
      setUser(data.user || null);
      return data.user || null;
    } catch {
      setUser(null);
      setAuthToken('');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh().catch(() => {});
    authRequest('/auth/config').then(config => setDemo(config.demo?.enabled ? config.demo : null)).catch(() => {}).finally(() => setConfigurationReady(true));
  }, [refresh]);

  const logout = useCallback(() => {
    setAuthToken('');
    setUser(null);
  }, []);

  const value = useMemo(() => ({
    user,
    demo,
    configurationReady,
    loading,
    refresh,
    logout,
    isAdmin: Boolean(user?.isAdmin || user?.role === 'admin'),
  }), [user, demo, configurationReady, loading, refresh, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** 读取当前登录账号（与工作区邮箱配置无关）。 */
export function useAuthUser() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuthUser must be used within AuthProvider');
  return value;
}
