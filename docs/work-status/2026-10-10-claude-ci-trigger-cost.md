# STATUS — 2026-10-10-claude-ci-trigger-cost

更新人：Claude
更新时间：2026-10-10T11:40:00Z
发现范围：观察时间 2026-10-10T11:20Z；基于 origin/main `16fdafc`（#104 已合并，现场核实）；GitHub open PR 列表在开工时无其他开放 PR（本分支开 PR 前）；其他分支上的任务记录未逐一检查。依据：Lan 在对话中同意的“先优化 CI”，以及此前读取的 GitHub Actions 运行记录。

总账 ID：新增（板块六“CI 触发成本”；关联“GitHub Actions `verify` 按未运行处理”的历史记录）。
验收话：同一次推送在 PR 上只触发一次 `verify`；PR 上较新的推送取消较旧的运行；`main` 合并后仍有一次运行；`verify` 的检查步骤与结果不变。
不做：不改 typecheck/lint/test/build 步骤；不按路径跳过文档改动；不动 Vercel；不加缓存之外的新机制；不改业务代码与测试。
停止条件：本 PR 经 Lan 手动合并，或 Lan 要求关闭；合并后另看一次 `main` 上的运行。

## 当前任务

待审查：只修改 `.github/workflows/ci.yml` 的触发与成本控制。

## 谁在改哪里

Claude；分支 `claude/ci-trigger-cost`；PR：创建后补链接。涉及：`.github/workflows/ci.yml`、`docs/AUDIT_LEDGER.md`（板块六新增一条；并入此前尚未合并的 #102 对照记录）、`docs/work-status/2026-10-10-claude-chat-header-split.md`（并入，内容见该文件）、本文件。

## 已完成

- 观察（配置与运行记录）：`ci.yml` 原为 `on: push`（所有分支）加 `on: pull_request`，同一提交跑两遍：`fec7b3f`（第 926、927 次）、`23174e3`（第 928、929 次）、`35915ca`（第 924、925 次）。恢复运行后单次约 67–83 秒；10 月 7、8 日各有一次约 81、117 秒的成功运行。无并发取消，无超时上限，未声明权限。
- 修改：`push` 限定 `main`；增加 `workflow_dispatch`；`permissions: contents: read`；`concurrency` 按 PR 号分组，仅 `pull_request` 事件取消旧运行，`main` 上的运行不取消；`verify` 加 `timeout-minutes: 15`。
- 检查：YAML 可解析，触发、并发、超时字段读取正确；没有安装 actionlint，未做更严格的静态检查。没有运行业务测试（只改工作流与文档）。
- 并入此前尚未合并的文档记录：#102 前后版本对照结果与 fount 暂存候选（来自本地分支 `claude/docs-f5a-attribution` 的提交，已改写到最新 main 上；该远程分支此后可删除）。

## 尚未验证

- 本 PR 自己的运行：应只出现 `pull_request` 事件的一次 `verify`，而没有同一 SHA 的 `push` 事件运行；之后再推送一次，确认较旧的运行被取消或已结束。结果待 PR 开出后核对，并写回本节。
- 合并后 `main` 上是否仍触发一次运行：待合并后核对。
- 对外部 fork 的 PR：仓库设置里“首次贡献者需批准”是否开启，我看不到，由 Lan 在仓库设置里确认。
- 公开前后实际消耗：Billing 页面数据我看不到。

## 下一步

开 PR 后核对本 PR 的运行次数，再等待 CodeRabbit 审查最新提交，由 Lan 手动合并；不自动合并。
