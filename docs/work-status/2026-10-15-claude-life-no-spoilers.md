# STATUS — 2026-10-15-claude-life-no-spoilers

更新人：Claude
更新时间：2026-10-15T15:10:00Z
发现范围：2026-10-15 15:05Z 查看 `yecays-ai/veil` 开放 PR 为空（含草稿）；起点 `origin/main` 为 `91815417e9ec07d40086d4b8655c1aa4d92ad319`（#206 合并后）。未检查其他分支上的未发布记录。

## 当前任务

待审查。Life 时间线观感修正：还没发生的内容不再提前显示。lan 2026-10-15 的决定：未来活动完全不显示，让生活看起来像随机发生而不是预先写好。

## 谁在改哪里

Claude；分支 `claude/project-thread-iwht8v`；PR 链接待创建后补充。涉及 `lib/life/activity.ts`、`components/chat/life-timeline.tsx`、`tests/life-activity-core.test.ts`。只改呈现，不改存储、计划生成、Presence 或 `lib/memory/*`。

## 已完成

- `lifeTimeline` 只返回正在进行和已结束的活动；没开始的活动（包括明天）不再出现。
- 小插曲到活动进行到 30%–70% 之间的某个固定时刻才可见（由 occurrenceKey 决定，刷新不变），结束后一直可见；之前不显示。已存数据不变。
- 页面的下一次刷新点包含活动开始、结束和小插曲到点，不增加轮询或模型调用。
- 检查（Node 24.21.0）：`tsc --noEmit`、eslint（改动文件 0 错误）、`npm run build`、life/presence/chat UI/回归相关 221 条测试全过；新增一条行为测试，旧的"未来活动去重"测试已替换。

## 尚未验证

- 真机：时间线观感、小插曲到点出现的体验。
- 角色自己的上下文还没有读取这套规则（下一张"让角色知道自己在做什么"会复用 `lifeTimeline`，使角色不会提前说出未发生的小插曲）。

## 下一步

lan 验收；之后做"角色知道自己在做什么"。
