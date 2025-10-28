export interface OrganizationDto {
  id: string;
  name: string;
  slug?: string;
  status?: string;
  branding?: {
    primaryColor?: string | null;
  } | null;
}

export interface EventDto {
  id: string;
  organizationId: string;
  title: string;
  start: string;
  end: string;
  description?: string | null;
  assigneeIds: string[];
  color?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface QueueJobDto {
  id: string;
  organizationId: string | null;
  type: string;
  status: string;
  payload?: Record<string, unknown> | null;
  queuedAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  lastError?: string | null;
}

export interface SchedulingWindowDto {
  start: string;
  end?: string;
  durationMinutes?: number;
  assigneeIds?: string[];
}

export interface SchedulingEventDto {
  title: string;
  start: string;
  end: string;
  assigneeIds: string[];
  color?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface SchedulingSuggestionDto {
  id: string;
  organizationId: string;
  solver: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
  committedAt?: string | null;
  scoreBreakdown?: Record<string, unknown> & {
    feasibleWindows?: number;
    selectedWindowIndex?: number;
    windowCoverageMinutes?: number;
    requestedDurationMinutes?: number;
  } | null;
  outputPlan?: {
    selectedWindow?: SchedulingWindowDto | null;
    events?: SchedulingEventDto[];
  } | null;
  errors?: string[];
}
