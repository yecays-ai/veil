# STATUS — 2026-10-16-claude-life-v2-l2-1-day-plan

更新人：Claude
更新时间：2026-10-16T09:30:00Z
发现范围：2026-10-16 09:10Z 基于 origin/main 9f1d76acda30d011566d76b7d28920ae14755d42（含 #226）；通过 GitHub API 查看 yecays-ai/veil，没有其他开放的 Life/Presence PR。

## 当前任务

Life V2 工单 L2-1：每个 Character 每个本地日一次的“当日计划”模型调用，页面打开时按需触发。待审查。

## 谁在改哪里

Claude；分支 `claude/life-v2-l2-1-day-plan`；PR 链接见 PR 描述（开出后补）。涉及 `lib/life/day-plan.ts`（新）、`lib/life/plan.ts`（plan 行不被 Routine 投影清掉，Situation 仍优先）、`lib/presence/compute.ts`（导出 `localWallClock`）、`lib/chat/request-diagnostics.ts` 与 `lib/chat/usage-baseline.ts`（新增请求来源 `life-day-plan`）、`components/chat/chat-room.tsx` 与 `components/chat/life-timeline.tsx`（各一行触发）、`tests/life-day-plan.test.ts`。不碰 `lib/memory/*`，不碰主动消息调度器。

## 已完成

- 打开聊天或 Life 页时，若有 Routine、有可用 API 且今天尚未认领，则认领当天并发 1 次请求（最多 3000 输出 token）；成功则把今天剩余时间的活动写入 Life 并标记完成。
- 认领在跨标签页锁内完成，所以同时打开、两个标签页、失败后重开都不会再发请求；认领超过 2 分钟未完成视为页面已关闭，可被接手。失败、无效回复、中止都当天不重试。无 API 或无 Routine 不消耗当天。
- 提示词包含 Universe 名称与世界设定、该 Character 的直接关系、语气，语言跟随 Character 设定，没有世界书。
- 计划行不会被 Routine 重算清掉；Situation 优先（计划行在遇到 Situation 时被截断或让位）；已发生的历史与已揭示的 Moment 不改。Routine 骨架填计划留下的空白。
- 检查：新增 14 个测试（解析、请求次数、并发、认领接手、失败不重试、无 API、让位与重叠、Routine 修改后保留、备份往返、触发点接线）；life/presence/quote 相关测试通过；`npm run typecheck`、eslint 通过（本地 Node v22）。

## 尚未验证

- 没有真机验证；没有用真实模型验证回复质量与语言。自动化测试用的是假 provider。
- 计划行在 Situation 之后的尾部被直接丢弃（已接受的简化）。
- 未跑完整测试套件。

## 下一步

CI 与 CodeRabbit 通过后合并；随后 L2-3（聊天上下文）。
