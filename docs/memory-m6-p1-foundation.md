# Memory M6 P1：State 与 Background 快照基础

核对日期：2026-10-13（Asia/Shanghai）。远端基线 `ae5c8999e6feff21b68551e9cf42322b25d6838e`。本次仅 P1；P2–P5 未授权。

【总账 ID】既有 Memory 系统 / M6 P1，不新编其他 F/S/M ID。

【这一刀只解决】State、不可变 Background 版本的数据合同，本地隔离存储、来源清理和完整备份恢复。

【验收话】旧四表内容不重写；State 与快照按 Character 隔离；冲突有明确暂停数据；删除来源物理撤销其 State 正文并恢复合法旧版本；备份/恢复/回滚保留图与来源身份。

【做完划掉】P1 数据基础的本地自动化施工。不得核销真实模型、真机、自动写入或 Prompt 行为。

【不做】维护写入、Foundation 保存接线、Prompt、UI、Presence 重算、Ongoing 到期、Inspector、Journal 行为改动、真实数据操作、Production 部署或合并。Lan 后续仅授权本 PR 的 Preview。

【停止条件】发现非 main 分支触发 Production/提升机制则停止发布；验证与审查后等待 Lan 手动合并，不继续 P2。

## 已批准规则与工程选择

产品规则来自 Lan 本次正式决议：State 由 Character 控制、用户只读，仅重大持续生活变化；允许 Character 自述为证据；原 Background 保留；State 不触发 Presence 作息调用。D1 新 Background 优先、冲突 State 暂停且不删除；D2 来源撤销并恢复仍有依据的旧版本；不额外保存聊天原文。

工程选择（不冒充原有源码事实）：复用同一 Memory IndexedDB，新增 `backgrounds`、`states`，数据库版本 1 → 2。没有新数据库、服务、框架或运行时写入入口。版本关系采用同 Character/同 key 的单链；不实现跨字段合并框架。State 的 key 是内部稳定字段标识，具体生活字段与重大变化判定留给 P2 的授权合同。

## 数据形状与权限

`BackgroundSnapshot`：id、characterId、version、text（原 backstory，允许 null）、createdAt。第一版与后续用户基础设定快照均追加；纯 planner 不提供修改旧快照操作。快照不含聊天来源、State 生成正文或额外聊天副本。

`CharacterStateVersion`：id、characterId、key、version、value、previousId、backgroundId、sources、review、createdAt。sources 严格只有 sessionId/messageId；review 为 null 或显式的 `{backgroundId, verdict: compatible/conflict}`。旧版本和来源保留，已删除来源对应的版本正文则物理移除，不留删除墓碑正文。

严格图校验：ID/版本唯一，快照同角色，前驱同角色同 key、版本递增、无叉链或循环、来源非空且无重复、未知字段拒绝。公共只读接口 `MemoryStorage.readStateFoundation` 在返回前校验，损坏数据报错，不当空数据或有效 State。

新增纯接口：appendBackgroundSnapshot、appendCharacterState、reviewCharacterState、effectiveCharacterStates、cleanCharacterStates。它们只返回数据计划，**不是持久提交权限**。P1 没有 State 的用户/模型 writer。持久化与测试夹具复用现有 Memory 事务；自动维护仍只有现有 memories 提交路径，不能修改新表。

## D1：暂停的数据基础

追加基础设定快照会保留原始版本。旧 State 没有针对最新 Background 的明确 review 时，查询结果为 pending，不能视为可生效；明确 compatible 为 active，conflict 为 suspended。暂停保留完整记录和来源。

纯 planner 拒绝旧 Background id、旧 State head 或跨角色 review。不使用模糊匹配。新 State 计划必须以最新快照为 basis。

**P1 不执行冲突分类、不监听用户保存、不修改实际 Prompt。** P2 必须在已授权的正常维护请求内取得明确复核结果，并确保兼容项继续有效、冲突项暂停；若不能可靠完成，按正式决议停止相关部分。pending 是尚未复核的工程状态，不是断言存在冲突。

## D2：来源撤销与隐私代价

现有 recordClearIntent 现在收集 State 来源；completeClear 在同一 Memory 事务中处理 State、普通 Memory、suppression、Undo 和 cursor。Character 删除遍历全部六张表；只有新表数据的孤儿角色也进入已有剩余记录检查。

任意一个贡献来源被删除，则整个相关 State 版本移除，包括无法分开归因的混合来源正文。仍独立有依据的旧版本可恢复；仍合法的后继版本保留，版本指针跳过移除的祖先。复核仍不适用于当前 Background 的祖先恢复后保持 pending/suspended，不误升级为 active。

代价：可能丢掉混合正文中尚有证据的部分；不调用模型重写或拆分，以避免已删除信息继续保留。合法记录不会把聊天正文复制到来源或 Background 快照。

清理图损坏时同事务回滚并保留持久意图；只读接口拒绝暴露为有效 State，备份严格拒绝损坏图。此故障仍需修复数据合同后重试，不能称为已清除；没有新增自动修复/付费机制。

completeClear 已支持指定 messageId 集合，P1 测试验证其精确撤销和幂等；**现有聊天单条删除入口尚未接入这条 State 清理包装**。当前没有 State 生产 writer，因此不存在新真实 State 可被该入口遗漏。P2 开放写入前必须把单条删除/编辑/重生成导致的来源失效接入可恢复清理与提交复核，不得先开放写入后补隐私链。

## 备份、恢复与旧版

全站备份主格式仍为 v2，Memory 域版本升为 2，六表全部参与导出、计数、严格引用校验、预览、Memory 恢复单元、摘要、继续与回滚。State 来源必须指向现存、同角色的私聊消息；即使有清理意图，也不允许把已删来源的 State 正文导出。

只支持明确已知的旧形状：本地 Memory schema v1 四表只读快照补两张空表；首次正常打开时追加两张表，不重写旧行。错误旧 store/key/index、升级占用、升级失败均安全拒绝，旧行保留。旧 schema 升级后不能降回 v1；回滚恢复数据内容，不宣称回滚数据库版本。

备份 Memory-domain v1 严格校验原四表后，仅在导入副本中补两张空表；主格式 v1 仍拒绝。新 Memory-domain v2 缺任何表、未知字段/图/来源均拒绝；不能通过降域版本隐藏已有 State。该兼容不回填 State、历史估计或原始快照。

空新增表不改变原有 Memory 恢复摘要；非空 State/Background 必须参与摘要和写后验证。旧安全副本缺两表时恢复写入按空表处理，避免破坏先前的中断恢复。

共享/独占备份租约和现有事务协议保留。六表同一 Memory 事务，不把 Memory、Chat、Foundation 跨库工作称为单一原子事务。恢复日志存在时旧写入口被阻止；已有 owner/ticket/incarnation/uncertain 逻辑不改。API Key、maintenance consent、诊断数据的既有备份边界不变。

## 验证与交付限制

25 项新契约/行为测试；Memory、Backup、Presence、Character 删除相关定向回归通过（fake IndexedDB、模拟 Web Locks、stub；最终数量见 work-status）。typecheck、改动文件 lint、webpack build 结果见 work-status。构建过程关闭 Maintenance 授权，无真实模型或 API Key 调用。

尚未验证：真实模型、iPhone、真实后台/旧版 tab。PR/CI/CodeRabbit/Preview 的当前状态见唯一 work-status 和 GitHub 最新 head；旧自动化、真实设备与构建证据不互相替代。

Vercel live lookup 确认 `veil` 项目 `prj_gI46oOhau16NBEuRqcWAvRDAowa9` 链接 `yecays-ai/veil`，main 的已有部署为 Production，其他分支为 Preview。连接器未返回 Production Branch 字段；Lan 后续只读确认该字段为 main、新发布分支仅 Preview，并授权该 PR 的 Preview。检查当前唯一 GitHub CI 工作流、package scripts、scripts 和仓库部署配置，未发现非 main 发布 Production 或自动提升动作。没有修改项目配置；未对不可见的外部自动化作安全保证。

P2 前置：P1 通过人工审查合并；重核最新 main 和重叠 PR；独立按名授权；把上述纯计划接入原有 owner/ticket、来源 hash、clear intent、restore incarnation 和唯一原子 commit，不新建旁路 writer；明确 Background 保存和来源失效适配，再接 Prompt 和只读展示。
