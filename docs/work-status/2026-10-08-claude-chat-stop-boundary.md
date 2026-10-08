# STATUS — 2026-10-08-claude-chat-stop-boundary

更新人：Claude
更新时间：2026-10-08T14:00:00+00:00
发现范围：2026-10-08 经 GitHub 集成列出 open PR，仅 #36（冻结，Chat 首帧）；对比其改动文件与本任务无重叠，`git merge-tree` 无冲突。

## 当前任务

第二板块施工单 A：Chat Stop 取消边界（审计 A1、A2、U1）。待审查。

## 谁在改哪里

Claude；分支 `claude/chat-stop-boundary`；PR https://github.com/yecays-ai/veil/pull/48；base `origin/main` 3107d8e。
涉及：`lib/chat/engine.ts`、`components/chat/chat-room.tsx`（仅 `regenerate()` 的 finally）、`tests/chat-stop-boundary.test.ts`。

## 已完成

- 开工核对：工单描述的“Stop 在天气/地点准备阶段取消不及时”在 main 上已由 #20 的 `awaited()` 修复，本单不重复修改，只补回归测试固定该行为。实际修复的是原审计编号：
  - A1：带草稿回复在草稿落库前被 Stop，且没有未回答的用户消息时，不再生成空的 stopped 气泡（该气泡的 Retry 会在没有用户内容时调用模型）。真实失败（非 Stop）仍按既有契约记录。
  - A2：领取生成权之前被 Stop，`requestReply` 返回 null，不再把 AbortError 文本抛给聊天界面。
  - U1：`regenerate()` 的 finally 仅在仍挂载且仍是同一会话时清 `replyLock`，与 `reply()` 一致。
- 测试 `tests/chat-stop-boundary.test.ts`（7 项）：A1（Stop 后无消息/无气泡/模型 0 次，迟到的 regex 结果无影响，之后新发送正常；存在未回答用户消息时保持既有 stopped 记录；真实失败仍记录）、A2、天气阶段 Stop + 迟到天气 + 立即重新生成、地点阶段 Stop + 重复 Stop、卸载式 stop 与用户 Stop 相邻只留一条终态记录。旧实现上 A1、A2 的 3 项失败。
- Node 24：`npm test` 595/595、`npx tsc --noEmit`、`npx eslint .`、`npm run build`、`git diff --check` 通过。

## 尚未验证

- U1 没有行为测试：它在审计中是未复现的纵深防御项，ChatRoom 的挂载测试代价大，本单未扩大范围。
- 真实浏览器/真机未测。
- Stop 与消息落库恰好交错时（`storage.send` 已开始但引擎已被中止），用户消息可能落库而没有回复或 stopped 气泡；内容不丢，可手动 Reply。
- 非 Stop 的发送失败仍会留下带错误的气泡，其 Retry 同样没有用户内容；这是既有契约（`failed direct Send never starts generation`），不在本单范围。
- 天气/地点/模型请求超时（B1/B2）按工单不处理。

## 下一步

等待 CodeRabbit 与 CI，由用户本人手动合并（不加 automerge）。
