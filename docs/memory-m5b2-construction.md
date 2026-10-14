# Memory M5b 第二刀施工记录

基线：`main 9fe2a5e324b40a1f6cf45b894a7d6b8f4c6db739`（PR #160 的合并提交）。2026-10-13，Codex；分支 `codex/memory-m5b2-production-wiring`。总账 ID：新增 Memory M5b2；不改变原 F/S 编号。

本刀只接通合格增量消息 → 空闲检查 → M5a 领取/派发 → 维护模型 → 第一刀严格解析 → 来源复核 → 原子 Memory/进度提交。验收话：默认关闭，启用后每批最多一个请求，聊天可继续，失败不伪装成功。停止条件：定向自动化验证和独立 PR；不合并、不启用、不部署、不进入 M6–M8。

## 默认关闭及启用前置条件

施工、CI、预览均未启用自动维护；未写实际设备 consent，未调用真实模型。Root 的 gate 在关闭时不读维护存储、不创建调度器；维护实现延迟加载。ChatStorage 默认同样关闭序号追踪。

未来启用须先取得 Lan 的单独批准，并同时满足 production 构建、`NEXT_PUBLIC_MEMORY_MAINTENANCE_APPROVED=true`、`NEXT_PUBLIC_VERCEL_ENV=production`、非 CI，以及本设备 `veil.memory-maintenance.consent.v1=enabled`。未知环境、preview、development、test、未授权构建或无 consent 均关闭。配置入口为 `maintenance-config.ts` 的受限 setter；本刀不增加维护状态/重试界面。consent 不进入既有备份，恢复不会授权另一台设备启动付费维护。不得把构建通过当作启用授权。

## 资格、空闲与批次

- 沿用 `memoryMessageEligible`：已持久化 User；出生于启用 epoch 且完成、确认的 Assistant。未确认的最新 Assistant 仍允许 Regenerate/Continue，不因空闲擅自确认。确认仍在下一次 User 发送事务发生，多气泡按现有顺序分配。错误、取消、streaming、system、群聊及旧消息不分配。现有产品没有独立 OOC 字段/功能，不新增猜测式 OOC 词面分类。
- 默认运行句柄使用动态 gate；启用后首次新发送事务内初始化 epoch、确认有 birth 的旧 Assistant、分配新 User seq。旧内容没有 birth，永不回填。显式 boolean 注入仍保留 M5a 的手动激活语义。关掉以后出生的消息同样不回填。
- 持久聊天活动取该 Character 所有 direct session 的最大 `updatedAt`；发送、完成回复、编辑/删除/清空都会保守推迟整理，system 事件不改变它。generation 存在时不派发。时钟回拨到活动之前继续等待，不用消息 ID 排序推断时间。
- 五分钟仅是最早检查门槛。只在可见且可运行页面启动；初始挂载、chat storage 通知、focus、visibility 恢复及 bfcache pageshow 重查。pagehide/卸载终止页面所有权，已派发结果按 uncertain 恢复。未错过门槛，也不承诺 iPhone 后台准时运行；没有 Service Worker、服务器定时任务。
- 每次 owner 工作至多处理一个批次；成功后再检查下一增量。工程参数为最多 20 个 seq、优先让新消息序列化不超过 12,000 字符，整条保留；第一条过长仍按完整输入护栏判断。一旦准备，来源和范围固定，新聊天进入下一批。

## 费用与提交协议

Character owner 复用 M5a `veil-memory:<id>`；证据核验、模型绑定复核和状态写入复用现有备份独占 scope。领取及 `in-flight` 持久化均发生在 provider 调用前。相同 Character 的竞争 tab 返回 busy，只在 5 秒后重查 owner/持久状态，不是模型重试。不会用最终写入去重代替费用防重。

派发前在同一独占租约内再次检查活动、generation、开关、来源以及实际模型 ID/model/base URL/key 是否仍相同。读取配置的冷打开在取得该租约之前完成；scope 传给最终读取。网络等待不持有备份独占锁。新聊天不取消旧批次：允许 post-dispatch 状态/最终提交时存在新的 generation，但仍复核固定消息摘要、candidate 摘要、Character、epoch/incarnation、清空意图及当前 manual/suppression。新聊天不是 blanket version 失效条件。

维护绑定沿用第一刀：未显式覆盖时继承实际 Messages binding，显式 disable/无效/删除不 fallback。只用既有 provider 一次，无评分、翻译、JSON 修复或二次整理模型。只送本批消息、第一刀候选与保护约束、Character ID/name；不组装聊天 Preset、History、完整 Background 或 WorldBook。memory marker 不控制维护。

保持第一刀上限：完整输入 24,000 字符、候选含 lineage 8,000 字符、响应 12,000 字符、20 操作、条目 2,000 字符、输出 `maxTokens=2,000`。90 秒总请求截止加既有 provider 连接/流空闲截止；输出溢出中止。字符护栏不是精确输入 Token 预算，输出 maxTokens 也不是输入预算。候选为小集合全量 active auto 或独立受限选择，绝不复用 M4.1 的五条。

| 持久状态/结果 | 自动处理 | 进度 |
|---|---|---|
| 未派发 ready | 复核并刷新证据；有限 claim | 不提前推进 |
| 遗留 claimed | M5a owner 恢复 ready；每批最多两次安全 claim | 不提前推进 |
| in-flight/commit-pending owner 丢失 | recover 标 uncertain | 不重发、不成功 |
| 网络错误、超时、关闭、取消或响应超限 | 保守 uncertain，包括派发预留到 fetch 的中断窗口 | 不重发、不推进 |
| 已收完整响应但结构/来源非法或 truncated | failed；本执行器不自动重试付费请求 | 保留失败空洞 |
| 已取得合法结果但最终提交失败 | uncertain 或遗留 commit-pending，由现有恢复协议处理 | 不部分写入、不推进 |
| 合法 IGNORE/受保护候选被合法丢弃 | 严格校验后提交空计划 | 同事务完成 |
| 真正删除形成的空批次、从未 claim | `completeEmpty`，不调用模型 | 原子完成 |
| too-large | 不截断/不送出，保留待处理 | 不冒充 IGNORE |
| 敏感/非法预检、曾 claimed 后来源全删 | 既有 claim → failed，不调用 provider | 保留失败空洞，后续新范围可继续 |

failed/uncertain/too-large 不换 token 重发；已有未完成范围继续占据空洞，后续新范围可以完成但连续水位不能跨越它们。两次安全 claim 均被请求前中断后保留 ready，不无限恢复。无维护重试 UI；这些保守阻塞状态的后续显式处理仍待未来授权。clear/删除/恢复使旧 token 失效时，本执行器不重建旧 cursor 或旧来源。

## 安全及自动化证据

自动写入仍只有 `commitAutomatic`；Memory 与进度同事务，不写 suppression、用户五条 Undo，不修改 manual。第一刀操作白名单、source/text suppression、lineage、备份 nonce/ABA 均复用。无存储版本迁移、聊天检索、正常 provider 或模型绑定逻辑重构。

基线 Red：用当前 main 的已校验 `progress.ts` 编译产物替换测试沙箱中的协议，新增“旧批次在新 generation 下完成”样例因 authority 拒绝而失败（exit 1）；恢复修订产物同样例通过。另以已发布的初版 runner 在测试沙箱复现敏感预检被留作 ready（Red，exit 1），修订后保留失败空洞且下一有效批次通过；安全领取后来源全删也有回归。未替换真实 main/旧分支源码。

截至本地验证：Node 24.19.0 / Next 16.3.8，定向 **645/645，零跳过**，包含 38 项本刀测试；测试编译、typecheck、改动路径 lint（无错误/警告）通过。webpack build 24 页通过。实际命令：

```text
node node_modules/typescript/bin/tsc --project tsconfig.tests.json --outDir .m5b2-tests
node --test --test-concurrency=4 .m5b2-tests/tests/memory-*.test.js .m5b2-tests/tests/binding-*.test.js .m5b2-tests/tests/backup-*.test.js .m5b2-tests/tests/usage-baseline.test.js .m5b2-tests/tests/chat.test.js .m5b2-tests/tests/regenerate.test.js .m5b2-tests/tests/continue.test.js .m5b2-tests/tests/generation-*.test.js .m5b2-tests/tests/network-timeouts.test.js
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js <本刀修改的 TS/TSX 路径>
node node_modules/next/dist/bin/next build --webpack
```

测试含：五分钟前/恰好门槛、无消息/无绑定零调用、合法 IGNORE/空洞、两个真实模拟锁客户端费用防重、新聊天/新 generation 与固定旧输入、删除/编辑/clear/Character 删除/晚到 manual 和 suppression、非法输出/ID、网络/总截止/取消、提交故障、claimed/unknown 恢复、失败空洞、长消息整条、恢复门禁、默认关闭 StrictMode/重挂载/生命周期、busy 重查及停止后迟到读取。继承 M5a 备份恢复、序号、lineage、Undo 和 M4.1 回归；没有跑无关全仓测试。

仅 stub provider + fake IndexedDB/Web Locks 的 30 次暖演练（31 条保留消息、15 个候选）：300 次独占 scope，hold p50/p95/max = 0.707/1.643/6.484 ms；runner p50/p95/max = 8.523/13.363/20.207 ms；最大非争用等待 0.045 ms。另注入 snapshot 占用：等待约 19.5 ms，提交只在释放后完成；provider 等待期间 snapshot 和聊天均能取得锁。不是 Safari 或真实网络性能保证。

真实 provider adapter 只接 stub fetch：一批一条 `memory-maintenance` M0 数字记录，含模拟 120/9/129 Token；不记录正文，不把模拟用量当真实费用。其他测试调用全部是 stub。生产开关、tracking 默认关闭且无真实网络/付费调用，未修改用户数据。

## 未验证与人工验收

CI/最新预览/CodeRabbit 以 PR 当前 head 为准，不能拿本地通过替代。真实模型输出质量、费用、实际输入 Token、iPhone Web Locks/后台暂停/强制关闭和大 History 锁耗时尚未实测。M0 未取得真实维护样本，不能宣称字符护栏适配所有模型；候选词面筛选和敏感文本过滤保持第一刀能力边界。已有 M3 iPhone 操作验收与 M4 Pickles 正向观察保留，不升级为 M5 验收。

后续取得启用/费用授权后，用隔离测试数据：正常对话包含可记忆事实；等满五分钟并在可运行页面检查自动记忆；维护时继续聊天检查新消息下一批；验证 manual/删除压制/不同 Character；iPhone 切后台/锁屏/返回/刷新和两个 tab；记录真实请求数、提供的 Token、耗时及费用；注入非法/网络异常确认 uncertain 不重发。完成这些之前不对既有用户数据启用。本 PR 结束后等待 Lan 审查，禁止继续 M6–M8 或新增维护 UI。

修改路径：`lib/chat/storage.ts`、`lib/memory/{progress,sequence}.ts`；新增 `maintenance-{config,runner,scheduler,browser}.ts`，维护输入注释更新；root layout/gate；新增两份对应测试；本记录、handoff、AUDIT_LEDGER 和独立 work-status。第一刀解析器、候选算法、存储/lineage/backup 格式及 M4.1 检索算法保持既有实现。
