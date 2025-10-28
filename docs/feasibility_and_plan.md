# 高级班排程系统可行性评审与实施蓝图

## 1. 可行性评审

### 1.1 架构与现有栈的适配度
- **前端**：现有 React + Vite 组合能够承载多视图日历、抽屉式编辑与实时过滤，无需额外框架迁移。
- **BFF/服务层**：Express + Prisma 与 PostgreSQL 搭配，天然支持多组织隔离、行级安全（RLS）与审计；FastAPI 微服务可独立承接 AI 解析职责。
- **数据层**：PostgreSQL 在复杂查询、JSON 字段、并发控制方面成熟，可满足事件冲突检测、审计留痕等需求。
- **AI 服务**：Qwen3-VL-8B 可直接调用托管 API，必要时再通过 vLLM/LMDeploy 自托管，结合 OCR 前处理满足课表解析。

### 1.2 核心风险与应对
1. **跨组织越权**：若只在服务层校验，易被遗漏。建议 UI 过滤 + 服务端校验 + PostgreSQL RLS 三层把关。
2. **模型解析可靠性**：需提供结构化输出约束、置信度阈值、人工复核与退避重试流程。
3. **并发与冲突处理**：拖拽和批量操作易产生冲突，需乐观锁（版本号/ETag）与冲突提示 UI。
4. **高密度周视图可读性**：默认周视图在高负载场景拥挤，需提供重叠视图与时间粒度缩放。
5. **可观测性与审计**：跨组织、批量、AI 入库必须落审计，并暴露指标/告警以保证合规性。

### 1.3 评审结论
整体方案与当前仓库分层高度匹配，可在增量迭代下落地。关键在于权限治理、AI 质量控制与实时协作的并发管理。

## 2. 更优实施方案

### 2.1 权限、数据与安全治理
- **角色模型**：`SUPER_ADMIN`、`ADMIN`、`STAFF` 三权，辅以 `OrganizationAdmin` 中间表标识管理员所辖组织。
- **ABAC 扩展**：基于事件 `organizationId`、`departmentId` 补充细粒度策略，必要时引入 Casbin/OPA。
- **三层防线**：
  1. 前端：组织选择器仅呈现授权域，负责人下拉自动过滤。
  2. BFF：每次请求注入 `app.org_ids` 会话变量，接口内统一校验。
  3. 数据库：启用 RLS 策略，确保无授权的 SQL 无法读取/写入。
- **审计模型**：`AuditLog` 记录 `actorId/action/subject/before/after/orgId`，覆盖跨组织、批量操作、AI 入库与同步任务。
- **并发控制**：事件表维护 `version` 字段，配合 `If-Match`/乐观锁处理冲突。

### 2.2 前端信息架构与交互
- **布局分层**：
  - 超级管理员：全局态势与告警仪表盘。
  - 管理员：组织选择器 + 成员过滤 + 日历 + 审批/队列侧栏。
  - 员工：个人/团队日历与指派列表。
- **日历交互**：
  - 拖拽划块创建 → 200ms ease-out 动画打开右侧抽屉（Radix Sheet + Framer Motion）。
  - 抽屉复用创建/编辑表单，包含标题、时间微调、组织/团队、负责人多选、颜色/标签、自定义字段、AI 辅助按钮。
  - 保存采用乐观更新，冲突返回 409 时弹出合并提示并回滚。
- **视图扩展**：日/周/月/议程 + “大周重叠视图” + 时间粒度缩放滑块，解决高密度排班可读性。
- **实时协作**：Socket.IO 订阅 `org:{orgId}`、`group:{groupId}` 房间，事件更新后即时推送。

### 2.3 启示与改进建议
- **引入启发式排班求解器**：借鉴 Auto Shift Planner 结合启发式/元启发式算法与 OptaPlanner 的实践，在半小时时间粒度上定义硬/软约束（最小/最大工时、开店窗口、连班间隔等），为管理员生成可微调的候选班表。
- **品牌与界面定制**：参考 Cal.com 社区对多品牌的诉求，为组织/小组提供 Logo、品牌色、通知模板等可配置主题，形成组件化皮肤系统，满足子团队差异化体验。
- **多周/跨日排班支持**：针对 Cal.com 对多周重复排班的需求反馈，在事件模型中扩展 `repeatInterval`、`rrule` 等字段，允许跨日、跨周乃至月度任务，保证生成与同步时段不局限于单周。
- **多成员可用性聚合**：来自 Booker 多 host 预订的经验显示，合并多成员忙闲信息复杂，需抽象 `availabilityService` 聚合 Google/Microsoft/CalDAV 等外部日历与本地事件，在前端给出冲突提示与建议时段。
- **任务队列与审计增强**：借鉴 Cal.com 关于数据库与审计重构的讨论，将所有跨组织、批量写入和 LLM 解析结果纳入队列处理，并在执行节点记录审计日志，确保可追溯与弹性。

### 2.4 数据与持久化层增强
- **核心表扩展**：在既有 `User`、`Organization`、`OrganizationAdmin`、`Group`、`Event`、`EventAssignee`、`AuditLog` 基础上新增：
  - `EventRecurrenceRule(eventId, rrule, exdates, interval)`：对齐社区反馈 #11908，完整描述跨日/跨周/多周复发与排除日；事件层面保留 `repeatInterval` 便于简单场景快速读取。
  - `SchedulingSuggestion(id, orgId, solver, status, inputSnapshot, outputPlan, scoreBreakdown, createdBy, createdAt, committedAt)`：承接启发式/OptaPlanner 候选方案，持久化输入快照、得分拆解、审批/写入人，支撑 Auto Shift Planner 式硬/软约束对比与人工微调闭环。
  - `AvailabilityCache(id, orgId, userId, source, rangeStart, rangeEnd, freeBusyJson, checksum, refreshedAt)`：针对 #23560 指出的高频外部 API 调用瓶颈缓存聚合忙闲数据，减少 Google/Microsoft/CalDAV 请求。
- **审计与合规**：
  - 审计日志对齐社区验收标准，敏感字段（邮箱、手机号、外部联系信息等）在 `before/after` 字段中采用透明加密或局部掩码存储，既保留溯源能力又防止原文泄露。
  - 关键表建立覆盖索引（如 `Event(organizationId,start,end)`、`AvailabilityCache(orgId,userId,rangeStart)`），并针对审计与回滚编写迁移验证脚本，确保 `ROLLBACK` 用例在 CI 中可重放。
- **迁移与回滚测试**：新增数据库迁移需附带回滚脚本与验收用例（参考社区 issue #24582 的“验收标准”小节），CI 中固定执行“迁移 → 种子 → 回滚 → 验证”闭环，并通过 `EXPLAIN` 校验关键索引是否命中。

### 2.5 服务层与队列编排
- **availabilityService**：
  - 拉取 Google/Microsoft/CalDAV、自建日历及本地事件，汇总为统一 free/busy 结构；
  - 返回多成员合并后的 **“可行窗口”** 集合，并附带冲突根因（成员、时间段、约束类型）。
- **schedulingService**：
  - 将管理员选定的约束（最小/最大工时、开店时间、连班间隔、技能标签等）转化为硬/软约束模型；
  - 通过 BullMQ/Temporal 等队列驱动异步调用 OptaPlanner/启发式求解器生成 `SchedulingSuggestion`，求解完成后推送候选方案供侧窗审阅并“一键写入”事件表；
  - 支持版本对比与回滚，将人工微调后的结果回写到 `outputPlan` 中，形成学习闭环。
- **LLMProviderRouter**：统一封装 `provider=OPENAI | OPENROUTER | QWEN_LOCAL` 路由逻辑，提供：
  - 每个组织/全局的配额、并发阈值、API Key、模型映射配置与熔断策略；
  - 失败退避、指标打点、灰度开关（按组织或管理员账号启用新模型）与审计日志落盘，继承方案 1 的多路由细节。
- **API 契约**：
  - 组织管理：`POST /api/organizations`、`POST /api/organizations/:id/groups`、`POST /api/organizations/:id/admins`，均要求通过 RLS 和 `AuditLog` 验证；
  - 可用性聚合：`GET /api/availability/windows?orgId=...&userIds[]=...` 返回可行窗口及冲突详情；
  - 排班候选：`POST /api/scheduling/run` 触发求解、`GET /api/scheduling/suggestions/:id` 查询结果、`POST /api/scheduling/suggestions/:id/commit` 落库；
  - 事件管理：`GET/POST/PATCH/DELETE /api/events`，支持批量指派、乐观锁参数与冲突列表返回。
- **工作流与队列**：
  - 使用 BullMQ/Temporal 串联解析、求解、外部同步与工具调用；
  - 任意跨组织/批量写入动作进入队列前写入 `AuditLog`，执行后记录结果与耗时；
  - 提供失败重试、死信处理、链路追踪（Trace ID 注入至日志与 Prometheus 指标）。

### 2.6 多源 LLM 与 Qwen3-VL-8B 解析流水线
- **模型接入矩阵**：
  - **OpenAI**：通过官方 REST/gRPC SDK，配置 API Key、组织 ID 与模型映射（`gpt-4o`、`gpt-4o-mini`、`gpt-4.1` 等），支持文本与多模态调用。
  - **OpenRouter**：封装统一的 `LLMProvider` 接口，可路由至 OpenRouter 聚合的 Claude、Gemini、Azure OpenAI 等模型，以降低成本并支持灰度。
  - **Qwen3-VL-8B（可选自托管）**：默认可调用官方托管/开放 API；在需要完全控制时再自托管（vLLM/LMDeploy + GPU），并通过 Redis 队列、幂等请求 ID 与配额限制保证稳定与成本可控。
  - 服务端暴露 `provider=OPENAI|OPENROUTER|QWEN_LOCAL` 选择参数，管理员通过控制台配置默认提供商、模型映射与配额告警阈值。
- **媒体与上下文处理**：
  - 前端提供 **图像/文档上传**，落盘对象存储（MinIO/S3），返回 `fileId` 与签名 URL；BFF 统一维护上传凭证与生命周期。
  - AI 服务调用多模态模型时附带 `image_url`/`input_image` 字段；若目标模型不支持图像输入则自动回退到 OCR 提取文本再调用文本模型。
- **工具调用与自动化**：
  - 约定 `ToolCall` 结构（`type`、`payload`、`sourceSessionId`、`needsApproval`、`relatedOrgId`）；
  - 首批内置工具：`notify_admin`（自动向所辖管理员发送站内信/邮件，支持组织主题模板）与 `update_personal_schedule`（调用事件 API 修改当前用户课程安排，并触发可用性缓存刷新）；
  - LLM 响应中出现 `tool_calls` 时，BFF 通过队列编排：
    1. 校验请求者身份与权限，审计“发起→审批→执行”全过程；
    2. 对 `needsApproval=true` 的调用向管理员推送待办（Socket + 邮件）；
    3. 执行结果写回会话上下文与 `SchedulingSuggestion` 注释区，便于追踪模型建议与实际执行差异。
- **解析流水线增强**：
  - **前处理**：OCR/表格结构化（PaddleOCR、Surya）生成单元块，与原图一起输入模型；必要时将截图与提取文本共同传给 GPT-4o 等模型以提高鲁棒性。
  - **提示词策略**：根据不同提供商动态拼装 Prompt，统一约束输出 JSON Schema（课程名、星期、起止时间、地点、组织、负责人、置信度、`tool_calls`）。
  - **后处理**：
    - JSON Schema 校验与类型纠偏；
    - 置信度低标记 `needs_review`，进入管理员复核抽屉；
    - 字段映射、工具触发结果与冲突检测后批量写入事件表。
- **回退与监控**：失败重试（退避）、人工处理队列、解析成功率/延迟指标、OpenAI/OpenRouter 配额监控、日志脱敏与审计。

### 2.7 前端体验与品牌定制补强
- **日历多视图**：延续 RBC 多视图（日/周/月/议程）并强化“大周重叠视图”与时间缩放滑块，保证高密度排班依旧清晰；拖拽划块→Framer Motion 200ms Drawer 仍为主要交互入口。
- **排班候选审阅**：侧窗新增“候选排班”分区，展示 `SchedulingSuggestion` 的硬/软约束满足度、冲突高亮、替代方案切换、评分折线；管理员可接受、拒绝或继续调优，评分曲线帮助快速理解不同候选的 trade-off。
- **品牌主题中心**：在组织/小组设置中提供 Logo、品牌色、通知模板等配置，前端主题系统通过 Token（颜色、字体、插画）动态注入到邮件、预约页、内嵌组件，预约页/邮件同 token 生效（对齐 #22352），并对多品牌视图进行可访问性校验（对比度、暗色模式）。
- **可用性可视化**：集成 `availabilityService` 输出的可行窗口与冲突列表，在日历与抽屉内通过时间轴/标签展示，并允许管理员一键刷新外部日历数据。

### 2.8 运行、观测与安全
- **健康检查**：各服务暴露 `/healthz`；CI/CD 在多服务环境下完成端到端自测，含数据库迁移回滚与队列消费冒烟测试。
- **可观测性**：Prometheus 指标覆盖解析成功率、求解耗时分布、Socket 推送延迟、冲突回退率、队列积压长度；结合 OpenTelemetry Trace、集中日志与告警（PagerDuty/Feishu）形成闭环。
- **安全控制**：会话采用 Redis 存储 + httpOnly/secure cookie；敏感配置使用 Vault/Secrets Manager；模型输入/输出脱敏、配额监控与越权告警；跨组织/批量操作默认带审计编号，支持一键追踪。

### 2.9 迭代里程碑
1. **基座搭建**：权限模型、RLS、审计、CI/CD。
2. **组织与小组管理**：CRUD、管理员授权、审计验证。
3. **日历核心与交互**：多视图 + 抽屉表单 + 乐观更新。
4. **AI 解析闭环**：上传→解析→复核→入库 + 指标/告警。
5. **协作与同步**：实时广播、冲突合并、外部日历同步、通知中心。

> 当前实现进度：阶段 1–3 已由 `backend` 包提供的会话守卫、组织与事件服务落地；阶段 4 的解析闭环已通过 `ai-service` 微服务的多提供商路由、解析作业和复核端点完成基础能力；阶段 5 启动了实时广播总线，为后续 Socket 房间和外部同步打下基础；阶段 6 引入了聚合忙闲与排班候选服务，为可行窗口计算、候选排班审阅与“一键写入”提供后端支撑。
> 阶段 7 进一步打通工具调用：新增通知服务与 `/api/tools/execute` 路由，支撑 LLM 自动触发管理员提醒与个人课表更新，并配套节点测试覆盖服务与 API 的授权流程。
> 阶段 8 补齐观测与合规防线：新增 `/metrics` 与 `/api/audit` 路由、指标聚合器与审计服务，所有组织、排班与工具动作都会落盘审计并提供 Prometheus 兼容的度量与节点测试验证。
> 阶段 9 强化多源 LLM 治理：`ProviderRouter` 新增配额窗口、组织灰度名单、并发上限与熔断冷却，解析作业会传入组织 ID 以便执行配额审计，并配套 pytest 覆盖限流与熔断恢复场景。
> 阶段 10 打通品牌主题中心：新增 `BrandingService` 与 `/api/organizations/:id/branding` 读写接口，支持 Logo、颜色与通知模板的验证、审计与指标打点，节点测试覆盖默认值、权限与校验错误。
> 阶段 11 补齐事件复发管理：新增 `RecurrenceService` 与 `/api/events/:id/recurrence` 读写接口，支持 RRULE/EXDATE 校验、预览扩展、审计与指标打点，节点测试覆盖规则验证、权限与扩展结果。
> 阶段 12 加固可用性缓存治理：`AvailabilityService` 新增缓存查询/清理能力，`/api/availability/cache` 路由支持管理员上报外部忙闲并审计留痕，指标统计更新/查询/清除的成功率，节点测试验证权限与缓存流程。
> 阶段 13 接入队列编排与治理：`QueueService` 管理排队/运行/失败/重试生命周期，`/api/queue/jobs` 路由允许管理员排队、查看、取消与重试作业，调度建议会同步生成队列作业以便可视化追踪，并配套节点测试覆盖治理流程。
> 阶段 14 上线通知中心：新增 `/api/notifications` 与读写接口，通知服务记录多收件人已读状态，管理员可广播跨组织告警，员工可确认已读；配套指标与审计保障通知流程可追踪，并通过节点测试覆盖创建、列出与确认路径。
> 阶段 15 打通 AI 解析编排：新增 `/api/ai/parse-jobs` 提交/查看/审批接口，后台自动执行无需审批的工具调用并写入个人课表，对需审批的调用生成组织通知与审计记录；新增服务与 API 测试覆盖工具去重、审批提醒与跨组织权限校验。
> 阶段 16 引入外部日历连接治理：新增 `ExternalCalendarService` 与 `/api/external-calendars` 系列接口，支持管理员创建连接、触发同步作业、查询日历目录并移除集成；队列与审计指标复用既有治理框架，避免重复解析与越权访问。
> 阶段 17 上线实时事件流：`/api/events/stream` 提供组织域内的 SSE 推送，支持 `Last-Event-ID` 历史补发、心跳保活与指标打点，节点测试验证鉴权、范围校验、实时推送与历史重播语义。

### 2.10 参考资料与对齐
- `Dynamic Event Calendar`（shadcn + Tailwind，多视图、侧面板、拖拽）。
- `origin-space/event-calendar`（月/周/日/议程视图、颜色与暗色支持）。
- `react-calendar-app`（推荐模态/侧面板编辑）。
- 项目《Advanced Team Scheduler – Architecture & Stack Overview》文档。

---

> 本文档可作为后续实现的蓝图与评审依据，支持在现有仓库上以增量迭代完成全部能力。
