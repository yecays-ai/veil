# S11 第 6 单：资源删除与 Binding 清理共用写入范围

基于 main 提交：`45ceb79fe8be4b7664b5cdf58eb8d4684ec32d31`，正式仓库 `yecays-ai/veil`。

【这一刀只解决】Preset、Regex、WorldBook 删除、Binding 清理及失败回退全程持有一次备份 shared 锁。
【验收话】无新手机入口；模拟快照排在删除中途时，等清理/回退结束后才读取，原冲突及删除行为保留。
【做完划掉】仅三项资源删除的整项写入边界，S11 整体不核销。
【不做】Presence、其他跨域操作、图片生命周期、建库协调、正式导出/恢复/UI、在线系统及 Memory 业务。
【停止条件】定向先行，提交前集中全量检查一次，提交独立 PR 后停止，等待 Lan 手动合并。

## 当前缺口与实现

前五单只有各适配器/事务单独持锁，资源删除和 Binding 清理之间会释放 shared 锁；快照可能穿过中间状态。直接再套外层 shared 锁会在 exclusive 请求排队时发生内外层等待环。本单只对三项现有删除入口修正这条边界，不重写存储。

`withPersistenceWriteScope` 在一次 shared 回调中创建只存在于内存的 scope。具体存储方法通过显式可选参数接收它，`runPersistenceWrite` 验证 scope 仍有效且属于同一 gate 后直接运行原域锁/事务，不再次请求 shared 锁。WeakMap 记录许可，不可从用户数据、空对象或另一个 gate 伪造；范围结束后旧 scope 拒绝写入。无全局“正在持锁”标志，因此其他并发操作不会误绕过锁。

三项入口逐步 await 初始化、删除、Binding 清理，以及错误路径的原回退，再释放 outer lease。结束时仍在运行的 scope 子操作会先等待 settle，关闭后的 scope 不再接收新操作；收尾发现未完成子操作失败时不能返回成功。既有原异常、较新数据保护、幂等删除及 rollbackIfCurrent 规则保持。

Bindings / Preset 的顺序调整为：**取得或复用 shared lease → 实例队列 → 原域锁**。尚未取得 shared lease 的独立调用不能先占据实例队列，阻塞正在持锁的整项删除。这避免“删除持 shared → snapshot 排 exclusive → 独立写入占实例队列等待 shared → 删除等待实例队列”的等待环；原域锁和队列仍串行提交同域操作。

browser Regex 默认初始化显式传 scope，不等待另一个独立调用在 exclusive 请求后排队的初始化 Promise；原默认内容与普通调用的初始化合并逻辑保持不变。自定义适配器/封装如参与整项操作，必须转发 scope，并与入口使用同一 gate；不能忽略参数后重新申请 shared 锁。

## 仍然未完成的能力

shared lease 只阻止 snapshot，并不把多个存储变成一个数据库事务，也不禁止其他 shared 写入。原有比较、冲突检查和失败回退仍负责保护较新数据。若既有回退失败，仍明确报错，不能称为整项原子恢复；本单没有改变该产品行为。

Presence 仍与 #117 重叠，其他跨域操作、首次建库/升级和图片挂接生命周期未全部覆盖。正式备份入口仍未开放，不能宣称整站活动快照已可靠。自动化只用模拟数据/锁；Safari/iOS 原生锁与真机未验收，不追踪 Vercel。
