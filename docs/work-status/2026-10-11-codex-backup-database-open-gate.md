# STATUS — 2026-10-11-codex-backup-database-open-gate

更新人：Codex
更新时间：2026-10-11T16:34:21+08:00
发现范围：本轮 fetch 正式仓库 latest origin/main、S11；GitHub #125 具体评价、修复提交复审覆盖和完整讨论分页；全部开放 PR #117 的 head/changed files 与既有交接。本单不碰 Presence/engine/UI，未发布本地工作不可见。

## 当前任务

已完成施工，待审查：S11 第 7 单，四库 open/初始化 shared 锁及拒绝后迟到事件的收尾。

【总账 ID】S11。
【这一刀只解决】首次读可能建库，需与快照互斥；open 失败不得在锁释放后继续建表或留下句柄。
【验收话】模拟首读等待快照、首写复用 lease、迟到事件无后续写入；无新 UI。
【做完划掉】仅四库打开生命周期接入，S11 整体未验收。
【不做】Presence、其他跨域操作、图片生命周期、正式备份/恢复/UI、在线系统及 Memory 业务。
【停止条件】提交本单独立 PR 后停止，等待 Lan 手动合并，不启动后续单。

## 谁在改哪里

Codex；branch `codex/backup-database-open-gate`；PR [#126](https://github.com/yecays-ai/veil/pull/126)，已提交，未合并。
base/main `4fc53325536e1942d2f422c57c96cc2bcc4a2f73`。
修改四库存储文件、`lib/backup/persistence-write-gate.ts` 的 scope 排队 options 转发及 `tests/backup-persistence-write-gate.test.ts` 初始化前提；新增 `tests/backup-database-open-gate.test.ts`、`docs/backup-database-open-gate.md`、本记录；只更新总账 S11。

## 已完成

- #125 审查发现早已失败的子 Promise 被移出集合，父范围可能误报成功。新增回归修复前失败，保留所有子结果到收尾，父异常优先；修复后定向 10/10、全量 959/959 及 typecheck/lint/build/diff check 通过。
- 修复提交 `f5eebf356a7cb3047afeec5305d9a8a0d70b44d0` 的 verify 与 CodeRabbit 通过，coverage 精确覆盖该 SHA，唯一意见 resolved、分页完整。按 Lan 本次单次授权合并 #125，merge/main 为 `4fc53325536e1942d2f422c57c96cc2bcc4a2f73`；不授权合并本单或后续 PR。
- 仅复用既有审计并读四库 open/transaction 与相关测试，没有重新全站扫描。等待复审期间仅只读准备，合并后才施工。
- 首次 open 取得 shared lease，readwrite 内 open 复用 scope；已有连接读不加锁；缓存只保存已发出原生请求的 Promise。拒绝后迟到升级 abort / 成功 close，原版本及业务规则不变。
- 定向 65/65 通过，其中新增 16 个模拟用例；覆盖普通首次读取阻止建库、首写只有一次 shared 请求、缓存读取不加请求、四库 error/blocked 后迟到事件的收尾。

- 提交前全量只跑一轮 975/975，typecheck、lint（0 错误/3 条既有警告）、build、diff check 全通过。Node 24.19.0、npm 10.9.4、TypeScript 5.9.3，依赖未改；仅模拟数据，无真实 VEIL 数据访问。

## 尚未验证

- 最新提交 GitHub verify / CodeRabbit 待发布后复审；不持续轮询。
- iOS/Safari 原生锁、页面终止和真机未测；Presence、其他跨域操作及图片生命周期未全部覆盖，正式备份与恢复未实施。

## 下一步

本单已提交并停止，不合并、不启动后续单，不持续轮询 CodeRabbit。
