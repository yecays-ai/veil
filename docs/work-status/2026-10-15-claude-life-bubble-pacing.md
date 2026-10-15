# STATUS — 2026-10-15-claude-life-bubble-pacing

更新人：Claude
更新时间：2026-10-15T20:05Z
发现范围：2026-10-15 19:52Z 读取 origin/main bad238f977f718a28ea3432fae87d80d5c04bbef；开放 PR 仅 #216（PR-B，也改 `components/chat/chat-room.tsx`，但不同位置）。

## 当前任务

Life Mode 回复与主动消息的气泡按用户设置的间隔逐个出现（lan 验收 PR-B 时发现三个气泡同时出现；lan 选择单独小 PR）。待审查；PR-B 验收后交 lan 验收。

## 谁在改哪里

Claude；分支 `claude/life-bubble-pacing`。
- `components/chat/use-background-reply-reveal.ts`（新增）
- `components/chat/chat-room.tsx`（接入一行）
- `tests/background-reply-reveal.test.ts`（新增）

## 已完成

- 原因：气泡间隔队列只在聊天页自己发起的回复里使用；Life Mode 与主动消息由应用级入口发起，finalize 一次写入全部气泡。
- 修复：聊天页看到不是自己发起、且本页引擎仍在运行的生成时，用同一个队列和同一套间隔逐个显示。只改显示，不改存储，不增加模型调用。
- 本地 Node 22.22.0：新测试 4/4；聊天、气泡、Life、主动消息相关测试 533/533；typecheck 通过；eslint 无新增问题。

## 尚未验证

- iOS 真机效果。
- 另一个标签页发起的回复不做间隔（本页引擎不在运行），按原样一次出现。

## 下一步

等 CI 与 CodeRabbit；PR-B 验收后交 lan 验收；不自行合并。
