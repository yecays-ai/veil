# STATUS — 2026-10-09-codex-chat-core-final-medium

更新人：Codex
更新时间：2026-10-09T12:19:00+08:00
发现范围：检查 remote main@610c4df、全部可见 branches、open PR #36/#56 及其 changed files；main 任务记录和相关路径已阅读。Git 直连受限，使用 GitHub API。#36 冻结、#56 独立，不修改其分支；本任务不包含它们的实现。未发布本地工作无法发现。AUDIT_LEDGER.md 不可访问，三项映射均为「待登记／无法核对」。

## 当前任务

进行中：只修 CF-01／CF-02／CF-03，同一个人工审查 PR、三个独立提交，不自动合并。

## 谁在改哪里

Codex；branch `fix/chat-core-final-medium-20261009`；base `610c4df75f8cf83824ba12b188576310bf8fb7c1`；[PR #60](https://github.com/yecays-ai/veil/pull/60)，draft。
生产范围：ChatStorage、chat engine、ChatRoom。测试：chat-connection-recovery、chat-stop-boundary、chat-regenerate-lock-ui；另维护本任务记录。

## 已完成

- CF-01：异常 close 清缓存；仅 transaction 创建阶段 InvalidStateError 重开并重试一次；事务创建后失败不重放；失效连接关闭、blocked late success 关闭。
- 未修 main 源码 tree `cb205ea1f9ccd17735c4522347b70768f1408457` 与隔离目录逐文件 hash 对齐后执行 Red。编译：`node node_modules/typescript/bin/tsc --project tsconfig.tests.json --outDir .test-output`。
- Red：`node --test --test-name-pattern='CF-01|CF-02|unsaved-draft|saved-reply-draft' .test-output/tests/chat-connection-recovery.test.js .test-output/tests/chat-regenerate-lock-ui.test.js .test-output/tests/chat-stop-boundary.test.js`：10 项，7 fail／3 pass。CF-01 InvalidStateError／仅一次 creation；CF-02 无安全 Retry、创建无上下文失败占位；CF-03 旧草稿仍在。保护项通过，不冒充 Red。
- CF-01 Green：同一编译命令后 `node --test .test-output/tests/chat-connection-recovery.test.js`：4/4 pass。
- CF-02：未保存草稿失败抛给页面，释放 attempt、不创建无上下文失败气泡、不消费已有 pending；页面保留原内容／quote／revision，显式 Retry 成功保存一次后生成。新的 Send／Regenerate 清除旧的重试上下文。
- CF-02 Green：编译后 `node --test --test-name-pattern='unsaved-draft' .test-output/tests/chat-regenerate-lock-ui.test.js`：3/3 pass；直接点击 Retry 的模型 prompt 含原问题一次，只有一条 User，新编辑保留；导航／页面重挂载后无可误用的 Retry。`node --test .test-output/tests/chat-stop-boundary.test.js`：8/8 pass。

## 尚未验证

- CF-02／CF-03 最终 Green、Chat Core／全量测试、typecheck、lint、build 尚待最终提交验证。
- iPhone／真实浏览器故障注入、原生双窗口尚未执行；自动测试及合并最多为「已修待验」。
- CF-02 方案：原问题只保留在当前 ChatRoom 的内存失败上下文；尚未入库不创建失败助手占位。当前页显式 Retry 保存一次后生成。离开或刷新不承诺恢复未保存输入，不保留无上下文 Retry；无 schema／数据迁移。

## 下一步

完成另外两项独立提交和全量验证，交 CodeRabbit／人工 review；不自动合并。
