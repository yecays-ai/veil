# S11 第 4 单：四库读写事务接入备份协调协议

基于 main 提交：`33404fc828f0da9860a4d680019e64720b9eb6e8`，正式仓库 `yecays-ai/veil`。

【这一刀只解决】四个 IndexedDB 存储的 readwrite 事务在运行前取得备份 shared 锁，完成提交/中止后释放。
【验收话】无手机入口；模拟写入在锁允许前不创建事务，失败不改数据，既有存储测试通过。
【做完划掉】仅四库 readwrite 事务接入，S11 整体不核销。
【不做】localStorage 全入口接入、跨域整项操作、正式导出/UI、恢复、在线系统/Memory 业务逻辑。
【停止条件】定向先行，提交前集中全量检查一次，提交独立 PR 后停止，等待 Lan 合并。

## 本单覆盖

`IndexedDBDocumentStorage`、`ApiConfigStorage`、`AppearanceImageStorage`、`ChatStorage` 的统一事务入口对 readwrite 使用 `PersistenceWriteGate`。默认浏览器 gate 在调用时读取 `window.navigator?.locks`，使用第 3 单固定锁名与 shared 模式；支持构造器注入以测试，不改变原有必传参数。

锁的回调包住原事务方法，包括 open、事务创建重试、请求、commit、abort 等待、原有通知；不在已创建的事务内等 Web Locks，不改变表、版本、ID 或冲突判断。readonly 不取得 shared 锁，保留原有读取路径；Chat 传入的取消信号同时用于排队等待，进入事务后继续由原取消处理器中止事务。不会锁住网络或模型请求。

如果浏览器没有 Web Locks，普通存储继续按原方式保存；这不是备份降级。`BackupCoordinator.withSnapshot` 仍在不支持时明确失败。存在锁 API 但获取失败时，不绕过锁执行写入，调用者收到失败。

## 保留的明确边界

这只是事务层接入，**不能称为整站活动快照保证**。七个 localStorage 键的所有写入、跨域逻辑操作及回退，以及 readonly/open 可能触发的首次建库/升级，尚未全部纳入同一一致性边界。部分 Appearance publication 原已在 readwrite 回调中写 Theme，本单使这些回调随其事务参与协议；不据此宣称其余 Theme/配置入口已覆盖。

跨多个事务的删除、图片保存/挂接等仍可能在两次事务之间被快照穿过。后续接入整项操作时不能直接在外层再加同名 shared 锁：内层事务再排队且前方有 exclusive 请求时可能死锁，需要先明确锁的唯一所有者。正式入口继续关闭；不提前接入 `exportStaticBackup`，不把局部协调冒充已完成备份。

自动化仅用 fake-indexeddb 与模拟锁/凭据；Safari/iOS 原生跨窗口锁、实际文件下载和恢复未验收。无需 Preview，不运行真实数据读取、删除或恢复。
