# Memory M6 P3：Ongoing 预计复查、自主结束与延期

基线 `main 8a0f79044c6b291906a518bc07a5d717924a348a`（P2 #168 合并）。唯一审计台账 [AUDIT_LEDGER](AUDIT_LEDGER.md)，任务状态见 [work-status](work-status/2026-10-13-claude-memory-m6-p3.md)。

【这一刀只解决】自动 `ongoing` 记忆的预计复查时间、延期、明确结束与推定结束。

【已批准规则（Lan，经 Codex 交接）】预计时间不是完成事实；只在下一次正常维护复查，不新增定时器、后台唤醒或独立模型请求；推定结束复用 `archived`，持久区分“明确结束 / 推定结束”；旧记录不猜测回填预计时间。

【不做】P4/P5、State 变化、Journal 变化、手动记忆（手动 Ongoing 不带复查数据、不被自动维护触碰）、迁移或清理旧记录、启用维护、真实数据、Production、自动合并。

## 工程选择（不是新的产品决议）

- 数据：`Memory.ongoing?: { reviewAt?: number; ended?: "explicit" | "presumed" }`，只允许 `origin: "auto"` 且 `kind: "ongoing"`；`ended` 只允许出现在 `archived` 行上，写入后不可改写。无新数据库、无版本变化；备份校验认识这个严格可选字段。
- 复查时间由模型给相对天数 `reviewInDays`（整数 1–365，仅 ongoing 的 CREATE/UPDATE/SUPERSEDE/MERGE 可带，可省略），本地用同一次维护请求读取的时钟换算成 `reviewAt`；提交闸再次检查不超过 366 天。UPDATE/MERGE/SUPERSEDE 不继承旧时间，没给就没有复查时间（永不“到期”）。
- 到期 = `reviewAt` 已过且仍 active。到期的候选在发给模型的投影里带 `due: true`，并且在候选受预算限制时优先保留；没有消息提到它时提示词要求不动它（只缺席提及是弱证据），所以不会因为沉默被误结束。
- 新操作 `EXTEND {targetId, messageIds, reviewInDays}`：保持 active、更新复查时间、追加引用的来源。`ARCHIVE` 对 ongoing 必须带 `ended`（`explicit` 或 `presumed`），`presumed` 只允许到期的候选；其他 kind 不能带。
- 手动编辑一条自动记忆会去掉 `ongoing`；Memory Bank 对已结束的显示“Ended / Presumed ended”。

## 不增加的东西

没有定时器、后台任务、额外模型请求或重试；到期检查随既有维护请求完成。候选按日常维护的同一预算规则选取。

## 验证与未验证

`tests/memory-ongoing.test.ts`（7 项）：复查时间生成与非法天数/非 ongoing、到期判定与旧记录不到期、`due` 只出现在发给模型的候选且受限预算下保留、EXTEND、ARCHIVE 两种结束与非法组合、提交闸拒绝不合理时间与手动记忆不可带数据、备份校验。证据级别：fake IndexedDB / stub，无真实模型。未验证：真实模型是否按新提示词给出合理天数、是否保守地对待沉默（需另批的小规模付费评估）；iPhone。
