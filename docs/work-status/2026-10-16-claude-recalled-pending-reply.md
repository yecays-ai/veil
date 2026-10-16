# STATUS — 2026-10-16-claude-recalled-pending-reply

更新人：Claude
更新时间：2026-10-16T00:00:00Z
发现范围：2026-10-16 通过 GitHub API 查看 yecays-ai/veil，除本任务外只有 D1 的 PR #221（`lib/chat/storage.ts` initiate 分支，不同位置）；基于 origin/main a533ed21407b4dc0d7f148b53b2fb1ad79ea6276。

## 当前任务

D2：已撤回但未回复的用户消息不再触发回复。待审查。

## 谁在改哪里

Claude；分支 `claude/recalled-pending-reply`；PR https://github.com/yecays-ai/veil/pull/222；涉及 `lib/chat/recall.ts`（共享判断）、`life-reply-watcher.ts`、`usability.ts`、`storage.ts`（beginReply 的 pending 一行）、`tests/life-reply.test.ts`。

## 已完成

- 新增共享判断 `isPendingUserMessage`：已撤回的消息不是待回复；它只以既有的 `[User recalled a message]` 标记出现在历史中。
- 两个新回归测试在修复前失败、修复后通过；chat-recall、message-recall、chat-usability、life-reply、proactive-contact 全部通过；`npm run typecheck`、eslint 通过（Node v22.22.0，仓库要求 24）。

## 尚未验证

- 未跑完整测试套件；未做真机验证。

## 下一步

CI 绿后按 AGENTS.md 合并，然后做 D3+D4。
