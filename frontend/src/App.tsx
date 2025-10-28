import { useEffect, useMemo, useRef } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './state/auth-store';
import { AppShell } from './components/AppShell';
import { SuperAdminDashboard } from './routes/SuperAdminDashboard';
import { AdminWorkspace } from './routes/AdminWorkspace';
import { StaffWorkspace } from './routes/StaffWorkspace';
import { useOrganizationsQuery } from './api/hooks';
import { useOrganizationStore, type OrganizationSummary } from './state/organization-store';
import type { OrganizationDto } from './api/types';

function LandingRedirect() {
  const { user } = useAuth();
  const target = user.role === 'SUPER_ADMIN' ? '/super-admin' : user.role === 'ADMIN' ? '/admin' : '/app';
  return <Navigate to={target} replace />;
}

function mapOrganization(dto: OrganizationDto): OrganizationSummary {
  return {
    id: dto.id,
    name: dto.name,
    timezone: 'Asia/Shanghai',
    color: dto.branding?.primaryColor ?? '#38bdf8'
  };
}

export function App() {
  const location = useLocation();
  const organizationQuery = useOrganizationsQuery();
  const { organizations, hydrate, useFallback } = useOrganizationStore();
  const fallbackApplied = useRef(false);

  useEffect(() => {
    if (organizationQuery.data && organizationQuery.data.length) {
      const mapped = organizationQuery.data.map(mapOrganization);
      hydrate(mapped);
      fallbackApplied.current = false;
    }
  }, [organizationQuery.data, hydrate]);

  useEffect(() => {
    if (organizationQuery.isError && !organizationQuery.isLoading && organizations.length === 0 && !fallbackApplied.current) {
      useFallback();
      fallbackApplied.current = true;
    }
  }, [organizationQuery.isError, organizationQuery.isLoading, organizations.length, useFallback]);

  const title = useMemo(() => {
    if (location.pathname.startsWith('/super-admin')) return '超级管理员控制台';
    if (location.pathname.startsWith('/admin')) return '组织排班中心';
    if (location.pathname.startsWith('/app')) return '个人与团队日历';
    return 'Sheduler 控制台';
  }, [location.pathname]);

  const bootstrapped = organizations.length > 0;
  const loading = organizationQuery.isLoading && !bootstrapped;
  const error = organizationQuery.isError && !loading && !bootstrapped;

  const content = loading ? (
    <div className="flex h-full items-center justify-center text-sm text-slate-400">正在加载组织数据…</div>
  ) : error ? (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-rose-300">
      <p>无法加载组织信息，已切换到演示数据。</p>
      <button
        type="button"
        className="rounded-md border border-rose-500 px-3 py-1 text-xs text-rose-100 hover:bg-rose-500/10"
        onClick={() => organizationQuery.refetch()}
      >
        重试
      </button>
    </div>
  ) : (
    <Routes>
      <Route path="/" element={<LandingRedirect />} />
      <Route path="/super-admin" element={<SuperAdminDashboard />} />
      <Route path="/admin" element={<AdminWorkspace />} />
      <Route path="/app" element={<StaffWorkspace />} />
    </Routes>
  );

  return <AppShell title={title}>{content}</AppShell>;
}
