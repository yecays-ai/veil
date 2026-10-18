# STATUS — 2026-10-18-claude-preset-feature-prompts

更新人：Claude
更新时间：2026-10-18T08:05+00:00
发现范围：基于 origin/main 75c22103e5ce5fa9ef73e742497c7fa290d2eb2e；未发现其他开放 PR 修改 Preset 或 self-context

## 当前任务

把角色自主使用的聊天功能（表情包、语音、生图、转账、礼物、撤回、表情回应、改状态签名备注、改日程、珍藏经历、主动消息）的说明文字放进 Preset，可查看、复制后编辑和开关。待审查。

## 谁在改哪里

Claude；分支 `claude/preset-feature-prompts`；PR 待创建。涉及 `lib/chat/feature-prompts.ts`（新）、`lib/preset.ts`、`lib/preset-library.ts`、`lib/chat/self-context.ts`、`lib/chat/engine.ts`、`lib/chat/proactive.ts`、`lib/chat/prompt.ts`、`components/settings/presets/*`。

## 已完成

- 新 Preset 条目类型 `source: "feature"`，不进 promptOrder；旧 Preset 读取或导入时补齐缺失条目（默认文字），存储仍是 localStorage `veil.preset.v1` version 3，不动 IndexedDB。
- 协议行、字段格式、表情包编号 / 可撤回 ID / 日程列表、主动消息的 silence 句仍由代码拼，不可编辑。
- 关掉的功能不提供给模型，回复里即使带了也不应用。
- `npm run typecheck`、`npm run lint`（0 error）通过；`npm test` 2265/2267 通过，2 个失败是 main 上已知的 Regex/WorldBook rollback lock 用例。
- 本地 `next dev` + Playwright 截图确认 Feature Prompts 一栏可展开、编辑、开关。

## 尚未验证

- 真机（用户自己的部署）上的使用体验。
- 修改文字后的实际模型回复效果。

## 下一步

CI 和 CodeRabbit 通过后合并，lan 在自己的部署上验收。
