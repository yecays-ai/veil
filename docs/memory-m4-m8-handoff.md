# Memory M4–M8 交接（Claude → Codex）

基于 main：`5002239c756a050741b727cd3409e5b484ef8e2a`，加上 M3 PR（分支 `claude/memory-m3-bank-daase9`）。写于 2026-10-12（UTC）。
权威顺序：已批准《审计更新与最小架构方案 v2》（Q1–Q7）及 Lan 已批准的 Q8 补充决定 > 本文件 > 历史设计记录。本文件只是交接说明，不授权开工：每一刀都需要 Lan 按名授权，产品规则须先讨论。

Codex 接手核对（2026-10-12T16:31:38+08:00）：最新 main `e5239fdca2d434d7f81a8f67a19c88be1a48d33e`；#151–#156 全部已合并，M3 #156 已进入 main。以下旧“待合并”文字属于交接时快照。Lan 本次仅授权 M4 与本交接更新，M5–M8 未授权。

**Q8 已核实的批准规则**：来源为《外部项目对照研究 v2 · AI 伴侣开源清单》，第 21 页、第 5.3 节《Q8 已决定（2026-10-11）》，不是 v2 主方案第四节。Codex 已读取 Lan 指定原始 DOCX 的该节，Lan 本次再次确认选项一：v1 仅提供用户自己最近 5 次编辑和删除的撤销功能；自动维护保留必要旧值（UPDATE / SUPERSEDE 的 lineage），暂不提供查看自动变更或回滚的界面。不建变更集或自动回滚界面。此确认只授权 Q8，不把外部研究的其他建议升级为规则。M4 保持现有撤销实现，不改存储或 Bank；M5 开工前仍须解决自动维护与用户撤销记录的隔离。

M4 施工与证据见 [独立工单](work-status/2026-10-12-codex-memory-m4-context.md)。临时条数/字符护栏不代表精确 Token 预算；本地词面检索的固定样例有明确漏召回，不宣称语义检索已经解决。

## 1. 已完成（交接时施工快照，证据为自动化测试；最新用户真机记录见第 7 节）

| 阶段 | PR | 内容 |
|---|---|---|
| M0 成本基线 | #152 | localStorage 每次真实模型请求一条数字记录（最近 300 条），不含内容，不进备份，无查看界面 |
| M1 关系类型 | #151 | Foundation 关系 `kind`（friend/family/romantic/acquaintance/colleague/hostile/other 或 null），`canCommunicate()` 只对前三种为 true |
| M2a 存储 | #153 | 独立库 `veil-memory-v1`：memories / suppressions / operations（每 Character 最近 5 条撤销）/ cursors；指纹 = NFKC + 小写 + 去空白/标点/符号 |
| M2b 备份 | #154 | 备份格式 v2 含 Memory 域（导出、校验、预览计数、恢复与回滚）；v1 备份拒绝；删 Character 清其 Memory；清空/删除会话先写清理意图 |
| M2 启动续做 | #155 | 启动时续做未完成清理；意图记录目标消息 id（`clearMessageIds`），不按时间猜；不设失败上限；读失败不删除 |
| M3 Memory Bank | 本 PR | 资料页入口 → `/characters/[id]/memory`；手动新增/编辑/删除、撤销最近 5 条、搜索与筛选、来源显示（不显示原文）、跨标签冲突检测 |

## 2. 关键代码入口

- `lib/memory/types.ts`：数据形状。新增持久字段必须同步 `lib/backup/validation.ts` 的严格字段白名单（`memoryRow` / `suppressionRow` / operations / cursors），否则备份导出会拒绝。
- `lib/memory/storage.ts`：`MemoryStorage`。
  - `applyChange(characterId, label, {put, remove, suppress}, {auto, expectUpdatedAt})`：单事务写入并记一条撤销操作。`auto: true` 不能碰 manual 记忆（`MemoryProtectedError`）；同 Character 活跃指纹重复抛 `MemoryDuplicateError`；`expectUpdatedAt` 不符抛 `MemoryConflictError`。
  - `undoLastOperation(characterId, expected?)`：LIFO 撤销；`expected` 不符抛冲突（seq 在撤销后会复用，所以同时比较 createdAt 和 label）。
  - `transaction()`：写入先过备份租约再进本地队列（`withPersistenceWriteScope`）。事务内只能 await 本事务的请求，不能联网或跨库 await。
- `lib/memory/lifecycle.ts`：`deleteCharacterMemory`、`recordClearIntent` / `completeClear` / `resumePendingClears`（lineage 拆回，不调模型）。
- `lib/memory/browser.ts`：唯一实例 `browserMemoryStorage`；`withMemoryClear`（聊天清空/删除调用方）；`resumeBrowserClears`（启动入口）。
- `lib/memory/bank.ts`：用户操作 `addManualMemory` / `editMemory` / `deleteMemory`，`filterMemories`，`describeSources`，类型标签 `MANUAL_MEMORY_KINDS`。
- `components/memory-bank.tsx`：Bank 页面。
- 尚未接入：`lib/chat/engine.ts` 的记忆参数仍传 `undefined`（M4 的改动点）。

## 3. 架构约束（已批准规则，不要改）

- 记忆属于 Character，不是用户偏好档案；各 Character 互不可见。不硬编码任何角色名。
- 用户手动新增/编辑/纠正高于自动；自动维护不能覆盖或删除 manual 记忆（存储层已强制，`auto: true`）。
- 用户删除/纠正写压制记录，自动提取不得复活被压制的指纹（M5 必须在写入前过滤 suppressions）。
- 撤销只针对用户自己的编辑/删除（Q8）。**M5 注意**：`applyChange` 目前每次都记一条撤销操作。自动维护如果直接调用它，会挤掉用户的 5 条撤销，还可能让用户“撤销”自动改动。M5 需要一条不记撤销操作的自动写入路径（或给操作加来源标记并在 Bank 里只撤用户操作）。这一点要先报 Lan 决定方案。
- Memory Bank 永不显示聊天原文；sources 只存 sessionId + messageId。
- 清空会话 A（Q2）：保留 manual 记忆，只移除 A 来源；只来自 A 的自动记忆删除；合并记忆按 lineage 拆回。
- 无 OOC 功能（A7）；无历史回填（Q7）；备份不兼容旧格式。
- 清理偏好：不按时间猜删除目标；读失败不删除；不因 N 次失败永久放弃；无法区分的情况宁可保留数据并说明。
- Character State 与 Presence 独立；Presence 推断不进长期记忆。Here & There 评论不进 Memory v1（Q4）。
- Memory 维护有独立模型绑定，默认继承聊天模型（Q5）；v1 检索本地。
- 工作方式：每刀独立 PR，Lan 手动合并，禁止 automerge/部署；定向测试，不做全仓审计；Vercel 免费额度，少推送。

## 4. 测试证据

- `tests/memory-storage.test.ts`、`tests/memory-backup.test.ts`、`tests/memory-startup.test.ts`（M2）。
- `tests/memory-bank.test.ts`（M3：新增/编辑/删除/压制/撤销、5 条上限与刷新、Character 隔离、跨标签冲突与 seq 复用、清空会话保留编辑过的记忆、删除 Character、搜索筛选、来源描述、Bank 行的备份校验与空设备恢复）。
- `tests/memory-bank-ui.test.ts`（JSDOM：资料页入口、增删撤销且刷新后可撤销、未知 Character、跨标签冲突保留草稿）。
- 运行环境 Node 22（仓库要求 Node 24，未在 24 上跑）。全量 `npm test` 在 M2 时为 1240/1242，失败的 2 项是已知 Node 22 锁争用测试。

## 5. 已知风险与未验证

- 真机专项边界：M3/M4 的用户 iPhone 基础功能验收及聊天观察见第 7 节；备份恢复、跨标签页和强制关闭恢复等专项不在本次记录范围内，不能据此判定基础功能验收失败。
- 跨标签冲突检测按毫秒级 updatedAt 比较，同一毫秒的两次写入理论上分不出（概率极低）。
- Bank 列表只在写入后和页面重新可见时刷新，没有跨标签实时订阅（刻意不加）。
- M2 遗留：没有 `clearMessageIds` 的旧意图会保留旧记忆；从未保存过的 Foundation 文档会让清理一直待处理；无会话/联系人的孤儿 Memory 不在残留检查里；残留清理可能把同一项同时计为已删和失败。
- M3 已定（Lan 2026-10-12 07:36Z）：手动可新增全部五类（含对话延续），手动记忆继续受 manual 保护，M5 不得覆盖、合并或删除；subject 取 `character` / `user` / `other`，手动默认 `character`（v2：记忆属于 Character 自己）。“其他”关联具体对象留给 M5。自动记忆的 subject 取值须与这三个值兼容或由 M5 提案。
- 记忆文本没有长度上限；M4 注入时需要硬上限（数值需 M0 真实数据支撑，不要凭空定）。

## 6. 下一步顺序（依赖见 v2）

1. **M4 记忆进入 Context**（依赖 M3）：`engine.ts` 传入记忆，本地规则选择（CJK bigram 为候选），确定性排序、硬上限，开发诊断显示用了哪些记忆。每轮仍一次模型调用；可回退为传 `undefined`。只注入 active 记忆；不读其他 Character。
2. **M5 自动提取**（依赖 M4）：先解决第 3 节的撤销隔离问题。维护模型绑定、游标与可恢复待处理、只处理已确认回合、按 Character 加锁、任务合并、一批一次调用、硬上限、去重快路径、操作白名单、manual 保护、压制过滤、敏感信息本地过滤、开发演练模式。定义 subject 语义。iOS 后台可靠性需真机测试。
3. **M6 Character State**（依赖 M5）：状态记录、原始 Background 快照不可变、覆盖层进 Prompt 和资料页；与 Presence 协调作息指纹接口。
4. **M7 检索与诊断**（依赖 M5 与 M0 数据）：固定样例测召回/精度，再决定是否评估语义检索；Ongoing 结束与过期；开发环境 Context Inspector（脱敏）。
5. **M8 Journal**（依赖 M4）：用户维护的最高权威角色知识，与自动记忆分开显示。

每一刀开工前：读本文件、`docs/AUDIT_LEDGER.md`、v2 方案；拉最新 main 记录 SHA；查开放 PR；写 `docs/work-status/<task>.md`。

## 7. 用户提供的 iPhone 真机验收记录（2026-10-12 记录）

来源：Lan 在本次对话中提供的 iPhone 实际操作和正常英文聊天观察。此记录是用户真机功能验收/观察，不是自动化测试结果，也不是 Codex 独立操作或请求注入日志验证。

| 范围 | 验收状态与证据 |
|---|---|
| M3 Memory Bank 页面 | 用户确认页面正常打开，列表、添加表单和筛选控件正常显示。 |
| M3 手动记忆基础操作 | 用户已完成新增、保存、编辑、删除和 Undo 的 iPhone 真机功能验收。 |
| M4 英文记忆召回与对话融入 | 取得正向真机观察，具体样例见下文；无独立注入日志，不能宣称技术层面已确认检索命中。 |
| 备份恢复、跨标签页、强制关闭恢复等专项 | 本次记录不涉及；保持独立专项验收状态，不混同于基础功能验收失败，也不因本次观察宣布专项通过。 |
| M5b 自动提取与维护 | 尚未启用，不属于此次验收范围。 |

英文聊天样例（用户报告）：

1. 用户手动添加测试记忆：`Lan's favorite childhood plushie was a purple dinosaur named Pickles.`
2. 随后正常聊天时，用户仅发送：`And I'm with my plushie.`
3. Peter 主动回复：`Is it Pickles? Tell me it's Pickles.`，并提到 purple dinosaur。

该案例支持 M4 英文记忆召回及自然融入角色对话的正向判断。没有独立请求注入日志，因此不将表现推断升级为已技术确认的检索命中，也不将单个样例当作总体召回率或全面质量验收。

Memory Bank UI 较拥挤：用户决定后续单独优化；本次只登记，不纳入当前 M5b 施工，不修改 UI 或代码。M5b 第二刀仍未授权。

## 2026-10-13：M5b 第二刀施工（默认关闭）

后续 Lan 已提供完整第二刀工单及四项修订，授权最小生产接线，不授权实际启用。#160 合并核验基线：`9fe2a5e324b40a1f6cf45b894a7d6b8f4c6db739`。本刀已实现 root 延迟挂载、显式 release/device gate、资格/epoch 接线、五分钟最早空闲门槛、请求前持久派发、provider 单次维护、严格解析和原子提交；默认关闭，施工/CI/预览无真实付费维护调用。

新聊天不取消旧快照；post-dispatch 允许新的 generation，仍按真实来源、候选、manual、suppression、epoch/incarnation 和删除意图复核。页面恢复重查资格/空闲/派发；uncertain 不重发，失败/too-large 不当 IGNORE，保留水位空洞。群聊、旧聊天回填、M4.1 检索、Memory Bank UI、Presence、M6–M8 不在范围。

自动化、性能、成本护栏、保守阻塞状态及后续人工验收见 [M5b 第二刀施工记录](memory-m5b2-construction.md)；独立 [任务状态](work-status/2026-10-13-codex-memory-m5b2.md)。真实模型/M0 费用与 iPhone 专项尚未验证；已有 M3 基础操作验收和 M4 Pickles 正向观察不改变。本刀完成后停在 PR 审查，等待 Lan 手动合并及单独启用授权。
