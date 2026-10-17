# STATUS — 2026-10-16-claude-discard-unrevealed-bubbles

更新人：Claude
更新时间：2026-10-16T08:30:00Z
发现范围：2026-10-16 通过 GitHub API 查看 yecays-ai/veil；并行 PR 为 #222（recall/watcher）、#223（`lib/life/plan.ts`）；本任务改 `storage.ts` 新增方法、`engine.ts` send/sendSticker、`chat-room.tsx` 两处发送；基于 origin/main 7713223（含 #221）。

## 当前任务

D5：发送新消息时丢弃尚未显示的 Character 气泡。待 lan 真机验收，不自动合并。

## 谁在改哪里

Claude；分支 `claude/discard-unrevealed-bubbles`；PR https://github.com/yecays-ai/veil/pull/224。

## 已完成

- `ChatStorage.discardUnrevealedTail`：只接受同一回合、位于会话末尾、纯文字/表情包的已完成 Character 气泡；其余情形整体不删。删除复用 `deleteMessages`（重排序、Memory 来源失效、被回复的用户消息按现有规则变为已回应）。
- `engine.send` / `sendSticker` 增加 `discardUnrevealed` 选项；删除被拒绝不影响新消息发送。ChatRoom 发送文字/表情包时传入揭示队列里仍隐藏的 ID，队列在消息消失后由既有 `reconcile` 自行停止。
- 边界：已提交的 Character 动作（状态、签名、转账/礼物卡等）不回滚，转账/礼物卡不可被丢弃；“请求回复”（带草稿）路径本次不处理。
- 6 个新测试；相关测试（bubble-pacing、background-reply-reveal、life-interject、life-reply、proactive-contact、recall、stickers、transfer、generation-safety 等）通过；typecheck、eslint（改动文件，仅有既存 2 条 warning）通过。Node v22.22.0。

## 尚未验证

- 未做真机验收（仅自动化测试）；未跑完整测试套件；揭示计时与删除的竞态只有逻辑推演，无真机观察。

## 下一步

lan 真机验收后决定是否合并。
