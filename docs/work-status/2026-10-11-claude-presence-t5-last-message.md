# STATUS — 2026-10-11-claude-presence-t5-last-message

更新人：Claude
更新时间：2026-10-11T09:55+08:00
发现范围：2026-10-11T09:40+08:00 起；`origin/main` = `9431f042f79580c74d0a26036410396aec430f69`（含 T4 #112、T3 修复 #113）；GitHub 远端开放 PR 与分支在本记录创建时未再逐项核对，除本分支外未发现涉及 `lib/chat/engine.ts` 的在途工作；已读 `docs/AUDIT_LEDGER.md`。本分支从该 `origin/main` 创建。

## 当前任务

Character Presence 第二批 T5：记录角色最后一条消息的发送时间（Last Seen 的第二个值）。待审查，等 CodeRabbit 与 Lan 的预览实机验收。

## 谁在改哪里

Claude；分支 `claude/presence-t5-last-message`；PR 见 GitHub；base `9431f04`。
修改：`lib/chat/engine.ts`、`docs/AUDIT_LEDGER.md`（只加一条验收记录，记录 T4 已知限制）。新增：`tests/presence-last-message.test.ts`、本记录。不碰 Presence 存储结构、界面、Header、提示词、T6–T8。

## 已完成

- 一次回复提交（`finalizeReply` 成功）后，引擎把当前时间记入该角色的 `lastMessageAt`（沿用 T2 的 `advanceLastSeen`，只增不减，无变化不写入）。写入是提交之后的单次尽力而为：失败只在控制台给出不含错误内容的一行警告，不影响已提交的回复，不重试。
- 记录发生在：普通回复、重新生成、继续生成成功提交之后。失败、停止、未保存的回复不记录。
- 依赖注入：`createChatEngine` 末尾新增可选参数 `recordSent`，默认写入浏览器 Presence 存储（无 `window` 时不做事）。
- 显示端不需要改动：T4 的 `lib/presence/view.ts` 已取 `lastMessageAt`、`lastOnlineAt` 与按作息推算的上线时间中最晚的一个。
- 测试：新增 4 项（提交后记录一次且归属正确；重新生成也记录；失败/停止/最终写入失败不记录；记录失败或同步抛错不改变已提交回复且不泄露错误文本）。
- 检查（Node 24.21.0，本地）：`npm run typecheck`、`npm run lint`（0 个错误，3 个原有警告）、`npm test` 872/872（CF-02 在一次全量运行中偶发失败，随后连续 3 次全量均通过，根因仍未查）、`npm run build`。证据级别：自动化测试，无真机。

## 尚未验证

- 真机：回复后 `veil.presence.v1` 里该角色的 `lastMessageAt` 是否写入，联系人页 Last seen 是否随之变化（由 Lan 在预览验收）。
- 多标签页同时回复时的竞态沿用 T2 已记录的已知风险（无 Web Locks 时可能互相覆盖，仅丢失一次更新）。
- 继续生成（Continue）的提交路径与重新生成共用同一处代码，但没有单独测试：它的资格条件依赖截断状态，测试里没有搭出该场景。
- GitHub CI、CodeRabbit 与 Vercel 预览：创建时尚未运行。

## 下一步

等 CodeRabbit 与 Lan 验收并手动合并；T6 等 Lan 确认。
