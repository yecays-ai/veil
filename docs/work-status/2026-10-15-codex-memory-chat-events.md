# STATUS — VEIL Memory v2 chat event connection

更新人：Codex
更新时间：2026-10-15 Asia/Shanghai
发现范围：基于已合并主线 `e84f5ac75d6032ccb93229589a528e2ac97ed97e`；本阶段只连接既有 Memory v2，不重做 Memory。

## 当前任务

进行中：将转账和礼物状态事件接入现有 Memory v2 来源失效与候选维护流程。

## 谁在改哪里

Codex；分支 `codex/chat-memory-events-20261015`；PR 尚未创建。涉及 `lib/chat/storage.ts` 与 `lib/memory/maintenance-*`。

## 已完成

- 转账/礼物状态变更时，连同原卡片一起失效已有关联结果事件的 Memory 来源。
- 候选检索同一批有原卡片时不重复检索其结果行；维护提示把结果卡定义为同一稳定 ID 的状态变化。
- 解析器阻止同一转账/礼物在同一批次被拆成多个 CREATE；事件和原卡片同在批次时要求共同作为来源。
- 定向测试 2 项通过；ESLint 和 `git diff --check` 通过。

## 尚未验证

- 完整 Memory/聊天测试和 GitHub CI；本机类型检查/测试编译受预装依赖缺失 `emoji-picker-react` 阻塞（该反应选择器未修改）。
- 浏览器/移动设备验收。

## 下一步

提交并推送独立 PR，处理审查意见，等待 CI 后合并。
