# S11 第 7 单：四库打开与初始化协调

基于 main 提交：`4fc53325536e1942d2f422c57c96cc2bcc4a2f73`，正式仓库 `yecays-ai/veil`。

【这一刀只解决】四库未缓存连接的 open/首次建库/升级参与 shared 协调锁，拒绝后禁止迟到事件继续建表或留下连接。
【验收话】无新手机入口；模拟快照持锁时首次读也不能建库，拒绝后迟到升级 abort、迟到成功 close；既有存储测试通过。
【做完划掉】仅四库打开生命周期接入，S11 全站备份/恢复仍不核销。
【不做】Presence、其余整项业务操作、图片挂接、正式导出/恢复/UI、在线系统及 Memory。
【停止条件】定向先行，提交前集中全量验证一轮，提交独立 PR 后停止，等待 Lan 手动合并。

## 本单改变

readwrite 锁只覆盖显式事务，普通读取在首次 open 时也可能触发 onupgradeneeded 创建 schema，因此它同样是持久化变更入口。Core、Chat、API、Appearance 的未缓存连接 open 现在先取得 shared lease。

readwrite 事务创建自己的 scope，再把 scope 传入 open/连接恢复：首次打开不二次申请 shared 锁，持锁到整个事务结束。Chat 原排队取消信号转发到 scope 外层，事务内取消处理保留。readonly 的首次 open 单独取得 shared 锁；已有连接仍走原缓存路径，不给每次读取添加锁。

连接缓存只在已取得 lease、真正发出原生 open 请求后赋值，不缓存仍在排队等锁的任务。否则正在持 shared 的写入可能等待一个排在 exclusive 后面的缓存 open Promise，形成等待环。多次首次读取仍复用同一个原生连接 Promise；不改版本号、表/index、keyPath 或初始化内容。

error/blocked 拒绝标记统一保留到请求生命周期结束。之后再收到 upgrade，不建表而 abort；再收到 success，关闭得到的连接并返回，不重置缓存、不执行后续事务。原错误文案、缓存失败清理、关闭/版本变化处理和创建事务重试保留，不扩展修复其他存储问题。

## 证据和限制

新增测试用 fake-indexeddb、模拟同 origin Web Locks 和受控迟到回调；没有真实 VEIL 数据访问。修正第 4 单的测试前提：先初始化空库，再验证**已有连接**的只读路径不等写锁，首次初始化由本单新测试覆盖。

本单不实现备份入口或全局原子数据库事务。Presence、其他跨域整项操作、图片挂接/清理等边界仍需补齐；Safari/iOS 原生锁及页面终止行为未验收。不追踪 Vercel，无 Preview 需求。
