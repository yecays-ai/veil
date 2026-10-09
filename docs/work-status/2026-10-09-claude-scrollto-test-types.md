# STATUS — 2026-10-09-claude-scrollto-test-types

更新人：Claude
更新时间：2026-10-09T23:40:00+08:00
发现范围：2026-10-09 读取远端 main `33a6cf7`（含 #75、#77）；#75 带入的 `tests/chat-first-paint.test.ts:123` 使 `tsc --project tsconfig.tests.json` 在 main 上失败，因而 `npm test` 在编译阶段就失败。无开放 PR 改该测试文件；#36 已关闭。

## 当前任务

待审查：只修复该测试夹具的类型错误；不改任何生产代码。

## 谁在改哪里

Claude；分支 `claude/fix-scrollto-test-types`；PR https://github.com/yecays-ai/veil/pull/78（base main）。仅修改 `tests/chat-first-paint.test.ts` 的 `scrollTo` 夹具签名，使其同时匹配 DOM 的两个重载。

## 已完成

- `scrollTo` 夹具改为接受 `ScrollToOptions | number` 与可选 `y`，记录行为不变（对象形式记录原对象）。
- 验证环境：Node v24.21.0，TypeScript 5.9.3（`npx tsc --version`）。
- `npx tsc --project tsconfig.tests.json`：通过，退出码 0（修复前在 main 上退出码 2）。
- `npx tsc --noEmit`：通过，退出码 0。
- `node --test node_modules/.cache/veil-desktop-tests/tests/chat-first-paint.test.js`：4/4 通过（跑了两次）。
- `npm test`（含上面的编译步骤）：751 项，750 通过，1 失败（`navigation-feedback`，见下）；`npx eslint .`：0 error。

## 尚未验证

- 完整测试套件的结果见 PR 描述；GitHub Actions 与 Vercel 因账单/额度不能作为结论。
- `navigation-feedback`（Contacts 加载页断言 `RouteLoading`）是 main 上另一个已有的失败，本任务不处理。

## 下一步

等待审核与手动合并。
