# STATUS — 2026-10-14-claude-message-reactions-character

更新人：Claude
更新时间：2026-10-14T20:30:00+08:00
发现范围：2026-10-14 通过 GitHub API 查看 `yecays-ai/veil` open PR（无与聊天回复/self-context/Presence 动作重叠的 PR）；基于 `origin/main` 6402e483ab2a62a73a3c6d85bbe6af7f0676abd9（含工单 1 的 #192）。

## 当前任务

消息 Reaction 工单 2：Character 通过回复末尾的隐藏标签给 lan 的消息点 Reaction。待审查。

## 谁在改哪里

Claude；分支 `claude/project-thread-q6qbh8`；PR 见 GitHub。涉及：`lib/chat/reactions.ts`（目标选择、连续限制、lan Reaction 摘要）、`lib/chat/self-context.ts`、`lib/chat/engine.ts`（回复提交后写入）、`lib/presence/actions.ts`（仅解析 `reactToUser`）、`tests/message-reactions-character.test.ts`。未触碰 `lib/memory/*`、主动消息（#189/#191）的调度逻辑。

## 已完成

- 同一个 `<veil-action>` 标签新增 `reactToUser`（单个 emoji）；只在回复 lan（普通回复 / Regenerate）时提供，Continue 与 Character 主动发起不提供。
- 限制（无新存储）：上一条 lan 消息已被 Character 点过则本次不提供、也不应用；提交回复后才写入，并按最新存储再校验一次；非单个 emoji 丢弃；失败/停止/提交失败都不会留下 Reaction。
- 上下文：Character 的提示里最多带最近 8 条内 lan 对它消息的 3 个 Reaction（emoji + 前 40 字），无新增模型调用。
- 检查（Node 22.22.0）：typecheck、lint（0 error，3 条既有 warning）、build 通过；定向测试通过：message-reactions-character(7)、message-reactions、presence-self-context、presence-actions、presence-action-commit、presence-notes、chat-storage、backup-validation、memory-context-engine。

## 尚未验证

- 真实模型是否会合理使用 `reactToUser`（频率、是否泄露标签）；仅用模拟 provider 测试。
- 真机上 Character Reaction 圆泡在 lan 气泡上的位置与出现时机。
- 未跑全量 `npm test`（按范围规则）；本机 Node 为 22。

## 下一步

lan 在测试分支验收；通过后合并。
