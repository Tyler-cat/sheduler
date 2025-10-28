import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

export type Role = 'SUPER_ADMIN' | 'ADMIN' | 'STAFF';

export interface SessionUser {
  id: string;
  name: string;
  role: Role;
  orgIds: string[];
}

interface AuthContextValue {
  user: SessionUser;
  switchRole: (role: Role) => void;
}

const defaultUser: SessionUser = {
  id: 'demo-user',
  name: 'Demo 管理员',
  role: 'ADMIN',
  orgIds: ['org-1', 'org-2']
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser>(defaultUser);
  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      switchRole: (role) => setUser((current) => ({ ...current, role }))
    }),
    [user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth 必须在 AuthProvider 中使用');
  }
  return ctx;
}
