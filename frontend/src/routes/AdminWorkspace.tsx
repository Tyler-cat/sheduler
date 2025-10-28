import { useEffect, useState } from 'react';
import { CalendarSurface } from '../features/calendar/CalendarSurface';
import { CandidateDrawer } from '../features/drawer/CandidateDrawer';
import { QueuePanel } from '../features/queue/QueuePanel';
import { useAuth } from '../state/auth-store';
import { OrganizationSwitcher } from '../components/OrganizationSwitcher';
import { useOrganizationStore } from '../state/organization-store';
import { useSchedulingSuggestionsQuery } from '../api/hooks';

export function AdminWorkspace() {
  const { user } = useAuth();
  const { activeOrgId } = useOrganizationStore();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedSuggestionId, setSelectedSuggestionId] = useState<string | null>(null);
  const suggestionsQuery = useSchedulingSuggestionsQuery(activeOrgId ?? null);

  useEffect(() => {
    setSelectedSuggestionId(null);
    setDrawerOpen(false);
  }, [activeOrgId]);

  useEffect(() => {
    if (!drawerOpen || !suggestionsQuery.data?.length) {
      return;
    }
    if (!selectedSuggestionId || !suggestionsQuery.data.some((item) => item.id === selectedSuggestionId)) {
      setSelectedSuggestionId(suggestionsQuery.data[0].id);
    }
  }, [drawerOpen, suggestionsQuery.data, selectedSuggestionId]);

  const handleOpenDrawer = () => {
    setDrawerOpen(true);
    if (suggestionsQuery.data?.length) {
      setSelectedSuggestionId(suggestionsQuery.data[0].id);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <OrganizationSwitcher />
        <div className="text-sm text-slate-400">当前管理员可访问 {user.orgIds.length} 个组织</div>
      </div>
      <div className="grid gap-6 xl:grid-cols-[2fr,1fr]">
        <CalendarSurface onOpenCandidateDrawer={handleOpenDrawer} />
        <QueuePanel organizationId={activeOrgId} />
      </div>
      <CandidateDrawer
        open={drawerOpen}
        suggestions={suggestionsQuery.data ?? []}
        selectedId={selectedSuggestionId}
        onSelect={setSelectedSuggestionId}
        onClose={() => setDrawerOpen(false)}
        isLoading={suggestionsQuery.isLoading}
        isError={suggestionsQuery.isError}
        onRefresh={() => suggestionsQuery.refetch()}
      />
    </div>
  );
}
