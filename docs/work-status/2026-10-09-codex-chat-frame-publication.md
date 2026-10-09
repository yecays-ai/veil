# STATUS — 2026-10-09-codex-chat-frame-publication

更新人：Codex
更新时间：2026-10-09T09:10:00+00:00
发现范围：基线 main@67c9ef246afcd03e491eba0271d190f0723c6dde。原始《前端》审计 F5 与 F3 已核对；#61 已合并，#36 仍开放。#36 涉及 Messages/session-prefetch/session-lifecycle 路径，本 PR 未依赖或修改这些文件；范围限定为 ChatRoom/background hook 与回归测试。工作区为只读项目镜像，所有分支文件变更通过 GitHub API 提交。

## 当前任务

F5 Chat 首屏分层发布：实现中，独立 PR #63 https://github.com/yecays-ai/veil/pull/63，目标 main，不自动合并。F3 作为独立审计项记录待调查，不追查、不纳入实现。

## 已确认原因

当前 ChatRoom 在 Foundation identity ready 后先显示实际人物 Header 和默认背景；useChatSession 随后从 per-route lifecycle 发布 session/messages；useChatBackground 又在 session 出现后读取全局/会话背景设置、再读取并解码所选图片。三条发布路径不共享 ready 边界，因此外壳/人物、默认背景、当前壁纸和消息可能在同一次进入中分批出现。PR #36 的 session prefetch 是未合并改动，不作为依赖，也未修改其文件。

## 修改

- ChatRoom 保持 header/history/composer DOM 锚点；session、人物标识、首批消息、会话 CSS 与所选背景在 frame boundary 打开后发布。当前会话 ID 与准备结果相符才发布，错误时保留可用回退。
- useChatBackground 并行准备全局设置与 route session；只等当前选中的背景图完成本地读取及 decode。挂起超过 1200ms 或读取/解码失败时以 Theme 背景放行；网络头像、消息图与历史非首帧资源不阻塞。保留现有有界对象 URL 缓存与清理。
- 新增当前消息在选中壁纸未准备前不可见、背景读取永不完成时有界放行的回归覆盖；更新 A/B 导航集成测试。
- 总账登记原编号 F5 为“已修待验”；F3 单独记为“待调查”。

## 红灯证据（修改前 main）

PR #63 初始测试提交 e805115cc2c90345036c2ce23cfd2a552af9d334 的 Actions run 37899042060：typecheck、lint 通过；测试阶段按预期失败：
- tests/chat-background-first-paint.test.ts：预期 frame readiness 未在 baseline 提供，测试指出 the chat frame must wait for its selected wallpaper。
- tests/chat-first-paint.test.ts：现有挂载集成在 Peter 消息已经出现时仍观测到无消息断言失败，指出当前消息早于选中背景发布。
这是对未修复 main 的真实 CI 红灯，不是伪造结果。

## 尚待完成

- 检查最新提交 CI（typecheck/lint/tests/build/diff）。
- 检查 CodeRabbit 最新提交评论、未解决 actionable threads。
- 记录生产代码文件数及增删行数。
- 查看 Preview 与审阅状态；不自动合并。
- iPhone 同机 main/Preview 肉眼对比由用户执行：单独记点击至首层出现时间与层内背景/人物/消息同步情况。自动化、React commit 和 decode 日志不代表真机视觉验收，F5 在真机完成前保持“已修待验”。
