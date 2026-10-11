# STATUS — 2026-10-11-claude-backup-text-api-delete-scope

更新人：Claude
更新时间：2026-10-11T20:00:00+08:00
发现范围：本轮 fetch 正式仓库 `origin/main` `9973b356a631dd546849ff2831ecab2699739088`（#126 合并后）与 `docs/AUDIT_LEDGER.md` S11；GitHub 开放 PR 列表为空（含草稿）。无其他分支声明触碰 Text API 删除路径。

## 当前任务

S11 第 8 单（原审计第 3 阶段"快照一致性边界"）：Text API 删除整项写入范围，已施工，待审查。

【这一刀只解决】Text API 删除、Binding 清理、失败回退共用一次 shared lease。
【验收话】模拟快照不会穿过删除中途；原冲突与回退语义保留。
【不做】Character 删除、Presence、图片生命周期、导出/恢复/UI、在线系统、Memory。
【停止条件】提交独立 PR 后停止，等待 Lan 手动合并，不启动后续单。

## 谁在改哪里

Claude；分支 `claude/backup-text-api-delete-scope`；PR 创建后补链接；base `9973b356a631dd546849ff2831ecab2699739088`。修改 `lib/api-config-storage.ts`、`lib/settings/text-api.ts`；新增 `tests/backup-text-api-delete-scope.test.ts`、`docs/backup-text-api-delete-scope.md`、本记录；只更新总账 S11。

## 已完成

- 删除、Binding 清理与回退共用一次 shared lease；ApiConfigStorage 的 delete/restore 接受可选 scope。设置页调用无需修改。
- 新增 3 条测试：成功与失败回退两条修复前失败、修复后通过；冲突语义守卫修复前后均通过。
- Node 24.21.0 下全量 1009/1009，typecheck、lint（0 错误/3 条既有警告）、build、diff check 通过。仅模拟数据，依赖未改。

## 尚未验证

- GitHub verify / CodeRabbit 待 PR 发布后复审。
- iOS/Safari 原生 Web Locks 与真机未测；Character 删除、Presence 键、图片生命周期及导出组合尚未覆盖。

## 下一步

等待 CI / CodeRabbit 与 Lan 手动合并；不启动后续单。
