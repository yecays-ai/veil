# STATUS — 2026-10-16-claude-life-v2-l2-4-matters

更新人：Claude
更新时间：2026-10-16T10:05:00Z
发现范围：2026-10-16 09:55Z 基于 origin/main 99ddaacb9408bb8dc9867d671d47ac78b93145f0（含 #226–#229）；GitHub API 查看 yecays-ai/veil 没有其他开放的 Life/Presence PR。

## 当前任务

Life V2 工单 L2-4：跨天事项（`life.threads`）。每日计划的提示词带上事项，模型可以推进、暂停、结束、取消或新开事项；聊天上下文只带进行中的事项。待审查。

## 谁在改哪里

Claude；分支 `claude/life-v2-l2-4-matters`；PR https://github.com/yecays-ai/veil/pull/230。涉及 `lib/life/matters.ts`（新）、`lib/life/day-plan.ts`、`lib/chat/self-context.ts`、`tests/life-matters.test.ts`（新）。不碰 `lib/memory/*`、主动消息调度器、`lib/life/chat-edit.ts`。

## 已完成

- 事项只在每日计划里被改写：同一次模型请求多返回一个可选的 `matters`，和计划行在同一次 Presence 写入里落盘（无新增请求、无新存储键，`life.threads` 在 L2-0 已定义）。
- 规则：进行中最多 3、暂停最多 5；第 4 件新事项以暂停进入；暂停已满则拒绝新事项，不丢弃旧的；恢复暂停事项需要空出进行中名额；finish/cancel 直接移除；进行中 14 天无更新自动暂停（暂停已满则保持进行中），暂停满 30 天移除。
- 提示词：每日计划带全部事项（带 M1… 代号，暂停的标注），要求“通常为空、不为填字段而编造进展”；聊天上下文只带进行中的事项（标题、进度、下一步），暂停的不进入聊天。
- 为空时 `threads` 字段不存在；备份规范化往返相等；删除 Character 的 Presence 记录后不留残余。

## 尚未验证

- 没有真机验证；没有用真实模型验证事项更新是否合理（是否过度新开、是否机械重复）。
- 额外输入：每日计划多约 150 token；聊天上下文有进行中事项时每轮多约 60–150 token，未实测。
- 未跑完整测试套件（跑了 life/self-context/presence/actions/backup/engine 相关 613 个测试，全部通过；typecheck、eslint 通过；本地 Node v22）。

## 下一步

CI 与评审通过后合并；随后 L2-5（纪念物）。
