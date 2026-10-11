# STATUS — 2026-10-11-codex-backup-idb-write-gate

更新人：Codex
更新时间：2026-10-11T15:14:13+08:00
发现范围：正式仓库最新 origin/main 与 S11；GitHub #121 合并证据，全部开放 PR #117 的 head/changed files 及已有交接范围，fetch 后远程分支；未发布本地工作不可见。#117 改 engine/presence/UI，不改本单四库文件；Lan 的 T8 UI 在另一 work，本单不改 UI。

## 当前任务

已完成施工，待审查：S11 第 4 单，四库 readwrite 事务接入备份 shared 锁。#121 已由 Lan 合并，merge SHA `d47296f0ad2819516ee138f08f478b8804af25ca`；最新 main 又含 #122 总账记录，基线为 `33404fc828f0da9860a4d680019e64720b9eb6e8`。

【总账 ID】S11。
【这一刀只解决】四库读写事务取得锁后执行、提交/中止后释放。
【验收话】模拟等待不提前建写事务；失败无改动；无手机入口。
【做完划掉】仅四库事务接入，整体 S11 仍未验收。
【不做】localStorage 全入口、跨域整项操作、UI/正式备份入口、恢复、在线系统/Memory 业务。
【停止条件】完成定向及提交前一次全量检查，提交 PR 后停止等待 Lan 合并。

## 谁在改哪里

Codex；branch `codex/backup-idb-write-gate`；PR 尚未创建。
base/main `33404fc828f0da9860a4d680019e64720b9eb6e8`。
改 `lib/core-document-storage.ts`、`lib/api-config-storage.ts`、`lib/appearance-image-storage.ts`、`lib/chat/storage.ts` 的统一事务入口；新增 `lib/backup/persistence-write-gate.ts`、`tests/backup-persistence-write-gate.test.ts`、`docs/backup-idb-write-gate.md`、本记录；更新总账 S11 状态；补齐 `tests/generation-lock-fixture.ts` 的 shared/exclusive 排队模拟，保持生成锁 ifAvailable 测试。

## 已完成

- 复用既有审计，只读本单事务入口及相关测试；无全站重新扫描。
- 四库 readwrite 包住原事务生命周期，readonly 不加锁；不改数据库结构或数据。无 Web Locks 时普通写入保持原行为，备份协调仍拒绝不支持环境。
- 定向 48/48 通过：12 条新 fake-indexeddb/模拟 gate 用例，加协调核心及四库相关既有测试。覆盖排队不创建事务、commit/abort settle 后释放、拒绝不建库、只读绕过写门及不支持环境。测试曾暴露模拟 window 缺 navigator，已修正 optional access；未扩大业务范围。

- 首轮全量 915/931：16 条挂载用例失败，定位为旧 Web Locks 夹具仅支持 ifAvailable，拒绝 shared 请求。补齐夹具后，失败相关文件定向 31/31 通过，新四库测试 12/12 通过（含一把 exclusive 锁阻止四库其他 client 写入）。生产代码没有绕过锁；修正后重新跑全量是由新失败/变更触发，不做无目的重复。

- 修正夹具后的最终全量 932/932 通过；typecheck、lint（0 错误/3 条既有警告）、build、diff check 通过。typecheck/build 验证的生产代码随后未改，不重复构建；夹具变更已由定向/全量编译测试及最终 lint 验证。Node 24.19.0、npm 10.9.4、TypeScript 5.9.3；依赖未改，全部模拟数据。

## 尚未验证

- 最新提交 GitHub verify / CodeRabbit 尚待 PR 发布后复审；不持续轮询。
- iOS/Safari 原生锁与真机未测；所有 localStorage 写入、首次建库/升级及整项跨域生命周期未覆盖，正式备份入口和恢复未实现。

## 下一步

本单施工完成，提交 PR 后停止；不自动合并，不启动第 5 单，不持续轮询 CodeRabbit。
