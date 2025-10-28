import { useMemo, useState } from 'react';
import { clsx } from 'clsx';
import { useEventsQuery } from '../../api/hooks';
import type { EventDto } from '../../api/types';
import { useOrganizationStore } from '../../state/organization-store';

export interface CalendarSurfaceProps {
  mode?: 'admin' | 'personal';
  onOpenCandidateDrawer?: () => void;
  onCreateEvent?: (range: { start: string; end: string }) => void;
  onEditEvent?: (event: EventDto) => void;
}

interface DisplayEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  assignees: string[];
  conflict?: boolean;
  source?: EventDto;
}

const fallbackEvents: DisplayEvent[] = [
  {
    id: 'evt-1',
    title: '物理实验课',
    start: '2024-04-08T09:00:00+08:00',
    end: '2024-04-08T11:00:00+08:00',
    assignees: ['王老师', '李老师']
  },
  {
    id: 'evt-2',
    title: '晨曦门店值班',
    start: '2024-04-08T09:30:00+08:00',
    end: '2024-04-08T13:00:00+08:00',
    assignees: ['张三'],
    conflict: true
  },
  {
    id: 'evt-3',
    title: 'AI 解析复核',
    start: '2024-04-08T14:00:00+08:00',
    end: '2024-04-08T15:30:00+08:00',
    assignees: ['李老师']
  }
];

const viewModes: Array<{ id: string; label: string }> = [
  { id: 'day', label: '日视图' },
  { id: 'week', label: '周视图' },
  { id: 'dense-week', label: '大周重叠' },
  { id: 'month', label: '月视图' },
  { id: 'agenda', label: '议程' }
];

function startOfWeek(date: Date) {
  const clone = new Date(date);
  const day = clone.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  clone.setDate(clone.getDate() + diff);
  clone.setHours(0, 0, 0, 0);
  return clone;
}

function toDate(value: string | undefined | null) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date;
}

function computeConflictIds(events: EventDto[]): Set<string> {
  const flagged = new Set<string>();
  const sorted = [...events].sort((a, b) => {
    const aStart = toDate(a.start)?.getTime() ?? 0;
    const bStart = toDate(b.start)?.getTime() ?? 0;
    return aStart - bStart;
  });
  for (let i = 0; i < sorted.length; i += 1) {
    const current = sorted[i];
    const currentStart = toDate(current.start);
    const currentEnd = toDate(current.end);
    if (!currentStart || !currentEnd) {
      continue;
    }
    for (let j = i + 1; j < sorted.length; j += 1) {
      const other = sorted[j];
      const otherStart = toDate(other.start);
      const otherEnd = toDate(other.end);
      if (!otherStart || !otherEnd) {
        continue;
      }
      if (otherStart >= currentEnd) {
        break;
      }
      if (currentStart < otherEnd && otherStart < currentEnd) {
        const shared = new Set(current.assigneeIds || []);
        const overlap = (other.assigneeIds || []).some((id) => shared.has(id));
        if (overlap) {
          flagged.add(current.id);
          flagged.add(other.id);
        }
      }
    }
  }
  return flagged;
}

function mapEvents(events: EventDto[] | undefined, fallback: DisplayEvent[]): DisplayEvent[] {
  if (!events || events.length === 0) {
    return fallback;
  }
  const conflicts = computeConflictIds(events);
  return events.map((event) => ({
    id: event.id,
    title: event.title,
    start: event.start,
    end: event.end,
    assignees: event.assigneeIds?.length ? event.assigneeIds : ['未指派'],
    conflict: conflicts.has(event.id),
    source: event
  }));
}

export function CalendarSurface({
  mode = 'admin',
  onOpenCandidateDrawer,
  onCreateEvent,
  onEditEvent
}: CalendarSurfaceProps) {
  const { activeOrgId } = useOrganizationStore();
  const [view, setView] = useState('week');
  const [zoom, setZoom] = useState(30);
  const rangeStart = startOfWeek(new Date());
  const rangeEnd = new Date(rangeStart);
  rangeEnd.setDate(rangeEnd.getDate() + 7);
  const eventsQuery = useEventsQuery({
    organizationId: activeOrgId,
    start: rangeStart.toISOString(),
    end: rangeEnd.toISOString()
  });

  const events = useMemo(
    () => mapEvents(eventsQuery.data, fallbackEvents),
    [eventsQuery.data]
  );

  const defaultCreateRange = useMemo(() => {
    const start = new Date(rangeStart);
    start.setHours(9, 0, 0, 0);
    const end = new Date(start);
    end.setMinutes(end.getMinutes() + zoom);
    return { start: start.toISOString(), end: end.toISOString() };
  }, [rangeStart, zoom]);

  return (
    <div className="flex h-full flex-col rounded-xl border border-slate-800 bg-slate-900/40">
      <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
        <div className="flex items-center gap-3 text-sm text-slate-300">
          <span className="rounded-full bg-brand.surface px-3 py-1 text-xs uppercase tracking-widest text-brand">
            {viewModes.find((v) => v.id === view)?.label}
          </span>
          <span>组织：{activeOrgId ?? '演示'}</span>
          <span>模式：{mode === 'admin' ? '管理员协同' : '个人日历'}</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-400">
          <label className="flex items-center gap-2">
            <span>时间缩放</span>
            <input
              type="range"
              min={15}
              max={60}
              step={5}
              value={zoom}
              onChange={(event) => setZoom(Number(event.target.value))}
            />
            <span>{zoom} 分钟</span>
          </label>
          <div className="flex items-center gap-2">
            {viewModes.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setView(item.id)}
                className={clsx(
                  'rounded-md px-3 py-1 text-xs font-medium transition',
                  view === item.id ? 'bg-brand text-slate-950' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3 text-xs">
        <div className="text-slate-400">
          {eventsQuery.isFetching ? '刷新中…' : `范围：${rangeStart.toLocaleDateString()} – ${rangeEnd.toLocaleDateString()}`}
        </div>
        <div className="flex items-center gap-2">
          {eventsQuery.isError ? (
            <span className="text-rose-300">事件加载失败，展示演示数据</span>
          ) : null}
          <button
            type="button"
            className="rounded-md border border-slate-700 px-3 py-1 text-xs text-slate-300 transition hover:bg-slate-800"
            onClick={() => eventsQuery.refetch()}
          >
            刷新
          </button>
          <button
            type="button"
            className="rounded-md border border-slate-700 px-3 py-1 text-xs text-slate-300 transition hover:bg-slate-800"
            onClick={() => onOpenCandidateDrawer?.()}
          >
            候选方案
          </button>
          <button
            type="button"
            onClick={() => onCreateEvent?.(defaultCreateRange)}
            className="rounded-md bg-brand px-3 py-1 text-xs font-semibold text-slate-950 shadow-sm hover:bg-sky-400"
          >
            划块创建
          </button>
        </div>
      </div>
      <div className="grid flex-1 grid-cols-1 gap-4 p-4 lg:grid-cols-2">
        <section className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900/50 p-4">
          <header className="flex items-center justify-between text-sm text-slate-400">
            <span>可视化日历</span>
            <span>{eventsQuery.isLoading ? '加载中…' : eventsQuery.isError ? '演示数据' : '实时数据'}</span>
          </header>
          <ul className="space-y-2 text-sm">
            {events.map((event) => (
              <li key={event.id}>
                <button
                  type="button"
                  data-testid="calendar-event"
                  onClick={() => (event.source ? onEditEvent?.(event.source) : undefined)}
                  disabled={!event.source}
                  className={clsx(
                    'flex w-full items-center justify-between rounded-md border px-3 py-2 text-left transition',
                    event.conflict
                      ? 'border-rose-500/60 bg-rose-950/40 text-rose-100 hover:border-rose-300'
                      : 'border-slate-700 bg-slate-900/60 text-slate-200 hover:border-slate-500',
                    !event.source ? 'cursor-default opacity-80' : 'cursor-pointer'
                  )}
                >
                  <div>
                    <p className="font-semibold">{event.title}</p>
                    <p className="text-xs text-slate-400">
                      {new Date(event.start).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                      {' – '}
                      {new Date(event.end).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    {event.assignees.map((name) => (
                      <span key={`${event.id}-${name}`} className="rounded-full bg-brand.surface px-2 py-1 text-slate-200">
                        {name}
                      </span>
                    ))}
                    {event.conflict ? (
                      <span className="text-rose-300" data-testid="event-conflict">
                        冲突
                      </span>
                    ) : null}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </section>
        <section className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900/50 p-4">
          <header className="flex items-center justify-between text-sm text-slate-400">
            <span>冲突 & 可行窗口</span>
            <span>{eventsQuery.isError ? '演示数据' : '自动计算'}</span>
          </header>
          <div className="space-y-3 text-xs text-slate-300">
            <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3">
              <p className="font-semibold text-amber-200">当前周窗口</p>
              <p>{`渲染 ${events.length} 条事件 · 显示模式 ${viewModes.find((v) => v.id === view)?.label}`}</p>
            </div>
            <div className="rounded-md border border-emerald-500/60 bg-emerald-500/10 p-3">
              <p className="font-semibold text-emerald-200">冲突统计</p>
              <p>
                {events.filter((item) => item.conflict).length > 0
                  ? `检测到 ${events.filter((item) => item.conflict).length} 条冲突事件`
                  : '当前无冲突'}
              </p>
            </div>
            <div className="rounded-md border border-slate-700 bg-slate-900/60 p-3 text-slate-300">
              <p>提示：冲突计算基于事件重叠与负责人交集，实际发布前仍需结合队列与排班候选进行最终确认。</p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
