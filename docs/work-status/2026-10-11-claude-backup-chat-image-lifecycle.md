# STATUS — 2026-10-11-claude-backup-chat-image-lifecycle

更新人：Claude
更新时间：2026-10-11T21:45:00+08:00
发现范围：fetch 正式仓库 `origin/main` `bb34c276605f257fb127c0e6b6a9513f3a96296d`；开放 PR：#131（读取侧，改 `lib/backup/snapshot-export.ts`、`static-export.ts`、`chat/generation-lock.ts`、测试与文档，与本单无同文件，仅总账 S11 行重叠）。

## 当前任务

S11 第 12 单（原审计第 3 阶段"快照一致性边界"，图片挂接生命周期）：聊天壁纸存图与挂接同一共享租约；已施工，PR #132 待审。

【这一刀只解决】聊天壁纸存图+挂接合一；挂接失败清理边界。
【不做】导出格式、UI、Provider 排队顺序、Theme 图片、无关重构。
【停止条件】提交独立 PR 后停止，等待 Lan 手动合并。

## 谁在改哪里

Claude；分支 `claude/backup-image-lifecycle`；PR [#132](https://github.com/yecays-ai/veil/pull/132)；base `bb34c27…`，已合并 `66332931964ecc9af381ef099c7f95475a4798f5`（含 #131）。改 `lib/chat/storage.ts`、`components/chat/chat-background-settings.tsx`、`components/settings/global-profile-settings.tsx`、`tests/regex-background-ui.test.ts`；新增 `tests/backup-chat-image-lifecycle.test.ts`、`docs/backup-chat-image-lifecycle.md`、本记录；只更新总账 S11。

## 已完成

- 新增两个合并方法，四个既有方法加可选 scope；组件改用新方法。
- 5 条新测试；Node 24 全量 1025/1025、typecheck、lint（0 错误/3 条既有警告）通过；build 用 `next build --webpack` 通过（工作区的 node_modules 为符号链接，Turbopack 无法解析根目录，默认 build 未在此运行）。仅模拟数据。

## 尚未验证

- 合并 main 后的 GitHub `verify` 与 CodeRabbit 待出结果；Vercel 预览首次构建已就绪。
- iOS/Safari 与真机未测。
- #131 已合并；已同步该 main、解决总账 S11 行冲突并重跑回归（见上）。

## 下一步

提交 PR，等待 CI/CodeRabbit 与 Lan 手动合并。第 3 阶段剩余（Lan 2026-10-11 分类）：阶段阻塞项仅 Provider 排队顺序，#132 合并后集中修复验收；旧 `generation` 标记不阻塞，记为入口阶段待办，不单独开 PR。
