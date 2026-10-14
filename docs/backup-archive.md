# S11 第 15 单：备份归档容器（纯逻辑）

基于 main 提交：`35cf77dcb0754e53639a7e94e52ff21e2dd10f1d`（#132 合并后），正式仓库 `yecays-ai/veil`。属于原审计第 8 阶段"用户入口与 iPhone 文件流程"的前置工作；未接入任何界面。

【总账 ID】S11
【这一刀只解决】新增 `lib/backup/archive.ts`：把备份包（`manifestJson` + 路径到字节的 Map）编码成单个标准 ZIP 文件，并严格解码回来。
【验收话】编码结果确定（固定时间戳，manifest 在前，其余路径排序）；解码对非 ZIP、截断、压缩、加密、ZIP64、多卷、数据描述符、CRC/大小不符、重名、不安全路径、缺 manifest、超限、偏移重叠/越界/缝隙、EOCD 后多余数据一律以 `BackupValidationError` 拒绝；解码结果可交给 `validateBackupPackage`。
【做完划掉】仅容器层，S11 整体不核销。
【不做】界面、下载/上传、存储、网络、压缩、新依赖、包内容的语义校验（仍归 `validateBackupPackage`）。
【停止条件】提交独立 PR 后停止，等待 Lan 手动合并。

## 实现

ZIP 仅用 STORE 方式，无注释、无 extra 字段，自带 CRC-32。`manifest.json` 是清单条目，其余条目路径即包内路径（`manifest.json` 不可作为包文件名）。解码按声明的大小先对照真实缓冲区长度，再分配。条目的本地记录必须从 0 开始首尾相接直到中央目录，所以重叠、越界、夹带隐藏数据都会被拒绝。

限制常量（已导出）：最多 4096 个条目；单条目 64 MiB；整个归档 256 MiB；路径最长 512 字节。

错误码（路径固定为 `archive`，不含用户文本）：`archive-not-zip`、`archive-truncated`、`archive-trailing-data`、`archive-unsupported`、`archive-unsupported-flags`、`archive-encrypted`、`archive-compressed`、`archive-zip64`、`archive-multi-disk`、`archive-bad-directory`、`archive-bad-offset`、`archive-header-mismatch`、`archive-overlap`、`archive-gap`、`archive-size-mismatch`、`archive-crc-mismatch`、`archive-duplicate-entry`、`archive-unsafe-name`、`archive-reserved-name`、`archive-missing-manifest`、`archive-bad-manifest`、`archive-too-many-entries`、`archive-entry-too-large`、`archive-too-large`。

## 证据和限制

`tests/backup-archive.test.ts`：往返、确定性、各类手工构造的恶意字节、限制、较大条目、篡改一个字节被 CRC 拒绝（CRC 补齐后被校验和拒绝）。自动化测试，仅模拟数据；Safari/iOS 真机文件处理未验证。
