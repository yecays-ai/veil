# STATUS — 2026-10-13-claude-memory-t2b

更新人：Claude
更新时间：2026-10-13T16:00:00Z
发现范围：base origin/main 2401d25（含 #172/#173/#174）；仅本任务路径（lib/chat、lib/memory、lib/backup/validation.ts）；未逐一检查其他开放 PR。

## 当前任务

Memory 重做工单 2b：容量触发的滚动摘要（进行中，待开 PR）。

## 谁在改哪里

Claude；分支 `claude/memory-t2b-rolling-summary`。涉及 `lib/chat/{summary,types,prompt,engine,storage,usage-baseline,request-diagnostics}.ts`、`lib/memory/{summary-input,summary-runner,maintenance-scheduler,maintenance-browser}.ts`、`lib/backup/validation.ts`、`tests/{chat-summary,memory-summary-runner}.test.ts`。

## 已完成

- `ChatSession.summary`：超出最近 40 条的内容每累积 20 条滚动并入摘要（≤2000 字，第一人称）；提示词在 History 前注入 `[conversation-summary]`，仅在覆盖的消息未变时有效。
- 编辑/删除/清空被覆盖的消息，在同一事务内丢弃摘要；写入为 compare-and-set。
- 请求运行器：Character owner 锁内、Memory 模型、每范围一次请求；失败/拒绝不重试，同一页面内不重复读取或发送。
- 备份校验只检查形状；恢复测试见 chat-summary.test.ts。

## 尚未验证

- 真实模型的摘要质量与成本（需 lan 另行批准）。
- 真机行为。
- 触发阈值 20 沿用维护批次，未实测。

## 下一步

开 PR，CI 绿后合并，然后做工单 3。
