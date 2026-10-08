# STATUS — 2026-10-08-claude-preset-delete-rollback

更新人：Claude
更新时间：2026-10-08T13:00:00+00:00
发现范围：2026-10-08 通过 GitHub API 查看开放 PR，仅 #36（Chat 首帧）开放，未触及 Preset 文件；基线 main `feefc49`（含 #39）；本地无未提交改动。

## 当前任务

待审查：工单 02 — Preset 删除回滚安全修复。

## 谁在改哪里

Claude；分支 `claude/brave-davinci-ws2ruk`；PR [#40](https://github.com/yecays-ai/veil/pull/40)（人工审查，不加 automerge）；涉及 `lib/preset-storage.ts`、`tests/preset-delete-rollback.test.ts`（新）、`tests/preset-persistence-safety.test.ts`（仅一条断言）。

## 已完成

- 根因：`rollbackIfCurrent` 把“快照冲突”和“无 Web Locks”都返回 false，锁占用与存储异常直接抛出，`deletePresetAndBindings` 没有捕获，原始 Binding 清理错误及其 cause 丢失；回滚做不了时 Preset 已删除，再次删除只会得到 “no longer exists”。
- 修复：`rollbackIfCurrent` 仅在快照冲突时返回 false，无 Web Locks 改为抛错；`deletePresetAndBindings` 分三类报告（已恢复→抛原始错误；快照冲突→“Newer data was kept”；无法回滚→“could not be restored (原因)… stays deleted; delete it again”），均以原始错误为 cause。删除改为幂等：Preset 已不存在时只补做 Binding 清理，不回滚、不改写库。
- 没有新增锁、事务或回滚机制，复用 #24 的 `exclusive` / `rollbackIfCurrent`。
- Node 24.21：`npm test` 538/538（新增 8 个），typecheck、lint、build 通过。新测试中 6 个在旧实现上失败；原始 P1 探针旧实现复现、新实现 cause 保留。

## 尚未验证

- 真机 iPhone / 真实浏览器多窗口；测试使用受控 LockManager 与内存存储。
- 回滚失败后 UI 仍显示该 Preset（未刷新列表），用户需再次点击删除完成清理；本工单未改 UI。

## 下一步

等待 CodeRabbit 与人工审查；不自动合并。
