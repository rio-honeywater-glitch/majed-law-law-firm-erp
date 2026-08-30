import { createContext, useContext, useEffect, useState } from "react";
import { User, UserRole, getMe } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import {
  clearCachedTheme,
  clearTheme,
  cacheTheme,
  applyTheme,
  cacheBranding,
  readCachedBranding,
  clearCachedBranding,
  type TenantBranding,
} from "@/lib/theme";

interface AuthContextType {
  user: User | null;
  token: string | null;
  branding: TenantBranding | null;
  isLoading: boolean;
  login: (user: User, token: string, branding?: TenantBranding | null) => void;
  logout: () => void;
  updateUser: (user: User) => void;
  isManager: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [branding, setBranding] = useState<TenantBranding | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [, setLocation] = useLocation();

  useEffect(() => {
    const storedToken = localStorage.getItem("auth_token");
    const storedUser = localStorage.getItem("auth_user");
    
    if (storedToken && storedUser) {
      try {
        setToken(storedToken);
        setUser(JSON.parse(storedUser));
        const cached = readCachedBranding();
        setBranding(cached);

        // Always verify the token is still valid against the server.
        // If it returns 401 (e.g. SESSION_SECRET rotated), auto-logout so
        // the user is sent to the login page instead of seeing empty pages.
        getMe()
          .then((session) => {
            cacheBranding(session.branding);
            setBranding(session.branding);
            cacheTheme(session.theme);
            applyTheme(session.theme);
          })
          .catch((err) => {
            if (err?.status === 401 || err?.status === 403) {
              localStorage.removeItem("auth_token");
              localStorage.removeItem("auth_user");
              clearCachedTheme();
              clearTheme();
              clearCachedBranding();
              setToken(null);
              setUser(null);
              setBranding(null);
              setLocation("/login");
            }
            /* other errors: keep session, server may be temporarily unavailable */
          });
      } catch (e) {
        localStorage.removeItem("auth_token");
        localStorage.removeItem("auth_user");
      }
    }
    setIsLoading(false);
  }, []);

  const login = (newUser: User, newToken: string, newBranding?: TenantBranding | null) => {
    localStorage.setItem("auth_token", newToken);
    localStorage.setItem("auth_user", JSON.stringify(newUser));
    cacheBranding(newBranding ?? null);
    setToken(newToken);
    setUser(newUser);
    setBranding(newBranding ?? null);
  };

  const updateUser = (newUser: User) => {
    localStorage.setItem("auth_user", JSON.stringify(newUser));
    setUser(newUser);
  };

  const logout = () => {
    localStorage.removeItem("auth_token");
    localStorage.removeItem("auth_user");
    clearCachedTheme();
    clearTheme();
    clearCachedBranding();
    setToken(null);
    setUser(null);
    setBranding(null);
    setLocation("/login");
  };

  const isManager = user?.role === "SYSTEM_MANAGER";

  return (
    <AuthContext.Provider value={{ user, token, branding, isLoading, login, logout, updateUser, isManager }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
