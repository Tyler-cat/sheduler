import { useMemo } from 'react';

interface SummaryCardsProps {
  scope: 'global' | 'org';
}

export function SummaryCards({ scope }: SummaryCardsProps) {
  const stats = useMemo(
    () => [
      { title: '解析成功率', value: '97.4%', trend: '+1.2%', tone: 'emerald' },
      { title: '排班耗时 P95', value: '24s', trend: '-3s', tone: 'sky' },
      { title: '队列积压', value: '12', trend: '-5', tone: 'amber' },
      { title: '外部同步失败', value: '1', trend: '-2', tone: 'rose' }
    ],
    []
  );

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {stats.map((item) => (
        <div key={item.title} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 shadow-sm">
          <p className="text-xs uppercase tracking-widest text-slate-400">{scope === 'global' ? '全局' : '组织'}</p>
          <h4 className="mt-2 text-sm text-slate-300">{item.title}</h4>
          <p className="mt-3 text-2xl font-semibold text-white">{item.value}</p>
          <p className="text-xs text-slate-400">较昨日 {item.trend}</p>
        </div>
      ))}
    </div>
  );
}
