# CODES

> 下一 Sprint 执行底稿 —— 聚焦“文件级证据 + 渐进迁移”两大板块，帮助团队在已有内存原型的基础上完成持久化、前端与观测体系的闭环。

## 1. 文件级证据（现状盘点）

### 1.0 数据库迁移脚本
- `backend/prisma/migrations/0001_init/migration.sql`：手写首批 `up` 脚本，覆盖角色枚举、用户/组织/事件/排班/可用性/审计等全部表与索引；默认值遵循 Prisma schema，并附带 `pgcrypto` 扩展初始化。
- `backend/prisma/migrations/0001_init/down.sql`：提供对应回滚逻辑，确保 CI 可执行 “迁移 → 回滚” 验证。
- `backend/package.json`：新增 `prisma:*` 脚本，统一注入 `PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING` 环境变量，便于在离线环境执行 `generate / deploy / reset`。
- `backend/scripts/validate-migrations.mjs` + `npm run prisma:migrate:verify`：改用 `@electric-sql/pglite` 回放 SQL，原生支持 RLS 语句并逐条执行 `migration.sql`/`down.sql`，持续校验“迁移→回滚”链路。
- `backend/prisma/seed.mjs` + `npm run prisma:seed`：提供 Prisma 客户端种子脚本，生成超级管理员、示例组织、排班建议与可用性缓存，支撑“迁移→种子→回滚”流水线。
- `backend/test/prisma-seed.test.js` + `backend/test/helpers/mock-prisma.js`：使用内存 Prisma mock 校验种子脚本幂等性与数据关联。
- `backend/prisma/migrations/0002_rls_policies/`：新增 `app_org_ids()` 辅助函数及 Event / SchedulingSuggestion / AvailabilityCache / AuditLog 的 RLS 策略，`down.sql` 可一键撤销。
- `backend/prisma/migrations/0004_queue_jobs/`：创建 `QueueJob` 表、索引与 RLS 策略，支撑队列作业的持久化与组织域隔离。
- `backend/prisma/migrations/0005_notifications/`：新增 `Notification`、`NotificationRecipient` 表及 RLS 策略，保障组织广播与已读记录的数据库隔离。
- `backend/test/rls-policies.test.js`：依托 PGlite 嵌入式数据库验证“未设置 `app.org_ids` 返回空集 / 全局审计仍可见”的黑盒场景。

### 1.1 权限、组织域与会话
- `backend/src/middleware/auth.js`：提供 `requireAuth` / `requireRole` / `injectOrgScope` 中间件，支撑三权分立与组织范围注入的基座逻辑。
- `backend/src/services/organization-service.js`：以内存存储维护组织、管理员与小组映射，配合路由校验 slug 唯一性与越权访问。对应测试位于 `backend/test/api-organizations.test.js` 与 `backend/test/organization-service.test.js`。
- `backend/src/services/branding-service.js` + `backend/test/api-branding.test.js`：验证组织品牌主题更新流程（Logo、颜色、通知模板）以及管理员/员工权限分级。
- `backend/src/stores/prisma-organization-store.js` + `backend/test/prisma-organization-store.test.js`：抽象 Prisma 仓储的 slug 去重、管理员/分组校验与品牌更新能力，并推动 OrganizationService 全面异步化，便于路由、工具与品牌服务统一 `await` 组织域操作。

### 1.2 事件、复发与排班
- `backend/src/services/event-service.js`：实现事件 CRUD、冲突检测、乐观锁版本控制，并在 API 层 (`backend/src/app.js` 中 `/api/events` 路由) 复用，覆盖单元与端到端测试 `backend/test/event-service.test.js`、`backend/test/api-events.test.js`。
- `backend/src/services/recurrence-service.js`：解析 RRULE/EXDATE，支撑 `/api/events/:id/recurrence` 路由；测试覆盖在 `backend/test/recurrence-service.test.js` 与 `backend/test/api-recurrence.test.js`。
- `backend/src/services/availability-service.js` & `backend/src/services/scheduling-service.js`：负责聚合忙闲、求解候选班表、缓存治理、队列集成；测试位于 `backend/test/availability-service.test.js`、`backend/test/api-availability.test.js`、`backend/test/scheduling-service.test.js`。
- `backend/src/app.js`：新增 `GET /api/scheduling/suggestions`，允许管理员按组织拉取候选排班列表，对应回归位于 `backend/test/api-scheduling.test.js`。
- `backend/src/stores/prisma-event-store.js` + `backend/test/prisma-event-store.test.js`：提供 Prisma 事件仓储实现，校验冲突检测、区间过滤与 assignee 同步逻辑，为切换数据库持久化打好底座。
- `backend/src/stores/prisma-availability-store.js` + `backend/test/prisma-availability-store.test.js`：落地可用性缓存的 Prisma 仓储与测试，支持按组织/用户过滤、更新时间排序以及 Busy 段 JSON 正常化。

### 1.3 队列、实时流与外部集成
- `backend/src/services/queue-service.js` + `backend/test/api-queue.test.js`：提供作业排队、运行、失败重试与度量审计治理，现阶段用于调度、解析与外部同步。
- `backend/src/stores/prisma-queue-store.js` + `backend/test/prisma-queue-store.test.js`：实现 Prisma 队列仓储、dedupe 查找、分组计数与范围列表；QueueService 已异步化并透出 `InMemoryQueueStore` / Prisma 双适配。
- `backend/src/services/event-bus.js` 与 `/api/events/stream` SSE 路由（`backend/src/app.js` 第 430–580 行）：实现组织域内的实时推送与历史补发，对应测试 `backend/test/api-realtime.test.js`。
- `backend/src/services/external-calendar-service.js`：管理外部日历连接、同步记录与唯一性限制，覆盖测试 `backend/test/external-calendar-service.test.js`、`backend/test/api-external-calendars.test.js`。

### 1.4 AI 解析与工具调用
- `ai-service/app/providers.py`：封装 OpenAI、OpenRouter、Qwen Local 的配额/灰度/并发/熔断策略。
- `ai-service/app/service.py`：解析作业状态机、复核流程与工具触发；`ai-service/tests/test_service.py` 确认限流、审批、重试路径。
- `backend/src/services/ai-parse-job-service.js` + `backend/test/api-ai-parse-jobs.test.js`：BFF 侧接入解析作业、自动工具执行与审批提醒。
- `backend/src/services/tool-service.js`：实现 `notify_admin` 与 `update_personal_schedule` 工具，并在 `backend/test/api-tools.test.js` 覆盖审计、指标、通知联动。

### 1.5 审计、指标与通知
- `backend/src/services/audit-service.js`：记录带掩码的审计日志，与 `backend/test/audit-service.test.js` / `backend/test/api-observability.test.js` 配套。
- `backend/src/services/metrics-service.js` + `/metrics` 路由：提供 Prometheus 兼容指标输出，目前已统计 HTTP 请求、事件变更、队列作业、通知、外部同步、实时流等指标。
- `ai_parse_success_total`、`ai_parse_failure_total`、`ai_parse_needs_review_total`、`scheduling_duration_ms`、`queue_backlog_total`、`socket_broadcast_latency_ms`、`http_5xx_total`、`db_slow_queries_total`、`external_calendar_failures_total`、`session_concurrency_gauge` 等指标已在代码中落地，为后续 Grafana/告警配置提供数据源。
- `backend/src/services/notification-service.js`：支持多收件人广播、已读状态与审计记录，配套测试 `backend/test/notification-service.test.js` 与 `backend/test/api-notifications.test.js`。
- `backend/src/stores/prisma-notification-store.js` + `backend/test/prisma-notification-store.test.js`：提供 Prisma 通知仓储与测试，验证广播创建、组织/成员列表与已读回执更新。

### 1.6 文档、Schema 与测试骨架
- `docs/feasibility_and_plan.md`：保留完整可行性评审与阶段划分，可作为背景资料。
- `backend/prisma/schema.prisma`：定义用户、组织、事件、复发、排班建议、可用性缓存、通知、外部日历等表结构（尚未落地至运行时代码）。
- 自动化测试矩阵：`npm test`（Node 原生 `node:test`，含 RLS 黑盒用例）、`pytest ai-service`（FastAPI 解析服务），覆盖绝大多数服务接口逻辑。
- `docs/sql/README.md`、`dashboards/grafana-scheduler.json`、`infra/alerts/scheduler-rules.yaml`：沉淀 SQL 分析约定、Grafana Dashboard 示例与 PrometheusRule 告警策略，便于后续迁移阶段直接复用。
- `frontend/`：Vite + React + TS 工作区，包含 `AppShell`、`CalendarSurface`、`QueuePanel`、`CandidateDrawer`、`BrandingPreview` 等骨架组件，演示角色路由、组织过滤与候选排班抽屉交互。
- `frontend/src/api/{client,hooks,types}.ts`：封装 TanStack Query 与类型化 fetch，串联组织、事件、队列与排班建议 API，并在离线或 4xx 时回退至示例数据。
- `frontend/src/features/{calendar,queue,drawer}`：组件升级为实时数据视图，加入冲突检测、刷新按钮、候选方案状态徽章与错误提醒。

## 2. 渐进迁移（下一 Sprint 作战计划）

### 2.1 目标速览
1. **持久化落地**：把内存实现迁移到 Prisma/PostgreSQL，满足迁移回滚、RLS、行级审计要求。
2. **前端衔接**：交付最小可用的 React/Vite 前端，覆盖抽屉交互、冲突提示、队列可视化，并配套 Playwright E2E。
3. **观测与告警闭环**：补齐 8 个核心指标与 Grafana 告警策略，确保解析、排班、队列、实时流等链路可观测。

### 2.2 数据库与迁移治理
- **Prisma Migrate**：首批迁移已存放于 `backend/prisma/migrations/0001_init/`，涵盖 `up/down` SQL；后续模型调整继续沿用“先生成 `migration.sql` + 手写 `down.sql`”的策略。
- **CI 数据验证**：新增脚本执行 “`prisma migrate deploy` → `npm run seed` → `prisma migrate resolve --rolled-back` → 功能回归” 流水；在 GitHub Actions 中固定运行。
- **关键查询评估**：对事件冲突检测、可用性聚合、排班建议、审计查询等 SQL 生成 `EXPLAIN (ANALYZE, BUFFERS)` 报告，存档于 `docs/sql/`。
- **数据脱敏**：在 `AuditLog` 迁移中引入透明加密/掩码字段（可用 PostgreSQL `pgcrypto` 或应用层加密），确保敏感信息合规存储。

### 2.3 RLS 与多层防护
- **策略实现**：为 `Event`、`SchedulingSuggestion`、`AvailabilityCache`、`Notification` 等表编写 `CREATE POLICY`；BFF 在连接池初始化时执行 `SET app.org_ids`。
- **回归测试**：新增黑盒测试用例（Node 层），验证 “未设置 `app.org_ids` 返回空集” 与 “跨组织访问 403 + 无数据库结果”。（已交付：`backend/test/rls-policies.test.js`）
- **前端过滤校验**：在前端组织切换器、负责人下拉中仅呈现授权域；Playwright 用例覆盖越权隐藏。

### 2.4 服务层渐进迁移
- **Repository 抽象**：逐步用 Prisma 替换内存服务。建议顺序：组织 → 事件 → 排班建议 → 可用性缓存 → 通知/队列记录 → 外部日历。
- （阶段进展）组织域已接入 `PrismaOrganizationStore` 并将 `OrganizationService` 全面异步化，相关路由、工具与品牌服务现已统一 `await` 组织校验，为事件/排班仓储迁移提供模板。
- （阶段进展）事件域完成 `EventService` 全异步化并新增 `PrismaEventStore`，Availability/Scheduling/Recurrence/API 流程全部改为 `await` 事件操作，单测覆盖 Prisma 仓储的冲突与写入逻辑。
- （阶段进展）排班建议域引入 `PrismaSchedulingStore`，`SchedulingService` 与 HTTP 路由整体异步化并复用仓储接口，配合 `0003_scheduling_store` 迁移、仓储单测与 API 回归确保队列驱动流程可直接落地数据库。
- （阶段进展）可用性缓存域接入 `PrismaAvailabilityStore`，`AvailabilityService` 及相关 API 路由完全异步化，测试覆盖创建/查询/删除路径与按用户过滤逻辑，为接入真实 Postgres 数据铺路。
- （阶段进展）队列域引入 `PrismaQueueStore` 与 `0004_queue_jobs` 迁移，QueueService 全面异步化并驱动 backlog 指标、审计与 dedupe 流程通过数据库持久化，API/服务测试随之更新。
- （阶段进展）通知域接入 `PrismaNotificationStore` 与 `0005_notifications` 迁移，NotificationService 改写为异步仓储并兼容内存适配器，API/服务/Prisma 测试覆盖广播创建、列表、已读操作。
- **队列与作业持久化**：将 `QueueService` 迁移至数据库表（或 Redis/BullMQ），保留审计与指标字段；迁移过程中提供双写开关与回滚策略。
- **AI 解析管道**：对接真实对象存储与模型 API，完善工具调用审批流的持久化（存储在 `ToolExecutionLog` 表）。

### 2.5 前端交付里程碑
- **项目骨架**：初始化 `frontend/`（React + Vite + TypeScript + shadcn/ui + Zustand/TanStack Query）。
- **核心场景**：
  - 日/周/月/议程视图 + “大周重叠视图” + 时间缩放。
  - 拖拽创建 → 右侧 Drawer（200ms ease-out），含事件表单、候选排班区、冲突提示。
  - 队列状态面板：展示 `QueueService` 作业列表与状态筛选。
  - 品牌主题中心：Logo/颜色/模板配置实时预览。
- **Playwright E2E**：覆盖以下脚本并纳入 CI：
  1. 新建事件 → Drawer 编辑 → 保存成功。（当前通过 `CalendarSurface` + `CandidateDrawer` 骨架预制交互区域）
  2. 创建冲突事件 → 前端提示冲突（结合后端 409）。
  3. 查看队列页面 → 作业状态实时刷新（可用 Mock SSE/轮询）。
  4. 候选排班审阅 → 接受方案 → 日历渲染更新。

### 2.6 指标与告警策略
- **指标基线（至少 8 项）**：
  1. `ai_parse_success_total` / `ai_parse_failure_total` → 解析成功率。
  2. `scheduling_duration_ms` (summary) → 求解耗时 P50/P95。
  3. `queue_backlog_total` → 队列积压长度（按作业类型标签）。
  4. `socket_broadcast_latency_ms` → 实时消息广播延迟。
  5. `http_requests_total` / `http_request_duration_ms` → HTTP 5xx 监控（按状态标签过滤）。
  6. `db_slow_queries_total` → 慢查询计数（>200ms 或基于 PG `pg_stat_statements`）。
  7. `external_calendar_failures_total` → 外部日历同步失败率。
  8. `session_concurrency_gauge` → 会话并发（可通过 Redis 计数或应用内 gauge）。
- **Grafana Dashboard**：
  - 面板建议：解析漏斗、求解耗时热力图、队列长度堆叠、Socket 延迟分布、HTTP 状态堆叠、慢查询 TopN、外部日历失败率趋势、会话并发折线。
  - 附录放置 `dashboards/grafana-scheduler.json` 示例，包含 Prometheus 数据源、关键阈值 (e.g. 解析成功率 < 95%、求解 P95 > 30s、队列积压 > 50)。
- **告警策略**：
  - PrometheusRule 示例（存档 `infra/alerts/scheduler-rules.yaml`）：
    - `AIParseSuccessDrop`: `sum(rate(ai_parse_success_total[5m])) / sum(rate(ai_parse_total[5m])) < 0.95` 连续 10 分钟。
    - `SchedulingLatencyHigh`: `histogram_quantile(0.95, rate(scheduling_duration_ms_bucket[5m])) > 30`
      秒 5 分钟内。
    - `QueueBacklog`: `queue_backlog_total{type="scheduling"} > 50` 持续 5 分钟。
    - `SocketLatency`: `socket_broadcast_latency_ms_max > 500`。
    - `Http5xxBurst`: `sum(rate(http_requests_total{status=~"5.."}[1m])) > 5`。
    - `DBSlowQuery`: `increase(db_slow_queries_total[5m]) > 0`。
    - `ExternalCalendarFailures`: `increase(external_calendar_failures_total[10m]) >= 3`。
    - `SessionConcurrency`: `session_concurrency_gauge > configured_limit`。
  - 告警通知：接入 PagerDuty/飞书，定义工作时间/非工作时间的告警抑制策略。

### 2.7 质量保障与流程
- **测试分层**：
  - 单元测试 (`node:test` / `pytest`) 继续覆盖服务逻辑。
  - 集成测试：针对数据库/RLS/队列/外部 API 的组合场景编写。
  - 前端：组件测试（Vitest/RTL）+ Playwright 端到端。
- **循环调试**：每个阶段完成后执行 `npm run lint`、`npm test`、`pytest ai-service -q`、`pnpm --filter frontend test`（待前端初始化）以及 Playwright 流水线。
- **回滚预案**：迁移发布前先运行 `prisma migrate reset` 在 staging 环境验证；队列/LLM 功能提供 feature flag，支持快速关闭。

### 2.8 交付成果清单
- 文档：`docs/CODES.md`（本文件）、`docs/feasibility_and_plan.md`（背景）、`docs/sql/*.md`（查询分析）、`dashboards/grafana-scheduler.json`、`infra/alerts/scheduler-rules.yaml`。
- 代码：Prisma 数据访问层、前端工程、Playwright 测试、Prometheus/Grafana/Alertmanager 配置样例。
- CI/CD：新增数据库迁移流水线、Playwright 云端执行、Prometheus 规则 Lint（`promtool check rules`）。

---

> 后续所有需求/缺陷在规划时，可直接参考本文件中的“文件级证据”定位当前实现，并依据“渐进迁移”部分的任务拆解和验收标准推进交付。
