# Memory M0–M2 施工准备

基于 canonical main：`e7b86d0726e603f55232c9f3f52cf43e98f0da8d`（2026-10-12，Asia/Shanghai）。本文件只准备工单，不授权启动，不创建 Memory 库，不修改业务。

依据：已批准《审计更新与最小架构方案 v2》（含 Q1–Q7）、本次夜间总工单、最新执行基线和 `docs/AUDIT_LEDGER.md`。外部项目研究只作背景，不替换 v2。施工顺序采用 Lan 后续决定：先收尾 S11 与在线系统验收，再正式 Memory；不沿用旧总账“Memory 完成后统一做备份”或旧“在线系统未启动”描述。

## 当前接入事实与门禁

- S11 #141/#142 已合并；F1 和未知库护栏有自动化证据；夜间 #143 补图片故障/中断证据、#144 修实际图片摘要缺陷，均待手动合并。在线 T1–T8 已合并，#145 补提交边界证据；Lan 2026-10-12 报告 Presence 已真机验收通过（此前“真实模型/手机验收尚欠”已过期）。
- `lib/chat/request-diagnostics.ts` 已有 CompletionRequestContext.source、真实 usage 解析和 cache-hit/cache-miss 字段，provider 在流式/非流式路径取得 usage。当前输出只在 development 打日志，没有生产有界用量持久存储。估算输入 token 不能当实际 token 或实际费用。
- `CharacterRelation` 当前有稳定 id、双方 Character id、label、两个方向 context 和 sharedHistory，没有 kind/canCommunicate。用户手动 Contacts 与 Universe 的 Character↔Character 关系分开。
- ChatMessage 当前有 id/sessionId/role/status/order/turnId/attemptId/outcome/confirmed。请求 source 是调用分类，不是持久消息来源或 Memory 权威。system 备注事件不是对话 turn，现有 prompt 已过滤；测试连接、作息、Here & There、开发诊断不能成为 Memory 来源。这里不提前改消息 schema。
- 备份已包含 Presence 的独立 localStorage 域，维持 Character/session/message/image 稳定 ID；没有 Memory 域。`static-source.ts` 会拒绝任何未登记 IndexedDB 库（即使空库），唯一本机恢复 safety 库明确排除；新 Memory 必须在开库同 PR 完整接入备份，而非只给数据库名字加白名单。

正式开工共同门禁：Lan 手动合并已审查 PR；确认 S11 和在线系统整体验收（2026-10-12 状态：S11 已验收通过、PR #150 合并后关闭；Presence 已真机验收通过，前置已满足；真机中断恢复缺口作为已接受残余风险）；当次明确授权 M0/M1/M2（尚未授权，本文件仍只是准备）。M0、M1 可独立；M2 依赖 M0 基础及备份验收，不依赖 M1。M0 的实际多日数据用于后续预算/提取上限，不让 M2 在没有模型调用的阶段凭空制定预算。

## M0 成本基线工单

【总账 ID】既有“Memory 系统”登记 / 已批准阶段 M0；不新编总账 ID。

【这一刀只解决】为现有模型调用记录有界、无内容的本机用量与耗时基线，不增加调用。

【执行范围】

- 复用 request-diagnostics 的 source/requestId、provider 的 usage 和已存在的调用链，不建第二套请求封装。覆盖 manual/keyboard reply、Regenerate、Continue、test-connection、presence-routine、here-there-comment 等已有类别；未知用量保留 null，不从字符估算冒充真实 token。
- 记录输入/输出/总 token、供应商返回的 cache-hit/cache-miss、完成/失败/取消、耗时、调用来源和用于比较的模型名；仅记数字/必要分类，不存 prompt、回复、URL、API Key、原始 Character/session 名称。会话长度只保存分布需要的计数，非原文。
- 新增已批准的有界小存储，容量/清理可用具名常量落实；不创建 veil-memory-v1、不改业务 Prompt。可采用现有本机诊断键模式的 localStorage 小存储，明确其非权威诊断性质和备份处理。若选新 IndexedDB，必须在同 PR 证明登记/排除依据并通过未知库护栏，禁止绕过护栏。该实现细节不是新 Memory 架构。
- 费用只有明确可靠的单价与 usage 来源时才算；缺少时显示/记录未知。不自动查价、不新增网络、付费资源或管理平台。失败和诊断写满不得影响回复。

【验收话】流式、非流式、缺 usage、缓存字段、取消/失败都可模拟；每次真实请求最多一条记录，请求数和回复内容不变；容量严格有界，清理可重做，敏感字段未落库，费用缺证据为未知。Lan 正常使用后可导出或查看数字汇总，得到实际会话长度与成本依据。

【做完划掉】M0 数字采集基础的自动化施工；实际多日模型费用/耗时分布另作观测，不在无数据时宣告预算已确定。

【不做】Memory 库/提取、上下文注入、统计后台服务、提示词内容日志、自动模型切换、价格推测、历史聊天回填、用户可见 OOC 入口。

【停止条件】按当次 M0 授权，从最新 main 独立 PR 完成相关测试和审查，等待 Lan 手动合并；不顺手进入 M1/M2。

## M1 关系类型工单

【总账 ID】既有“Memory 系统”登记 / 已批准阶段 M1、Q6。

【这一刀只解决】为 Character↔Character 关系落实已批准类型和纯通讯许可判断。

【执行范围】

- `lib/foundation-types.ts`、`lib/foundation.ts` 与 Universe 关系编辑调用方：kind 为 friend/family/romantic/acquaintance/colleague/hostile/other 或空值，label 保留。既有关系不猜测类型，旧数据空值/缺字段保持既定语义，未知类型归一为空。
- 实现纯 `canCommunicate(relation)`：仅 friend/family/romantic 默认允许；其他和空值不自动授予 Character↔Character 通讯权限。不创建聊天，不改用户手动 Contacts，不实现例外权限。
- 备份 `validation.ts` 的 Foundation 关系白名单/严格往返检查同步认识 kind；保留稳定关系与角色 ID。复用现有 Foundation 写入协调、编辑冲突和删除关系路径。
- 消息来源核对结果沿用上节：请求 source 与持久消息身份分开；M1 不为“预留”发明通用事件/Candidate 系统或改 ChatMessage。未来 M2 sources 只使用现有 sessionId/messageId，自动提取 eligibility 到 M5，按 v2 confirmed/最新可重生成轮次规则执行。

【验收话】七种类型/空值/未知值有表驱动测试；旧关系不被自动分类，label 与上下文往返保留；通讯纯函数不改变联系人；Foundation 备份导出/校验/空环境与覆盖恢复保留 kind，Character 删除不留关系引用。

【做完划掉】M1 类型与通讯判断施工；不核销未来群聊通讯或 Memory 提取。

【不做】Memory 数据库/模型调用、自动创建联系人或聊天、新关系规则、例外权限、旧备份格式兼容层、聊天 UI 重构。

【停止条件】单目标独立 PR 验证、审查后等待手动合并；M1 不依赖 M0，但共同验收/授权门禁仍有效。

## M2 记忆库基础工单

【总账 ID】既有“Memory 系统”登记 / 已批准阶段 M2；Q2、Q7 与 v2 生命周期规则。

【这一刀只解决】建立可隔离、可删除、可备份恢复的 Memory 基础存储和清理意图，不实现自动提取或 UI。

【执行范围】

- 按 v2 独立 `veil-memory-v1`，不塞入 Chat/Core；所有记录按 characterId 过滤/索引，稳定 id。M2 落实 memories、suppressions、operations、cursors；保留 v2 State/backgroundSnapshots 边界供 M6，Journal 为 M8，不提前做这些业务。
- memories 保留 kind/text/subject/status/origin/sources/lineage/时间戳，以及已批准归一化文本指纹与 characterId+指纹索引；sources 只存 sessionId/messageId，绝不复制聊天原文。manual/auto 和 active/superseded/archived/flagged 语义不改。
- operations 按 Character 最近五条，写入时同事务裁剪；suppressions 保存纠正/删除的指纹与来源；cursors 保存会话进度、待处理清空意图、失败次数/失败原因，不静默当作成功，不靠内存恢复。
- 写入/open 接入 `runPersistenceWrite` / `withPersistenceWriteScope`，复用当前全站快照锁；排队顺序保持“备份租约 → 本地队列”，事务内不得网络或跨库 await。不要为 Memory 重建备份协调器。
- `character-deletion.ts`、`character-leftovers.ts` 接入全部 Character 私有行清理；清空/删除会话调用方先落清理意图，可中断重做。只来自 A 的自动记忆删；多源 REINFORCE 去 A；合并记录按 lineage 删除只来自 A 的原记录，恢复其余原记录，再删合并后的记录；手动记忆保留，仅移除 A 来源；压制关联和游标按 v2 清理。不调用模型做拆分。
- 开库同 PR 同步完整备份：`format.ts` 域/版本、`static-source.ts` 库/store/key/schema、`static-export.ts` payload/计数、`validation.ts` 严格结构与 Character/session/message 引用规则、`restore-preview.ts` 计数、`restore.ts` snapshot/单元/writer/摘要/日志/回滚、安全副本、入口域摘要。不能只登记库名而缺数据读取/恢复写入。允许来源消息删除后的元数据按规则存在，不为了过校验伪造源消息。
- 采用新备份格式版本，旧备份以 unsupported 拒绝，写入前失败；Lan 已决定当前开发阶段不做旧格式兼容。保留新格式内重复恢复、中断继续/回滚、稳定来源 ID；API Key 仍排除。

【验收话】fake IndexedDB 覆盖 Character 隔离、manual 保护、五条撤销、指纹、单事务失败、清空 A 的全部类别/lineage、删除角色、意图落库后重开/重复重做。备份包含所有 store，空环境/确认覆盖、校验拒绝、注入失败回滚/中断继续均保留来源 ID；未知库/版本/store 安全拒绝；旧格式不写设备。全量既有删除与备份测试通过。

【做完划掉】M2 基础存储、生命周期和同版备份覆盖的施工证据；不代表 Memory 提取/召回/质量/真机后台可靠性通过。

【不做】模型调用、自动维护调度、Memory Bank/State/Journal 界面、Context 注入、语义检索、旧数据回填、旧备份兼容、OOC 模式、私有记忆跨 Character 读取。

【停止条件】M0 基础已合并、共同验收及 M2 授权满足后开工；按 v2 完成独立可验收 PR。具体施工可按“存储合同与完整备份接入”“删除/清空意图与生命周期”串行拆成两个小 PR，后者等前者手动合并；未全部核销前不开放任何用户/自动写入调用方，不宣告 M2 完成。不提交“建立整套 Memory”大单，不把未合并数据库当 main；验证/审查后等待手动合并，禁止接着 M3。
