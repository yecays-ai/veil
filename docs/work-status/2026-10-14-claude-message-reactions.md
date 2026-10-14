# STATUS — 2026-10-14-claude-message-reactions

更新人：Claude
更新时间：2026-10-14T20:10:00+08:00
发现范围：2026-10-14 11:30Z 通过 GitHub API 查看 `yecays-ai/veil` 当前 open PR（仅 #190 README，文档类，无路径重叠）；基于 `origin/main` efc5c92ae52efe14b0e76952ae6972d834cfe82e；未发现其他 work-status 记录占用聊天消息 / 备份校验路径。

## 当前任务

消息 Reaction 工单 1：lan 可以给任意（非 system、已完成）消息点 Reaction。待审查。

## 谁在改哪里

Claude；分支 `claude/project-thread-q6qbh8`；PR 见 GitHub。涉及：`lib/chat/reactions.ts`（新）、`lib/chat/types.ts`、`lib/chat/storage.ts`（仅新增 `setReaction`）、`lib/chat/message-actions.ts`、`lib/backup/validation.ts`（消息字段白名单）、`components/chat/chat-room.tsx`、`components/chat/reaction-bar.tsx`（新）、`components/chat/reaction-picker.tsx`（新）、`app/messages/chat.css`、`package.json`/lock（新增 `emoji-picker-react` 5.0.0）。未触碰 `lib/memory/*`、#189/#191 的主动消息逻辑。

## 已完成

- 数据：`ChatMessage.reactions?: { user?, character? }`，没人点过则字段不存在，清除最后一个时删除字段；备份白名单与校验（单个 emoji、仅 user/character 键、system 消息不可带）。
- 存储：`setReaction` 只改消息行，不动会话摘要/预览/Memory；编辑保留 Reaction，删除消息一并删除。
- UI：轻点气泡的现有弹层上方加 Reaction 条（常用 6 个 + 展开按钮），选中即关闭；展开后懒加载 `emoji-picker-react`（原生 emoji 样式，无 CDN 请求）；气泡角落小圆泡。弹层放不下时整体滚动气泡，Reaction 条在上、菜单在下。
- 检查（Node 22.22.0）：`npm run typecheck` 通过；`npm run lint` 0 error（3 条既有 warning）；`npm run build` 通过；定向测试通过：message-reactions(9)、message-actions(8)、message-actions-ui、chat-message-actions、backup-validation、memory-t3-panel、presence-backup-roundtrip、chat-storage。

## 尚未验证

- 真机 / 浏览器内的实际视觉：弹层整体定位（滚动与临时底部留白）、小圆泡位置、选择器弹出尺寸。仅有源码级与纯函数测试。
- 未跑全量 `npm test`（按范围规则只跑相关模块）；本机 Node 为 22，非项目建议的 24。
- Character 给 lan 消息点 Reaction（工单 2）未做；`character` 字段已预留。

## 下一步

lan 在 Preview 验收工单 1；通过后做工单 2（回复末尾隐藏标签，不额外调模型）。
