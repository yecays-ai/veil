# STATUS — 2026-10-14-codex-life-timeline-ui

更新人：Codex
更新时间：2026-10-14T22:35:00+08:00
发现范围：GitHub 最新 `main` 为 `be3221e7daf4479f4829b7f29819518bf8708bde`（PR #196 已合并），开放 PR 为空；本分支从该提交创建。

## 当前任务

已修待审：在 Chat Info 增加简易 Life 时间线入口和只读页面；打开页面时用已合并的确定性计划执行一次低成本结算并展示当前、最近与稍后活动。

## 谁在改哪里

Codex；分支 `feat/life-timeline-ui-20261014`；PR https://github.com/yecays-ai/veil/pull/197。新增 `components/chat/life-timeline.tsx`，仅接入 `components/chat/chat-room.tsx`、`app/messages/chat.css` 和定向 UI 合同测试。

## 已完成

- 已核对最新 main、无开放 PR；已读 Chat Info、Presence live document、Activity Core 和计划投影接口。
- Chat Info 新增 Life 入口；子页面沿用原全屏设置页、44px 返回按钮、滚动容器和安全区。
- 页面显示最近八项、当前活动和接下来三项；当前节点使用主题强调色，稍后活动降权。每项只显示时间、粗标题和已有的可选小插曲。
- 页面挂载时在 Presence 现有事务/Web Lock 内执行一次确定性结算；没有 Routine、Situation 或旧 Life 时不创建空记录。活动边界只刷新本地显示，不调用模型。
- 读取或结算失败保留已有内容并显示错误；无内容显示空状态。返回只回到 Chat Info，不改变聊天滚动位置。
- 测试编译通过；Chat UI 13/13、Life plan 6/6、Activity Core 8/8，共 27/27；改动文件 ESLint 无新增错误（`chat-room.tsx` 两条既有 hook warning）；`git diff --check` 通过；Next.js 16.3.8 生产构建及其 TypeScript 检查通过（26 个静态页面）。
- 针对 PR #197 的 CodeRabbit 意见，新增两个真实挂载 `LifeTimelineScreen` 的调用层持久化测试：Routine 存在时验证该角色投影活动已保存；Routine、Situations 和旧 Life 都缺失时验证 ready 效果运行且 Presence 存储原文不变。定向测试 2/2 通过，测试 TypeScript 编译通过。

## 尚未验证

- 自动化还覆盖实际 `LifeTimelineScreen` 挂载后的事务及持久化行为；尚未做真实浏览器点击或 iPhone 安全区/滚动验收。

## 下一步

提交并推送 PR #197 的评审补充；等待 Lan 手动合并；不在本单继续忙时延迟回复。

