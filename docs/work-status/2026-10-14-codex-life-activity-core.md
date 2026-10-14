# STATUS — 2026-10-14-codex-life-activity-core

更新人：Codex  
更新时间：2026-10-14T23:20:00+08:00  
发现范围：2026-10-14T22:20:00+08:00 核对 GitHub 最新 `main` 为 `b0a3e3ecf133422bbf68fbb6133f72f0017c84c8`，开放 PR 为空；本分支从该提交创建。已读根 `AGENTS.md`、`docs/work-status/README.md`、`docs/AUDIT_LEDGER.md` 及现有 Presence、Contact Info、Chat Info 边界。

## 当前任务

已修待审：Character Life & Autonomy 的最小 Activity Core。以粗粒度、稳定身份的活动表达角色一段时间在做什么，支持跨关闭时间的确定性投影与无重复读取；本单只建立可验证的数据/推进合同，不实现关闭网页后的通知或忙时延迟回复。

## 谁在改哪里

Codex；分支 `feat/life-activity-core-20261014`；PR https://github.com/yecays-ai/veil/pull/195。新增 `lib/life/activity.ts`、`tests/life-activity-core.test.ts`，仅在 `lib/presence/storage.ts` 增加可选 Life 状态和受现有写入协调保护的 setter。后续独立小步接入生活计划和 Chat Info 只读 Life 页面。未修改 `lib/memory/*` 或现有主动消息预算、调度与回复规则。

## 已完成

- 产品方向确认：持续生活、粗粒度活动、简易时间线；每项活动至多一个可选小插曲，暂不自动写长期 Memory。
- 当前基线与并行任务检查完成；未发现开放 PR 或路径占用。
- 活动有独立 `id` 与稳定 `occurrenceKey`；显示文案变化不会产生第二顿午餐。重复唤醒保留已经落定的活动与 Moment，不重写。
- 活动状态由绝对开始/结束时间投影为 upcoming / active / completed；关闭网页不会暂停时间。第一版拒绝两个主活动重叠。
- 数据限制为最多 96 项、保留最近 7 天和未来 3 天；单项最长 36 小时；标题和 Moment 有长度上限。Life 暂作为 Presence 记录的可选字段，复用现有 local-first 写入锁、备份/恢复和旧数据兼容边界，不增加新的备份格式版本。
- CodeRabbit 三条边界意见已核实并修复：直接写入也执行保留窗口校验；时钟回拨时统一使用不倒退的 reconciliation 时间；`recent=0` 返回空历史。
- 自动化：Node 24.19.0；测试编译通过；Activity Core 8/8、Presence storage / backup / validation 40/40，共 48/48；改动文件 ESLint 通过。

## 尚未验证

- Chat Info 入口、时间线 UI、真实模型生活计划与 Life Moment 生产器尚未实现；本单没有可见产品入口。
- 全仓 `tsc --noEmit` 因本环境用 pnpm 临时安装后没有把 Playwright 的传递包链接到根目录，现有 e2e 导入报类型缺失；`tsconfig.tests.json` 的仓库测试编译通过，改动代码没有类型错误。没有改依赖或锁文件。
- 未运行 build、浏览器或真机验收；本单无 UI。

## 下一步

提交、推送并创建独立 PR，等待人工审查。后续工单在此合同上实现低频生活计划与 Chat Info 简易时间线。
