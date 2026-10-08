# STATUS — 2026-10-08-claude-theme-provider-recovery

更新人：Claude
更新时间：2026-10-08T12:00:00+00:00
发现范围：2026-10-08 通过 GitHub API 查看开放 PR，仅 #36（Chat 首帧）开放，未触及 Theme 文件；基线 main `ac84315`；本地无未提交改动。

## 当前任务

待审查：工单 01 — Theme Provider 失败恢复（只修两个问题）。

## 谁在改哪里

Claude；分支 `claude/brave-davinci-ws2ruk`；PR [#39](https://github.com/yecays-ai/veil/pull/39)（人工审查，不加 automerge）；涉及 `components/theme-provider.tsx`、`tests/theme-provider-recovery.test.ts`（新）、`tests/theme-safety-ui.test.ts`（仅把按钮选择器改为按文字选取）。

## 已完成

- 根因 1：`commit()` 只 await 已 rejected 的 hydration，且失败时 `ready=false` 使 Appearance 控件被禁用，无任何重新读取入口。
- 根因 2：`commit()` 在持久化成功后 await `refresh()`，刷新失败被当作保存失败抛出，并把运行时置为不可写。
- 修复：`commit()` 在不可写时先从持久层重新加载一次（复用已有的 load 路径），仍失败则抛出加载错误且不写入；通知条在 `!ready` 时显示 Retry，重试加入进行中的加载而不是再开一次；保存成功后刷新失败只提示“已保存但无法重新加载”，commit 正常完成，下次写入会再次恢复。
- 未新增 hydration、缓存、锁或存储机制；图片生命周期、blob 回收、Web Locks、数据格式未改动。
- Node 24.21：`npm test` 530/530（含新增 6 个），typecheck、lint、build 通过。新增 6 个测试在旧 Provider 上全部失败。

## 尚未验证

- 真机 iPhone / 真实浏览器多窗口；测试使用 JSDOM、假 IndexedDB 和注入的加载失败。
- Node 22 下 Regex/WorldBook 的 2 个锁争用测试因缺少 `navigator.locks` 失败（与本改动无关，Node 24 通过）。

## 下一步

等待 CodeRabbit 与人工审查；不自动合并。
