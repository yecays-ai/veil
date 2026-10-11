# STATUS — 2026-10-11-claude-presence-t7-actions

更新人：Claude
更新时间：2026-10-11T12:40+08:00
发现范围：2026-10-11T12:25+08:00 起；`origin/main` = `1a281e33c8317f9ea9dbd71f5b700fc916dc2669`（含 T6 #115）；已读 `docs/AUDIT_LEDGER.md` 与 Presence 工单计划 T6–T8 定稿；GitHub 开放 PR 只有 #116（`codex/chat-entry-performance`，聊天进入首帧），与本任务文件无重叠。本分支从该 `origin/main` 创建。

## 当前任务

Character Presence T7：角色通过结构化动作自己改处境和签名；签名写入 Foundation `statusMessage`；角色资料页副标题改用签名。

## 谁在改哪里

Claude；分支 `claude/presence-t7-actions`；PR [#117](https://github.com/yecays-ai/veil/pull/117)；base `1a281e3`。
新增：`lib/presence/actions.ts`、`tests/presence-actions.test.ts`、本记录。修改：`lib/chat/engine.ts`、`lib/chat/self-context.ts`、`components/profile-view.tsx`、`tests/presence-self-context.test.ts`。不碰 Header、聊天室 UI、T8 范围。

## 已完成

- 回复末尾可带一行（只有收尾的那一行才生效；回复中间引用的标签只会被隐藏，不会执行） `<veil-action>{JSON}</veil-action>`，字段可选：`signature`、`situation`（状态/原因/几分钟后开始/持续几分钟）、`endSituation`（current/all）、`cancelUpcoming`。标签在流式阶段和落库前都被去掉（含写了一半的标签），用户看不到；JSON 无效则丢弃，不报错。
- 同一次回复请求里完成，不增加模型请求。动作在回复提交之后才应用，失败只在控制台记一行警告，不影响已保存的回复；Continue 既不提示也不应用动作。
- 过去事件不会改写已定状态：开始时间不早于"现在"，只能是现在或将来；提示词也要求只在"正在发生或即将发生"时才改。持续时间缺省 6 小时，上限 14 天（沿用 T1）；状态未知则不写。
- 冷却：按角色自己上一次改动的时间判断（处境 30 分钟、签名 12 小时，均为暂定值），不是每周次数；冷却中的那一类不会出现在提示词里，引擎也会忽略。结束或取消处境同样启动冷却（Presence 记录新增 `situationChange` 变更标记，缺省为空，旧数据原样读取）；什么也没改变的动作不消耗冷却，用户或作息造成的处境不计入。签名没变化不消耗冷却。
- 签名写入 Foundation `statusMessage`，随后在 Presence 记录里打变更标记（来源 `character:<消息 ID>`）。两个存储无法同事务，签名先写（真实数据），标记后写；标记失败的后果只是冷却未生效。签名写入前过滤控制字符/不可见字符、折叠空白、最多 200 字（回应 CodeRabbit 在 #115 提的安全建议，只作用于模型写入路径，不改动已有备注）。
- 验收修复（Lan 2026-10-11 真机）：Universe 角色列表原先用职业（无职业时用地点）当副标题，现改为只显示角色签名，签名为空则不显示，不用职业兜底；职业字段本身保留。Messages → Contact Info 早已在在线状态行下方显示签名（`contact-status`），本次补了渲染测试，确认顺序、为空不显示、不显示职业。其他位置（联系人列表、社交资料、聊天头部）本来就只用签名；用户自己的资料页副标题仍是职业，不属于角色签名。
- 角色资料页副标题：角色显示签名，签名为空则不显示副标题，职业字段与详情保留；用户资料页仍显示职业。
- 角色资料正在编辑时若签名被角色改动，保存会走现有的"已在别处修改"冲突提示，不会静默覆盖。

## 本地验证（Node v24.21.0）

typecheck、lint（3 条既有警告，0 错误）、`npm test`、`npm run build` 均通过；测试数见 PR 说明。

## 尚未验证

- 真机：模型是否在合适时机发出动作、不乱改、不复述过去；资料页副标题显示；预览分支。
- 暂定常量（冷却 30 分钟 / 12 小时、提前开始上限 7 天）待 Lan 验收后调整。
- GitHub CI、CodeRabbit 与 Vercel 预览：创建时尚未运行。

## 下一步

开 PR，等 CI 与 CodeRabbit，同步临时验收分支，等 Lan 验收并手动合并；T8 等 Lan 确认。
