# STATUS — 2026-10-15-claude-life-contact-reason

更新人：Claude
更新时间：2026-10-15T15:30:00Z
发现范围：2026-10-15 15:18Z 查看 `yecays-ai/veil` 开放 PR 为空（含草稿）；起点 `origin/main` 为 `3f37e5607f5e8a256bd3cc49859d0260283aeca4`（#208 合并后）。未检查其他分支上的未发布记录。

## 当前任务

待审查。第二步：生活事件作为角色主动联系的理由。lan 2026-10-15 选择"只改提示词"：不加触发、不加模型调用。

## 谁在改哪里

Claude；分支 `claude/project-thread-iwht8v`；PR：https://github.com/yecays-ai/veil/pull/209。涉及 `lib/chat/proactive.ts`、`tests/proactive-contact.test.ts`。不改调度、预算、状态规则或 `lib/memory/*`。

## 已完成

- 主动联系的判断提示加一句：自己日子里已经发生的小事可以是开口的理由，但不是必须。角色在这次判断里本来就能看到当前活动和已发生的小插曲（#208）。
- 频率规则不变：每 15 分钟检查、每天最多 2 次、间隔 3 小时，Busy/勿扰/离线不联系。
- 检查（Node 24.21.0）：`tsc --noEmit`、eslint 0 错误；proactive-contact 与 presence-self-context 共 27 条测试通过，新增 1 条措辞测试。

## 尚未验证

- 真机：角色是否会因为生活小事自然开口、是否过于频繁，要在真实对话里观察。

## 下一步

lan 验收观察；之后再决定是否做"新小插曲触发"或第三步（忙碌时延迟回复，需要 lan 先定规则）。
