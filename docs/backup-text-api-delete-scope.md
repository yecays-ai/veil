# S11 第 8 单：Text API 删除整项写入范围

基于 main 提交：`9973b356a631dd546849ff2831ecab2699739088`（#126 合并后），正式仓库 `yecays-ai/veil`。对应原审计第 3 阶段"快照一致性边界"。

【这一刀只解决】Text API 配置删除、Binding 清理及失败回退全程持有一次备份 shared 锁。
【验收话】无新手机入口；模拟快照排在删除中途时，等清理/回退结束后才读取，不会看到"配置已删、Binding 仍指向它"；原冲突及回退行为保留。
【做完划掉】仅 Text API 删除的整项写入边界，S11 整体不核销。
【不做】Character 删除、Presence、图片生命周期、正式导出/恢复/UI、在线系统及 Memory 业务。
【停止条件】定向先行，提交前集中全量检查一次，提交独立 PR 后停止，等待 Lan 手动合并。

## 当前缺口与实现

#125 把 Preset、Regex、WorldBook 的删除、Binding 清理和回退放进同一个 shared 范围，但 Text API 的 `deleteApiConfigAndBindings` 当时未接入：删除配置、清理 Binding、失败时恢复配置是三次各自取锁的写入，快照可以落在两步之间，导出时 Binding 会指向已不存在的 API 配置，校验报 `missing-binding-resource`。

本单照搬 #125 的做法：`deleteApiConfigAndBindings` 通过 `withPersistenceWriteScope` 取得一次 shared lease，`ApiConfigStorage.deleteApiConfig` / `restoreApiConfigIfAbsent` 新增可选 scope 参数并经 `runPersistenceWrite` 校验后复用该 lease；Binding 的 `transact` 原本就接受 scope。不传 scope 的原有调用路径（独立保存/删除）不变。函数新增可选末位参数 `writeGate`，默认浏览器 gate，设置页调用不用改。

## 保留的行为

配置比较（`ApiConfigConflictError`）、已被别处修改时保留较新数据的错误文案、清理失败后的恢复及原异常传出、幂等删除（不存在则直接返回）均未改变；不改数据库名、版本、store 或 key。扩大锁范围只影响快照排队时机，不禁止其他 shared 写入。

## 证据和限制

新增 `tests/backup-text-api-delete-scope.test.ts` 3 条：成功与失败回退两条验证快照等整项结束、全程只有 1 次 shared 请求（修复前这两条失败）；第 3 条验证被别处修改时保持原冲突语义（修复前后均通过，作为行为保留的守卫）。仅 fake-indexeddb、模拟锁和模拟凭据，未接触真实数据；Safari/iOS 原生锁与真机未验收。

仍未覆盖：Character 删除的六步清理、Presence 键写入（#117/#127 已合并，等后续单）、图片挂接生命周期，以及快照读取侧与导出的组合。正式备份入口仍未开放。
