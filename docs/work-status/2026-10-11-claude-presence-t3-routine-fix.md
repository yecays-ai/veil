# STATUS — 2026-10-11-claude-presence-t3-routine-fix

更新人：Claude
更新时间：2026-10-11T08:40:00+08:00
发现范围：2026-10-11T08:20+08:00 起；`origin/main` = `3bb7b5880e5e0198a9b40ed3070a3d031898f4dc`（含 T3 #111）；开放 PR #112（T4，改动聊天头部与 Presence 展示，未碰 `lib/presence/routine.ts`）；本分支从 `origin/main` 创建。已读 `docs/AUDIT_LEDGER.md`。

## 当前任务

T3 作息生成修复（Preview 实机发现：推理模型在 700 token 内只输出思考，作息 JSON 没出现）。待审查。

## 谁在改哪里

Claude；分支 `claude/presence-routine-fix`；PR 见 GitHub；base `3bb7b58`。
修改：`lib/presence/routine.ts`、`components/profile-pages.tsx`、`lib/foundation-copy.ts`、`tests/presence-routine.test.ts`、本记录。不碰 App Overrides UI、聊天、T5 及以后的任务。

## 已完成

- 输出预算：`ROUTINE_MAX_TOKENS` 700 → 3000，并且按原值使用，不再被预设里的 `maxTokens` 压低（预设的值是给聊天回复定的）；温度仍取预设。仍是单次请求、不重试。
- 失败原因：结果区分 `no-api`、`error`（请求失败）、`truncated`（`finish_reason` 为 length 且没有可用 JSON）、`invalid`；角色资料页保存后只在失败时显示一行提示，成功静默。
- 兼容的格式偏差：结束时间 `24:00`（只限结束时间，等于 00:00 次日起点）、数字写成字符串、状态大小写/空白。周日写成 7、`24:01`、起始 `24:00`、缺字段、未知状态仍然整份拒绝。
- 测试：新增 4 项（预算不被预设压低；四种失败原因及“截断但 JSON 完整仍可用”；宽容与严格边界；`23:00–24:00`、`23:00–01:00`、`00:00–24:00` 经 `effectivePresence` 验证无零长度或全天误判）。
- 本地检查（Node 24.21.0）：`npm test` 853/853；`npm run typecheck`；`npm run lint` 0 error / 3 条既有 warning；`npm run build` 均通过。证据级别：自动化测试，非真机。

## 尚未验证

- 真机：真实 DeepSeek 推理模型在 3000 token 内能否产出 JSON、`veil.presence.v1` 是否出现、提示是否显示。
- 新建角色保存后会跳转页面，失败提示随页面切换而不显示（编辑已有角色时显示）。
- 3000 仍是暂定值；推理特别长的模型仍可能截断，此时提示会显示“被截断”。

## 下一步

等 Lan 在 Preview 验收并手动合并；T5 等 Lan 确认。
