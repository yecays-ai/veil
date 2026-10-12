# M5b 记忆决策规则与来源修复 — 施工记录

基线：`origin/main 68f003320b59b2fba85e2e0ca68f6dfc8485d4c4`（施工时再次核对）。依据：Lan 批准的《M5b 记忆决策规则与来源修复 · 方案草案 v1》及其修订。

## 改了什么

1. **UPDATE 来源语义**（`lib/memory/maintenance-operations.ts`）：UPDATE 新条目的来源 = 旧条目来源 ∪ 本批消息，并登记 `lineage.mergedFrom=[targetId]`。SUPERSEDE 不变（只含本批消息，无 `mergedFrom`）。沿用现有 `cleanMemoryLineage`，没有新存储结构。语义是“依赖”：清掉任何一个贡献来源，整条更新结果撤销，旧版恢复；不是逐事实归因。
2. **决策提示词**（`lib/memory/maintenance-input.ts`）：顺序为先识别已有记忆的变化/结束/替换（UPDATE / SUPERSEDE / ARCHIVE），再 MERGE、REINFORCE、CREATE、FLAG，最后才 IGNORE。局部纠错或补充且仍依赖旧信息用 UPDATE，拿不准用 UPDATE，SUPERSEDE 只在新消息独立支持完整替代时使用；不得编造缺失信息。角色事件按角色世界观与语境判断，不按现实可能性；引用的消息必须自身表述该记忆；反复出现且稳定的玩笑可合并为一条 Relationship（写模式，不写玩笑内容为事实）。
3. **候选预算**：只统计发给模型的 active 候选；隐藏的 lineage 原件仍作为授权数据一并带入，不计入预算、不扩大候选数量、不改检索算法。

## 保守边界

- 清除原始来源 A 时，依赖 A 的 UPDATE 结果整体撤销，B 的补充细节随之丢失；已删除来源不残留优先。
- 旧的 UPDATE 记录不迁移、不改写，只有之后产生的记录适用。
- 不增加 checkedCandidates、语义相似度、自动 FLAG/合并/删除；不增加消息日期字段；不改 UI、调度、运行器、绑定、备份结构。

## 验证（证据级别：自动化测试，fake IndexedDB + stub，无网络、无真实模型）

`tests/memory-maintenance-source.test.ts`（新）覆盖：UPDATE/SUPERSEDE 来源区别；局部纠错后删除纠正来源（恢复旧版）与删除原始来源（两版皆无）；REINFORCE 追加独立来源后 UPDATE，再分别删除 A / B / C；MERGE 解卡与 manual 保护（manual 不可作为目标，清理只去掉来源链接）；跨会话；旧版 UPDATE 行不变；候选预算；提示词关键规则与无硬编码角色名；备份往返与恢复后清理。已确认这些测试在旧代码上失败（6 项）。`tests/memory-maintenance.test.ts` 的 UPDATE/SUPERSEDE 断言已拆开。

未验证：真实模型是否照提示词判断（需另行批准的小规模付费评估，暂定四组样例各三次）；iPhone 真机；已存在的重复记忆未清理。
