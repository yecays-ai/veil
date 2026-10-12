# Memory M4–M8 交接（Claude → Codex）

基于 main：`5002239c756a050741b727cd3409e5b484ef8e2a`，加上 M3 PR（分支 `claude/memory-m3-bank-daase9`）。写于 2026-10-12（UTC）。
权威顺序：已批准《审计更新与最小架构方案 v2》（含 Q1–Q8）> 本文件 > 历史设计记录。本文件只是交接说明，不授权开工：每一刀都需要 Lan 按名授权，产品规则须先讨论。

## 1. 已完成（均已合并或待合并，证据等级为自动化测试，未做真机验收）

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

- 没有任何真机验收：iPhone Safari 的 IndexedDB、多标签页、中断恢复都未验证。
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
