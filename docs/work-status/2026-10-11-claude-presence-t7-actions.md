# STATUS — 2026-10-11-claude-presence-t7-actions

更新人：Claude
更新时间：2026-10-11T17:40+08:00
发现范围：2026-10-11T12:25+08:00 起，17:25+08:00 复查；`origin/main` = `1a281e33c8317f9ea9dbd71f5b700fc916dc2669`（含 T6 #115）；已读 `docs/AUDIT_LEDGER.md` 与 Presence 工单计划 T6–T8 定稿；GitHub 开放 PR 只有 #116（`codex/chat-entry-performance`，聊天进入首帧），与本任务文件无重叠。本分支从该 `origin/main` 创建；17:25+08:00 已把最新 `origin/main`（`4fc5332`，含备份 #123–#125）合入本分支，与本任务文件无重叠、无冲突。

## 当前任务

状态：待审查（等待 Lan 真机验收；Vercel 预览因每日部署额度用完未运行）。

Character Presence T7：角色通过结构化动作自己改处境和签名；签名写入 Foundation `statusMessage`；角色资料页副标题改用签名。

## 谁在改哪里

Claude；分支 `claude/presence-t7-actions`；PR [#117](https://github.com/yecays-ai/veil/pull/117)；base `1a281e3`。
新增：`lib/presence/actions.ts`、`tests/presence-actions.test.ts`、本记录。修改：`lib/chat/engine.ts`、`lib/chat/self-context.ts`、`components/profile-view.tsx`、`tests/presence-self-context.test.ts`。不碰 Header、聊天室 UI、T8 范围。

## 已完成

- 回复末尾可带一行（只有收尾的那一行才生效；回复中间引用的标签只会被隐藏，不会执行） `<veil-action>{JSON}</veil-action>`，字段可选：`signature`、`situation`（状态/原因/几分钟后开始/持续几分钟）、`endSituation`（current/all）、`cancelUpcoming`。标签在流式阶段和落库前都被去掉（含写了一半的标签），用户看不到；JSON 无效则丢弃，不报错。
- 同一次回复请求里完成，不增加模型请求。动作在回复提交之后才应用，失败只在控制台记一行警告，不影响已保存的回复；Continue 既不提示也不应用动作。
- 过去事件不会改写已定状态：开始时间不早于"现在"，只能是现在或将来；提示词也要求只在"正在发生或即将发生"时才改。持续时间缺省 6 小时，上限 14 天（沿用 T1）；状态未知则不写。
- 冷却：按角色自己上一次改动的时间判断（处境 30 分钟、签名 12 小时，均为暂定值），不是每周次数；冷却中的那一类不会出现在提示词里，引擎也会忽略。结束或取消处境同样启动冷却（Presence 记录新增可选的 `situationChange` 变更标记，首次变更前不存在，因此旧数据和旧备份包按原样读取、通过备份校验）；什么也没改变的动作不消耗冷却，用户或作息造成的处境不计入。签名没变化不消耗冷却。
- 签名写入 Foundation `statusMessage`，随后在 Presence 记录里打变更标记（来源 `character:<消息 ID>`）。两个存储无法同事务，签名先写（真实数据），标记后写；标记失败的后果只是冷却未生效。签名写入前过滤控制字符/不可见字符、折叠空白、最多 200 字（回应 CodeRabbit 在 #115 提的安全建议，只作用于模型写入路径，不改动已有备注）。
- 验收澄清（Lan 2026-10-11 真机）：Universe 角色列表的职业/地点副标题是角色设定展示，保持原样，本 PR 不改（曾误改后已撤回）。签名的主要展示在 Messages → Contact Info 在线状态下方，早已实现；补了渲染测试，确认顺序、为空不显示、不显示职业。
- 角色资料页副标题：角色显示签名，签名为空则不显示副标题，职业字段与详情保留；用户资料页仍显示职业。
- 角色资料正在编辑时若签名被角色改动，保存会走现有的"已在别处修改"冲突提示，不会静默覆盖。

## 本地验证（Node v24.21.0）

typecheck、lint（3 条既有警告，0 错误）、`npm test`（973/973）、`npm run build` 均通过。GitHub `verify`：首个提交上 CF-02（已知偶发）失败，按规则重跑失败任务一次后通过；之后各提交，包括 `eb1fb0f`，均通过。CodeRabbit 已复审并回复处理。

## 尚未验证

- 真机：模型是否在合适时机发出动作、不乱改、不复述过去；资料页副标题显示；预览分支。
- 暂定常量（冷却 30 分钟 / 12 小时、提前开始上限 7 天）待 Lan 验收后调整。
- Vercel 预览：因账号每日部署额度用完（100 次/天），`937b55a` 与 `eb1fb0f` 均未部署，记为未运行；验收分支同样未验证。

## 下一步

额度恢复后确认 Preview 部署版本并同步验收分支，等 Lan 真机验收并手动合并；T8 等 Lan 确认。
