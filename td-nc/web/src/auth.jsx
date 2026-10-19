import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api.js';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [state, setState] = useState({ loading: true, user: null, pending: false, authMethod: null });
  const refresh = useCallback(async () => {
    try {
      const me = await api.get('/auth/me');
      setState({ loading: false, user: me.user, pending: me.pending, authMethod: me.authMethod });
    } catch {
      setState({ loading: false, user: null, pending: false, authMethod: null });
    }
  }, []);
  useEffect(() => {
    refresh();
    const onUnauth = () => setState({ loading: false, user: null, pending: false, authMethod: null });
    window.addEventListener('td:unauthorized', onUnauth);
    return () => window.removeEventListener('td:unauthorized', onUnauth);
  }, [refresh]);
  const logout = async () => { try { await api.post('/auth/logout'); } finally { setState({ loading: false, user: null, pending: false, authMethod: null }); } };
  return <AuthCtx.Provider value={{ ...state, refresh, logout }}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
export const isAdmin = (u) => u?.role === 'ADMIN';
export const isQualita = (u) => u?.role === 'ADMIN' || u?.role === 'QUALITA';
export const isLab = (u) => ['ADMIN', 'QUALITA', 'LAB'].includes(u?.role);
export const isSede = (u) => u?.role === 'SEDE';
export const isInternal = (u) => ['ADMIN', 'QUALITA', 'LAB', 'VIEWER'].includes(u?.role);
