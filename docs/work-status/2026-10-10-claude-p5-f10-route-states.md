# STATUS — 2026-10-10-claude-p5-f10-route-states

更新人：Claude
更新时间：2026-10-09T21:20:00Z
发现范围：观察时间 2026-10-09T21:05Z；基于 origin/main `72c3bd89e0e1e70918fc5530762cc971b6b77a08`（#86 已合并，F9 已修）；远程 open PR 当时仅有 #87（删除 auto-merge 工作流，只涉及 .github/workflows/auto-merge.yml、tests/safe-pr-auto-merge.test.ts 与其 work-status），与本任务无文件重叠；无访问限制。

## 当前任务

Part 5 F10（《6刀.docx》，Low；与《前端》F1–F8 无关）：四种页面状态错误暗示加载中、不存在或失败。状态：待审查（①③④）；②暂停，待 Lan 决定。

## 谁在改哪里

Claude；分支 `claude/p5-f10-route-states`；PR 见本分支 PR。涉及：`components/chat/messages-home.tsx`、`components/chat/group-room.tsx`、`components/settings/bindings/binding-manager.tsx`、`tests/route-state-display.test.ts`（新）、`docs/AUDIT_LEDGER.md`（仅 F10 相关两处）、本记录。base revision `72c3bd89e0e1e70918fc5530762cc971b6b77a08`。

## 已完成

- 逐项核对：四种情况在 72c3bd89e0e1e70918fc5530762cc971b6b77a08 上全部仍存在。运行 `npx tsc --project tsconfig.tests.json` 后 `node --test node_modules/.cache/veil-desktop-tests/tests/route-state-display.test.js`（Node 24，jsdom + fake-indexeddb），未改生产代码时 7 条中 5 条失败，2 条防回归通过（该统计是第一版测试，含 ② 的 “No conversations yet” 与无匹配断言；② 暂停后这两条已改为不钉文案的完成态测试）。
- 修复：① 读取失败时不再显示 Loading（`!loaded && !error`）；② 不做（见下）；③ GroupRoom 读到非群聊 session 显示 “This conversation is not a group.”；④ BindingEditor 仅在 Foundation ready 后才判断 Character 缺失，之前显示 “Loading Bindings…”。App 标识无效不依赖 Foundation，仍立即判定。
- 修复后测试全部通过（最终为 6 条）；`npm test`、lint、build 结果见 PR 描述。
- 证据级别：自动化测试（JSDOM）；未做真机验证。
- 与工单差异：② 工单要求恢复“没有会话/没有匹配”的提示，但 bce4305（2026-10-06）曾有意移除这些文案，并由 `tests/contacts-conversations.test.ts` 的 `doesNotMatch(/No conversations yet|No group chats yet|No matching chats/)` 钉住。依停止条件，② 暂停，不改生产代码和该测试；是否恢复由 Lan 决定。① 工单要求展示“已有的重试入口”，但 MessagesHome 没有重试入口（列表只在挂载和存储变更订阅时重读），本 PR 未新增；④ 工单要求区分 Foundation pending / failed / ready，Foundation Provider 不暴露失败状态，本 PR 只区分 pending / ready，Foundation 加载失败仍表现为 “Loading Bindings…”，不会再被误报为 not found，也不改 Foundation。

## 尚未验证

- 真机未验证。
- GitHub Actions `verify` 与 Vercel 预览：如未运行成功，在 PR 中逐项记录原因，不算通过；本地命令为替代检查。

## 下一步

等待 CodeRabbit 审查最新提交，由 Lan 手动合并；不自动合并，不加 automerge 标签。
