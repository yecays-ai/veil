# STATUS — 2026-10-15-codex-message-recall

更新人：Codex
更新时间：2026-10-15T00:00:00+08:00
发现范围：从最新 GitHub `main` `0ca16e87191df9958b74a06401a5f224f67c8b56` 开始；该 SHA 是 PR #200 合并提交。

## 当前任务

消息撤回与消息操作边界收敛（PR #201，审查问题已修正，待更新 CI 与合并）。

## 谁在改哪里

Codex；分支 `codex/message-recall-20261015`；PR #201；base `origin/main` `0ca16e87191df9958b74a06401a5f224f67c8b56`。范围：ChatMessage 撤回语义、ChatStorage 持久化与 Memory v2 来源失效、搜索/摘要/Prompt 过滤、引用预览、Character 自主撤回 Action、菜单 UI、备份验证；另将菜单状态与定位、Reaction、复制、撤回、删除控制移入 `use-message-actions.ts`。

## 已完成

- 用户只能撤回本人已发送消息；Character Action 只能撤回其上一个已完成回复。
- 撤回后清空正文，原位置显示 “Message recalled”；引用预览同步变为撤回文案。
- 搜索、上下文、摘要与 Memory 来源均不再读取撤回正文；摘要及 Memory lineage 按现有清理接口失效。
- Character 正常回复可通过已解析的 `recallPrevious` Action 撤回；Continue 不提供该 Action。
- Message operation control now lives in `components/chat/message-actions/use-message-actions.ts`: open/close, selection guard, menu positioning, Reaction, copy, recall, delete confirmation and persistence. ChatRoom retains overlay focus trapping, delete side effects (reveal queue and multi-select cleanup), and coordinates edit/quote/Memory/regenerate and registered actions.
- Review fixes: hide Recall during generation; Character target selection skips error/cancelled messages; a failed Character recall no longer blocks signature updates.
- Targeted tests pass: `message-recall` (5), `presence-actions` (15), mounted `chat-message-actions` (1), and `presence-self-context` (8).
- The first PR CI found the stale `canRecall` expectation; corrected here. Local tests compilation/typecheck cannot resolve the pre-existing absent `emoji-picker-react`; CI provides the clean dependency check. Targeted ESLint passes for the Hook and changed tests; whole ChatRoom lint reports existing project-wide React hook/ref diagnostics when invoked standalone.

## 尚未验证

- Updated PR CI and review after the latest push; real browser/device acceptance remains unverified.

## 下一步

Push this correction to PR #201; merge after the updated CI and review are green, then start the transfer stage from the merged main.
