import { useMemo } from 'react';
import { useOrganizationStore } from '../state/organization-store';

export function OrganizationSwitcher() {
  const { organizations, activeOrgId, setActiveOrg } = useOrganizationStore();
  const label = useMemo(() => {
    if (!organizations.length) {
      return '未加载组织';
    }
    const current = organizations.find((item) => item.id === activeOrgId);
    return current?.name ?? organizations[0]?.name ?? '未选择';
  }, [organizations, activeOrgId]);

  if (!organizations.length) {
    return <span className="text-sm text-slate-500">正在加载组织…</span>;
  }

  const value = activeOrgId ?? organizations[0]?.id ?? '';

  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-slate-400">组织：</span>
      <select
        className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-brand focus:outline-none"
        value={value}
        onChange={(event) => setActiveOrg(event.target.value)}
      >
        {organizations.map((org) => (
          <option key={org.id} value={org.id}>
            {org.name}
          </option>
        ))}
      </select>
      <span className="rounded-full bg-brand.surface px-3 py-1 text-xs text-slate-300">{label}</span>
    </div>
  );
}
