# 备份恢复引擎（原审计第 5、6 阶段，S11 第 16 单）

依赖：叠在 #134（第 4 阶段预检）之上，**须先合并 #134**。本单尚未接入任何界面，也不会被应用自动调用。

## 做什么

`lib/backup/restore.ts`：把已验证的备份包恢复到**确认为空**的设备；中断后可继续或回滚。不做合并，不做覆盖（第 7 阶段）。

- `restoreIntoEmpty(manifestJson, files, device, locks, options)`：先校验包，持独占快照锁，重新预检（`previewValidatedBackup`）；不是 `empty-restore` 就拒绝，传入旧预检报告且设备已变化则拒绝（`preview-changed`）。
- 写入前先在 localStorage 写恢复日志 `veil.restore-journal.v1`（每个单元的期望摘要）。日志写不进去就一个字节都不写。
- 单元顺序：chat（五个 store 与聊天图片在**同一个 IndexedDB 事务**）→ 外观图片 → API 配置（无密钥）→ 外观/绑定/预设/正则/世界书/联系人/Presence（localStorage）→ foundation（最后）。备份里没有的单元不写。
- 全部写完后重读设备并逐单元核对摘要；任何单元写失败（包括"写进去了却报失败"）或核对失败，立即回滚到空并抛 `restore-failed-rolled-back` / `verify-failed-rolled-back`，日志随之删除。
- 回滚本身失败：日志保留，`recoverRestore("rollback")` 可重试，`recoverRestore("resume", …, 同一个包)` 可继续完成。
- 恢复/回滚只动"空"或"恰好等于日志期望"的单元；出现别的内容抛 `target-changed` 并保留日志，绝不清除或覆盖。
- 恢复用的存储实例使用直通 gate（外层已持独占锁，用普通 gate 会自锁）。新增只给恢复用的 `replaceAll*`（核心文档、外观图片、API 配置、聊天五 store）。

## 摘要口径

每个单元一个 SHA-256；图片只比较 id、创建时间、字节数、MIME（不比较字节内容，和预检一致）；API 配置不含密钥；IndexedDB 行按 id 排序比较。

## 证据与未验证

- 证据级别：自动化测试（fake-indexeddb、模拟 Web Locks、模拟 localStorage）。31 个测试：干净恢复、每个有数据的单元各两种故障注入（写失败 / 写入后报失败）、回滚失败后重试、中断后继续且结果与干净恢复一致、包不匹配、设备被改动、日志损坏/写失败、校验失败回滚、独占锁等待。
- 测试夹具没有外观图片，外观图片单元走代码路径但无故障注入用例。
- 未验证：真实浏览器进程在写入中途被杀（日志保留与下次启动处理属第 8 阶段）；真实设备上"空环境"的定义；其他标签页持有旧内存状态（恢复后须重新加载，第 8 阶段）；Safari/iOS。
- 应用启动时遇到日志必须阻止正常使用并提示继续/回滚：第 8 阶段待办。
