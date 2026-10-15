# STATUS — 2026-10-16-codex-chat-interaction-optimization

更新人：Codex
更新时间：2026-10-16T05:04+08:00
发现范围：从 GitHub main SHA 5914e198952c8a322552382f2485ac1038683a22 开始；开始时核对无其他开放 PR、PR #216（已于 2026-10-15 合并）。工作分支 codex/chat-interaction-120s-stickers-navigation 基于该 SHA；PR #219 已创建并保持 Open。

## 当前任务

进行中：实现双方统一 120 秒撤回、撤回事件与 Character 短期认知、Sticker 连续发送体验和整页聊天导航转场。

## 谁在改哪里

Codex；分支 codex/chat-interaction-120s-stickers-navigation；PR #219：https://github.com/yecays-ai/veil/pull/219
涉及 Chat Storage、Prompt、Character Actions、聊天消息菜单、Sticker Composer、Messages 路由转场、备份验证和定向测试。
不修改白闪/白边、Memory 内容规则、删除规则或 PR #216 的 Life Mode 插话行为。

## 已完成

- 用户与 Character 共享 sentAt + 120 秒可撤回校验；存储最终写事务重新验证 sender、状态、会话和时限。
- Character Action 从 recallPrevious 改为 recallMessageId，提示中只列出 120 秒内自己的候选消息。
- 普通模型历史只加入 [User recalled a message] / [Character recalled a message]；原文继续从消息行清空并排除摘要、Memory 与搜索。
- Character 自己撤回的原文仅保存在当前引擎内存中，供下一次正常模型请求延续；请求开始后消费，刷新/重进会话后不会保留，清空/删除后也无法从消息行恢复。
- Sticker 点击发送后保留面板挂载；输入框 focus 收起面板并交给系统键盘。
- Messages 路由转场包裹整页内容，支持列表进入与浏览器返回；尊重减少动态效果偏好。
- 备份白名单接受可选 sentAt，兼容无此字段的旧备份。

## 尚未验证

- PR #219 首轮 typecheck 发现一处撤回 session 校验误落入 editMessage，以及既有 message-recall 测试引用已退休的 previous-only API；均已修复。第二轮 typecheck 通过，lint 指出两处新代码在 render 中读 ref/Date.now；已改为 layout/effect 处理，第三轮提交 9c098b2e314361835dca5176acbd2748d8642382 的 typecheck 与 lint 通过；完整 npm test 发现 4 个断言失败：撤回模型测试未在第二轮请求前设置目标 ID、Recall 静态 UI 断言仍指向旧结构、Presence 状态断言包含已移除的 canRecall 字段、转账卡撤回错误文案断言过期。已修正测试断言/夹具，等待下一轮 CI。测试失败导致 build 与 diff 检查跳过。
- iOS/PWA 真机上的整页转场、键盘切换和 Sticker 连发体验待验收。
- 首轮 Vercel 预览部署失败；9c098b2e314361835dca5176acbd2748d8642382 的 Vercel Preview 部署成功。
- View Transitions API 不可用或用户启用减少动态效果时，路由正常切换但不运行横向动画。

## 下一步

等待第四轮 GitHub CI、CodeRabbit 结果；Vercel Preview 已部署。CI 通过后仍需用户真机验收；不自行合并。
