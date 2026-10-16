# STATUS — 2026-10-16-claude-life-v2-l2-3-context

更新人：Claude
更新时间：2026-10-16T09:40:00Z
发现范围：2026-10-16 09:30Z 基于 origin/main 7de9a9689f385dba94c2b289974e4e27a3102fec（含 #226、#227）；GitHub API 查看 yecays-ai/veil 没有其他开放的 Life/Presence PR。

## 当前任务

Life V2 工单 L2-3：Character 自己当天后续的计划进入聊天上下文（只给标题与大致时间），用户页面不变。待审查。

## 谁在改哪里

Claude；分支 `claude/life-v2-l2-3-context`；PR 链接见 PR 描述。涉及 `lib/life/recent.ts`（新增 `aheadLife`）、`lib/chat/self-context.ts`（新增 `ahead` 与一行提示）、`tests/life-recent-context.test.ts`。不碰 `lib/memory/*`。

## 已完成

- 回复上下文新增「今天剩余的计划」：只取当天本地日结束前尚未开始、未取消的日计划行（`origin: "plan"`），最多 5 条，只给时间段与标题，不含细节；Routine 的通用节律行不算计划。
- 提示明确是背景：自然时可提，不背诵、不每次提、计划可变、不假定用户已知道。
- 用户 Life 时间线不变，仍不显示未来。上下文只含该 Character 自己的 Life。
- 检查：新增 1 个测试；life/presence/self-context 相关测试通过；typecheck、eslint 通过（本地 Node v22）。

## 尚未验证

- 没有真机验证，没有用真实模型验证 Character 是否自然使用这一行。
- 额外输入约 50–150 token（最多 5 行），未实测。
- 未跑完整测试套件。

## 下一步

CI 与 CodeRabbit 通过后合并；随后 L2-2（聊天内调整计划）。
