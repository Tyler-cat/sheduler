import { type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../state/auth-store';
import { RoleSwitcher } from './RoleSwitcher';

const navItems: Array<{ label: string; path: string; roles: string[] }> = [
  { label: '超级管理员', path: '/super-admin', roles: ['SUPER_ADMIN'] },
  { label: '组织排班', path: '/admin', roles: ['SUPER_ADMIN', 'ADMIN'] },
  { label: '个人日历', path: '/app', roles: ['SUPER_ADMIN', 'ADMIN', 'STAFF'] }
];

export function AppShell({ title, children }: { title: string; children: ReactNode }) {
  const { user } = useAuth();

  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-100">
      <aside className="w-64 border-r border-slate-800 bg-slate-900/60 p-6">
        <div className="mb-8">
          <h1 className="text-lg font-semibold text-slate-50">Sheduler</h1>
          <p className="text-sm text-slate-400">多组织排班与 AI 协同工作台</p>
        </div>
        <nav className="space-y-2">
          {navItems
            .filter((item) => item.roles.includes(user.role))
            .map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  [
                    'block rounded-md px-3 py-2 text-sm font-medium transition',
                    isActive
                      ? 'bg-brand.surface text-white'
                      : 'text-slate-200 hover:bg-brand.surface hover:text-white'
                  ].join(' ')
                }
              >
                {item.label}
              </NavLink>
            ))}
        </nav>
      </aside>
      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-800 bg-slate-900/80 px-6 py-4">
          <div>
            <p className="text-xs uppercase tracking-widest text-slate-400">当前视图</p>
            <h2 className="text-xl font-semibold text-white">{title}</h2>
          </div>
          <RoleSwitcher />
        </header>
        <main className="flex-1 overflow-y-auto bg-slate-950/40 px-6 py-6">{children}</main>
      </div>
    </div>
  );
}
