# Memory M6 P2：自动维护、Background 复核与 Prompt 接线

核对：2026-10-13，Asia/Shanghai。远端 main / P1 #167 合并基线 `fe6a209f9938d230dc10b60d822508bf1cb436c5`。唯一施工状态见 [work-status](work-status/2026-10-13-codex-memory-m6-p2.md)，唯一审计台账为 [AUDIT_LEDGER](AUDIT_LEDGER.md)。

【总账 ID】既有 Memory / M6 P2，不更改其他命名空间。

【这一刀只解决】P1 Background 保存与来源安全接线、正常维护 State 操作、冲突复核、Prompt 覆盖、Character 只读展示。

【验收话】新 Background 优先，未复核 State 不注入；来源删改撤销整版本并恢复独立前驱；同一次正常维护请求和既有提交边界写入 State，不侵占五条手动 Undo。

【做完划掉】本阶段本地施工及自动化验证；真实模型判断、真机验收与人工合并仍分开记录。

【不做】P3–P5、Journal 产品变化、State 用户编辑、Presence 作息重算、额外模型请求、启用维护/修改 consent、真实数据操作、Production、自动合并。

【停止条件】来源、head、Background、owner、cursor、恢复 incarnation、门禁不合法则拒绝结果；复核未知保持 pending；发布出现非 main Production/提升风险则停止；完成独立 PR 审查后等待 Lan 手动合并。

## 产品决议与工程实现分别记录

Lan 批准：重大持续角色生活变化、角色自主控制/用户只读、角色自述可作证据、原 Background 保留、State 不触发 Presence 请求；D1 新 Background 优先、冲突暂停且保留记录；D2 删除来源撤销失据版本、恢复合法前驱、混合来源保守整体撤销。临时情绪、日常、玩笑、假设、用户经历、Ongoing、Presence、Last Seen、签名不是 State。以下字段、预算、锁及故障协调是本次工程选择，不是假称既有源码事实或新的产品决议。

## A：Background 保存与恢复

生产 Foundation handle 复用同一惰性 Memory handle。Provider 顺序为备份租约 → 已有写队列 → 存储；可用 Web Locks 时取独占租约。已持共享 scope 的 signature/status/角色删除等原调用不升级锁；修改或新建 Background 必须独占，否则写入前拒绝。

顺序：先保留已保存 Background 原快照，Foundation CAS 保存新文档，再追加新快照。这是两个数据库的顺序写入，**不是跨库原子事务**。第二步失败时 Foundation 可能已保存，错误明确返回；新文档与快照文本不一致时 State 一律 pending，不成为事实。load/retry 在同一独占 scope 读取实际 Foundation 并追加缺失版本，旧快照不覆盖。并发读取/写入受同一租约协调，CAS 拒绝覆盖他人文档。

无 Web Locks 时普通 Foundation 读取和 signature/status 保存仍可用；State 不可用，Background 变更安全拒绝。普通新回复/continuation 沿用共享租约，替换来源的编辑/删除/重生成需要独占协调并安全拒绝。未建立可恢复记录的来源替换不能通过降级绕过；这是协调能力限制，真机兼容仍待验证。共享恢复 scope 不自动做快照写入。

## B/C：唯一正常维护请求及 State 提交

现有 release approval / device consent 双门禁、owner、cursor、范围、源证据、uncertain、迟到结果及 restore incarnation 保留。State 开关只是生产协议能力，不启用任何设备维护。输入携带当前 Background id/text 与本角色 State heads 的 id/key/value/status，不向模型输出来源哈希。沿用总输入 24,000 字符、输出 12,000 字符/2,000 tokens 和总操作 20 的原临时工程保护；超限失败，不另发修复请求。State 每批最多 8 个操作，不创建独立维护批次。

`STATE_CREATE`：key/value/backgroundId/messageIds/assessment/compatibility。`STATE_UPDATE`：targetId/value，其余同 CREATE；继承全部前驱来源。`STATE_REVIEW`：targetId/backgroundId/verdict（compatible/conflict/pending）。严格字段、key 64 字符、value 500 字符、敏感值保护、本批合法新来源 ID、最新 head、同角色/当前 Background、同批 key 不重复。assessment 必须显式 character/actual/lasting/major，写入必须 compatible；假设/玩笑/短期/用户经历的判断值拒绝。

模型判断受角色世界、基础设定、提示规则及显式协议约束；**这不是确定性语义真伪分类器**。真实模型对“重大/持续/冲突”的质量未验证。缺复核或 pending 永不默认兼容。compatible 生效，conflict suspended；显式 pending 会撤销旧 compatible review。复核准确绑定 Background 和 State head；新证据/新 Background 使捕获摘要变化即拒绝迟到结果。

readInput 返回独立副本，不能修改 ticket 权限。来源摘要、State 图与当前 Foundation 在 claim/dispatch/commit 复核。最终 State、普通 Memory 和 cursor 进度在同一 Memory IndexedDB 事务提交；失败共同回滚。manual/suppression 保护复核，自动操作不写 Undo，不修改 Journal/manual。只有提交成功才通知只读页面；通知不携带正文。

复核仅随下一次符合原门禁的正常维护处理，不为 Background 修改单独唤醒模型。没有新消息或维护关闭时 pending 可持续存在。预算不足/可靠判断失败会保持 pending，并按既有维护失败语义处理，不能默认 compatible 或额外付费重试。

## D：来源失效、隐私与恢复

State 版本新增可选 `sourceHashes: [{sessionId,messageId,hash}]`；SHA-256 引用对应来源内容与身份，不复制原文，排除 annotation/order/confirmed/outcome 等不替换正文的元数据。P1 无 hash 记录可严格读取/恢复，但不会作为有效事实注入；需正常维护明确复核并绑定实际证据。备份拒绝额外 source 字段、错误 digest、缺失/跨角色来源及已变化的内容。

编辑/删除/重生成在独占租约下：先记录 cursor 定向清理意图，`sourceInvalidation: {messages:[{messageId,hash}]}`（旧证据摘要），执行原 Chat 事务，再运行既有 completeClear/lineage 清理。包括重生成复用首条 messageId、整轮旧气泡和多来源。Chat 事务失败撤回本次 marker；Chat 成功但清理失败保留持久意图并返回错误。此时聊天可能已变更，不宣称回滚了聊天；State 读取/Prompt 不暴露旧值，启动恢复继续完成。

重启比较当前实际 hash：marker 后但 Chat 前中断，证据未变化则撤回意图并保留 State；已删除/替换则仅清理变化来源。重复清理幂等。已有普通 Memory、suppression、Undo 的 lineage/清理原则保留，定向 cursor 保留进度并旋转 incarnation，已分发结果变 uncertain，不重发。

旧版本 tab 绕过新包装时，只读 State 在请求末端按实际消息 hash 隐藏失效版本、虚拟恢复独立祖先；下次正常输入准备物理清理。严格备份在物理清理前拒绝失效内容，绝不静默导出旧正文。任何一个贡献来源失效撤销整个混合版本；隐私代价是仍有支持的片段也可能丢失，不调用模型拆分。

原始 Background 只来源于用户基础设定，不写聊天副本或 State 生成内容；来源删除不通过快照保留聊天。Character 删除复用 P1 六表清理，所有链/来源限定 Character。

## E/F：真实 Prompt 与只读页面

聊天引擎完成原 Weather/Self/Memory 读取后，在实际请求生成末端读取本角色 State、保存的 Foundation 权威及仅被引用的源消息。取消/迟到保护覆盖这次读取；不可用则省略 State，保持基础设定，不发第二个模型请求。没有在最后读取与 Prompt 生成/发请求之间额外异步存储等待。

仅首个启用的 system Character marker 接入：`backgroundBaseline` 为既有 Character 内容，`stateAuthority` 明确用户基础设定与兼容持续变化的权威，`currentState` 表示现在，较早生活字段按历史理解。immutable/world 设定仍由 Background 约束。pending/suspended/撤销项、其他角色/旧基础设定不注入，不重复完整 Background；禁用或 user-role marker 不注入 State。既有 Memory/Journal/History/WorldBook/runtime/self/pending 保留。State 最多 8 条，连同权威说明的序列化覆盖预算 2,000 字符，整条选取不截断事实。

现有 Social Character 资料页展示 State，用户只有查看权；pending/suspended 明确“not active”。加载、错误与 Retry；角色或 backstory 切换即时隐藏旧视图，旧请求/外角色结果拒绝。提交事件、聊天来源变化、focus/visibility 触发本地刷新；组件卸载清理监听/频道。诊断不保存内容，不实现 Context Inspector，不新增计时器或模型调用。

## 持久化/备份兼容

没有新增数据库/store/schema 升级，也未更改主备份 v2 / Memory-domain v2；增加严格识别的上述可选元数据。P1 无 hash 的六表包仍接受，v1 四表旧兼容不变；旧软件严格拒绝新元数据，不能保证向旧版降级可写。恢复按原单位顺序、日志、独占租约、摘要、预览和安全副本执行；成功恢复移除设备 API Key、rollback 保留原安全副本凭据的既有规则不改。

## 自动化验收矩阵

| 边界 | 证据 | 结果 |
|---|---|---|
| 初始/追加 Background、独占并发、第二库失败恢复、共享 scope | 新 fake IndexedDB + 模拟 Web Locks | 通过 |
| 角色自述、排除 assessment、合法来源/版本、不可伪造 ticket | 新 State 协议 tests + stub | 通过 |
| compatible/conflict/pending、显式重新 pending、旧 basis 拒绝 | 新正常提交 tests | 通过 |
| 删除/编辑/整轮重生成、同 ID、清理失败/启动继续/旧 tab | 新来源与故障 tests | 通过 |
| 多来源/前驱恢复/角色删除/损坏 lineage/重复清理 | P1 与本次受影响安全回归 | 通过 |
| owner/restore/uncertain、原子进度/五条 Undo、manual/Journal | 新与既有维护安全回归 | 通过 |
| 实际 Prompt 预算/权威/无重复、一次请求与取消 | 新 Prompt/引擎 stub tests | 通过 |
| 只读 UI 加载/错误/切角色/旧响应/卸载 | 新挂载 JSDOM tests | 通过 |
| strict hash 校验、导出/预览/空/覆盖/回滚/中断继续 | 新及既有 Backup 安全回归 | 通过 |
| Presence/Last Seen/签名、旧 schema/升级失败 | 原受影响回归 | 通过 |
| 真实模型分类与冲突复核质量、iPhone/Safari、多真实标签页 | 未执行 | 未验证 |

Node 24.19.0：受影响回归 **983/983，零跳过**，其中本阶段新 tests **45**；typecheck、改动文件 lint、webpack build 通过。新 State 原子提交测试使用真实 main 对应的编译后 Progress 模块作隔离负对照，因原协议不提供 State authority 而失败；恢复 P2 模块后通过。仅测试产物替换，未修改 main/原工作树/真实数据。首发 CI 的 Chat 删除确认挂载测试缺 Web Locks 导致失败；补齐模拟锁并保留所有原断言后通过，同时新增无锁普通回复/签名及稳定 hash 的 Red/Green 回归。没有增加等待时长或跳过测试。

发布门禁：重读当前唯一 GitHub CI（仅验证）、scripts/package、仓库部署配置，未发现自动合并、非 main Production 或提升动作；无 vercel.json 或部署脚本。Vercel 实时 main `fe6a209...` 为 Production、其他分支为 Preview，正确绑定 `yecays-ai/veil`；Lan 已确认 Production Branch=main。没有修改 Vercel 项目配置。外部不可见自动化不作未经检查的安全保证；本 PR 仅发布独立分支并允许 Preview。最新 head CI/CodeRabbit/Preview 以 GitHub 与唯一 work-status 核对，不把旧 head 成功充当新 head。
