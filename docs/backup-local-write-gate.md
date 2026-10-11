# S11 第 5 单：五域 localStorage 写入接入

基于 main 提交：`3b9dfa7ea23097f53849a43bd7af40d8197a7404`，正式仓库 `yecays-ai/veil`。

【这一刀只解决】Bindings、Contacts、Preset、Regex、WorldBook 的适配器写入先取得备份 shared 锁。
【验收话】无手机入口；模拟快照持锁时五域不落盘，释放后写入；失败保留原字节与既有冲突语义。
【做完划掉】仅这五域适配器接入；S11 全站备份/恢复不核销。
【不做】Presence（当前 #117 修改中）、跨域整项操作、建库协调、正式导出/恢复/UI、在线系统和 Memory 业务。
【停止条件】定向先行，提交前集中全量验证，提交独立 PR 后停止等待 Lan 手动合并。

## 覆盖与锁顺序

复用第 4 单的 `PersistenceWriteGate`，作为适配器可选注入参数，浏览器默认用第 3 单固定锁名。新增 shared 边界包住原有锁获取与整个写入回调：**实例队列 → 备份 shared 锁 → 原数据域锁 → 原校验/提交 → 释放**。不替换原域锁，不改数据格式、键、初始化内容、通知或冲突判断；不在 synchronous setItem 内异步等待。

- Bindings：save/transact 和 cleanStale；资源权威只读保护及最终同步写回全在 shared 边界内。其资源校验用 Preset.readRaw、原始 Regex.load、WorldBook.load、API readonly 事务，不触发嵌套写门。
- Contacts：transact 及调用 transact 的 portable restore；保留跨窗口域锁、重读重算和原合并行为。本单不增加全站恢复或跨设备合并能力。
- Preset：save、transact、rollbackIfCurrent，以及 load 的首次初始化和规范化写回。load 原有队列和域锁不变；readRaw 纯只读，不加 shared 锁。纯读取的 load 仍经过同一入口，因为它可能写入。
- Regex / WorldBook：原共用 guarded-write 边界内的 save/transact；保留 ifAvailable、编辑快照检查、域忙和不支持浏览器时的既有错误。默认 Regex 的初始化仍通过同一 transact 路径。

Appearance 的 Theme publication 原就在第 4 单已接入的 Appearance readwrite 事务内，不在其外层再取得同名 shared 锁。Presence 的写入与 #117 重叠，本单不改它，不把本次覆盖称为七键完成。

无 Web Locks 时，新写门不新增普通存储禁用；原各域已有的安全限制仍生效。正式备份协调仍拒绝不支持环境。已有 API 获取锁失败时不绕过锁写入；实例队列按原方式消化失败，后续调用可以继续。

## 剩余一致性边界

正式备份入口仍未接入。Presence、首次建库/升级、跨多次事务的删除/清理/回退以及在线系统的后续跨域提交仍需补齐。同名 shared 锁不可在整项操作外层与各存储内层直接嵌套，后续必须明确唯一持锁者，避免 exclusive 请求排队时发生等待环。

本单只使用内存 localStorage、模拟 Web Locks 和模拟凭据/数据；不读取或修改用户真实 VEIL 数据。iOS/Safari 原生跨窗口锁未验收，无 Preview 验收需求，不追踪 Vercel。
