# S11 第 2 张：全站静态导出

基线：正式仓库 `yecays-ai/veil` main `e71eb9fbb0e5d2b8c93f652b0d159b506d45ba1f`（#118 合并后）。

【总账 ID】S11，板块一全站备份与恢复。
【这一刀只解决】把静止的持久化权威数据和图片生成经过 v1 校验的逻辑文件包。
【验收话】无手机入口；固定模拟四库七键的正文、资料、配置、绑定、命名预设和图片字节往返一致；失败不返回成功包。
【做完划掉】仅第 2 张静态导出施工，S11 整体仍未验收。
【不做】跨域快照锁、写入协调、ZIP/下载按钮、恢复、UI、在线系统和 Memory 业务。
【停止条件】必要验证通过并提交本张 PR 后停止；不自动合并本张，不启动第 3 张。

## 使用边界

`exportStaticBackup(source, metadata)` 只接收明确传入的 localStorage 读取接口、IndexedDB factory 和备份元数据。没有默认 `window` 入口，应用页面没有调用它。返回 `manifestJson`、逻辑文件字节 Map 和校验器警告，不下载、不上传、不恢复、不发布 UI。

当前只保证**静止输入**的读取和编码。一个数据库的全部 object stores 在一个 readonly 事务内读取；四个数据库与七个 localStorage 键之间没有全局原子快照。跨窗口编辑、删除、在线系统的跨域后续提交，需要第 3 张明确的一致性边界。即使当前返回包通过结构校验，也不能把它宣称为正在活动设备的完整时点快照。因此本张不提供正式备份入口。

## 覆盖与安全

- 直接读七个业务键，不调用普通 `load()`，不会初始化默认 Preset、修复 generation 或运行图片回收。诊断开关、其他应用键和其他数据库不读取。
- 先枚举 IndexedDB，只打开四个已存在且版本已知的数据库。不支持枚举则失败；缺库用不存在文档/空数组表示，不通过 open 创建库。枚举后数据库消失时中止 upgrade，失败而不 bootstrap。
- 拒绝未知数据库版本、额外/缺失 object store、异常 keyPath、额外 Foundation 文档，避免漏掉未来域。Foundation `updatedAt` 是存储包装元数据，不属于 FoundationDocument；它不进入当前逻辑格式。
- 当前 Foundation、Contacts 内联头像/背景留在文档中；Appearance 保留当前与全部命名预设、Widget Character 绑定及评论。整站导出不调用会移除私有字段的 Theme 资源包导出器。
- Chat 包括所有 sessions/messages/chatSettings/worldBookStates，原 ID、消息顺序字段、引用、失败/截断状态及会话设置保留。读取不排序改写源记录。活跃 generation/streaming 按 v1 校验规则明确拒绝。
- 两个 assets 表的全部图片字节都导出，包括未引用图片；不擅自回收或过滤用户已有图片。外观原 ID 和聊天原 ID 不重建；临时 Appearance holders 不迁移。索引型相对文件名避免把 ID 直接当路径。
- API 配置仅序列化 `id/name/provider/baseUrl/model`，排除 `apiKey`，绑定保持原样并给需重新填写凭据警告。未知配置字段报错，不能顺手漏掉未来自定义配置。不会读取其他设备或其他配置来补密钥。
- 任一读取、图片转换、哈希或最终 v1 校验失败，整个 Promise 拒绝，不返回部分成功包。错误只给固定代码/位置，不回显正文或模拟密钥。
- 严格 JSON 输入及输出检测拒绝 Date、Map、非有限数、循环等会丢语义的值。ChatStorage 正常写入的 undefined 可选对象字段按 JSON 省略；数组中的 undefined 不转成 null。
- 真正缺键/缺 Foundation 记录与“存在但内容是 JSON null”区分；后者拒绝，不冒充不存在。缺失必需图片也不生成完整成功包。

## 验证与后续

自动化只使用 `fake-indexeddb`、本地模拟字符串键和模拟图片/凭据，未运行用户真实 VEIL 数据读取。验证成功不等于 iPhone 文件保存、内存可承受规模或恢复验收。

产品规则仍为 P0、普通备份排除 API Key、首版空环境及明确整站覆盖恢复、不做数据合并。MPB 不参与阻塞或验收；本张无 Preview 验收需求，不追踪额度已满的 Vercel。后续恢复系统和在线系统新增域仍需各自验收；Memory / Context 暂不施工。
