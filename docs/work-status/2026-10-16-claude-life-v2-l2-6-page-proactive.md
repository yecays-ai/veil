# STATUS — 2026-10-16-claude-life-v2-l2-6-page-proactive

更新人：Claude
更新时间：2026-10-16T10:45:00Z
发现范围：2026-10-16 10:30Z 基于 origin/main 32283ccf03a6fdec06d62d9961aecff4d89464a8（含 #226–#231）；GitHub API 查看 yecays-ai/veil 没有其他开放的 Life/Presence PR。

## 当前任务

Life V2 工单 L2-6：Life 页展示模型计划行 + 主动联系前先确保当天计划存在。待审查。

## 谁在改哪里

Claude；分支 `claude/life-v2-l2-6-page-proactive`；PR https://github.com/yecays-ai/veil/pull/232。涉及 `lib/chat/proactive-scheduler.ts`（可选 `prepare` 依赖）、`lib/chat/proactive-browser.ts`（接入 `ensureDayPlan`）、`tests/proactive-contact.test.ts`、`tests/life-day-plan.test.ts`。不碰 `lib/memory/*`、`components/chat/life-timeline.tsx`（见下）。

## 已完成

- Life 页：计划行本来就是 Life 活动（`origin:"plan"`），页面经 `lifeTimeline` 展示；已有测试覆盖：只显示已发生/进行中的，未来行和取消行都不显示（`life-recent-context.test.ts`）。所以页面代码本张不需要改，只做核实，没有新增 UI。
- 主动联系：一次检查里，对“预算和状态都通过、即将给出一次尝试”的 Character，先调用 `prepare`（浏览器里是 `ensureDayPlan`），再发起尝试。预算不够、状态忙/勿扰/离线、群聊的 Character 不触发计划请求。`ensureDayPlan` 自己的认领保证每天每个 Character 最多一次请求；计划失败或超时不阻止本次尝试；准备期间页面隐藏或聊天开始生成则放弃这次尝试（不计入预算，下一轮重新判断）。
- 没有新增后台任务或定时器，没有新增存储。

## 尚未验证

- 没有真机验证；没有用真实模型验证主动消息是否更常引用当天计划。
- 若聊天页刚好已在请求当天计划，`ensureDayPlan` 返回 busy，这次主动消息可能没有计划可用（有界、下一次再用）。
- 未跑完整测试套件（跑了 life/proactive/self-context/presence/chat-engine 相关测试，全部通过；typecheck、eslint 通过；本地 Node v22）。

## 下一步

CI 与评审通过后合并。这是 Life V2 的最后一张工单；之后等 lan 真机验收，并按验收反馈调整常量与提示词。
