# STATUS — 2026-10-16-claude-life-v2-l2-0-schema

更新人：Claude
更新时间：2026-10-16T09:00:00Z
发现范围：2026-10-16 08:37Z 通过 GitHub API 查看 yecays-ai/veil，当时没有开放 PR；基于 origin/main 4df6366a7f60689d6563eecb08207ed4c2a20ae5。未读取其他 PR 头上的 work-status。

## 当前任务

Life V2 工单 L2-0：Life 数据结构与备份兼容，不改任何用户可见行为。待审查。工单见 Life V2 开发工单草案（artifact 2f693682）。

## 谁在改哪里

Claude；分支 `claude/life-v2-l2-0-schema`；PR 见下方创建后补充；涉及 `lib/life/activity.ts`、`lib/life/recent.ts`、`lib/life/plan.ts`（一行：对账时带上新记录）、`tests/life-v2-schema.test.ts`。不碰 `lib/memory/*`。

## 已完成

- 活动新增可选 `origin: "plan"` 与 `state: "cancelled"`；`LifeState` 新增可选 `threads`（活跃≤3、暂停≤5）、`keepsakes`（≤20，重要度 1–5）、`plan`（本地日标记）。
- 全部在首次写入前不存在；旧数据读出后逐字节不变（有测试）；规范化顺序确定，备份往返相等。
- 某个可选记录不合法（超限、重复 id、非法日期等）只丢该记录，活动与其他记录保留；非法行标记使该行无效。
- 已取消的行不占时间、不进时间线和聊天上下文（`lifeLive`）。
- 对账（`reconcileLifeActivities`、`reconcileProjectedLife`）把新记录原样带过，避免 Life 页或回复前对账清掉它们。
- 检查：新增 6 个测试；所有含 life 或 presence 的 72 个测试文件通过；`npm run typecheck`、eslint 通过（本地 Node v22）。

## 尚未验证

- 未跑完整测试套件；自动化测试证据，没有真机验证（本张无用户可见变化）。
- 容量淘汰、事项状态转换、取消行与 Routine 重算的配合属于 L2-1 / L2-2 / L2-4 / L2-5。

## 下一步

CodeRabbit 与 CI 通过后按 AGENTS.md 合并（无用户可见变化）；随后等 lan 指示是否开始 L2-1。
