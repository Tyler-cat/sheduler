import { expect, test } from '@playwright/test';

test.describe('管理员排班工作台', () => {
  test('支持新建/编辑事件并展示冲突与队列状态', async ({ page }) => {
    const organizations = [
      { id: 'org-1', name: '星火教育集团' },
      { id: 'org-2', name: '晨曦零售总部' }
    ];

    let events = [
      {
        id: 'evt-1',
        organizationId: 'org-1',
        title: '晨会准备',
        start: '2024-04-08T09:00:00+08:00',
        end: '2024-04-08T10:00:00+08:00',
        assigneeIds: ['zhangsan']
      },
      {
        id: 'evt-2',
        organizationId: 'org-1',
        title: '客户拜访',
        start: '2024-04-08T09:30:00+08:00',
        end: '2024-04-08T11:00:00+08:00',
        assigneeIds: ['zhangsan']
      },
      {
        id: 'evt-3',
        organizationId: 'org-1',
        title: 'AI 解析复核',
        start: '2024-04-08T14:00:00+08:00',
        end: '2024-04-08T15:30:00+08:00',
        assigneeIds: ['lili']
      }
    ];
    let nextEventId = 4;

    const queueJobs = [
      {
        id: 'job-1',
        organizationId: 'org-1',
        type: 'scheduling.generate',
        status: 'RUNNING',
        queuedAt: '2024-04-08T08:00:00+08:00',
        startedAt: '2024-04-08T08:05:00+08:00'
      },
      {
        id: 'job-2',
        organizationId: 'org-1',
        type: 'ai.parse',
        status: 'FAILED',
        queuedAt: '2024-04-08T07:55:00+08:00',
        updatedAt: '2024-04-08T08:10:00+08:00',
        lastError: '凭据失效'
      }
    ];

    const suggestions = [
      {
        id: 'sug-1',
        organizationId: 'org-1',
        solver: 'optaplanner',
        status: 'READY',
        scoreBreakdown: {
          feasibleWindows: 2,
          windowCoverageMinutes: 90,
          requestedDurationMinutes: 100
        },
        outputPlan: {
          selectedWindow: {
            start: '2024-04-08T16:00:00+08:00',
            end: '2024-04-08T17:30:00+08:00',
            durationMinutes: 90
          },
          events: [
            {
              title: '班表候选',
              start: '2024-04-08T16:00:00+08:00',
              end: '2024-04-08T17:30:00+08:00',
              assigneeIds: ['wangwu']
            }
          ]
        }
      }
    ];

    await page.route('**/api/organizations?mine=true', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ organizations })
      });
    });

    await page.route('**/api/events*', async (route) => {
      const request = route.request();
      const method = request.method();
      const url = new URL(request.url());

      if (method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ events })
        });
        return;
      }

      if (method === 'POST') {
        const payload = request.postDataJSON() as {
          organizationId: string;
          title: string;
          start: string;
          end: string;
          assigneeIds?: string[];
        };
        const created = {
          id: `evt-${nextEventId}`,
          organizationId: payload.organizationId,
          title: payload.title,
          start: payload.start,
          end: payload.end,
          assigneeIds: payload.assigneeIds ?? []
        };
        nextEventId += 1;
        events = [...events, created];
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ event: created })
        });
        return;
      }

      if (method === 'PATCH') {
        const id = url.pathname.split('/').pop() ?? '';
        const payload = request.postDataJSON() as Partial<{
          title: string;
          start: string;
          end: string;
          assigneeIds: string[];
        }>;
        events = events.map((event) =>
          event.id === id
            ? {
                ...event,
                ...payload,
                assigneeIds: payload.assigneeIds ?? event.assigneeIds
              }
            : event
        );
        const updated = events.find((event) => event.id === id);
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ event: updated })
        });
        return;
      }

      await route.fulfill({ status: 204 });
    });

    await page.route('**/api/queue/jobs*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ jobs: queueJobs })
      });
    });

    await page.route('**/api/scheduling/suggestions*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ suggestions })
      });
    });

    await page.goto('/');

    await expect(page.getByText('组织：org-1')).toBeVisible();
    await expect(page.getByTestId('calendar-event').filter({ hasText: '晨会准备' })).toBeVisible();
    await expect(page.getByTestId('event-conflict')).toHaveCount(1);
    await expect(page.getByTestId('queue-job')).toHaveCount(queueJobs.length);

    await page.getByRole('button', { name: '划块创建' }).click();
    await expect(page.getByTestId('event-editor')).toBeVisible();

    await page.getByLabel('事件名称').fill('新品发布会');
    await page.getByLabel('开始时间').fill('2024-04-08T16:00');
    await page.getByLabel('结束时间').fill('2024-04-08T17:00');
    await page.getByLabel('负责人（可选，逗号分隔）').fill('王老师, 李老师');
    await page.getByRole('button', { name: '保存' }).click();

    await expect(page.getByTestId('event-editor')).toBeHidden();
    await expect(page.getByTestId('calendar-event').filter({ hasText: '新品发布会' })).toBeVisible();

    await page.getByTestId('calendar-event').filter({ hasText: 'AI 解析复核' }).click();
    await expect(page.getByTestId('event-editor')).toBeVisible();
    await page.getByLabel('事件名称').fill('AI 解析复核（更新）');
    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.getByTestId('event-editor')).toBeHidden();
    await expect(page.getByTestId('calendar-event').filter({ hasText: 'AI 解析复核（更新）' })).toBeVisible();

    await page.getByRole('button', { name: '候选方案' }).click();
    await expect(page.getByTestId('candidate-item')).toHaveCount(1);
    await page.getByRole('button', { name: '关闭' }).click();
  });
});
