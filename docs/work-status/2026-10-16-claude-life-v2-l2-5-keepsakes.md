# STATUS — 2026-10-16-claude-life-v2-l2-5-keepsakes

更新人：Claude
更新时间：2026-10-16T10:25:00Z
发现范围：2026-10-16 10:10Z 基于 origin/main 6e498fbbc1206c6d7c8431e2cf2b8d88994bb3ac（含 #226–#230）；GitHub API 查看 yecays-ai/veil 没有其他开放的 Life/Presence PR。

## 当前任务

Life V2 工单 L2-5：纪念物（`life.keepsakes`）。Character 自己判断“几个月后仍然重要”的经历，权重 1–5，上限 20。待审查。

## 谁在改哪里

Claude；分支 `claude/life-v2-l2-5-keepsakes`；PR 见 GitHub（创建后补入）。涉及 `lib/life/keepsakes.ts`（新）、`lib/life/day-plan.ts`、`lib/presence/actions.ts`（`lifeKeepsake` 动作）、`lib/chat/self-context.ts`、`tests/life-keepsakes.test.ts`（新）、`tests/presence-self-context.test.ts`（期望值加 `canKeepsake`）。不碰 `lib/memory/*`（Memory 功能）：纪念物是 Life 记录里的独立小列表，不读不写 Memory。

## 已完成

- 两个来源：每日计划输出里可选的 `keepsakes`（add / 用 K1… 代号 retire，每次最多 4 条），和聊天动作 `lifeKeepsake {text, weight}`（每条回复最多一个）。每日计划没有新增请求。
- 规则：权重 1–5，文本 ≤280；上限 20；同一句话再次出现只提高权重，不重复；已满时只有新条目权重不低于“最低权重里最老的一条”才替换它，否则拒绝（不静默丢弃已有的）；同一次更新先 retire 再按权重从高到低 add。
- 读取：每日计划看到全部纪念物（带代号和权重）；聊天上下文只带权重最高的 5 条（同权重新的优先），不带其余。
- 为空时字段不存在；备份规范化往返相等；删除 Character 的 Presence 记录后不留残余。

## 尚未验证

- 没有真机验证；没有用真实模型验证 Character 是否把“寻常的一天”当纪念物滥记，或是否过于吝啬。
- 额外输入：每日计划多约 100–800 token（取决于条数）；聊天每轮多约 120 token（动作说明）+ 最多 5 条纪念物，未实测。
- 未跑完整测试套件（跑了 life/self-context/presence/actions/backup/engine 相关 621 个测试，全部通过；typecheck、eslint 通过；本地 Node v22）。

## 下一步

CI 与评审通过后合并；随后 L2-6（生活页与主动联系前置）。
