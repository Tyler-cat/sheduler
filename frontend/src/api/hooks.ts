import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiError } from './client';
import type {
  EventCreateInput,
  EventDto,
  EventUpdateInput,
  OrganizationDto,
  QueueJobDto,
  SchedulingSuggestionDto
} from './types';

export function useOrganizationsQuery(enabled = true) {
  return useQuery({
    queryKey: ['organizations', 'mine'],
    enabled,
    queryFn: async (): Promise<OrganizationDto[]> => {
      const payload = await apiFetch<{ organizations: OrganizationDto[] }>(
        '/api/organizations?mine=true',
        { method: 'GET' }
      );
      return Array.isArray(payload.organizations) ? payload.organizations : [];
    },
    staleTime: 60_000
  });
}

export interface EventsQueryOptions {
  organizationId: string | null;
  start?: string;
  end?: string;
}

export function useEventsQuery({ organizationId, start, end }: EventsQueryOptions) {
  return useQuery({
    queryKey: ['events', organizationId, start, end],
    enabled: Boolean(organizationId),
    queryFn: async (): Promise<EventDto[]> => {
      if (!organizationId) {
        return [];
      }
      const params = new URLSearchParams({ organizationId });
      if (start) {
        params.set('start', start);
      }
      if (end) {
        params.set('end', end);
      }
      const payload = await apiFetch<{ events: EventDto[] }>(`/api/events?${params.toString()}`);
      return Array.isArray(payload.events) ? payload.events : [];
    }
  });
}

function invalidateEventQueries(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['events'], exact: false });
}

export function useCreateEventMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: EventCreateInput): Promise<EventDto> => {
      const payload = await apiFetch<{ event: EventDto }>('/api/events', {
        method: 'POST',
        body: JSON.stringify(input)
      });
      return payload.event;
    },
    onSuccess: () => invalidateEventQueries(queryClient)
  });
}

export function useUpdateEventMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: EventUpdateInput }): Promise<EventDto> => {
      const payload = await apiFetch<{ event: EventDto }>(`/api/events/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data)
      });
      return payload.event;
    },
    onSuccess: () => invalidateEventQueries(queryClient)
  });
}

export interface QueueJobsQueryOptions {
  organizationId: string | null;
  limit?: number;
  status?: string | null;
}

export function useQueueJobsQuery({ organizationId, limit = 12, status = null }: QueueJobsQueryOptions) {
  return useQuery({
    queryKey: ['queue', 'jobs', organizationId, limit, status],
    enabled: Boolean(organizationId),
    queryFn: async (): Promise<QueueJobDto[]> => {
      if (!organizationId) {
        return [];
      }
      const params = new URLSearchParams({ organizationId });
      if (limit) {
        params.set('limit', String(limit));
      }
      if (status) {
        params.set('status', status);
      }
      const payload = await apiFetch<{ jobs: QueueJobDto[] }>(`/api/queue/jobs?${params.toString()}`);
      return Array.isArray(payload.jobs) ? payload.jobs : [];
    },
    refetchInterval: 15_000,
    refetchOnMount: 'always'
  });
}

export function useSchedulingSuggestionsQuery(organizationId: string | null) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: ['scheduling', 'suggestions', organizationId],
    enabled: Boolean(organizationId),
    queryFn: async (): Promise<SchedulingSuggestionDto[]> => {
      if (!organizationId) {
        return [];
      }
      try {
        const params = new URLSearchParams({ organizationId });
        const payload = await apiFetch<{ suggestions: SchedulingSuggestionDto[] }>(
          `/api/scheduling/suggestions?${params.toString()}`
        );
        return Array.isArray(payload.suggestions) ? payload.suggestions : [];
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          // No suggestions recorded yet — treat as empty cache and avoid retry storms.
          queryClient.setQueryData(['scheduling', 'suggestions', organizationId], []);
          return [];
        }
        throw error;
      }
    },
    staleTime: 15_000
  });
}
