# Memory M5b 第一刀 — 被动维护能力与隔离演练

基线：main `f60fea1e7dffffeeb14ee8be595456c523267256`，#159 已合并。GitHub API 核实 main、开放 PR；开放 PR 为空。独立目录的 624 个版本文件逐一核对 Git blob，全部一致。没有在旧 `codex/s11-api-key-restore` checkout 上施工，也未覆盖其工作。

权威：用户本次第一刀授权、v2 Q1–Q7、原始外部研究 §5.3 Q8、M4–M8 交接及 M5a 施工记录。已读取本基线 AUDIT_LEDGER；其中早期 Memory 状态按历史处理，未改总账。

## 范围与关闭证据

- `MEMORY_TRACKING_ENABLED` 仍为 false；ChatStorage 默认实例、engine、provider、Memory Bank、Presence、M4.1 检索、M6–M8 均未修改。
- 不新增生产 runner、scheduler、生命周期挂载或 MemoryProgressProtocol 实例。
- Binding 管理器允许选择维护配置，仅持久化用户的模型选择，不能触发维护调用。
- 演练入口位于 `tests/memory-maintenance-rehearsal.ts`，每次建立全新 fake IndexedDB；只接受脚本化字符串或 Error，不能接入真实 provider。没有 browserMemoryStorage、正式配置读取、网络或持久 M0 写入。
- 演练写入只发生在隔离数据库，用来验证真正的提交协议。另一个预存数据的数据库在演练前后内容、撤销和进度均不变；fetch 拦截计数为 0。

## 协议补齐

1. 受限 ARCHIVE/FLAG：同 Character、候选版本和来源有效；禁止修改正文/类型/主体、禁止恢复 superseded 或任意转 active；保留 lineage、manual、suppression 与撤销保护。
2. suppression 在最终 Memory 事务检查规范化指纹 **或**同 session/message 来源。输入/解析阶段也检查；提示词不能替代最终门禁。自动入口不写 suppression。
3. `completeEmpty(ticket)` 仅完成 ready、attempts=0、无来源且无候选的真实删除空洞。提交前二次核验，进度同事务完成；失败不推进；重复调用在当前 incarnation 内幂等；不能给真实消息、failed/uncertain 或已派发任务伪造成功。
4. `readInput(ticket)` 在现有独占 scope 下核验消息与候选摘要，返回当批消息、授权候选、只读 manual 与 suppression。调用方不得在锁内联网。claim/派发/提交仍分别核验，不能把 RAM 快照视为永久权限。

## 绑定与输入

`BindingSlot.memoryApiConfigId` 遵守已有 Global → Character defaults → Messages override 链。未指定时继承实际 Messages API；null 禁用维护；显式失效配置或缺密钥拒绝，不 fallback。绑定 UI 只在 Global/Character 默认层提供独立选择，不新增 App；资源删除及 stale cleanup 将失效维护绑定置 null，备份白名单/资源引用校验同步支持字段。

维护候选选择独立于 M4.1：小规模全量 active auto；超过字符护栏后按本批词项重合选受限候选，稳定排序，不以无关条目补位。合并条目包含完整历史 lineage 依赖供本地校验，但模型输入和操作目标仅为 active，不能操作历史依赖。损坏或 manual 依赖安全拒绝，未修复原记录。

输入为固定任务提示、Character 上下文、新消息、候选和只读约束。全部作为数据；不继承 Preset/Regex/WorldBook。manual/suppression 不因候选截取失去保护。超长整体输入拒绝，不截断后记成功。可能含密钥或令牌时不送出。

临时工程护栏：完整输入 24,000 字符；候选及依赖 8,000 字符；响应 12,000 字符；最多 20 个操作、单条 2,000 字符；未来输出请求参数建议 maxOutputTokens=2,000。本刀没有真实请求使用该参数。字符护栏不是精确输入 Token 预算，也不是模型能力保证；M0 真机数据仍不可取得，第二刀必须继续验证。

## 操作与来源

严格 JSON 操作白名单：IGNORE/CREATE/REINFORCE/UPDATE/SUPERSEDE/MERGE/ARCHIVE/FLAG。拒绝额外字段、非法主体/类型、未知目标、重复修改目标、批次外消息 ID、模型提供的 Character/记录 ID、越权操作及超限响应。新 ID 本地生成。manual 精确冲突、敏感内容、source/text suppression 和精确重复候选丢弃。语义冲突仍需提示和实际模型质量评估，不能把指纹相等检查宣称为语义判定。

UPDATE/SUPERSEDE 的新条目只引用新证据，旧版本与其来源仍保留在 lineage；MERGE 新条目保留全部 originals 来源。REINFORCE 仅追加证据；ARCHIVE/FLAG 只改授权状态。最终提交复用 M5a，Memory 与进度同事务；不写用户撤销记录。

非法结构、脚本化请求失败、来源修改和提交失败均有隔离演练。第一刀不分类真实网络失败、不自动重试、不恢复生产 uncertain；这些由第二刀接线并继续遵守 M5a。

## 验证与成本

实际验证：Node 24.19.0 / Next 16.3.8；测试编译通过；定向 Memory/Binding/Backup/M0/Chat 回归 **561/561、零跳过**，包含 25 个新测试及一个扩充的挂载 Binding 回归；typecheck、改动路径 lint（零错误/警告）、本地 webpack build（24 静态页）通过。首次受限 build 创建缓存目录 EPERM，获准本地构建后通过；未部署。未重复全量测试，不宣称真机或模型质量通过。

命令：`node node_modules/typescript/bin/tsc --project tsconfig.tests.json --outDir .m5b1-tests`，`node --test --test-concurrency=4 .m5b1-tests/tests/memory-*.test.js .m5b1-tests/tests/binding-*.test.js .m5b1-tests/tests/backup-*.test.js .m5b1-tests/tests/usage-baseline.test.js .m5b1-tests/tests/chat.test.js`，`tsc --noEmit --incremental false`，改动路径 ESLint，`next build --webpack`。隔离演练可重复运行编译后的 `memory-maintenance.test.js`，不需要 API key。

修改文件：`lib/memory/progress.ts`、`storage.ts`；新增 `maintenance-{binding,input,operations,diagnostics}.ts`；`lib/bindings.ts`、`lib/backup/validation.ts`、Binding 管理器；`lib/chat/{request-diagnostics,usage-baseline}.ts`；新增 `tests/memory-maintenance{,-binding,-cost}.test.ts`、`memory-maintenance-rehearsal.ts`，扩充 `binding-default-selection-ui.test.ts`；本记录及独立任务状态。

固定合成候选（每条约 200 字符正文加元数据，10% 与主题词项相关）：

| auto 条目数 | 全量序列化字符 | 选择条目 | 选择字符 |
|---|---:|---:|---:|
| 10 | 4,347 | 10（all） | 4,347 |
| 20 | 8,714 | 2 | 866 |
| 100 | 43,650 | 10 | 4,338 |
| 500 | 219,130 | 18 | 7,826 |

本机一次独立探针选择耗时约 0.3–2.5 ms，不是设备保证。这里只比较字符增长与候选成本，不是实际 Token、费用或提取质量评测，也不能据此认定限定候选没有漏召回。

M0 增加 `memory-maintenance` source，保留一次真实请求一条数字记录及 300 条容量；本刀只在测试私有 map 演示记录，不把 stub 当真实付费请求。新增开发诊断仅 RAM，最多 20 条，固定枚举与数字，不收正文/密钥/任意字段，不新增 Inspector 或维护 UI。

## 第二刀需要接线的接口及剩余风险

- `resolveMaintenanceModel`、`selectMaintenanceCandidates`、`prepare/readInput`、`buildMaintenanceInput`、`parseMaintenanceOperations`、`claim/transition/commitAutomatic/completeEmpty`、数字用量与内存诊断。
- 仍需生产激活、触发合并、空闲窗口、provider 单次派发、真实终态分类、有限恢复和前后台取消。网络期间不得持有备份独占锁；uncertain 不自动重发；too-large 不截断后记成功。
- WebKit、多标签页、页面强制关闭、真实模型输出/提取质量、大规模 lineage 及 M0 真实费用尚未验证。词面候选仍会漏语义关联；敏感过滤不是完整 DLP。
- 无需为第一刀启用追踪或调度。生产请求增量为 0；第二刀仍未授权。

等待用户手动审查、合并及验收；不自动合并，不主动部署。
