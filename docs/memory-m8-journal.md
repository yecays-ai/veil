# Memory M8 · Journal 施工记录

基线 `main 21369721e77a031aad4410b53d55767dd48396ae`。Journal = 用户自己写的、按关键词触发的、归属单个 Character 的记忆；独立于 Memory Bank 的自动/手动记忆，也不是 Lorebook。

## 存储（最小调整）

复用 `memories` 库，`origin: "journal"`、`kind: "journal"`、`subject: "character"`，新增可选字段 `keywords`（仅 Journal 行有）。**不升级数据库版本，不改备份 manifest/格式版本**；备份校验器的 `memoryRow` 认识 `origin: "journal"` 与 `keywords`，并对 Journal 行强制 `journalRowProblem`。Character 隔离、备份恢复、删除 Character 清理沿用现有 `characterId` 机制；Journal 无来源，清空聊天不会影响。

规则（`lib/memory/journal.ts`）：正文 1–500 字；1–10 个关键词，每个 ≤40 字，规范化后不可重复；始终 active；无来源、无 lineage。这些上限（10×40）是施工时定的默认值，Lan 可改。

## 触发

仅关键词（NFKC + 小写的字面子串匹配），无语义检索、无权重。一次请求最多注入一条；多条命中按创建时间早者优先、再按 id（确定性）；无命中不注入。

扫描范围（`journalTriggerTexts`）= 本轮新用户消息 + 紧邻其前的连续 Character 消息（上一条回复及主动消息）。因此用户命中 → 立即对应的回复请求；Character 命中 → 下一次 Character 请求；每条新消息只被判断一次（下一次请求的扫描窗口从本次输入之后开始），不存状态、不重扫历史、不增加模型调用。命中的条目不常驻：下一轮靠正常 Recent History 延续。注入走自己的配额，不占 Memory 的 5 条 / 2000 字；以 `JSON.stringify` 的数据形式放入 memory 槽，内容是数据而非系统指令。

注入受预设的 `memory` 槽位（与 Memory 相同）约束；扫描 Character 消息还要求 History 槽位启用（未发给模型的消息不触发）。

## 与自动维护隔离

自动写入守卫由 `origin === "manual"` 改为 `origin !== "auto"`（storage `applyChange`、progress 的候选/提交校验），维护候选与上下文检索只看 `origin === "auto"` / 排除 journal。重复检测按“是否 Journal”分域。Journal 行不能转成非 Journal 或反之。

## UI

Memory Bank 页内一个 Journal 区块（添加/编辑/删除，关键词逗号分隔）；主列表、类型/来源筛选不显示 Journal 行。Journal 增删改与现有操作共用最近 5 步撤销，不写 suppression。

## 测试与未验证

`tests/memory-journal.test.ts`（关键词命中/未命中、多关键词、竞争条目、单次注入、不重复注入、Character 命中、手动保护、跨 Character 隔离、备份校验与恢复往返、数据形式注入）与 `tests/memory-bank-ui.test.ts` 新增 Journal UI 用例。证据级别：自动化（fake IndexedDB / JSDOM / stub provider）。未验证：真实模型对 Journal 内容的反应、iPhone 真机。
