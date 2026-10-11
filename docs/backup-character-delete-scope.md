# S11 第 10 单：Character 删除整项写入范围

基于 main 提交：`5e3eb56e63133b5eb4625e6911ed0f5854ed4d59`（#129 合并后），正式仓库 `yecays-ai/veil`。对应原审计第 3 阶段"快照一致性边界"。

【总账 ID】S11
【这一刀只解决】Foundation 删除 Character 与其后的六步清理（widgets、groups、conversation、contact、bindings、presence）全程持有一次备份 shared 锁。
【验收话】模拟快照排在删除中途时，等整项结束才读取，不会看到"Character 已删、引用仍在"；中途失败时锁正常释放、原错误正常传出；删除顺序、提交点和业务语义不变。
【做完划掉】仅 Character 删除的整项写入边界，S11 整体不核销。
【不做】删除机制重构、图片挂接生命周期、导出/恢复/UI、在线系统、Memory。
【停止条件】提交独立 PR 后停止，等待 Lan 手动合并。

## 实现

`deleteCharacterWithData` 在生成中检查（只读）之后用 `withPersistenceWriteScope` 取得一次 shared lease，Foundation 提交与六步清理共用它。scope 作为可选末位参数贯穿：`FoundationStorage.transact` → `DocumentStorage.replaceIfCurrent`、`ThemeStorage.transact` → `AppearanceImageStorage.publish/collect`、`ContactStorage.transact`、`ChatStorage.listSessions/removeGroupMembers/deleteSession`，以及 Foundation/Theme Provider 的 `commit(update, scope?)`。Binding、Presence 此前已支持。不传 scope 的原有调用路径不变。`cleanupCharacterData`（失败后的重试入口）自身也取一次 lease，重试同样不被快照切开。

## 锁顺序

删除路径是：备份 lease → 域锁 / 会话生成锁。会话生成锁（`veil-chat-v2:generation:*`）以 `ifAvailable` 方式获取，永远不等待：回复正在生成时 `deleteSession` 立即报"A reply is in progress"，该步在报告里标为失败，lease 随之正常释放。因此不会出现"删除持有 lease 等会话锁、回复持有会话锁等 lease（排在独占快照之后）"的环。已缓存的数据库连接不再申请 lease，故各 Provider 在 scope 内的写后刷新不会嵌套取锁；连接被浏览器关闭后的重新打开属于与前几单相同的已知边界。

## 审查后补充

- 清理步骤经 scope 写入失败时，scope 关闭会重抛该子操作的拒绝，导致调用方拿不到 `CleanupReport`。现改为：报告生成后，scope 的重抛不覆盖报告；报告生成前的失败（取锁、Foundation 提交）仍原样抛出。
- Contact 存储原先是"实例队列 → 备份 lease"，与 Binding、Presence 的"备份 lease → 实例队列"相反，已调为一致，避免排队中的写入挡住已持锁的删除。
- 已知边界（未处理，待 Lan 决定）：Foundation / Theme Provider 的 `commit` 仍是"Provider 队列 → 存储 lease"。若同一页内有更早的无 scope 提交恰在独占快照排队后才申请 lease，而删除的 scoped 提交排在它后面，三者会互相等待。触发需要同时出现：未完成的 Provider 写入、备份快照请求、Character 删除；备份入口目前未开放。修复需调整两个 Provider 的排队与取锁顺序。

## 保留的行为与已知残余

Foundation 删除仍是唯一提交点，其前只读；清理失败不阻断其他步骤且可重试；残余数据沿用原机制，未扩大。已记录：某一步失败时快照可在失败后、重试前取到"Character 已删但引用仍在"，导出校验会因 `missing-*` 报错，直到重试完成（原有设计，本单未改）。`reconcileInertReferences` / `removeLeftovers` 的单步写入未纳入。

## 证据和限制

新增 `tests/backup-character-delete-scope.test.ts` 4 条：快照等整项结束且全程 1 次 shared 请求、清理步骤失败（锁释放、报告、重试仍 1 次 lease）、Foundation 提交失败（无改动、原错误、锁释放）、会话锁被占用时不阻塞（修复前第 1、2 条失败）。fake-indexeddb 与模拟锁，仅模拟数据；Safari/iOS 原生 Web Locks 与真机未验收。

仍未覆盖：图片挂接/清理生命周期，快照读取侧与导出的组合及回复生成期间拒绝备份。
