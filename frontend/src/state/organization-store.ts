import { create } from 'zustand';

export interface OrganizationSummary {
  id: string;
  name: string;
  timezone: string;
  color: string;
}

interface OrganizationState {
  organizations: OrganizationSummary[];
  activeOrgId: string | null;
  setActiveOrg: (id: string) => void;
  hydrate: (organizations: OrganizationSummary[]) => void;
  useFallback: () => void;
}

export const fallbackOrganizations: OrganizationSummary[] = [
  { id: 'org-1', name: '星火教育集团', timezone: 'Asia/Shanghai', color: '#38bdf8' },
  { id: 'org-2', name: '晨曦零售总部', timezone: 'Asia/Shanghai', color: '#f97316' }
];

export const useOrganizationStore = create<OrganizationState>((set) => ({
  organizations: [],
  activeOrgId: null,
  setActiveOrg: (id) =>
    set((state) => ({
      activeOrgId: state.organizations.some((org) => org.id === id) ? id : state.activeOrgId
    })),
  hydrate: (organizations) =>
    set((state) => {
      if (!Array.isArray(organizations) || organizations.length === 0) {
        return state;
      }
      const activeExists = state.activeOrgId && organizations.some((org) => org.id === state.activeOrgId);
      return {
        organizations,
        activeOrgId: activeExists ? state.activeOrgId : organizations[0]?.id ?? null
      };
    }),
  useFallback: () =>
    set(() => ({
      organizations: fallbackOrganizations,
      activeOrgId: fallbackOrganizations[0]?.id ?? null
    }))
}));
