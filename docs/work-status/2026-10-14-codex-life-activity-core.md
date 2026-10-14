# STATUS — 2026-10-14-codex-life-activity-core

更新人：Codex  
更新时间：2026-10-14T22:30:00+08:00  
发现范围：2026-10-14T22:20:00+08:00 核对 GitHub 最新 `main` 为 `b0a3e3ecf133422bbf68fbb6133f72f0017c84c8`，开放 PR 为空；本分支从该提交创建。已读根 `AGENTS.md`、`docs/work-status/README.md`、`docs/AUDIT_LEDGER.md` 及现有 Presence、Contact Info、Chat Info 边界。

## 当前任务

施工中：Character Life & Autonomy 的最小 Activity Core。目标是以粗粒度、稳定身份的活动表达角色一段时间在做什么，支持跨关闭时间的确定性投影与无重复读取；先建立可验证的数据/推进合同，不实现关闭网页后的通知或忙时延迟回复。

## 谁在改哪里

Codex；分支 `feat/life-activity-core-20261014`；PR 待创建。预计新增独立 `lib/life/*` 与定向测试，并在后续小步接入 Chat Info 的只读 Life 页面。不会修改 `lib/memory/*` 或现有主动消息预算、调度与回复规则。

## 已完成

- 产品方向确认：持续生活、粗粒度活动、简易时间线；每项活动至多一个可选小插曲，暂不自动写长期 Memory。
- 当前基线与并行任务检查完成；未发现开放 PR 或路径占用。

## 尚未验证

- Activity 数据合同、断线投影、重复事件防护尚未实现。
- Chat Info 入口、时间线 UI、真实模型生活计划与 Life Moment 尚未实现。
- 未运行自动化测试、浏览器或真机验收。

## 下一步

先提交并发布本任务占用记录；随后实现最小 Activity Core 及其重复事件、边界时间和跨日投影测试。
