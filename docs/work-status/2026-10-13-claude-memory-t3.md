# STATUS — 2026-10-13-claude-memory-t3

更新人：Claude
更新时间：2026-10-13T14:40:00Z
发现范围：base origin/main 656cc4b79bc0d93a26f5d68735184308110641bc（含 #172–#175）；仅本任务相关路径；未逐一检查其他开放 PR。

## 当前任务

Memory 重做工单 3：聊天里的 Memory 按钮与面板（进行中）。

## 谁在改哪里

Claude；分支 `claude/memory-t3-chat-memory-button`；PR 尚未创建。涉及 `components/chat/{chat-room,message-memory}.tsx`、`app/messages/chat.css`、`lib/chat/{types,engine,storage}.ts`、`lib/memory/{context,injected,bank,storage}.ts`、`lib/backup/validation.ts`、相关测试。

## 已完成

- 角色回复的长按菜单：禁用的 React 换成 Memory（仅 Character 回复可点，其余保持 4×2 固定布局）。面板有 Long Term Memories / Journal 两个标签，只读。
- 每条回复保存本次注入条目的 id + 内容哈希（`memoryRefs`，≤6，不含记忆文本）。面板只在能证明文本就是当时注入的内容时显示：当前行匹配，或最近 5 次撤销记录里仍有该版本且记忆还在；否则显示「This version is no longer available.」，绝不用当前文本顶替。已删除的记忆只显示「已删除」。
- 不新增任何长期版本存储：手动编辑的旧文本只存在于原有的“最近 5 次撤销”记录里，超出即被修剪。自动维护的历史沿用 Superseded + lineage。
- 删除记忆：同一事务里连带删除它的 lineage 历史（被它取代的原件），并为这些文本写删除抑制；更早的、含该记忆其他文本版本的撤销记录被清除；撤销这次删除仍可整体恢复。
- 注入条目新增 `recordedAt`（记忆首次写入的 UTC 日期），Journal 条目同样带；P4 评测 167 项不变。
- 备份校验：`memoryRefs` 只允许 assistant 消息、≤6 条、`{id, hash(16 hex), journal?:true}`；往返恢复测试通过。旧数据没有该字段，面板显示“记录之前的回复”。

## 验证（自动化测试，非真机）

- typecheck、eslint 0 errors；`tests/memory-t3-panel.test.ts` 7/7；memory-bank、memory-bank-ui、message-actions-ui 通过；`npm run test:memory` 167 通过。
- 完整 `npm test`：仅 `regex-worldbook-storage-safety` 两项失败，在 origin/main 上同样失败，与本任务无关。

## 尚未验证

- 真机上长按菜单与面板的实际外观与交互。
- `recordedAt` 用 UTC 日期，用户时区下接近午夜可能差一天，未处理。
- 真实模型对带日期条目的使用效果（需 lan 另行批准评测）。

## 下一步

开 PR，CI 绿且评审线程处理完后合并，然后工单 4（Memory Bank App 设计稿）与工单 5。
