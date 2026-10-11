# STATUS — 2026-10-11-claude-backup-character-delete-scope

更新人：Claude
更新时间：2026-10-11T21:00:00+08:00
发现范围：fetch 正式仓库 `origin/main` `5e3eb56e63133b5eb4625e6911ed0f5854ed4d59`（#129 合并后）；开放 PR 列表为空（含草稿）。无其他分支声明触碰这些路径。

## 当前任务

S11 第 10 单（原审计第 3 阶段"快照一致性边界"）：Character 删除整项写入范围，已施工，待审查。

【这一刀只解决】Foundation 删除与六步清理共用一次 shared lease。
【不做】删除机制重构、图片生命周期、导出/恢复/UI、在线系统、Memory。
【停止条件】提交独立 PR 后停止，等待 Lan 手动合并。

## 谁在改哪里

Claude；分支 `claude/backup-character-delete-scope`；PR 待创建后补链接；base `5e3eb56e63133b5eb4625e6911ed0f5854ed4d59`。修改 `lib/character-deletion.ts`、`lib/foundation-storage.ts`、`lib/core-document-storage.ts`、`lib/theme-storage.ts`、`lib/appearance-image-storage.ts`、`lib/contact-storage.ts`、`lib/chat/storage.ts`、两个 Provider；测试夹具加可选 gate；新增 `tests/backup-character-delete-scope.test.ts`、`docs/backup-character-delete-scope.md`、本记录；只更新总账 S11。

## 已完成

- scope 作为可选参数贯穿六个存储与两个 Provider；删除顺序、提交点和语义不变。
- 4 条新测试（前两条修复前失败）；既有 character-deletion 测试 11 条仍通过。全量与 typecheck/lint/build 见 PR 描述。仅模拟数据。

## 尚未验证

- GitHub verify / CodeRabbit 待 PR 发布；Vercel 若受部署限制则记为未运行。
- iOS/Safari 原生 Web Locks 与真机未测；图片生命周期及导出组合未覆盖。

## 下一步

等待 CI / CodeRabbit 与 Lan 手动合并；不启动后续单。
