# STATUS — 2026-10-10-claude-p6-b2-persistence-diagnostics

更新人：Claude
更新时间：2026-10-10T09:00:00Z
发现范围：观察时间 2026-10-10T08:50Z；基于 origin/main `b0d6a790ae4b2de9994f8705b7d1fb69162f51ab`（#93 已合并）；GitHub open PR 列表（含 draft）为空，无重叠；其他分支上的任务记录未逐一检查。需求来自 Codex 的 B2 只读核查报告（对话中交付，未入库），关键判断已对照 `engine.ts` 复核。

## 当前任务

待审查：第六刀 B2——Chat 最终持久化结果诊断（总账板块六“统一终态诊断事件”，部分修复，不整体销账）。

## 谁在改哪里

Claude；分支 `claude/p6-b2-persistence-diagnostics`；PR：[#94](https://github.com/yecays-ai/veil/pull/94)。涉及：新增 `lib/chat/persistence-diagnostics.ts`、`lib/chat/engine.ts`（`generateReply` 内观察现有调用结果）、新增 `tests/generation-persistence-diagnostics.test.ts`、`docs/AUDIT_LEDGER.md` 板块六一行。不改存储实现、数据库结构、`provider.ts`、Stop 与生成状态机。

## 已完成

- 修复前证据：在 main 上有模块、引擎未接入时，新测试 7 条中 6 条失败（唯一通过的是“生产不输出、日志异常不影响、一次性”这类本来成立的性质）。
- 新增开发环境 `[VEIL generation:persisted]`：requestId（= attemptId，同时是该次模型调用的 requestId）、source、outcome、releaseFailed、durationMs。每个已领取 attempt 恰好一条，在 `releaseGeneration` 之后输出，因此排在 `completion:terminal` 之后；未领取的 attempt 不输出。
- outcome：`committed`（`finalizeReply` 返回）、`failure-recorded`、`stopped-recorded`、`owner-lost`（`failGeneration` 返回 null）、`failure-record-failed`（`failGeneration` 自己抛错）、`nothing-persisted`。
- 不记录聊天内容、prompt、Key、会话/角色 ID 或异常文本；日志异常被吞掉；生产环境不输出；所有既有错误、返回值与重试/取消行为不变（含 `releaseGeneration` 抛错会使调用 reject 的既有行为，测试把它钉住为“只观察”）。
- 检查（Node 24.21.0，本地，基线 `b0d6a79`）：`npm test` 790/790；`npm run typecheck` 通过；`npx eslint app components lib tests scripts` 0 error（6 条既有 warning）；`npm run build` 成功。证据级别：自动化测试；无真机层面。

## 尚未验证

- 没有在浏览器开发环境里真实看过控制台输出，只有测试中捕获的 `console.info`。
- 未覆盖：Here & There 最终处置（B3）；无草稿时的跨窗口 Stop 与崩溃恢复新建的标记没有原 attemptId，不能完整追溯。
- 旁支（只记录）：`releaseGeneration` 抛错会盖掉已提交的返回值，使整个调用 reject；`failureStage=provider` 也包含流式写入存储失败，不能直接当作模型错误。
- GitHub Actions `verify` 与 Vercel 预览：结果以 PR 为准；未运行成功的逐项记为“未运行”，不算通过。

## 下一步

等待 CodeRabbit 针对最新提交完成审查，并确认无未解决评论、CI 为绿且预览对应最新提交后，由 Lan 手动合并；若 CI 或预览未运行，按人工例外记录并由 Lan 决定是否合并；不自动合并，不加 automerge 标签。B3 另开单。
