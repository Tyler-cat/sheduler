import { Fragment, useEffect, useMemo, useState } from 'react';
import { Transition } from '@headlessui/react';
import { clsx } from 'clsx';
import { ApiError } from '../../api/client';
import { useCreateEventMutation, useUpdateEventMutation } from '../../api/hooks';
import type { EventCreateInput } from '../../api/types';

export interface EventEditorDraft {
  id?: string;
  organizationId: string;
  title: string;
  start: string;
  end: string;
  assigneeIds: string[];
}

export interface EventEditorDrawerProps {
  open: boolean;
  mode: 'create' | 'edit';
  draft: EventEditorDraft | null;
  onClose: () => void;
}

function toLocalInput(value: string | undefined) {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return '';
  }
  const tzOffset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - tzOffset * 60_000);
  return local.toISOString().slice(0, 16);
}

function fromLocalInput(value: string | undefined) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return null;
  }
  return date.toISOString();
}

export function EventEditorDrawer({ open, mode, draft, onClose }: EventEditorDrawerProps) {
  const [title, setTitle] = useState('');
  const [startValue, setStartValue] = useState('');
  const [endValue, setEndValue] = useState('');
  const [assigneeText, setAssigneeText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const createMutation = useCreateEventMutation();
  const updateMutation = useUpdateEventMutation();

  const isEditMode = mode === 'edit' && Boolean(draft?.id);
  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  useEffect(() => {
    if (!open) {
      return;
    }
    setTitle(draft?.title ?? '');
    setStartValue(toLocalInput(draft?.start));
    setEndValue(toLocalInput(draft?.end));
    setAssigneeText((draft?.assigneeIds ?? []).join(', '));
    setError(null);
  }, [open, draft?.title, draft?.start, draft?.end, draft?.assigneeIds]);

  const heading = isEditMode ? '编辑事件' : '新建事件';

  const canSubmit = useMemo(() => {
    return Boolean(
      draft?.organizationId &&
        title.trim().length > 0 &&
        fromLocalInput(startValue) &&
        fromLocalInput(endValue) &&
        !isSubmitting
    );
  }, [draft?.organizationId, title, startValue, endValue, isSubmitting]);

  const helperText = isEditMode
    ? '修改事件后会实时更新排班冲突提示，并写入审计日志。'
    : '填写基本信息并保存，队列与冲突视图会自动刷新。';

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft?.organizationId) {
      setError('缺少组织信息，无法保存事件。');
      return;
    }
    const startIso = fromLocalInput(startValue);
    const endIso = fromLocalInput(endValue);
    if (!startIso || !endIso) {
      setError('请填写有效的开始与结束时间。');
      return;
    }
    const assigneeIds = assigneeText
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);

    const basePayload: EventCreateInput = {
      organizationId: draft.organizationId,
      title: title.trim(),
      start: startIso,
      end: endIso,
      assigneeIds
    };
    try {
      if (isEditMode && draft?.id) {
        await updateMutation.mutateAsync({
          id: draft.id,
          data: {
            title: basePayload.title,
            start: basePayload.start,
            end: basePayload.end,
            assigneeIds: basePayload.assigneeIds
          }
        });
      } else {
        await createMutation.mutateAsync(basePayload);
      }
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message || '保存失败，请稍后重试');
      } else {
        setError('保存失败，请稍后重试');
      }
    }
  }

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
          <section
            className="flex h-full w-full max-w-xl flex-col border-l border-slate-800 bg-slate-900/95 p-6 text-slate-100 shadow-2xl"
            data-testid="event-editor"
          >
            <header className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div>
                <p className="text-xs uppercase tracking-widest text-slate-400">事件编辑</p>
                <h3 className="text-lg font-semibold text-white">{heading}</h3>
                <p className="mt-1 text-xs text-slate-400">{helperText}</p>
              </div>
              <button
                type="button"
                className="rounded-md border border-slate-700 px-3 py-1 text-sm text-slate-300 transition hover:bg-slate-800"
                onClick={onClose}
              >
                关闭
              </button>
            </header>
            <form className="mt-6 flex-1 space-y-5 overflow-y-auto pr-2 text-sm" onSubmit={handleSubmit}>
              <label className="flex flex-col gap-2 text-slate-300">
                <span className="text-xs uppercase tracking-widest text-slate-400">事件名称</span>
                <input
                  name="title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="例如：新品发布准备会"
                  className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
                  required
                />
              </label>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="flex flex-col gap-2 text-slate-300">
                  <span className="text-xs uppercase tracking-widest text-slate-400">开始时间</span>
                  <input
                    type="datetime-local"
                    name="start"
                    value={startValue}
                    onChange={(event) => setStartValue(event.target.value)}
                    className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
                    required
                  />
                </label>
                <label className="flex flex-col gap-2 text-slate-300">
                  <span className="text-xs uppercase tracking-widest text-slate-400">结束时间</span>
                  <input
                    type="datetime-local"
                    name="end"
                    value={endValue}
                    onChange={(event) => setEndValue(event.target.value)}
                    className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
                    required
                  />
                </label>
              </div>
              <label className="flex flex-col gap-2 text-slate-300">
                <span className="text-xs uppercase tracking-widest text-slate-400">负责人（可选，逗号分隔）</span>
                <input
                  name="assignees"
                  value={assigneeText}
                  onChange={(event) => setAssigneeText(event.target.value)}
                  placeholder="如：王老师, 李老师"
                  className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
                />
              </label>
              {error ? (
                <div className="rounded-md border border-rose-500/60 bg-rose-500/10 p-3 text-xs text-rose-200" role="alert">
                  {error}
                </div>
              ) : null}
              <div className="flex items-center justify-end gap-3 pt-4">
                <button
                  type="button"
                  className="rounded-md border border-slate-700 px-4 py-2 text-xs text-slate-300 transition hover:bg-slate-800"
                  onClick={onClose}
                >
                  取消
                </button>
                <button
                  type="submit"
                  className={clsx(
                    'rounded-md px-4 py-2 text-xs font-semibold shadow transition',
                    canSubmit ? 'bg-brand text-slate-950 hover:bg-sky-400' : 'cursor-not-allowed bg-slate-800 text-slate-500'
                  )}
                  disabled={!canSubmit}
                >
                  保存
                </button>
              </div>
            </form>
          </section>
        </Transition.Child>
      </div>
    </Transition>
  );
}
