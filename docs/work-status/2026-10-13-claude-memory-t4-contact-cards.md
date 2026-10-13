# STATUS — 2026-10-13-claude-memory-t4-contact-cards

更新人：Claude
更新时间：2026-10-13T16:20:00Z（Asia/Taipei 00:20）
发现范围：base 为 #179 分支（claude/memory-t4-state-history，基于 main 7b8b3bcf）；2026-10-13T15:10Z 起通过 GitHub 集成查看；仅核对本任务路径，其他开放 PR 视为归属未知。

## 当前任务

Memory 工单 4 · 第 4 步：Contact Info 的 Character State / Memory 两张卡（待审查；依赖 #179 先合并）。

## 谁在改哪里

Claude；分支 `claude/memory-t4-contact-cards`；PR 创建后补链接。涉及 `components/contact-memory-cards.tsx`、`components/contact-info.tsx`、`app/contacts/contact-info.css`、新增 `tests/contact-memory-cards.test.ts`，以及 4 个已有联系人 UI 测试的模块桩。

## 已完成

- Contact Info 顺序：Shared Media → Character State → Memory → Relationship。State 卡显示最多 3 条当前（active）条目 + 「+N more」，点击进入 `/memory/<id>?tab=state`；Memory 卡显示 Active 记忆数，点击进入 `?tab=memories`。只读，无编辑控件；pending / suspended 不当作当前。
- 复用 #179 的 `useCharacterState` 和 `countActiveMemories`，不新增存储或请求。读取失败显示「Could not load State」/「Unavailable」，不显示 0 或「无 State」；切换角色不显示上一个角色的数字；联系人页 pending 或编辑中时卡片不可点。
- 已有的 4 个联系人 UI 测试（contacts-async-lifecycle / contacts-load-retry / leave-guards-ui / navigation-reentry）对 `contact-memory-cards` 加了模块桩，否则真实存储订阅会让测试进程不退出；这些测试本身不测 Memory。
- 验证（自动化，非真机）：typecheck、eslint 0 error；新测试 3/3；contact-info、contact-navigation-ui、contacts-*、leave-guards-ui、navigation-reentry、navigation-feedback、presence-actions 通过。

## 尚未验证

- 真机上 Contact Info 的外观，以及从聊天头像进入时多出的两次本地读取对首屏的影响（未实测）。
- 社交资料页的 State 面板此 PR 不动，下一步移除。

## 下一步

#179 合并后：清理社交资料页（移除 State、资料页底部 Memory 卡片改为轻量入口）。
