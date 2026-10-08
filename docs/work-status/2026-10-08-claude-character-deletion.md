# STATUS — 2026-10-08-claude-character-deletion

更新人：Claude
更新时间：2026-10-08T12:00:00+00:00
发现范围：2026-10-08 通过 GitHub 集成列出 `yecays-ai/veil` 的 open PR：仅 #36（冻结，`fix/chat-first-frame-complete`，chat session prefetch），未修改；本任务与其无意图重叠，另用 `git merge-tree` 检查文件冲突。

## 当前任务

工单 08｜R3 Character 完整删除与数据清理（待审查）

## 谁在改哪里

Claude；分支 `claude/brave-davinci-ws2ruk`；PR 尚未创建（创建后在此补链接）；base `origin/main` 5e0b03c。
涉及：`lib/character-deletion.ts`、`lib/character-leftovers.ts`（新）、`lib/chat/storage.ts`（`countMessages`、`removeGroupMembers`）、`lib/chat/types.ts`（注释）、`lib/bindings.ts`、`lib/here-there-binding.ts`、`lib/foundation-copy.ts`、`components/profile-pages.tsx`、`tests/character-deletion*.ts`、`tests/stale-editor-ui.test.ts`、`tests/navigation-reentry.test.ts`、`tests/no-active-character.test.ts`。

## 已完成

- 删除顺序：先检查（无进行中的回复，否则中止且未改动）→ Foundation 删除（唯一提交点；失败则其它存储都未触碰）→ 五个幂等清理步骤（widgets、groups、conversation、contact、bindings），各自独立失败并在报告中逐项列出，可重试。跨存储无原子性：提交点之后失败的步骤会保留其数据，UI 如实显示“角色已删除，但以下步骤未完成”并提供 Retry。
- 群聊一律保留；成员为 0 时 `characterId` 置为 `""`（不匹配任何角色）。
- 当前布局与已保存预设中的 Here & There 绑定及评论被清除，小组件保留；在途评论生成因 widget 已解绑，写回被现有 commit 守卫丢弃。
- 历史遗留：Binding、widget 链接、群成员 ID 在进入 Characters 页时自动清理（Foundation 读取成功且角色目录非空才执行）；历史私聊与联系人只在用户确认后删除。
- 测试：`tests/character-deletion.test.ts`（10 项，真实存储 + fake-indexeddb）、`tests/stale-editor-ui.test.ts` 新增挂载 UI 测试（确认清单、未完成步骤报告、Retry）。
- Node 24：`npm test` 586/586 通过；`npx tsc --noEmit`、`npx eslint .`、`npm run build` 见 PR 描述中的最终结果。

## 尚未验证

- 真机/真实浏览器中多标签页并发删除未手测。
- 历史数据清理仅在测试存储中验证，未对用户真实浏览器数据运行。

## 下一步

创建 PR（不加 automerge），等待 CodeRabbit 与 CI，由用户本人手动合并。
