# STATUS — G2 Storage authority mapping

更新人：Codex
更新时间：2026-10-08T20:15:00+08:00
发现范围：审计 GitHub 当前 main commit 5e0b03ccf414bd0f2556a7c925203c8cd7d00321（2026-10-08）；检查公开可见的 open PR 与相关分支。PR 搜索只发现冻结的 #36；R3 施工状态来自工单说明，当前源码为 R3 合并前状态。

## 当前任务

进行中：完成 current-main 的持久化数据归属/入口/清理/导入导出和备份覆盖文档，等待审查。

## 谁在改哪里

Codex；独立分支 `docs/g2-storage-authority-20261008`；目标 PR 尚未创建。文档改动仅限 `README.md`、`docs/chat-core-v1.md` 和本记录。分支基于当前 main SHA `5e0b03ccf414bd0f2556a7c925203c8cd7d00321`。
Claude 正在施工 R3 Character 删除及关联数据清理；相关映射需在 R3 最终合并后复核。PR #36（Chat 首帧）保持冻结且未触碰；本分支不改其文件。

## 已完成

- 对当前 main 的 localStorage、IndexedDB 数据库/对象仓库/键、主要适配器、UI 读写和删除路径进行源码核对。
- 更新 README 既有 Storage/Data Safety 文档，明确权威存储、资源级导入导出、局部清理、无全站备份/恢复/云同步，以及缓存/健康状态边界；纠正 Binding 与 Foundation 同库及 Character 删除级联的过期描述。
- 补充 Chat Core 对 Chat 记录删除覆盖及 R3 后复核要求。
- `git diff --check`：通过（当前两份已编辑 Markdown，无空白错误）。

## 尚未验证

- 尚未在独立分支基于远端 main 内容运行文档链接检查；本地 worktree 的起始对象是较旧的 `14da44e`，远端 main 通过 GitHub API 核实为 `5e0b03c`。推送时将以远端 main 为精确基底重新生成文件提交，避免旧基底差异。
- 仓库没有专用 Markdown 文档检查脚本；未运行应用构建或产品测试（本任务仅文档）。
- R3 最终 diff 尚未可见/合并，Character 相关联数据清理尚未复核。

## 下一步

将这三份文档发布到从 main SHA `5e0b03c` 创建的独立分支，运行文档检查并创建普通 PR；不启用 auto-merge、不加 automerge 标签、不合并。等待 CodeRabbit 正式审查、CI 通过及用户本人确认后再由用户手动合并。
