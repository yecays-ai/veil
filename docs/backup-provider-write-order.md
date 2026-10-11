# S11 第 14 单：Provider 提交顺序（备份租约 → Provider 队列）

基于 main 提交：`35cf77dcb0754e53639a7e94e52ff21e2dd10f1d`（#132 合并后），正式仓库 `yecays-ai/veil`。对应原审计第 3 阶段"快照一致性边界"的最后一项（阶段阻塞项）。

【总账 ID】S11
【这一刀只解决】Foundation / Theme Provider 的 `commit` 由「Provider 队列 → 存储 lease」改为「备份租约 → Provider 队列」，解除总账记录的活性风险。
【验收话】旧死锁场景（更早的无 scope 提交仍在 Provider 队列，Character 删除的 scoped 提交排在其后，独占快照已排队）能全部完成；新的取锁顺序不引入其他等待环；正常提交顺序不变。
【做完划掉】总账 S11 中"Provider 排队顺序"待办；S11 整体不核销。
【不做】导出格式、UI、恢复、Provider 的加载/刷新逻辑、存储层。
【停止条件】提交独立 PR 后停止，等待 Lan 手动合并。

## 旧环（源码推演，本单用测试复现）

无 scope 的提交 C1 先排进 Provider 队列，队首 C0 还在跑。Character 删除 D 持有共享租约，其 scoped 提交排在 C1 之后。独占快照 S 此时请求，排在 D 的租约后面。C0 结束后 C1 才去申请共享租约，却被排在前面的 S 挡住；S 等 D 释放，D 等队列里的 C1。D → C1 → S → D 形成环。

## 实现

新增 `lib/backup/write-queue.ts` 的 `runQueuedWrite(queue, job, scope?, gate?)`：
- 带 scope 的调用方已持有租约，直接进入 Provider 队列。
- 无 scope 的调用方先 `withPersistenceWriteScope` 取自己的共享租约，拿到后才进入队列，并把这个 scope 传给存储层。
- 租约到手后立即入队，所以入队顺序等于租约授予顺序，即请求顺序（Web Locks 按请求顺序授予）。

Foundation 与 Theme 两个 Provider 的 `commit` 都改为调用它；队列内的逻辑（失败后重读、冲突重取、写后刷新、错误提示）原样保留。

## 锁顺序

备份租约 → Provider 队列 → 存储事务/域锁。队列里的任务只做读取或已持有租约的存储写入，不再申请新的共享租约，所以队首任务不会等待排在独占快照之后的请求。

## 证据和限制

`tests/backup-provider-write-order.test.ts` 4 条：新顺序下旧场景全部完成且按调用顺序执行；对照用例证明旧顺序在同一场景下无法在测试窗口内完成（测试能看见这个环，随后取消卡住的请求）；scoped 调用方不增加共享租约，无 scope 调用方恰好一个；多次提交保持请求顺序，失败不阻塞后续且租约释放。现有 Provider 与 Character 删除测试仍通过。fake-indexeddb 与模拟 Web Locks，仅模拟数据；真实 Safari/iOS Web Locks 授予顺序未验收。

第 3 阶段至此无阶段阻塞项；旧 `generation` 标记为入口阶段待办。
