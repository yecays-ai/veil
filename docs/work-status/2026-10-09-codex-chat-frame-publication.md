# STATUS — 2026-10-09-codex-chat-frame-publication

更新人：Codex
更新时间：2026-10-09T07:22:11+00:00
发现范围：2026-10-09T07:22Z 使用 GitHub API 检查 yecays-ai/veil 最新 main@67c9ef2、AUDIT_LEDGER.md、原始《前端》审计、开放 PR #36/#62、相关 PR 头及远端分支。PR #36 仍开放并改 session prefetch 路径；本任务限定在未与其改动文件重叠的 ChatRoom/background UI 边界。发现 PR #36 task record 报告旧 main 和旧基线，未接管或修改。工作区是只读项目镜像；通过 GitHub API 管理任务分支。

## 当前任务

进行中：按原始审计 F5 建立当前会话的 Chat 首屏协调发布；F3 背景选择问题只登记，不纳入本任务。

## 谁在改哪里

Codex；branch codex/chat-frame-publication-20261009；PR 尚未创建；基于 main@67c9ef246afcd03e491eba0271d190f0723c6dde。生产范围暂定 components/chat/chat-room.tsx、components/chat/use-chat-background.ts 与必要的 Chat 样式/缓存接口；不修改 PR #36 的 Messages 入口、session hook/lifecycle 或存储路径。

## 已完成

- 确认 F5 原始编号与当前可见差异：Chat shell/人物可先出现；会话/消息由 per-route lifecycle 发布；背景设置与当前图片读取/解码由独立 hook 发布。
- 添加两条先红回归断言：图片读取/解码未完成时，消息不应先出现在可见历史；首帧 readiness 应随必要背景准备完成。

## 尚未验证

- 已推测试先行分支，等待 main 基线红灯 CI。
- 所有修复后自动化、Build、CodeRabbit 与 Preview 均尚未完成。
- iPhone Safari/Standalone 真机对比未执行；点击到首屏时间与内部层同步需分别记录。

## 下一步

保存基线红灯证据，再实施限于 F5 的非重叠改动；若预算超限或 #36 后续变更造成冲突，停止并报告。