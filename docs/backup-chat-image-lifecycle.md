# S11 第 12 单：聊天壁纸图片生命周期（存图与挂接同一共享租约）

基于 main 提交：`bb34c276605f257fb127c0e6b6a9513f3a96296d`（#130 合并后），正式仓库 `yecays-ai/veil`。对应原审计第 3 阶段"快照一致性边界"中的图片挂接/清理生命周期。

【总账 ID】S11
【这一刀只解决】聊天壁纸（单个会话与全局）"先存图、再挂接"两步放进同一次共享备份租约；挂接失败时的清理边界。
【验收话】快照要么看到图片已存且已被引用，要么两者都没有；挂接失败只清理本次刚存的那张，且仅当它无人引用；其他图片不受影响；原错误原样抛出；租约释放。
【做完划掉】仅聊天壁纸；S11 整体不核销。
【不做】导出格式、UI 文案与流程、Provider 排队顺序、外观（Theme）图片、无关重构。
【停止条件】提交独立 PR 后停止，等待 Lan 手动合并。

## 现状（源码核对）

聊天壁纸原先由两个组件各自先调用 `saveChatImage`（一次写事务），再调用 `updateSessionSettings` / `updateGlobalChatBackground`（另一次写事务），失败时再调用 `deleteChatImageIfUnused`。三步各自取一次共享租约，所以快照可能夹在其间：包里会多带一张未被引用的图片。挂接步骤在事务内核对图片是否存在，所以不会出现悬空引用。外观（Theme）图片已由 `stageBlobs` 与 `publish`/`collect` 的既有流程处理（#130 已让 `publish`/`collect` 接受 scope），不在本单。

## 实现

`ChatStorage` 新增 `setSessionBackgroundImage(sessionId, blob)` 与 `setGlobalChatBackgroundImage(blob)`，在 `withPersistenceWriteScope` 的同一个外层共享租约里依次存图、挂接。`saveChatImage`、`updateSessionSettings`、`updateGlobalChatBackground`、`deleteChatImageIfUnused` 新增可选 `scope` 末位参数，不传时行为不变。两个设置组件改为调用新方法，不再自行拼接三步。

## 失败处理边界

- 存图失败（非图片、超过大小）：什么都没写入，错误原样抛出。
- 挂接失败：只对本次刚存的图片调用 `deleteChatImageIfUnused`，该函数在事务内检查全部会话与全局设置的引用，被引用则不删。其他已有图片不动。
- 清理本身失败：忽略清理错误，仍抛挂接的原错误；留下的无引用图片在下一次存图时、超过宽限期后由既有 `deleteOrphanedChatImages` 回收。
- 进程中途崩溃：与原行为一致，遗留无引用图片按宽限期回收；备份校验允许多余图片。

## 锁顺序

存图、挂接、清理都带同一个 scope，不再各自请求共享租约，因此排在后面的独占快照不会被嵌套的共享请求卡住。顺序仍是：备份租约 → 存储事务。

## 证据和限制

新增 `tests/backup-chat-image-lifecycle.test.ts` 5 条：单个/全局壁纸的快照不会夹在两步之间且只取一次共享租约；挂接失败只清理新图、保留其他图片、原错误抛出且排队快照随后正常运行；清理失败不掩盖原错误且租约释放；非图片在存储前被拒绝。fake-indexeddb 与模拟锁，仅模拟数据。Safari/iOS 与真机未验收。

第 3 阶段剩余：Provider 排队顺序（备份入口开放前）；旧 `generation` 标记（入口开放时）。
