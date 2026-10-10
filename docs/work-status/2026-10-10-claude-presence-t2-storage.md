# STATUS — 2026-10-10-claude-presence-t2-storage

更新人：Claude
更新时间：2026-10-11T06:50:00+08:00
发现范围：2026-10-11T06:02+08:00 通过 GitHub API 查看开放 PR（无开放 PR，含草稿）；`origin/main` = `47828c9e4d7287a0b1afd143e510c1f7eea98be6`（含 T1 #109）；已读 `docs/AUDIT_LEDGER.md`（在线系统仍为“未启动、保持登记”，要求不动首帧布局；本工单不碰界面）。

## 当前任务

Character Presence 第一批 T2：Presence 存储。待审查。

## 谁在改哪里

Claude；分支 `claude/project-thread-459m41`（T1 合并后从最新 main 重建）；PR [#110](https://github.com/yecays-ai/veil/pull/110)；base `47828c9`。
新增：`lib/presence/storage.ts`、`tests/presence-storage.test.ts`、本记录。
修改：`lib/presence/compute.ts`（仅注释）、`lib/character-deletion.ts`、`lib/character-leftovers.ts`（删除角色时清理 Presence 数据）、`tests/character-deletion-fixture.ts`、`tests/character-deletion.test.ts`、`tests/presence-compute.test.ts`。
不碰 Foundation、聊天、备注数据，不碰角色原有的 `presence` 字段，不碰任何界面。

## 已完成

- 独立存储域 `veil.presence.v1`（localStorage，沿用 Contacts / Bindings 的写入约定：本实例排队、跨标签页 Web Lock、写前复读重试）。按角色保存：作息（带修改时间与来源）、处境列表（各自保留原始起止时间；任一时刻最多两层在进行：长期底层 + 其上的短暂活动，展示开始得最晚的那条，短暂活动结束后底层恢复；第三条在两层都进行时从它开始的时刻起截断中间层；开始时间相同后写入者取代；只允许 1 条尚未开始，新的当前处境不删除它，可用 `cancelUpcoming` 取消或再写一条未来处境替换；`endSituation` 的“current”只结束最上层、“all”结束所有进行中的层，未来处境不受影响；结束超过 7 天的清除，8 条上限只裁剪已结束的记录，进行中和未开始的永不丢）、签名的修改标记（只存标记，签名文字仍在角色上）、两个 Last Seen 值（只增不减；非法值与超出 1 分钟时钟误差的未来值忽略）。
- 无变化的更新不写入、不广播；读不到、解析失败或来自更新版本的数据，读写都失败，不会被空文档覆盖。
- 作息整份有效才保存（任何字段越界则拒绝写入，读到时视为没有作息）；读取时丢弃损坏的行，不改动存储。
- 删除角色时清理该角色的 Presence 数据（`cleanupCharacterData` 新增 `presence` 步骤），并加入历史遗留的惰性引用清理（`reconcileInertReferences`）。
- 测试：新增 `tests/presence-storage.test.ts` 16 项（角色隔离、Last Seen 只增不减、未来处境与修剪、作息校验、损坏数据、无变化不写入、读失败/新版本不覆盖、写失败不丢数据、多标签页并发、写前复读重试、短暂活动结束后长期处境恢复、计划/取消/替换、结束当前与全部结束、Last Seen 回溯穿过两层、读取时限制为两层、上限与修剪不丢进行中的长期处境）；T1 另加 1 项长期处境恢复的回归测试；删除相关用例加入 Presence 并覆盖单步失败重试。
- 本地检查（2026-10-11 +08:00，Node 24.21.0）：`npm test` 838/838 通过；`npm run typecheck` 通过；`npm run lint` 0 error / 3 条既有 warning；`npm run build` 通过；`git diff --check` 无输出。证据级别：自动化测试（内存 localStorage、fake IndexedDB），非真机。

## 尚未验证

- 不适用真机：没有界面改动，Presence 数据尚未被任何页面或请求读写（T3 起接入）。
- 未验证真实浏览器里多标签页的 Web Lock 行为（只在测试里用模拟锁）。
- 不迁移、不删除角色原有的 `presence` 字段；备份/导出未纳入 Presence 数据（当前 Contacts 的导出函数也无调用方，本工单不扩范围）。
- 处境最多 8 条、作息最多 24 段、来源标记最长 100 字符是暂定上限。

## 下一步

等 Lan 审查合并 T2；确认后再开始 T3（作息生成）。
