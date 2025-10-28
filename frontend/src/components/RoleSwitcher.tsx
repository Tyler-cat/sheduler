import { useAuth, type Role } from '../state/auth-store';

const roleLabels: Record<Role, string> = {
  SUPER_ADMIN: '超级管理员',
  ADMIN: '管理员',
  STAFF: '员工'
};

export function RoleSwitcher() {
  const { user, switchRole } = useAuth();
  return (
    <div className="flex items-center gap-3 rounded-lg border border-slate-700 bg-slate-900/50 px-3 py-2 text-sm">
      <span className="text-slate-400">当前身份：</span>
      <select
        className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-slate-100 focus:border-brand focus:outline-none"
        value={user.role}
        onChange={(event) => switchRole(event.target.value as Role)}
      >
        {(Object.keys(roleLabels) as Role[]).map((role) => (
          <option key={role} value={role}>
            {roleLabels[role]}
          </option>
        ))}
      </select>
    </div>
  );
}
