# STATUS — 2026-10-09-codex-chat-core-final-medium

更新人：Codex
更新时间：2026-10-09T12:28:00+08:00
发现范围：检查 remote main@610c4df、全部可见 branches、open PR #36/#56 及其 changed files；main 任务记录和相关路径已阅读。Git 直连受限，使用 GitHub API。#36 冻结、#56 独立，不修改其分支；本任务不包含它们的实现。未发布本地工作无法发现。AUDIT_LEDGER.md 不可访问，三项映射均为「待登记／无法核对」。

## 当前任务

已完成实现和本地验证，待 CodeRabbit／人工 review：CF-01／CF-02／CF-03 均为「已修待验」，不自动合并。

## 谁在改哪里

Codex；branch `fix/chat-core-final-medium-20261009`；base `610c4df75f8cf83824ba12b188576310bf8fb7c1`；[PR #60](https://github.com/yecays-ai/veil/pull/60)，人工审查。
生产范围 3 文件：ChatStorage、chat engine、ChatRoom。测试 4 文件：chat-connection-recovery、chat-stop-boundary、chat-regenerate-lock-ui、chat-usability；第四文件与一次 CF-02 lease 历史整理已获用户明确授权。另维护本任务记录。

## 已完成

- CF-01：异常 close 清缓存；仅 transaction 创建阶段 InvalidStateError 重开并重试一次；事务创建后失败不重放；失效连接关闭、blocked late success 关闭。
- 未修 main 源码 tree `cb205ea1f9ccd17735c4522347b70768f1408457` 与隔离目录逐文件 hash 对齐后执行 Red。编译：`node node_modules/typescript/bin/tsc --project tsconfig.tests.json --outDir .test-output`。
- Red：`node --test --test-name-pattern='CF-01|CF-02|unsaved-draft|saved-reply-draft' .test-output/tests/chat-connection-recovery.test.js .test-output/tests/chat-regenerate-lock-ui.test.js .test-output/tests/chat-stop-boundary.test.js`：10 项，7 fail／3 pass。CF-01 InvalidStateError／仅一次 creation；CF-02 无安全 Retry、创建无上下文失败占位；CF-03 旧草稿仍在。保护项通过，不冒充 Red。
- CF-01 Green：同一编译命令后 `node --test .test-output/tests/chat-connection-recovery.test.js`：4/4 pass。
- CF-02：未保存草稿失败抛给页面，释放 attempt、不创建无上下文失败气泡、不消费已有 pending；页面保留原内容／quote／revision，显式 Retry 成功保存一次后生成。新的 Send／Regenerate 清除旧的重试上下文。
- CF-02 Green：编译后 `node --test --test-name-pattern='unsaved-draft' .test-output/tests/chat-regenerate-lock-ui.test.js`：3/3 pass；直接点击 Retry 的模型 prompt 含原问题一次，只有一条 User，新编辑保留；导航／页面重挂载后无可误用的 Retry。`node --test .test-output/tests/chat-stop-boundary.test.js`：8/8 pass。
- 加入 chat-usability 旧断言后再次 Red：恢复三份生产源码到同一 main 基线，`node node_modules/typescript/bin/tsc --project tsconfig.tests.json --outDir E:/AI-phone/chat-core-final-red-output`；设置 NODE_PATH 为本任务 node_modules；`node --test --test-name-pattern='CF-01|CF-02|unsaved-draft|saved-reply-draft|failed direct Send' E:/AI-phone/chat-core-final-red-output/tests/chat-connection-recovery.test.js E:/AI-phone/chat-core-final-red-output/tests/chat-regenerate-lock-ui.test.js E:/AI-phone/chat-core-final-red-output/tests/chat-stop-boundary.test.js E:/AI-phone/chat-core-final-red-output/tests/chat-usability.test.js`：11 项，8 fail／3 保护项 pass。日志位于任务目录外 `E:/AI-phone/chat-core-final-red.txt`。
- CF-03：Reply onSent 成功后记录原 session／content／editVersion；会话暂失时复用 #55 pending cleanup；恢复后只清那一版文本，即便改写后又写回相同文字也保留用户编辑。CF-03 依赖 CF-02 捕获的 revision 和同一挂载测试 fixture；不改 Send 的既有清理实现。
- 最终 Green：`node node_modules/typescript/bin/tsc --project tsconfig.tests.json`；三组定向回归 10/10，Chat Core 相关 234/234；`node scripts/run-tests.mjs` 全量 692/692、0 skip。相关筛选为 chat／generation／regenerate／quote／message-action／bubble-pacing／messages-home／network-timeouts／contacts-conversations／pr20-review-fixes。
- `node node_modules/typescript/bin/tsc --noEmit` 通过；`node node_modules/eslint/bin/eslint.js .` 0 error（未触及 use-chat-background.ts 的既有 unused-disable warning 1 项）；`NEXT_TELEMETRY_DISABLED=1 node node_modules/next/dist/bin/next build` 默认 Turbopack 通过；diff check 通过。
- 本机 npm 不在 PATH，按 veil-development 指南执行 package.json 的相同底层命令；初次构建受 sandbox／外部 dependency junction 限制，改用任务目录内已有依赖副本后构建通过，无构建配置改动。

## 尚未验证

- iPhone／真实浏览器故障注入、原生双窗口尚未执行；自动测试及合并最多为「已修待验」。
- CF-02 方案：原问题只保留在当前 ChatRoom 的内存失败上下文；尚未入库不创建失败助手占位。当前页显式 Retry 保存一次后生成。离开或刷新不承诺恢复未保存输入，不保留无上下文 Retry；无 schema／数据迁移。
- 手机 CF-01：验收环境注入数据库异常关闭 → 重新进入聊天可加载原消息、发送一次成功，无需清除数据。
- 手机 CF-02：验收环境模拟 Reply 草稿入库前失败，当前页点 Retry → 回复针对原问题、只有一条 User；失败后刷新或离开返回 → 未保存草稿不能恢复、没有本次失败的 Retry 气泡，需重新输入。
- 手机 CF-03：验收环境延迟保存返回并模拟角色暂不可用，保存完成后恢复 → 已保存旧草稿消失，再点 Send 不重复；等待期间新编辑仍在。
- 以上故障注入须用测试数据及 Safari 远程调试／验收夹具；JSDOM 重挂载不等于真实刷新通过。
- AUDIT_LEDGER.md 映射：CF-01／CF-02／CF-03 均「待登记／无法核对」；未编造原始 ID。

## 下一步

停止施工，等待 CodeRabbit、手机人工验收及最终第三刀复核；验收通过前不标记「已验证修复」。
