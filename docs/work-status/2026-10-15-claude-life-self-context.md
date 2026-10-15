# STATUS — 2026-10-15-claude-life-self-context

更新人：Claude
更新时间：2026-10-15T15:20:00Z
发现范围：2026-10-15 15:10Z 查看 `yecays-ai/veil` 开放 PR 为空（含草稿）；起点 `origin/main` 为 `fd9bf89cf6cbdd20e52e78fbd3c1280c8aa6cf7a`（#207 合并后）。未检查其他分支上的未发布记录。

## 当前任务

待审查。"第一章"：角色回复时知道自己此刻在做什么，以及这项活动里已经"发生"的小插曲。不新增模型调用。

## 谁在改哪里

Claude；分支 `claude/project-thread-iwht8v`；PR：创建后补链接。涉及 `lib/chat/self-context.ts`、`tests/presence-self-context.test.ts`。不改存储、计划生成、Presence 或 `lib/memory/*`。

## 已完成

- `selfState` 用与时间线相同的 `lifeTimeline` 取当前活动：只带活动名；小插曲只有到了固定显示时刻才带，所以角色不会说出 lan 还没看到的事。
- 有生效中的"当前状况"时不带活动（当前状况优先于日程）。后面的活动、明天的活动完全不进提示词。
- 提示词一行，标为背景、合适才提，并要求不要编造当天之后的安排。
- 检查（Node 24.21.0）：`tsc --noEmit`、eslint 0 错误；presence/life/proactive 相关 143 条测试通过，新增 1 条。

## 尚未验证

- 真实模型是否自然地使用这条背景、是否过度提起：需要真机对话观察。

## 下一步

lan 验收；之后讨论"生活事件触发主动联系"。
