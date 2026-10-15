# STATUS — 2026-10-15-claude-life-reply-start-race

更新人：Claude
更新时间：2026-10-15T22:10Z
发现范围：2026-10-15 21:43Z 与 22:01Z 读取 origin/main 5914e198952c8a322552382f2485ac1038683a22；开放 PR 仅 #219（Codex，改 chat-room / engine / storage 等，不改 `lib/chat/life-reply-watcher.ts`、`tests/life-reply.test.ts`，无重叠）。

## 当前任务

修复 PR-A / PR-B / #218 合并后验证单 V1 确认的缺陷：Life Mode 自动回复没能取得生成资格时，待回复消息被永久跳过。lan 2026-10-15 21:59Z 批准最小修复；验证单其余项结案。待审查。

## 谁在改哪里

Claude；分支 `claude/project-thread-grwhb1`；PR 待创建。
- `lib/chat/life-reply-watcher.ts`（回复结束后重读一次；最新消息仍未被认领就清掉 `attempted`）
- `tests/life-reply.test.ts`（3 个新测试；测试替身的回复改为像真实路径一样认领等待中的消息）

## 已完成

- 原因：watcher 在 `deps.reply` 前把最新消息记入 `attempted`；回复若因同页主动消息或另一标签页持有生成而没能开始，不会认领消息，之后的检查都跳过它。
- 修复：没能开始的回复不再算作“已尝试”；不排定时器，由之后的事件（如对方释放生成）再看。已开始的回复无论成败都会认领消息，所以模型失败不自动重试的规则不变。
- 本地 Node 24.22.0：去掉修复时 3 个新测试失败，加上后通过；Life / 插话 / 主动消息 / 气泡揭示 / 未读相关 106/106；`npm run typecheck` 通过；变更文件 eslint 无问题。
- 验证报告：https://claude.ai/artifact/5w8AdW71KQQtH76f4cZhcz

## 尚未验证

- 真机：竞争窗口很窄，真机上难以主动触发，只有自动化测试（fake IndexedDB、假模型）证据。
- 全量测试套件未跑（按 AGENTS 分级，属小范围改动）。

## 下一步

等 CI 与 CodeRabbit，然后交 lan 决定是否合并。
