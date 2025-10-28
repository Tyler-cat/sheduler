import { Fragment, useMemo } from 'react';
import { Transition } from '@headlessui/react';
import { clsx } from 'clsx';
import type { SchedulingSuggestionDto } from '../../api/types';

export interface CandidateDrawerProps {
  open: boolean;
  suggestions: SchedulingSuggestionDto[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
  isLoading?: boolean;
  isError?: boolean;
  onRefresh?: () => void;
}

function computeCoverage(suggestion: SchedulingSuggestionDto) {
  const requested = suggestion.scoreBreakdown?.requestedDurationMinutes;
  const actual = suggestion.scoreBreakdown?.windowCoverageMinutes;
  if (!requested || !actual || requested <= 0) {
    return null;
  }
  return Math.min(100, Math.round((actual / requested) * 100));
}

function formatWindow(suggestion: SchedulingSuggestionDto) {
  const window = suggestion.outputPlan?.selectedWindow;
  if (!window) {
    return '尚未选择窗口';
  }
  const start = window.start ? new Date(window.start) : null;
  const end = window.end ? new Date(window.end) : null;
  const duration = window.durationMinutes ?? suggestion.scoreBreakdown?.requestedDurationMinutes;
  const label = [
    start ? start.toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : null,
    end ? end.toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : null
  ]
    .filter(Boolean)
    .join(' – ');
  return label ? `${label} · ${duration ?? '?'} 分钟` : `${duration ?? '?'} 分钟`;
}

export function CandidateDrawer({
  open,
  suggestions,
  selectedId,
  onSelect,
  onClose,
  isLoading = false,
  isError = false,
  onRefresh
}: CandidateDrawerProps) {
  const items = suggestions ?? [];
  const activeId = useMemo(() => {
    if (selectedId && items.some((item) => item.id === selectedId)) {
      return selectedId;
    }
    return items[0]?.id ?? null;
  }, [items, selectedId]);

  return (
    <Transition show={open} as={Fragment}>
      <div className="fixed inset-0 z-40 flex justify-end bg-slate-950/40 backdrop-blur-sm">
        <Transition.Child
          as={Fragment}
          enter="transition-transform duration-200 ease-out"
          enterFrom="translate-x-full opacity-0"
          enterTo="translate-x-0 opacity-100"
          leave="transition-transform duration-150 ease-in"
          leaveFrom="translate-x-0 opacity-100"
          leaveTo="translate-x-full opacity-0"
        >
          <section className="flex h-full w-full max-w-xl flex-col border-l border-slate-800 bg-slate-900/95 p-6 text-slate-100 shadow-2xl">
            <header className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div>
                <p className="text-xs uppercase tracking-widest text-slate-400">候选排班</p>
                <h3 className="text-lg font-semibold text-white">自动求解建议</h3>
                <p className="mt-1 text-xs text-slate-400">
                  {isLoading
                    ? '正在加载求解结果…'
                    : isError
                    ? '求解结果加载失败，保留最近缓存'
                    : `${items.length} 条候选方案`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="rounded-md border border-slate-700 px-3 py-1 text-xs text-slate-300 transition hover:bg-slate-800"
                  onClick={() => onRefresh?.()}
                >
                  刷新
                </button>
                <button
                  type="button"
                  className="rounded-md border border-slate-700 px-3 py-1 text-sm text-slate-300 transition hover:bg-slate-800"
                  onClick={onClose}
                >
                  关闭
                </button>
              </div>
            </header>
            <div className="mt-6 flex-1 space-y-4 overflow-y-auto pr-2 text-sm">
              {items.length === 0 ? (
                <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-6 text-center text-xs text-slate-400">
                  <p>暂未生成候选方案，可在日历中划块创建或检查队列状态。</p>
                </div>
              ) : null}
              {items.map((candidate) => {
                const coverage = computeCoverage(candidate);
                const feasible = candidate.scoreBreakdown?.feasibleWindows ?? 0;
                const status = candidate.status;
                const isActive = candidate.id === activeId;
                return (
                  <article
                    key={candidate.id}
                    className={clsx(
                      'rounded-lg border border-slate-700/80 bg-slate-900/60 p-4 shadow-sm transition',
                      isActive ? 'ring-2 ring-sky-400' : 'hover:border-slate-500'
                    )}
                    onClick={() => onSelect(candidate.id)}
                    role="presentation"
                  >
                    <div className="flex items-center justify-between">
                      <h4 className="text-base font-semibold text-white">{candidate.outputPlan?.events?.[0]?.title ?? '候选方案'}</h4>
                      <span
                        className={clsx(
                          'text-xs uppercase tracking-widest',
                          status === 'READY'
                            ? 'text-emerald-300'
                            : status === 'FAILED'
                            ? 'text-rose-300'
                            : 'text-slate-400'
                        )}
                      >
                        {status}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-slate-300">
                      可行窗口 {feasible} 个
                      {coverage !== null ? ` · 覆盖度 ${coverage}%` : ''}
                    </p>
                    <p className="mt-2 text-xs text-slate-400">{formatWindow(candidate)}</p>
                    {candidate.errors && candidate.errors.length ? (
                      <p className="mt-3 text-xs text-rose-300">{candidate.errors[0]}</p>
                    ) : null}
                    <div className="mt-4 flex items-center gap-3">
                      <button
                        type="button"
                        className={clsx(
                          'rounded-md px-3 py-1 text-xs font-semibold shadow',
                          status === 'READY'
                            ? 'bg-brand text-slate-950 hover:bg-sky-400'
                            : 'cursor-not-allowed bg-slate-800 text-slate-500'
                        )}
                        disabled={status !== 'READY'}
                      >
                        接受方案
                      </button>
                      <button
                        type="button"
                        className="rounded-md border border-slate-700 px-3 py-1 text-xs text-slate-300"
                      >
                        查看详情
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
            <footer className="border-t border-slate-800 pt-4 text-xs text-slate-400">
              <p>提示：所有候选方案均记录在 `SchedulingSuggestion` 表，审批结果会写入审计日志。</p>
            </footer>
          </section>
        </Transition.Child>
      </div>
    </Transition>
  );
}
