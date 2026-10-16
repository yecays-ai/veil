# STATUS — 2026-10-16-claude-life-v2-l2-2-actions

更新人：Claude
更新时间：2026-10-16T09:50:00Z
发现范围：2026-10-16 09:40Z 基于 origin/main 7ea1363a59fa913528624f2971e8272f13d4f0f8（含 #226、#227、#228）；GitHub API 查看 yecays-ai/veil 没有其他开放的 Life/Presence PR。

## 当前任务

Life V2 工单 L2-2：Character 在聊天回复里调整自己当天的计划（延后、取消、替换，或给正在进行的活动补一条细节）。待审查。

## 谁在改哪里

Claude；分支 `claude/life-v2-l2-2-actions`；PR 链接见 PR 描述（开出后补）。涉及 `lib/life/chat-edit.ts`（新）、`lib/life/activity.ts`（`LifeState.actedAt`）、`lib/presence/actions.ts`（`life` 动作解析与应用）、`lib/chat/self-context.ts`（条目清单与动作说明）、`lib/chat/engine.ts`（把本次回复的代号换成行 ID）、`tests/life-chat-edit.test.ts`。不碰 `lib/memory/*`、主动消息调度器。

## 已完成

- 新动作 `life`：`delay`（5–240 分钟）、`cancel`、`replace`（新标题）、`detail`（一条小细节）。每条回复最多一个；改动之后 30 分钟内不再提供也不再接受（`life.actedAt`）。Continue 不提供。
- 只能改本次回复里给出代号的条目：正在进行的活动，和自己的计划行中今天还没开始的几条（最多 5 个）。非法代号、他人数据、已结束或已取消的行一律忽略。
- 已开始的内容不回改：取消或替换正在进行的活动，是在此刻截断，已揭示的细节保留；未开始的计划行取消后保留为 cancelled，不再显示、不再算发生。细节只在没有细节时写入，不覆盖。
- 延后不会侵入后面的计划行或 Situation，遇到时被截短或拒绝；挡路的未开始 Routine 行让位。
- 没有新增模型调用，没有新存储（只多一个可选字段 `actedAt`，首次改动前不存在，备份往返相等）。
- 检查：新增 11 个测试；presence/self-context/actions/engine/life/backup 相关测试文件全部通过；`npm run typecheck`、eslint 通过（本地 Node v22）。

## 尚未验证

- 没有真机验证；没有用真实模型验证 Character 是否合理使用这个动作，以及它是否过度使用。
- 额外输入：有条目时每轮约 +150–250 token（条目清单 + 动作说明），未实测。
- 未跑完整测试套件。

## 下一步

CI 与 CodeRabbit 通过后合并；随后 L2-4（跨天事项）。
