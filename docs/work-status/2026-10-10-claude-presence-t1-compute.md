# STATUS — 2026-10-10-claude-presence-t1-compute

更新人：Claude
更新时间：2026-10-11T05:40:00+08:00
发现范围：2026-10-11T05:30+08:00 通过 GitHub API 查看开放 PR（无开放 PR，含草稿）；`origin/main` = `928a565296c9514a1514411fac2f8c381c61db73`；已读 `docs/AUDIT_LEDGER.md`（在线系统登记为“未启动、保持登记”，要求不动首帧布局）。

## 当前任务

Character Presence 第一批 T1：Presence 纯计算核心。待审查。

## 谁在改哪里

Claude；分支 `claude/project-thread-459m41`；PR [#109](https://github.com/yecays-ai/veil/pull/109)；base `928a565`。
只新增：`lib/presence/compute.ts`、`tests/presence-compute.test.ts`、本记录。不改任何现有文件、存储、界面或请求。

## 已完成

- 纯计算：有效状态（处境优先于作息）、下一次状态变化时刻、按作息与处境推算的最近在线时间（回溯 7 天有界）、处境规范化（开始不早于当前、必有结束、缺省 6 小时、上限 14 天）。
- 作息按 Character 时区计算，支持跨午夜时段与夏令时；每日波动由“Character + 本地日期 + 时段”固定种子决定，幅度不超过时段长度的四分之一。
- `tests/presence-compute.test.ts` 10 项测试。
- 本地检查（2026-10-11 +08:00，提交 `b572936`）：Node 24.21.0 下 `npm test` 821/821 通过；`npm run typecheck` 通过；`npm run lint` 0 error / 3 条既有 warning（均不在本次文件）；`npm run build` 通过（Node 22.22.0）；`git diff --check` 无输出。
- 环境说明：本机默认 Node 22.22.0 跑 `npm test` 时 `regex-worldbook-storage-safety` 两条用例失败（Node 22 没有 `navigator.locks`），与本改动无关；仓库要求 Node 24，换 Node 24 后全部通过。

## 尚未验证

- 不适用真机：本工单没有界面和存储改动，Presence 尚未接入任何页面。
- 缺省 6 小时、上限 14 天、回溯 7 天、波动上限 120 分钟是暂定常量，待 T2–T4 接入后按真机体验再定。
- 性能只有测试内粗测（单次最近在线推算约 1–2 ms，Node 22）；未在手机上测。

## 下一步

等 Lan 审查合并 T1；确认后再开始 T2（存储）。
