# STATUS — 2026-10-15-claude-life-reply-interject

更新人：Claude
更新时间：2026-10-15T19:45Z
发现范围：2026-10-15 19:24Z 读取 origin/main bad238f977f718a28ea3432fae87d80d5c04bbef（PR-A #215 已合并）；无与本任务路径重叠的开放 PR。

## 当前任务

PR-B：Life Mode 生成中插话与安全取消。待审查 / 待 lan 真机验收。

## 谁在改哪里

Claude；分支 `claude/life-reply-interject`；PR 创建后补链接。
- `lib/chat/storage.ts`（`send` 新增 `interject`，同一事务内删除未提交草稿、解除认领、保存新消息）
- `lib/chat/engine.ts`（`send` 透传 `interject`）
- `components/chat/chat-room.tsx`（Life Mode 生成中允许发送）
- `tests/life-interject.test.ts`（新增），`tests/chat-layout-ui.test.ts`、`tests/quote.test.ts`（源码契约随之更新）

## 已完成

- 插话只在 Life Mode 且显式传 `interject` 时生效；普通聊天与 Request Reply 仍互斥。
- 未提交草稿直接删除，不留 stopped / Retry；被它认领的用户消息恢复为待回复；已提交气泡不动。
- 与 finalize 的竞争由 IndexedDB 事务决定：finalize 先则插话退化为普通发送；插话先则 finalize / updateReply 因归属失效被拒。
- 手动 Stop 不变（仍留 cancelled 可重试）；真实 API 失败路径不变。
- Memory：流式草稿从未分配 `memorySequence.seq`（只在确认后分配），删除草稿不产生序号空洞；测试验证序号连续、归属正确、无重排。未改 Memory 核心。
- 本地 Node 22.22.0：新测试 8/8；全量 1974 项中 1970 通过，失败 4 项中 2 项是源码契约随本改动更新（已修正后 50/50），另 2 项为已知 Node 22 regex/worldbook 锁测试（CI Node 24 正常）。`tsc --noEmit` 通过，eslint 无新增问题。

## 尚未验证

- iOS 真机：生成中点发送的手感、流式文字消失是否突兀、下一轮回复时机。
- 插话打断主动消息时，该次主动尝试仍计入每日 2 次额度（已知，未改）。
- 刷新/关闭 PWA 产生的 interrupted 气泡不在本期范围。

## 下一步

等 CI、CodeRabbit 与 lan 的 Preview 验收；不自行合并。
