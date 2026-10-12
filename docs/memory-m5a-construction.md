# Memory M5a — 存储与进度地基

基线：`main fa464aa380d548d1c5997989d62df12af8b9af80`（#158 已合并）。施工及发布前通过 GitHub integration 复核 main 与开放 PR；开放 PR 为空。独立源码快照的 609 个版本文件逐一核对 Git blob SHA，未覆盖其他 checkout。基线审计依据为该提交的 `docs/AUDIT_LEDGER.md`。

## 范围与生产关闭证据

本 PR 仅完成 M5a。`MEMORY_TRACKING_ENABLED = false`；生产 `chatStorage = new ChatStorage()` 沿用默认关闭值，激活入口在该实例上拒绝执行。`MemoryProgressProtocol` 没有生产实例、调度器、聊天完成回调或 provider 依赖。没有启用提取、维护模型、用量统计、M6–M8 或维护 UI。

生产模型调用增量为 **0**。定向测试拦截网络访问，普通聊天持久化与多气泡回复无网络新增；已有普通回复、Regenerate、Continue、取消及 Memory 上下文引擎回归通过。`lib/memory/context.ts`、聊天 prompt/engine、provider、模型绑定及 5 条/2,000 字符护栏与基线 blob 相同。

## 数据与提交协议

- 保留 Memory 四个 store 与数据库版本；新增字段均可选。旧聊天不回填。会话 `memorySequence = {epoch,nextSeq}`；出生于启用 epoch 的消息才具有分配资格，User 持久化、Assistant 完成且确认后分配。计数器与资格确认在 Chat 同一事务内；删除与重排不复用 seq，清空更换 epoch。
- Cursor `extraction` 保存 epoch、恢复 incarnation、连续完成水位、已完成区间及待处理批次。批次保存范围、来源 ID/seq/SHA-256、候选版本摘要、attempt/owner 与状态；不保存聊天正文或模型结果。后续范围完成不能跨越失败空洞。
- 唯一自动入口为 `commitAutomatic(ticket,{put},signal)`。旧 `applyChange(...,{auto:true})` 拒绝执行。自动入口不接受 remove/suppression，不写用户撤销 store；保护 manual ID、manual 精确冲突与 suppression。UPDATE 保留前值并派生 previousStatus，MERGE 保留原始来源并校验关系，REINFORCE 不改正文或删除旧来源。
- 来源核验读取已存在的 Core/Chat；不 bootstrap、不升级、不修复 generation。提交前重新核验 Character、session、epoch、消息资格/正文摘要、候选版本及候选来源是否仍存在。任何失败不推进成功水位。
- Memory 修改与批次完成进度在同一个 Memory 事务内，监听终态 complete/abort。注入进度写失败和取消可回滚已经排入事务的 Memory 写入。
- 每个 ticket 只属于一个 attempt；明确失败的重试或安全刷新产生新 capability，保留 attempt 次数。恢复替换与回滚更换本地 incarnation/clearToken，包括逻辑内容完全相同的替换，防止 ABA。

| 状态 | 有限恢复授权 |
|---|---|
| ready | 当前 Character owner 可确认来源后 claim；不自动派发 |
| claimed | 持久化后才允许标记 in-flight；旧 owner 退出后，新 owner 可恢复为 ready，次数保留 |
| in-flight | 必须先落盘再由未来 M5b 派发；owner 丢失转 uncertain |
| commit-pending | 结果只在 RAM；同 owner 可重试本地提交；刷新/owner 丢失转 uncertain |
| failed | 仅明确失败；新 ticket 可有限重试，`maxAttempts` 由调用方工程配置传入 |
| uncertain | 保留，不自动重发，不发放恢复提交 ticket |
| too-large | 保留，不截断后记成功；只有显式重新评估完整输入才能解除 |

`recover`/`refresh` 是被动接口，没有在启动流程中调用。刷新仅允许 ready/failed/too-large，不能刷新已派发或 uncertain 批次；attempt 次数不重置。M5b 仍须提供明确失败分类、输入/输出预算和调度参数，不能把网络错误一概称为已知失败。

## 锁协议与删除交错

短提交保护复用 `veil.persistence.snapshot.v1` 独占模式，没有新增跨库提交锁。按 Character 的维护任务所有权遵守 v2 已批准的 Character 加锁方向；M5a 仅提供被动 `withOwner`，不在生产取得任务锁。

共享入口包括所有 Chat write transaction、Core/Memory writes、聊天 clear/delete 完整逻辑、Character 删除与清理。两个聊天 UI 清理闭包传递 scope；Foundation 冷读也传递现有 scope。启动清理每个意图取得独占 scope 后重新读意图、Character 与聊天来源；没有锁或无法核实时 defer。

锁顺序：Character 维护 owner → 备份独占 → 只读来源 → Memory transaction；独占期间不取得 generation lock、不调用可写的 `readSession`。普通清空的 generation probe 为非等待式，未进行共享到独占升级。scope 的品牌、所属 gate 和 active 状态均核验；冷读取不会申请嵌套共享租约。未 await 的已受理子操作也不能越过 scope/owner 的租约终点。

两种交错均有测试：

1. 删除/clear intent/编辑先完成 → 新来源核验或 cursor/epoch/version 核验失败 → 迟到结果拒绝写入。
2. 自动提交已核验来源并持有独占 → 删除共享入口等待 → Memory transaction 完成/中止 → 租约释放 → 删除意图和清理覆盖已提交记录。

恢复 journal 的存在（包括损坏值）阻止普通共享/独占写入；restore 内部 passthrough 不具备自动提交所需的独占 scope。已 claimed/dispatched 的批次阻止备份包输出及本地替换，需先经所有权恢复；没有新增维护状态/重试界面。

## Lineage 清理

来源清理保持 manual 正文、类型、主体和状态；仅移除删除的来源。自动 UPDATE/SUPERSEDE 在有效后继消失后恢复前值状态，部分链删除会接续至仍有效的后继。多层 MERGE 展开到有效 originals；REINFORCE 仅移除对应证据。manual 权威、仍有效的 suppression 和其他活跃覆盖阻止复活。

缺失节点、环或不互相对应的合并链所在受影响自动组件保留正文、置 flagged，并保存 `clearLineageIds` 和清理意图；后续续做不会因来源已被剥离而误认为清理完成。manual 单独的历史 dangling metadata 不撤销用户权威。意图 clearToken 与恢复 nonce 防止同毫秒/恢复后的旧失败记录污染新意图。

## 修改文件

| 文件 | 原因 |
|---|---|
| `lib/memory/progress.ts`, `progress-types.ts` | 受限自动提交、持久批次、范围/状态校验、owner/ticket 与有限恢复 |
| `lib/memory/sequence.ts`, `source-read.ts`, `types.ts` | 被动稳定序号、严格只读来源、可选数据字段 |
| `lib/memory/storage.ts`, `lifecycle.ts`, `lineage.ts`, `startup.ts`, `browser.ts` | 事务终态、自动隔离、跨库 scope、来源与 lineage 清理/续做 |
| `lib/chat/storage.ts`, `types.ts` | 默认关闭的序号协议、资格分配、epoch 重置、只读来源与 scope |
| `lib/core-document-storage.ts`, `lib/foundation-storage.ts` | 冷读 scope、严格只读 authority、等待事务终态 |
| `lib/backup/persistence-write-gate.ts`, `validation.ts`, `restore-preview.ts`, `restore.ts` | 复用独占锁、备份字段/引用校验、活动批次阻止替换、恢复 ABA |
| `components/chat/chat-room.tsx`, `messages-home.tsx` | 清空/删除闭包传递 scope |
| `components/settings/backup-restore.tsx` | 现有 Backup 阻止替换提示新增一项，无维护 UI |
| `tests/memory-{m5a-red,progress,progress-backup,progress-performance,sequence,lineage,source-read}.test.ts`, `memory-progress-fixture.ts` | 故障、交错、所有权、恢复、序号、lineage、只读与性能测试 |
| `tests/memory-storage.test.ts`, `memory-startup.test.ts` | 适配独占测试门禁；保留旧回归并增加意图 ABA 样例 |
| 本记录、`docs/work-status/2026-10-12-codex-memory-m5a.md` | 施工证据及单独任务交接 |

## 实际验证

环境：Node **24.19.0**、TypeScript 5、Next **16.3.8**、fake-indexeddb **6.2.5**；复用已有依赖，没有新增依赖。

- 原始缺口复现：**4/4 Red**；最终这些用例 **4/4 Green**。
- 一次全量回归：**1,396/1,396**。此后最终序号边界和只读来源收敛仅重跑影响范围，最终 **558/558**（Memory、Chat storage/请求生命周期、Backup、Core、Character 删除及 generation）。不将旧全量结果冒充最终源码的全量重跑。
- 恢复任务后再次编译并核验来源/进度/启动/序号：**45/45**，缺失库不创建、未知版本不升级、冷打开及删除交错通过。
- 测试编译及 `tsc --noEmit --incremental false`：通过。
- 改动及直接相关路径 ESLint：**0 errors**；`chat-room.tsx` 原有两条 Hook dependency warning 保留，没有处理无关 Hook。
- 最终 `next build --webpack`：通过，24 个静态页面生成成功。首次受限执行器 mkdir `.next` 被拒绝；获准执行本地构建后通过。没有部署。
- React 技能清单仅检查三个 TSX 改动点：没有增加 Hook、订阅、组件或渲染数据读取。
- 生产开关测试：关闭、激活被拒绝、不生成新 seq/cursor；网络拦截新增请求 **0**。检索、prompt、engine、provider 和绑定文件与 main 的 Git blob 相同。

独立性能探针（模拟 IndexedDB，51 条消息、25 个候选，50 轮被动批次、250 次独占租约）：持有时间 **p50 1.249 ms / p95 2.362 ms / max 5.828 ms**；无争用等待最大 **0.145 ms**。注入 10 ms 独占暂停时，共享 writer 实测等待 **22.881 ms**，且仅在释放后继续。数字包含本机调度，不能视为真实设备保证或新的产品阈值。所有探针调用新增生产模型请求均为零。

## 风险与待验收

- 尚未做真实浏览器多标签页、页面强制关闭、iOS/WebKit 或大容量/极深 lineage 的真机验收；fake IndexedDB 和锁模拟器不是设备证据。
- 来源读取会读取对应 session 的本地消息集合，维护候选亦核验已有来源。大聊天/大 Memory 的锁持有时间仍需实测，不能用本次小样本推导 M5b 参数。没有通过放松核验来缩短窗口。
- 缺 Web Locks 或数据库 catalog 读取能力时安全 defer；普通手动聊天/清理沿用既有共享降级，后台自动提交不能绕过门禁。
- uncertain 以及损坏链保持待处理/隔离，没有新增处理 UI。M5b 不得将这些状态自动重发或伪报成功。
- 新字段由当前备份校验覆盖，旧记录仍可读；不认识这些字段的旧客户端会拒绝新包，应使用支持本协议的版本恢复。
- GitHub CI 和预览状态以实际 PR 检查为准；本地测试/构建不代表 CI 或设备验收。

M5b 必须等待本 PR 由用户手动合并并验收，再单独授权。
