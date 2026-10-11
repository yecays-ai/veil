# S11 第 11 单：快照读取侧（独占快照锁内导出，生成中拒绝）

基于 main 提交：`bb34c276605f257fb127c0e6b6a9513f3a96296d`（#130 合并后），正式仓库 `yecays-ai/veil`。对应原审计第 3 阶段"快照一致性边界"的读取侧。

【总账 ID】S11
【这一刀只解决】新增内部入口 `exportStaticBackupSnapshot`：在独占快照锁内完成静态导出，并在回复正在生成时直接拒绝、不产出备份包。
【验收话】快照等进行中的逻辑写入结束才读取；回复持有生成锁时报 `generation-active` 且没有包；协调器的超时、取消、不可用错误码原样保留；导出格式不变。
【做完划掉】仅读取侧组合，S11 整体不核销。
【不做】备份入口界面、下载、恢复、导出格式、已有写入路径、Provider 排队顺序、图片生命周期。
【停止条件】提交独立 PR 后停止，等待 Lan 手动合并。

## 实现

`lib/backup/snapshot-export.ts` 的 `exportStaticBackupSnapshot(source, metadata, locks, options)` 调用现有 `BackupCoordinator.withSnapshot`，在锁内运行 `exportStaticBackup`。`exportStaticBackup` 新增一个可选末位参数 `inspect(snapshot)`：读取完源数据后、构建任何包字节之前调用，所以只读一次数据，检查与读取同处于独占锁内。

回复是否"正在生成"以会话的生成锁为准：对带 `generation` 标记的会话，用 Web Locks 的 `ifAvailable` 探测 `veil-chat-v2:generation:<sessionId>`（名称现由 `generationLockName` 导出，生成侧改用同一函数，行为不变）。锁被占用即为活动回复，抛 `BackupValidationError("generation-active", "chat")`；探测只尝试、不等待，取得即刻释放。新的生成必须先写会话标记，而写入需要共享锁，被独占快照挡住，所以检查之后不会再冒出新的生成。

## 保留的行为与发现

锁的取得、超时（`coordination-timeout`）、取消、不可用（`coordination-unavailable`）全由现有协调器产生，错误码不变；导出包内容和格式不变；不传锁的原 `exportStaticBackup` 调用不变。

发现（未处理）：v1 校验不允许会话带 `generation` 字段。崩溃遗留的旧标记（锁已不在）不会被判为"生成中"，但仍会因 `invalid-data`（`chat.sessions[i]`）被校验拒绝，直到聊天存储恢复该会话（打开对话时会恢复）。备份入口开放时应对此给出明确提示或先触发恢复；这属于入口/恢复范畴，本单不改。

## 证据和限制

新增 `tests/backup-snapshot-export.test.ts` 4 条：快照等进行中的写入结束后产出有效包；活动回复被 `generation-active` 拒绝；旧标记不被判为活动、探测不留锁；不可用与超时错误码保留。fake-indexeddb 与模拟锁，仅模拟数据；Safari/iOS 原生 Web Locks 与真机未验收。

第 3 阶段剩余：图片挂接/清理生命周期；Provider 排队顺序（备份入口开放前）。正式备份入口仍未开放。
