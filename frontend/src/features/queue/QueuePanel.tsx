import { useMemo } from 'react';
import { clsx } from 'clsx';
import { useQueueJobsQuery } from '../../api/hooks';
import type { QueueJobDto } from '../../api/types';

interface QueuePanelProps {
  organizationId?: string | null;
  variant?: 'default' | 'compact' | 'wide';
}

interface DisplayJob {
  id: string;
  type: string;
  status: string;
  label: string;
  statusLabel: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  lastError?: string | null;
}

const fallbackJobs: DisplayJob[] = [
  {
    id: 'job-1',
    type: 'scheduling.generate',
    label: '排班求解',
    status: 'RUNNING',
    statusLabel: '运行中',
    createdAt: '2024-04-08T08:12:00+08:00',
    updatedAt: '2024-04-08T08:14:00+08:00'
  },
  {
    id: 'job-2',
    type: 'ai.parse',
    label: 'AI 解析',
    status: 'QUEUED',
    statusLabel: '等待中',
    createdAt: '2024-04-08T08:10:00+08:00',
    updatedAt: '2024-04-08T08:10:00+08:00'
  },
  {
    id: 'job-3',
    type: 'externalCalendar.sync',
    label: '外部日历同步',
    status: 'FAILED',
    statusLabel: '失败',
    createdAt: '2024-04-08T07:55:00+08:00',
    updatedAt: '2024-04-08T08:05:00+08:00',
    lastError: '凭据失效，等待管理员修复'
  }
];

const typeLabel: Record<string, string> = {
  'ai.parse': 'AI 解析',
  'scheduling.generate': '排班求解',
  'externalCalendar.sync': '外部日历同步'
};

const statusLabel: Record<string, string> = {
  QUEUED: '等待中',
  RUNNING: '运行中',
  COMPLETED: '已完成',
  FAILED: '失败'
};

const statusClass: Record<string, string> = {
  QUEUED: 'border-slate-700 bg-slate-900/50 text-slate-300',
  RUNNING: 'border-sky-500/50 bg-sky-500/10 text-sky-100',
  FAILED: 'border-rose-500/60 bg-rose-500/15 text-rose-100',
  COMPLETED: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-100'
};

function mapJob(job: QueueJobDto): DisplayJob {
  const normalizedStatus = (job.status || 'QUEUED').toUpperCase();
  return {
    id: job.id,
    type: job.type,
    status: normalizedStatus,
    label: typeLabel[job.type] ?? job.type,
    statusLabel: statusLabel[normalizedStatus] ?? normalizedStatus,
    createdAt: job.queuedAt ?? job.createdAt ?? null,
    updatedAt: job.completedAt ?? job.startedAt ?? job.updatedAt ?? null,
    lastError: job.lastError ?? null
  };
}

function formatTime(value?: string | null) {
  if (!value) {
    return '—';
  }
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return '—';
  }
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

export function QueuePanel({ organizationId = null, variant = 'default' }: QueuePanelProps) {
  const limit = variant === 'compact' ? 6 : 12;
  const queueQuery = useQueueJobsQuery({ organizationId, limit });

  const jobs = useMemo(() => {
    if (queueQuery.data && queueQuery.data.length) {
      return queueQuery.data.map(mapJob);
    }
    return fallbackJobs;
  }, [queueQuery.data]);

  const title = variant === 'compact' ? '作业队列' : '队列状态面板';
  const isDemoSource = !organizationId || queueQuery.isError;
  const sourceLabel = queueQuery.isFetching ? '刷新中…' : isDemoSource ? '演示数据' : '实时数据';

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-slate-800 bg-slate-900/50 p-5">
      <header className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-white">{title}</h3>
          <p className="text-xs text-slate-400">{organizationId ? `组织 ${organizationId}` : '演示组织'} · {sourceLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          {queueQuery.isError ? <span className="text-xs text-rose-300">加载失败</span> : null}
          <button
            type="button"
            className="rounded-md border border-slate-700 px-3 py-1 text-xs text-slate-300 transition hover:bg-slate-800"
            onClick={() => queueQuery.refetch()}
          >
            刷新
          </button>
        </div>
      </header>
      <div className={clsx('grid gap-3', variant === 'wide' ? 'md:grid-cols-2' : '')}>
        {jobs.map((job) => (
          <article
            key={job.id}
            className={clsx(
              'rounded-lg border px-4 py-3 text-sm shadow-sm',
              statusClass[job.status] ?? statusClass.QUEUED
            )}
          >
            <div className="flex items-center justify-between">
              <span className="font-semibold">{job.label}</span>
              <span className="text-xs uppercase tracking-widest">{job.statusLabel}</span>
            </div>
            <dl className="mt-2 space-y-1 text-xs text-slate-300">
              <div className="flex justify-between">
                <dt>创建</dt>
                <dd>{formatTime(job.createdAt)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>最近更新</dt>
                <dd>{formatTime(job.updatedAt)}</dd>
              </div>
              {job.lastError ? (
                <div className="flex justify-between text-rose-200">
                  <dt>错误</dt>
                  <dd className="text-right">{job.lastError}</dd>
                </div>
              ) : null}
            </dl>
          </article>
        ))}
      </div>
    </section>
  );
}
