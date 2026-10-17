# STATUS — 2026-10-16-claude-m2-acceptance-fixes

更新人：Claude
更新时间：2026-10-16T19:20Z（UTC）
发现范围：2026-10-16 查看 yecays-ai/veil，base 为 origin/main 4065120（含 M1 #233、M2 #234）；当时没有其它打开的 PR；只看了远端。

## 当前任务

M2 真机验收的两个修复，待审查。不做图片送模型（M3）。

## 谁在改哪里

Claude；分支 fix/m2-photos-shared-media；PR：https://github.com/yecays-ai/veil/pull/235。涉及：components/chat/chat-room.tsx、components/contact-shared-media.tsx（新）、components/contact-info.tsx、components/chat/messages/image-message.tsx、lib/chat/storage.ts（新增只读 listSessionImages）、app/contacts/contact-info.css、tests/{chat-image-send,contact-info,contacts-load-retry,contacts-async-lifecycle,leave-guards-ui,navigation-reentry}.test.ts。base 4065120。

## 已完成

- Photos：点开系统选图菜单时 + 面板保持显示；选完图或关闭选图器（input 的 cancel 事件）后才收起。
- Contact → Shared Media：显示该角色单聊里最新 8 张图片，最近优先，点击大图（可保存）；图片消息被删除、撤回，或图片数据丢失后从列表消失（订阅聊天存储变化）。直接读聊天消息的附件，没有新建媒体库、没有改 IndexedDB 结构。
- 评审后补充：读取失败显示「Photos could not be loaded. Try again」而不是「No photos yet.」；图片数据已丢失的消息在取前 8 张之前就被排除（只查资源 key，不读字节），不会占名额；新增挂载 ChatRoom 的测试（tests/chat-photos-panel.test.ts）覆盖选图器打开、cancel、选择三种情形下面板的收起。
- 联系人页现在会订阅聊天存储（会开 BroadcastChannel），4 个渲染联系人页的测试夹具（contacts-load-retry、contacts-async-lifecycle、leave-guards-ui、navigation-reentry）按仓库惯例关掉 BroadcastChannel，否则测试进程退出不了。
- npm run typecheck 通过；lint 0 错误（3 条原有警告）；npm test 2096 条，2094 通过。
- Chromium 实测（自动化浏览器，不是真机）：选图器打开时面板在、选图后收起、cancel 事件后收起；Shared Media 蓝/绿/红三张按最近优先，点开大图；删掉最新一张的图片数据后刷新只剩两张。

## 尚未验证

- 失败的 2 条（Regex、WorldBook 回滚锁）在 main 上同样失败，非本改动引起。
- iPhone Safari 真机：iOS 上关闭系统菜单是否触发 input 的 cancel 事件未验证（Safari 16.4 起支持，未实测）；若不触发，面板会留在原处，点 + 可收起。
- Shared Media 只显示最近 8 张，没有「查看全部」；群聊不涉及。

## 下一步

等 lan 审查并真机验收；M3（图片送模型）等 lan 说开始。M7 的两种生图模式只登记在项目记忆里，未实施。
