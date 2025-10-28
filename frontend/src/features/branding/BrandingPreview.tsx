import { useOrganizationStore } from '../../state/organization-store';

interface BrandingPreviewProps {
  showDirectory?: boolean;
}

const template = {
  subject: '【{organization}】班表更新提醒',
  body: '您好，{name}：您在 {date} 有新的排班调整，请登录 Sheduler 查看详情。'
};

export function BrandingPreview({ showDirectory = false }: BrandingPreviewProps) {
  const { organizations, activeOrgId } = useOrganizationStore();
  const active = organizations.find((item) => item.id === activeOrgId) ?? organizations[0];

  if (!active) {
    return null;
  }

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-slate-800 bg-slate-900/50 p-5">
      <header className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-white">品牌主题预览</h3>
          <p className="text-xs text-slate-400">Logo、品牌色、通知模板一处调试</p>
        </div>
        <div
          className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold text-slate-900"
          style={{ backgroundColor: active.color }}
        >
          {active.name.slice(0, 1)}
        </div>
      </header>
      <article className="rounded-lg border border-slate-800 bg-slate-900/80 p-4 text-sm text-slate-200">
        <h4 className="text-base font-semibold text-white">通知模板</h4>
        <p className="mt-2 text-xs text-slate-400">主题</p>
        <p className="text-sm">{template.subject.replace('{organization}', active.name)}</p>
        <p className="mt-3 text-xs text-slate-400">正文</p>
        <p className="whitespace-pre-line text-sm">
          {template.body
            .replace('{organization}', active.name)
            .replace('{name}', '王老师')
            .replace('{date}', '4 月 8 日 (周一)')}
        </p>
      </article>
      {showDirectory ? (
        <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-4 text-xs text-slate-300">
          <p className="text-sm font-semibold text-white">组织目录</p>
          <ul className="mt-2 space-y-1">
            {organizations.map((org) => (
              <li key={org.id} className="flex items-center justify-between">
                <span>{org.name}</span>
                <span className="text-slate-500">{org.timezone}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
