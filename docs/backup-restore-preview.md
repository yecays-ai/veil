# S11 第 13 单：恢复预检（原计划第 4 阶段）

基于 main 提交：`35cf77dcb0754e53639a7e94e52ff21e2dd10f1d`（#132 合并后），正式仓库 `yecays-ai/veil`。对应原审计第 4 阶段"恢复预检"。

【总账 ID】S11
【这一刀只解决】只读恢复预检 `previewRestore`：校验备份包，在独占快照锁内读取本机，输出一份预检报告。
【验收话】空环境判为 `empty-restore`，有数据判为 `replace-required`，有阻塞原因判为 `blocked`；不写任何数据、不创建数据库；报告是当时的状态快照，恢复前必须重新预检并比较；本机活动生成、本机崩溃遗留标记、备份包自身的无效标记是三种不同的阻塞原因。
【做完划掉】仅第 4 阶段；S11 整体不核销。
【不做】任何恢复写入、恢复日志、中断续做或回滚（第 5、6 阶段）、整站覆盖（第 7 阶段）、入口界面（第 8 阶段）、导出格式、备份包解压。
【停止条件】提交独立 PR 后停止，等待 Lan 手动合并。

## 报告内容（`RestorePreview`）

- `mode`：`empty-restore`（本机为空）/ `replace-required`（本机有数据，只能走明确的整站覆盖，不合并）/ `blocked`。
- `target`：`empty` / `has-data` / `unknown`（本机读不出来，不假定为空）。
- `domains`、`assets`：每个数据域和图片的备份数量与本机现有数量。
- `warnings`：备份包校验给出的警告（如需要重新填写 API Key、外部图片）。
- `blockers`：阻塞原因，见下。
- `capturedAt`、`targetDigest`：这份报告的时间和本机状态摘要。

## 阻塞原因（互不混用）

- `backup-invalid`：备份包校验失败（校验和、版本、结构），附校验码。
- `backup-generation-marker`：备份包自身的会话带 `generation` 标记（文件损坏或被改过）。
- `target-unreadable`：本机无法读取或文档格式不符，附原因。
- `local-generation-active`：本机某会话的生成锁正被持有，回复正在生成。
- `local-generation-stale`：本机会话带 `generation` 标记，但没有任何回复持有生成锁，是崩溃遗留；打开该对话即可恢复。

## 报告只是快照

预检在独占快照锁内读本机，但锁一释放，报告就只是过去的状态。`targetDigest` 是本机文档、聊天记录、图片元数据（id、时间、大小、类型）和不含密钥的 API 配置的摘要；图片字节和密钥不参与。后续恢复开始前必须重新调用 `previewRestore`，并用 `restorePreviewChanged(旧报告, 新报告)` 比较，变了就不能继续使用旧报告。预检本身不授权任何写入。

## 实现

`lib/backup/restore-preview.ts`。包校验用既有 `validateBackupPackage`；本机读取用既有 `readStaticBackupSource`（缺失的数据库当作空，不创建）；独占锁用既有 `BackupCoordinator.withSnapshot`，超时、取消、不可用错误码原样抛出。小改两处已合并代码：`static-export.ts` 导出 `recordCount`，`snapshot-export.ts` 抽出 `generationHeld` 供导出和预检共用，导出行为不变。

## 证据和限制

`tests/backup-restore-preview.test.ts` 7 条：空环境、有数据、报告过期（含不改变数量的写入）、三类标记阻塞、其他包失败、本机不可读、锁内读取与错误码。fake-indexeddb 与模拟 Web Locks，仅模拟数据。

未验证：真实设备上"空环境"的判断。本单按"所有数据域和图片都为空"判空；若应用首次启动会自动写入默认文档，这种设备会被判为 `has-data`，需要在第 6 阶段结合真机确认"仅含默认数据"是否也算空环境。Safari/iOS 与真机未验收。
