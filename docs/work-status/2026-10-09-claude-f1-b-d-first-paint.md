# STATUS — 2026-10-09-claude-f1-b-d-first-paint

更新人：Claude
更新时间：2026-10-09T17:30:00Z
发现范围：基于 origin/main 9919b3a（含 #79、#81）；只读定位后按 owner 确认实施 F1、b、d；a、c 只加诊断事件、不修；未重新枚举其他开放 PR，改动限于下列文件。

## 当前任务

待审查：F1（冷启动不再先画默认桌面）、b（Chats 列表保留最近快照）、d（Contact Info → Chat 复用 prefetchChatSession）；a（Chats → Chat 白帧）与 c（Safari 恢复 Loading Character）仅诊断，未修。

## 谁在改哪里

Claude；分支 claude/f1-b-d-first-paint；PR 创建后补链接；涉及 components/theme-provider.tsx、components/home-screen.tsx、components/chat/messages-home.tsx、lib/chat/session-list-snapshot.ts、components/contact-info.tsx、components/chat/chat-room.tsx（仅诊断事件）、tests/navigation-reentry.test.ts、tests/messages-home-snapshot.test.ts；base 9919b3a。

## 已完成

- F1：ThemeProvider 新增 `settled`（首次读取结束，无论成败）；HomeScreen 在 `settled` 前只渲染空壳，由 hydration 前的 bootstrap 颜色填满；读取失败时仍显示默认桌面，应用保持可达。壁纸与自定义图标仍沿用现有 1 秒上限，未加动画。
- b：新增 lib/chat/session-list-snapshot.ts，MessagesHome 用上次读到的列表作首帧，仍每次重新读取并覆盖；快照只活在本页面生命周期内，不持久化。取舍：旧行可能闪现一次读取的时间（例如在别处删除后）。
- d：Contact Info 的 Message 在 openSession 之后、导航之前调用现有 prefetchChatSession；预取失败只是没有种子。
- a、c：chat-room 新增诊断事件 `chat-frame`（phase: shell／published），仅在已有首帧诊断开关打开时记录，不改行为。
- 测试：navigation-reentry 10/10（含 F1 两条、d 一条）；messages-home-snapshot＋messages-home-refresh 3/3。
- 全套 `npm test`：见 PR 描述中的最终结果（Node v24.21.0）。已知偶发失败 CF-02（chat.unsaved-draft-explicit-retry）在未改动的 main 上也出现过。
- eslint：0 errors；6 条 warning 为既有，不在本次改动行上。

## 尚未验证

- iPhone Standalone 真机：F1 冷启动、b 返回列表、d 进入聊天均未验证。
- a、c 的耗时分解需要真机诊断数据，未采集；采集步骤见 PR 描述。

## 下一步

等待 owner 手动合并；真机采集 a、c 的诊断后再决定是否修。
