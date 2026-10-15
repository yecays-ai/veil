# STATUS — 2026-10-15-claude-life-reply-typing-defer

更新人：Claude
更新时间：2026-10-15T19:15Z
发现范围：2026-10-15 19:00Z 读取 origin/main b2041a178b2dc138d0370be9934d4ba481790645；此时无与本任务路径重叠的开放 PR。

## 当前任务

PR-A：Life Mode 在用户输入或有草稿时暂缓自动回复，并加 3 秒安静窗口。待审查 / 待 lan 真机验收。

## 谁在改哪里

Claude；分支 `claude/life-reply-typing-defer`；PR https://github.com/yecays-ai/veil/pull/215 。测试分支 claude/presence-routine-fix 已同步（a6d91ec）。
- `lib/chat/composition.ts`（新增，内存草稿信号）
- `lib/chat/life-reply-watcher.ts`（安静窗口、草稿暂缓）
- `lib/chat/life-reply-browser.ts`（接线）
- `components/chat/chat-room.tsx`（上报草稿，卸载/切换时清除）
- `tests/life-reply.test.ts`

## 已完成

- 到点时间 = max(Presence 计划, 最新未回复消息 + 3 秒)；草稿非空时不生成，草稿清空/发送/页面卸载后由 touch 重新检查。
- 无新存储、无新模型调用、无设置开关；Presence 节奏不变。
- CodeRabbit 指出最后一次读取后才判断草稿与新消息：已改为最后读取后再检查（新增测试先失败后通过）。
- 本地 Node 22.22.0：`tests/life-reply.test.ts` 22/22，generation-ui、chat-layout-ui、proactive 相关 35/35；`tsc --noEmit` 通过；eslint 无新增问题（chat-room 两个既有 warning）。

## 尚未验证

- iOS 真机：连续短消息、长时间停顿留草稿、切会话/离开聊天页后回复是否正常。
- 另一标签页的草稿看不到（信号仅本页内存），已知限制。

## 下一步

等 CodeRabbit 与 lan 的 Preview 验收；PR-A 验收前不开始 PR-B（生成中插话）。
