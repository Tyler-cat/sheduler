# SQL 分析记录

该目录用于存档关键查询的 `EXPLAIN (ANALYZE, BUFFERS)` 报告与分析笔记，帮助团队在持久化迁移后持续验证性能与索引策略。

## 结构约定

- 每个查询一个子目录，例如 `events/conflict-window/`。
- 子目录内包含：
  - `query.sql`：原始查询或 Prisma 生成的 SQL 片段。
  - `explain.txt`：`EXPLAIN (ANALYZE, BUFFERS)` 的原始输出。
  - `notes.md`：瓶颈分析、索引建议与待办事项。

## 首批待测查询

1. **事件冲突检测**：`Event` 按组织/负责人时间区间扫描。
2. **可用性聚合**：`AvailabilityCache` 与外部忙闲合并逻辑。
3. **排班建议读取**：`SchedulingSuggestion` 的候选筛选与回放。
4. **审计日志查询**：`AuditLog` 的跨组织查询与掩码验证。

> 迁移完成后，请在 CI 中生成这些报告并更新至本目录，确保性能回归有据可查。
