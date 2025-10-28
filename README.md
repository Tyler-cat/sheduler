# sheduler

- [# CODES：下一 Sprint 执行底稿](docs/CODES.md)
- [高级班排程系统可行性评审与实施蓝图](docs/feasibility_and_plan.md)

## Packages

| Package   | Description |
|-----------|-------------|
| `backend` | Minimal HTTP service skeleton with role/organization guard utilities, health probe, organization management, and event scheduling APIs. |
| `ai-service` | FastAPI microservice that orchestrates timetable parsing jobs across multiple LLM providers. |

## Getting Started

```bash
npm install
npm run lint
npm test
# AI service tests
python -m venv .venv
source .venv/bin/activate
pip install -e ./ai-service[dev]
pytest ai-service
```

The backend now covers the first three implementation stages from the 实施蓝图：

- Session-based role/organization checks (`requireAuth`, `requireRole`, `injectOrgScope`).
- Health probe server stub for subsequent Express/BFF layering.
- In-memory organization management APIs (create organization, assign admins, create groups) protected by role and scope checks.
- In-memory event scheduling APIs with optimistic locking, basic conflict detection, and scope-aware REST routes.
- Node built-in test suite covering the guards, health endpoint, organization service, event service, and REST API flows.

Stage four introduces the AI parsing service:

- FastAPI-based parse job workflow with asynchronous execution and review endpoints.
- Provider router pre-wired for OpenAI, OpenRouter, and Qwen stub clients to demonstrate multi-source orchestration.
- pytest suite validating job submission, background completion, review handling, and organization filtering.

Stage five brings collaborative plumbing and stage six unlocks scheduling intelligence:

- In-memory event bus with sequencing/history for forthcoming Socket.IO rooms and external sync bridges.
- Aggregated availability windows derived from existing events and cached external calendars.
- Asynchronous scheduling suggestions that surface candidate shifts, expose readiness via REST, and commit accepted plans back into the event store.

Stage seven enables LLM-driven tooling automation:

- Notification service used to alert organization administrators when tool calls request assistance.
- `/api/tools/execute` endpoint processes `notify_admin` and `update_personal_schedule` actions with scope-aware validation.
- Additional node:test coverage validating service orchestration and REST flows for tool execution.

Stage eight adds observability and compliance guardrails:

- `/metrics` endpoint surfaces Prometheus-compatible counters for HTTP traffic, scheduling jobs, tool calls, and event lifecycle activity.
- `/api/audit` exposes masked audit logs to super administrators (or scoped admins) while the backend records entries for organization, scheduling, and tool workflows.
- New test suites exercise the audit/metrics services alongside end-to-end assertions for the telemetry routes.

Stage nine tightens multi-provider LLM governance:

- Provider router tracks rolling quotas, organization allow/deny lists, concurrency limits, and a simple circuit breaker so OpenAI/OpenRouter/Qwen usage can be throttled per blueprint requirements.
- Parse jobs now pass organization scope into the router ensuring quota and rollout decisions are enforced per request.
- pytest coverage validates quota exhaustion, rollout blocking, concurrency guards, and recovery from circuit-breaker cool downs.

Stage ten unlocks brand customization workflows:

- Organization branding APIs expose `/api/organizations/:id/branding` so scoped users can read theme tokens while admins update logo URLs, palette colors, and notification templates.
- Branding service validations ensure safe defaults, color/URL guards, and metadata tracking for audit logging.
- New node:test suites cover the branding service and REST integration, keeping the blueprint aligned with stage ten deliverables.

Stage eleven enriches recurrence planning:

- Recurrence service stores ICS-style rules, exclusion dates, and generates preview occurrences for the calendar.
- `/api/events/:id/recurrence` routes let scoped members review rules while administrators manage them with auditing and metrics in place.
- Additional unit and API coverage protects rule validation, expansion, and permission enforcement.

Stage twelve unlocks availability cache governance:

- `/api/availability/cache` endpoints let administrators upsert, inspect, and clear cached busy windows for external calendars.
- Availability service exposes helpers to list cache records per organization, enabling scoped lookups for downstream tooling.
- Metrics and audit hooks trace cache mutations while expanded tests validate service logic and REST authorization.

Stage thirteen wires queue orchestration and governance:

- Queue service tracks job lifecycle, deduplication, metrics, and audit events for scheduling, parsing, and sync workflows.
- `/api/queue/jobs` endpoints let administrators enqueue, review, cancel, and retry scoped jobs while respecting role-based access.
- Scheduling suggestions now emit queue jobs for visibility, with unit/API coverage confirming queue transitions and admin controls.

Stage fourteen introduces a scoped notification center:

- Notification service now tracks read receipts per recipient, exposing `/api/notifications` for organization administrators and end users.
- Administrators can broadcast scoped alerts while staff acknowledge them, with audit trails and Prometheus counters covering creation and reads.
- Automated tests protect the broadcast, listing, and acknowledgement flows to keep tooling automation aligned with blueprint targets.

Stage fifteen connects the AI parsing loop to the backend orchestration:

- `/api/ai/parse-jobs` endpoints let administrators submit, inspect, and review timetable parsing runs while scoped users fetch job status.
- Automatic tool execution fires for low-risk tool calls, updating personal schedules via the existing `ToolService` and recording audit/metrics data.
- Approval-required tool calls raise organization notifications, and new test suites cover the service logic plus REST integration end to end.

Stage sixteen introduces external calendar connectors:

- External calendar service tracks provider links, cached calendar catalogs, and sync history per organization while enforcing unique provider accounts.
- `/api/external-calendars` routes let administrators create connections, inspect scoped details, trigger sync jobs, and remove integrations with full audit/metrics hooks.
- Queue-backed sync requests reuse the governance pipeline so manual refreshes surface as jobs and update availability ingestion flows.

Stage seventeen enables realtime event streaming over SSE:

- `/api/events/stream` exposes organization-scoped Server-Sent Events that replay history (via `Last-Event-ID`) and push new event bus updates with heartbeat keepalives.
- Metrics counters track stream lifecycle, delivered messages, and replay volume so observability aligns with the blueprint’s realtime governance goals.
- Automated tests confirm authentication, scope enforcement, live delivery, and historical replay semantics for the new stream endpoint.

Stage eighteen introduces database migration scaffolding:

- `backend/prisma/migrations/0001_init/` delivers the first Prisma migration pair, defining role enums plus user, organization, scheduling, availability, and audit tables with indexes for conflict lookups.
- `backend/prisma/migrations/0001_init/down.sql` captures the rollback path so CI can perform migrate → seed → rollback cycles per the blueprint acceptance criteria.
- `backend/package.json` now exposes `prisma:*` scripts with offline-friendly engine flags, enabling local or CI pipelines to run status/deploy/reset commands even when Prisma binaries cannot be downloaded automatically.
- Stage nineteen adds a migration verification harness (`npm run prisma:migrate:verify`) that replays every migration against an in-memory Postgres, registers the deterministic functions required by our SQL defaults, and confirms the rollback leaves a clean schema—mirroring the “迁移→回滚→验证” gate in `CODES.md`.

Stage twenty delivers Prisma-powered seeding baselines:

- `backend/prisma/seed.mjs` seeds super admin/admin/staff users, an example organization, scheduling data, and availability caches so migrate → seed flows have concrete fixtures.
- `npm run prisma:seed` executes the runner with offline engine flags, complementing the verification harness for CI smoke tests.
- New in-memory Prisma mock tests (`backend/test/prisma-seed.test.js`) ensure the seeder is idempotent and mirrors the domain relationships expected by subsequent Prisma repositories.

Stage twenty-one enforces PostgreSQL row-level security:

- `backend/prisma/migrations/0002_rls_policies/` installs the `app_org_ids()` helper and policies for events, scheduling suggestions, availability caches, and audit logs.
- `backend/scripts/validate-migrations.mjs` now replays migrations with PGlite so RLS statements participate in migrate → rollback verification.
- `backend/test/rls-policies.test.js` spins up an embedded Postgres instance to prove that queries return empty sets without `app.org_ids` while still surfacing global audit entries.

Stage twenty-two begins the Prisma-backed organization migration:

- `OrganizationService` exposes asynchronous APIs backed by swappable stores so HTTP routes and downstream services await scoped checks consistently.
- `backend/src/stores/prisma-organization-store.js` implements a Prisma-oriented repository with slug uniqueness, admin lookup, group validation, and branding updates aligned to the production schema.
- `backend/test/prisma-organization-store.test.js` verifies the repository behaviour with an in-memory Prisma stub while updated tool, branding, and AI flows await organization calls end to end.

Stage twenty-three extends event persistence toward Prisma integration:

- `EventService` now relies on asynchronous stores, retaining the in-memory adapter while adding a Prisma-backed implementation and dedicated tests covering filtering and conflict detection.
- Availability, scheduling, recurrence, and API layers all await event operations, ensuring the stack is ready for database-backed execution without race conditions.

Stage twenty-four migrates scheduling suggestions toward Prisma persistence:

- `backend/src/services/scheduling-service.js` promotes the scheduling lifecycle to async repositories, keeps the in-memory adapter for tests, and coordinates queue-driven processing while persisting updates through store interfaces.
- `backend/src/stores/prisma-scheduling-store.js` introduces the Prisma repository with JSON cloning helpers so suggestions, errors, and resulting events round-trip cleanly alongside the new `0003_scheduling_store` migration columns.
- `backend/test/prisma-scheduling-store.test.js` plus refreshed service/API suites cover create/list/update flows, and HTTP routes now await scheduling APIs for consistent async behaviour.

Stage twenty-five migrates availability caches toward Prisma persistence:

- `backend/src/stores/prisma-availability-store.js` adds a Prisma-backed repository that normalises busy entries, enforces scoped lookups, and keeps refreshed timestamps for ordering and auditing.
- `backend/src/services/availability-service.js` now supports asynchronous cache operations via pluggable stores while preserving the in-memory adapter for tests and fallbacks.
- New tests (`backend/test/prisma-availability-store.test.js`, updated availability API/unit suites) exercise create/update/list/delete flows and validate error propagation for the async paths.

Stage twenty-six introduces queue job persistence and async orchestration:

- `backend/prisma/migrations/0004_queue_jobs/` establishes the `QueueJob` table, indexes, and row-level security policies so queued workloads respect organization scopes.
- `backend/src/services/queue-service.js` now operates asynchronously over pluggable stores, updating metrics/audit trails while coordinating dedupe, retries, and backlog gauges through persistence.
- `backend/src/stores/prisma-queue-store.js` delivers the Prisma-backed implementation with accompanying mock support and tests (`backend/test/prisma-queue-store.test.js`) covering creation, dedupe lookups, scoped listings, and queued-count aggregation.

Stage twenty-seven migrates notifications to Prisma-backed persistence:

- `backend/prisma/migrations/0005_notifications/` adds `Notification` and `NotificationRecipient` tables with row-level security so scoped users only see organization-specific broadcasts.
- `backend/src/services/notification-service.js` now operates asynchronously over pluggable stores, keeping the in-memory adapter while introducing a Prisma-based repository in `backend/src/stores/prisma-notification-store.js`.
- Updated tests (`backend/test/prisma-notification-store.test.js`, API/service suites) verify creation, listing, and read-receipt flows across both in-memory and Prisma-backed paths.

Stage twenty-eight boots the frontend workspace and high-fidelity admin shell:

- `frontend/` introduces a Vite + React + TypeScript setup with TailwindCSS, TanStack Query, Zustand, and Headless UI to mirror the blueprint’s技术选型。
- `frontend/src/App.tsx` wires role-aware路由（超级管理员 / 管理员 / 员工），并通过 `AppShell`、`RoleSwitcher` 与 `OrganizationSwitcher` 还原“前端过滤”原则。
- Calendar、队列、候选排班抽屉与品牌主题预览组件提供高保真占位视图，为后续接入真实 BFF API、Playwright E2E 与冲突提示打下骨架。

Stage twenty-nine links the admin surface to live scheduling data:

- New React Query hooks (`frontend/src/api`) call `/api/organizations`, `/api/events`, `/api/queue/jobs`, and `/api/scheduling/suggestions` with graceful fallbacks when the BFF is offline.
- `CalendarSurface` now renders real events with overlap-based 冲突检测, refresh controls, and organization-aware ranges instead of 静态示例。
- `QueuePanel` 与 `CandidateDrawer` 读取实时队列和排班建议列表；后者依赖新增的 `GET /api/scheduling/suggestions` 路由展示可行窗口、覆盖度和错误提示。

Stage thirty introduces event editing and Playwright regression coverage:

- `EventEditorDrawer` 提供右侧抽屉，涵盖事件名称、时间、负责人等字段，并复用 React Query mutation 新建或更新事件后自动刷新日历与冲突状态。
- `CalendarSurface` 调整顶部按钮区，新增“候选方案”“划块创建”分离按钮，并允许点击事件行进入编辑模式；列表项、冲突提示与队列卡片都补充了 `data-testid` 以便 E2E 断言。
- `frontend/playwright.config.ts` 与 `frontend/tests/e2e/admin-workflow.spec.ts` 建立 Playwright 基线，模拟 API 响应覆盖“新建事件→冲突提示→候选抽屉→队列面板”核心路径，纳入下一阶段的 CI 回归。
