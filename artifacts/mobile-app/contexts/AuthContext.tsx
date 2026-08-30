import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

/** Module-level token ref — read by setAuthTokenGetter in _layout.tsx */
let _authToken: string | null = null;
export const getAuthToken = () => _authToken;

export interface AuthUser {
  id: number;
  email: string;
  name: string | null;
  role: 'SYSTEM_MANAGER' | 'TECHNICIAN';
}

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (token: string, user: AuthUser) => Promise<void>;
  logout: () => Promise<void>;
}

const TOKEN_KEY = 'auth_token';
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const queryClient = useQueryClient();

  useEffect(() => {
    _authToken = token;
  }, [token]);

  useEffect(() => {
    loadStoredToken();
  }, []);

  async function loadStoredToken() {
    try {
      const stored = await AsyncStorage.getItem(TOKEN_KEY);
      if (stored) {
        _authToken = stored;
        setToken(stored);
        const res = await fetch(
          `https://${process.env.EXPO_PUBLIC_DOMAIN}/api/auth/me`,
          { headers: { Authorization: `Bearer ${stored}` } }
        );
        if (res.ok) {
          const data = await res.json();
          setUser(data.user);
        } else {
          await AsyncStorage.removeItem(TOKEN_KEY);
          _authToken = null;
          setToken(null);
        }
      }
    } catch {
      // ignore storage errors
    } finally {
      setIsLoading(false);
    }
  }

  const login = useCallback(async (newToken: string, newUser: AuthUser) => {
    await AsyncStorage.setItem(TOKEN_KEY, newToken);
    _authToken = newToken;
    setToken(newToken);
    setUser(newUser);
  }, []);

  const logout = useCallback(async () => {
    await AsyncStorage.removeItem(TOKEN_KEY);
    _authToken = null;
    setToken(null);
    setUser(null);
    queryClient.clear();
  }, [queryClient]);

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        isAuthenticated: !!token && !!user,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
