# S11：原备份审计 F3 中断恢复写入门禁

基线：`65668b881c20d77ea55530b90a406361eee9e517`，正式仓库 `yecays-ai/veil`。

## 已核实根因

`RestoreGate` 首次挂载读取日志；已打开的标签页不会重新挂载，也不能依赖 storage/BroadcastChannel 通知及时送达。`runRestore` 在同名独占快照锁中完成预检、建立安全副本、持久化日志，再写入各单元。成功或完成回滚才清除日志；中断/回滚失败保留日志，但独占锁随回调结束释放。

原 `createPersistenceWriteGate` 仅取得共享租约，不检查恢复日志。因此旧实例可以在独占锁释放后继续写。最小复现：注入覆盖恢复及回滚失败 → 日志保留 → 旧 ChatStorage 写入新消息 → 继续和回滚均拒绝 `target-changed`，日志仍在。该路径已在 main 写入适配器上用模拟数据复现。

## 最小修复与覆盖

普通写入在**取得共享租约后**读取同一设备 localStorage 的 `veil.restore-journal.v1`，有值（包括损坏日志）则拒绝；读取失败也拒绝，不回显异常内容。不能在排队前缓存判断：排队期间恢复可能先建立日志。成功恢复/回滚清除日志后，相同旧实例下一次写入重新检查并可继续。

复用 `veil.persistence.snapshot.v1`，不新增锁、广播或持久化标记。原日志常量提取到无依赖小模块，restore 原导出保留，避免 gate → restore → 存储 → gate 的运行时循环。恢复自身在独占锁内继续使用既有专用直通 writer，故不会申请嵌套共享锁或被日志拒绝。普通外部 scope 不能伪造或过期复用；合法 scope 由整项共享租约保护，恢复不能中途插入。

| 受管理入口 | 现有统一门禁接入 | 本次证据 |
| --- | --- | --- |
| Foundation 核心文档、Chat、API Config、Appearance 图片 | IDB open/读写事务、跨域 scope 使用统一 gate | 已初始化的四库实例分别在中断后拒绝写入，快照保持 |
| Bindings、Contacts、Presets、Regex、WorldBook、Presence | runPersistenceWrite / withPersistenceWriteScope | 各域实例分别拒绝，原始键值保持 |
| Theme 外观 localStorage | images.publish 的共享 scope 内提交 | 外观提交拒绝，不写 localStorage |
| 资源删除及关联清理 | WorldBook/Regex/Preset/API/Character 删除的外层共享 scope；图片删除由对应存储 gate | WorldBook 与 Binding 联动删除直接验证；其他既有范围测试随 S11 回归运行 |

## 竞态与保护边界

- 已开始的共享写入必须全部结束，独占恢复才能建立日志；待在恢复后的写入先等独占锁释放，再读日志，拒绝中断状态。没有依赖通知的正确性窗口。
- Web Locks 不可用时仍检查已存在日志，但不声称 localStorage 检查与异步写入跨标签页原子化。该环境正常写入沿用既有回退，备份/恢复本身因缺少 Web Locks 拒绝，不能把回退包装成严格恢复协调。
- 仅保证同 origin、使用当前 S11 协议的执行器。未升级旧代码、直接操作存储的脚本/DevTools、不遵守协议的执行器不受保护；恢复的摘要检查与 `target-changed` 拒绝仍保留。
- 本单不刷新旧页面缓存或重新设计 Provider。F4 的手动 Reload 产品流程保持；恢复后应 Reload 使用最新整站数据。

## 证据边界

自动化使用 fake-indexeddb、模拟 origin Web Locks、内存 localStorage，及 jsdom/React 的已挂载界面。覆盖确定性中断、继续、回滚、原数据与安全副本、12 类实际写入入口、两种锁顺序、结束后重新写入、损坏/不可读日志、无锁边界。主场景含真实图片字节和模拟 API Key：继续恢复排除密钥，回滚恢复安全副本中的原配置。

原 main 写入适配器上的 17 条负向回归全部失败（仅给旧签名增加不使用的测试注入参数，不改变实现），另单独复现旧聊天写入后两种收尾均 `target-changed`。最新结果见[任务记录](work-status/2026-10-12-codex-s11-f3-interrupted-write-gate.md)和 PR。

Lan 明确允许故障注入作为中断恢复主要验收证据；**iPhone 真机中断未实测**，不以这些测试冒充 Safari/真机进程终止。#147 N1 已合并，且 Lan 报告 iPhone 导出、导入、覆盖恢复和 Reload 已通过。

## 范围外发现：只登记

构造模拟配置元数据完全相同、仅设备有 API Key 的覆盖恢复，观察到设备密钥保留：`digestUnits` 排除密钥，`applyUnits` 因元数据摘要相同跳过 API 单元。本单没有修改该逻辑或规则。它与既定“恢复需重填、不得静默沿用设备密钥”要求冲突，建议独立最小工单处理后再决定 S11 整体验收；不在 F3 扩修。
