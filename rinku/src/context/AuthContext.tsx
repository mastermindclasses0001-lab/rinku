import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { Branch, NavSection, SessionUser, TenantInfo } from '../types/erp';
import { apiFetch, getStoredToken, setStoredToken, setSuperTenantOverride } from '../lib/api';

interface Toast {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
}

interface AuthContextValue {
  session: SessionUser | null;
  tenant: TenantInfo | null;
  branches: Branch[];
  activeBranchId: string;
  setActiveBranchId: (id: string) => void;
  activeSection: NavSection;
  setActiveSection: (s: NavSection) => void;
  theme: 'dark' | 'light';
  toggleTheme: () => void;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refreshContext: () => Promise<void>;
  switchSuperTenant: (tenantId: string | null) => Promise<void>;
  notify: (type: Toast['type'], message: string) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<SessionUser | null>(null);
  const [tenant, setTenant] = useState<TenantInfo | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [activeBranchId, setActiveBranchId] = useState<string>('all');
  const [activeSection, setActiveSection] = useState<NavSection>('dashboard');
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const saved = localStorage.getItem('titangrid_theme');
    return saved === 'light' ? 'light' : 'dark';
  });
  const [loading, setLoading] = useState<boolean>(true);
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem('titangrid_theme', theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  const notify = useCallback((type: Toast['type'], message: string) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  const refreshContext = useCallback(async () => {
    const token = getStoredToken();
    if (!token) {
      setSession(null);
      setTenant(null);
      setBranches([]);
      setLoading(false);
      return;
    }
    try {
      const data = await apiFetch('/api/auth/me');
      setSession(data.session);
      setTenant(data.tenant);
      setBranches(data.branches || []);
      if (data.session?.role === 'salesman' || data.session?.role === 'cashier') {
        setActiveBranchId(data.session.branchId || data.branches?.[0]?.id || 'all');
      }
    } catch {
      setStoredToken(null);
      setSession(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshContext();
  }, [refreshContext]);

  const login = async (email: string, password: string) => {
    setSuperTenantOverride(null);
    const data = await apiFetch<{ token: string; user: SessionUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setStoredToken(data.token);
    await refreshContext();
    setActiveSection(data.user.role === 'salesman' || data.user.role === 'cashier' ? 'pos' : 'dashboard');
    notify('success', `Signed in as ${data.user.fullName} / लॉगिन सफल`);
  };

  const logout = () => {
    setStoredToken(null);
    setSuperTenantOverride(null);
    setSession(null);
    setTenant(null);
    setBranches([]);
    setActiveBranchId('all');
  };

  const switchSuperTenant = async (tenantId: string | null) => {
    setSuperTenantOverride(tenantId);
    setActiveBranchId('all');
    await refreshContext();
    notify('info', 'Switched active business workspace / बिजनेस बदला गया');
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        tenant,
        branches,
        activeBranchId,
        setActiveBranchId,
        activeSection,
        setActiveSection,
        theme,
        toggleTheme,
        loading,
        login,
        logout,
        refreshContext,
        switchSuperTenant,
        notify,
      }}
    >
      {children}
      {/* Toast Notification Stack */}
      <div className="fixed bottom-20 md:bottom-5 right-5 z-50 flex flex-col gap-2 max-w-sm pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto px-4 py-3 rounded-lg border text-sm font-medium shadow-lg backdrop-blur-md transition-all ${
              t.type === 'success'
                ? 'bg-emerald-950/90 border-emerald-500/40 text-emerald-100'
                : t.type === 'error'
                ? 'bg-red-950/90 border-red-500/40 text-red-100'
                : 'bg-slate-900/95 border-sky-500/40 text-slate-100'
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </AuthContext.Provider>
  );
};

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
