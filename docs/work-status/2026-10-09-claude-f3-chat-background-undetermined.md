# STATUS — 2026-10-09-claude-f3-chat-background-undetermined

更新人：Claude
更新时间：2026-10-09T16:40:00Z
发现范围：基于 origin/main e162789；读取了 use-chat-background.ts、background-cache.ts、chat-room.tsx 与 tests/chat-background-first-paint.test.ts；未重新枚举其他开放 PR，本 PR 只改一个测试文件、账本与本记录。

## 当前任务

待审查：核对账本 F3（Chat 把“尚未确定背景”当成“默认背景”）；结论为当前 main 已受保护，不改生产代码，只补回归测试并更正账本。

## 谁在改哪里

Claude；分支 claude/f3-chat-background-undetermined；PR 创建后补链接；涉及 tests/chat-background-first-paint.test.ts、docs/AUDIT_LEDGER.md；base e162789。

## 已完成

- 核对：设置未读到时 `readyForFrame` 为假（chat-room 的 frameReady 依赖它）；读取失败不写入缓存；晚到全局设置不覆盖会话自己的壁纸；#73 的 “Part 5 / F3” 与本编号无关。
- 新增 3 项测试：失败读取不当作默认并在下次进入重读、明确默认立即发布、晚到全局设置不覆盖角色壁纸。
- 账本：F3 改为已核对待验；F6 记 #74/#80、F7 记 #75 已合并（已修待验）；表头基线改为 e162789；F8 第⑤项未改动，仍为“阻塞（待设备）”。
- 完整 `npm test`：754/754 通过；eslint 对该测试文件无报错。
- `npx tsc --project tsconfig.tests.json` 通过；`node --test …/chat-background-first-paint.test.js`：19/19 通过（Node v24.21.0）。

## 尚未验证

- iPhone 真机未验。
- 有意保留的 1200ms 回退（设置读取超时或失败时发布 Theme 背景）是否符合预期，需要 owner 确认。

## 下一步

等待用户手动合并，不使用 automerge。
