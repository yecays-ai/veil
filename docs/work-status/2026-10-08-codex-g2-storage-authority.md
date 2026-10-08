# STATUS — G2 Storage authority mapping

更新人：Claude（按用户指示接手 PR #47 的审查意见与 R3 同步；原作者 Codex）
更新时间：2026-10-08T12:30:00+00:00
发现范围：审计 GitHub 当前 main commit 5e0b03ccf414bd0f2556a7c925203c8cd7d00321（2026-10-08）；检查公开可见的 open PR 与相关分支。PR 搜索只发现冻结的 #36；2026-10-08T12:20Z 复查：R3 已合并（PR #46，main `8790e40`），open PR 仅冻结的 #36。

## 当前任务

进行中：完成 current-main 的持久化数据归属/入口/清理/导入导出和备份覆盖文档，等待审查。

## 谁在改哪里

Codex 创建；Claude 接手审查意见与 R3 同步；独立分支 `docs/g2-storage-authority-20261008`；PR https://github.com/yecays-ai/veil/pull/47 。文档改动仅限 `README.md`、`docs/chat-core-v1.md` 和本记录。分支基于当前 main SHA `5e0b03ccf414bd0f2556a7c925203c8cd7d00321`。
R3 已合并，Character/Contact/Chat/Binding/Appearance 行已按 R3 实际实现更新（基于 `8790e40`，已合并进本分支）。PR #36（Chat 首帧）保持冻结且未触碰；本分支不改其文件。

## 已完成

- 对当前 main 的 localStorage、IndexedDB 数据库/对象仓库/键、主要适配器、UI 读写和删除路径进行源码核对。
- 更新 README 既有 Storage/Data Safety 文档，明确权威存储、资源级导入导出、局部清理、无全站备份/恢复/云同步，以及缓存/健康状态边界；纠正 Binding 与 Foundation 同库及 Character 删除级联的过期描述。
- 补充 Chat Core 对 Chat 记录删除覆盖及 R3 后复核要求。
- 处理 CodeRabbit 两条 Minor：为 Chat Core 补审计 SHA 与日期；区分 Binding 原有清理与 R3 新增清理。
- 合并最新 main 后按 R3 实际源码（`lib/character-deletion.ts`、`lib/character-leftovers.ts`、`components/profile-pages.tsx`、`lib/chat/storage.ts`）重写相关描述。
- `git diff --check`：通过（当前两份已编辑 Markdown，无空白错误）。

## 尚未验证

- 尚未在独立分支基于远端 main 内容运行文档链接检查；本地 worktree 的起始对象是较旧的 `14da44e`，远端 main 通过 GitHub API 核实为 `5e0b03c`。推送时将以远端 main 为精确基底重新生成文件提交，避免旧基底差异。
- 仓库没有专用 Markdown 文档检查脚本；未运行应用构建或产品测试（本任务仅文档）。
- 无。R3 行已对照合并后的源码；文档中的行为描述未做真机验证。

## 下一步

等待 CodeRabbit 复审与 CI；不启用 auto-merge、不加 automerge 标签、不合并，由用户本人手动合并。
