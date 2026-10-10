# STATUS — 2026-10-10-codex-p6-background-settings-cleanup

更新人：Codex
更新时间：2026-10-10T15:13:00+08:00
发现范围：2026-10-10T07:13Z 读取 GitHub API `main`、开放 PR（含 Draft）和分支清单；开放 PR 为 0。最新 main 为 `047b07683e2fc9433d854382f261cd5df23c99ab`（#98 已合并）。已读 main 的 `AGENTS.md`、`docs/AUDIT_LEDGER.md`、work-status 规则及目标测试/组件。原本地干净检出位于 #98 head `0b64f35604445750d4873d6fef2d4eda98215977`，其 tree 与 main 均为 `020c82d9c85c71f9ab1d6ce1fe41f978f32fadad`；新任务分支从该内容树开始。未发布本地任务不能由远端发现。

## 当前任务

聊天背景设置 URL 释放与退订测试补强；代码和本地验证完成，PR 创建待完成。Lan 手动合并。

## 谁在改哪里

Codex；分支 `test/p6-chat-background-cleanup`；PR 尚未创建。
仅目标测试、板块六总账和本记录；生产组件不改。

## 已完成

- 测试订阅夹具改为实际维护 listener 集合；卸载后事件不再投递，且不再启动设置读取。
- 新增先创建预览 URL、换图后确认旧 URL 被 revoke、再次创建、卸载后确认当前 URL 被 revoke，以及卸载前已开始的迟到图片读取不再创建 URL 的行为测试。原 `chat.background-settings-unmount` 保留并增强。
- Node v24.21.0 / npm 11.19.0；`npm test` 798/798 通过（其中目标测试 7/7）；`npm run typecheck` 通过；`npm run lint` 0 errors、6 条既有 warnings。
- 本次检出和工作区根目录没有 `.probe-r1` 目录；历史 work-status 有一次 lint 受该目录影响的记录，仓库内仅保留该历史记录引用。本任务不清理其他任务残留。

## 尚未验证

- `npm run build` 未运行；无浏览器/iPhone 验收。
- 总账局部核销需随 PR 审查/合并状态保持准确；Foundation、天气等仍未核销，清理类测试总项为“部分修复”。
- GitHub Actions / Vercel 与 CodeRabbit 针对 PR 最新 head 的状态待创建后核对。

## 下一步

创建独立 PR，并核对 PR 最新 head 的审查、CI 与预览状态；不自动合并。
