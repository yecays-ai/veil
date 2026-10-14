# STATUS — 2026-10-14-codex-life-moment-dedup

更新人：Codex
更新时间：2026-10-15T00:23:00+08:00
发现范围：2026-10-14 GitHub API 核对 `main`、全部开放 PR 和可见分支；最新 `main` 为 `93765df91f4f22b0c3baf1ad9d581ef3207016fc`，开放 PR 为空。目标模块未见并行开放改动。

## 当前任务

已修待审：避免 Life 时间线在多天内反复展示相同的小插曲，同时保留已结算生活记录；PR #198 已创建，未合并。

## 谁在改哪里

Codex；独立分支 `fix/life-moment-dedup-20261014`；[PR #198](https://github.com/yecays-ai/veil/pull/198)。基于 `main 93765df91f4f22b0c3baf1ad9d581ef3207016fc`。仅修改 `lib/life/activity.ts`、`lib/life/plan.ts`、`tests/life-activity-core.test.ts`、`tests/life-daily-plan.test.ts` 和本记录。最新提交 SHA 以 GitHub PR #198 head 为准。

## 已完成

- 时间线呈现去掉可见范围内重复的小插曲，仅对返回 UI 的投影去重，底层历史不变；优先保留当前/较新的那条。
- 固定小插曲选项由每类 2 条扩至 10 条；新计划避开近七天已保存的原句，并在本次投影内避免重复。没有新增模型调用或定时器。
- 新增计划唯一性/近期避重、已保存历史呈现去重且不改存储的回归测试。
- CodeRabbit 发现的有效期边界已修：仅将同一 7 日历史与 3 日未来窗口内活动的 moment 用作避重输入，边界以 `max(reconciledAt, now)` 计算；新增保留记录转发和过期记录不抑制新计划的测试。
- CodeRabbit 复审发现的未来活动优先级已修：去重时逆序处理 upcoming、再还原时间顺序，让较新的相同 moment 保留；新增回归测试。
- `tsconfig.tests.json` 编译通过；Life 活动、计划和挂载持久化测试 20/20 通过；改动文件 ESLint 通过；`git diff --check` 通过。
- 全项目 typecheck 未通过，因当前安装的 `@playwright/test` 类型缺少 `expect`、`test`、`Page`、`defineConfig` 导出；测试专用 TypeScript 编译正常。

## 尚未验证

- 真机/浏览器页面视觉验收；本轮最新 head 的 CI、CodeRabbit、Preview 尚待确认。前一代码 head `26ec63c` 的 GitHub CI（typecheck/lint/test/build/diff）全绿、Preview Ready；CodeRabbit 已将过期记录避重意见标为 addressed，未来活动优先级意见刚发现并已修，文档覆盖率 warning 不涉及功能。
- 全项目 typecheck 需要在正常 Playwright 类型依赖环境下重试。

## 下一步

查看本轮 head 的 CI、CodeRabbit 与 Preview；等待 Lan 手动审核与合并。

