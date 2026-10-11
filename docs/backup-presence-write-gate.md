# S11 第 9 单：Presence 存储键写入协调

基于 main 提交：`3ac899498ca64f68d4ed672e1b4a3b29c7dc0d62`，正式仓库 `yecays-ai/veil`。对应原审计第 3 阶段"快照一致性边界"。

【这一刀只解决】`veil.presence.v1`（localStorage）的写入接入备份 shared 锁，是 #124 五域之外唯一未协调的本地键。
【验收话】独占快照持有期间 Presence 写入等待；写入失败释放锁且原字节不变；调用方传入 scope 时复用同一次 shared lease。
【不做】Character 删除六步清理、图片生命周期、导出/恢复/UI、Presence 业务逻辑、在线系统、Memory。
【停止条件】提交独立 PR 后停止，等待 Lan 手动合并。

## 实现

`createPresenceStorage` 新增可选末位参数 `writeGate`（默认浏览器 gate）。`transact` 经 `runPersistenceWrite` 包裹：先取 shared lease（或复用调用方 scope），再进入原有实例队列和跨标签 `veil.presence.v1` 排他锁。锁顺序与 #124 一致，避免倒置。读取路径、键名、数据格式、提交与校验逻辑均未改。

## 证据和限制

新增 `tests/backup-presence-write-gate.test.ts` 5 条：等待与释放、拒绝协调时存储不变、独占快照阻塞写入（修复前这三条失败）、提交失败释放锁并保留原字节、传入 scope 只占一次 shared lease。Node 24 下全量、typecheck、lint、build 通过。仅模拟数据；Safari/iOS 原生锁与真机未验收。

仍未覆盖：Presence 跨存储流程（签名 Foundation 后标记；便签先 Presence 后聊天事件），它们不留下悬空引用，暂不纳入；Character 删除六步、图片生命周期，以及快照读取侧与导出的组合。
