# STATUS — 2026-10-08-codex-c9-binding-manager

更新人：GPT/Codex
更新时间：2026-10-08T17:48:00+08:00
发现范围：GitHub API 最新 main、全部开放 PR（含草稿）、各 PR 文件和 head 任务记录、全部远端分支；本地独立 clone。未发布本地任务不可见。

## 当前任务

进行中：工单 03 C9 — Binding Manager 陈旧资源列表并发误删。

## 谁在改哪里

Codex；分支 `fix/c9-binding-manager-safe-cleanup`；PR 尚未创建；base `feefc49d49f418fa0e0eecfac630d27733017875`。
范围：Binding Manager、Binding Storage、必要的资源校验边界及行为测试。Text API 需要一个同步回调的只读事务接口，防止校验与 Binding 写入之间的目录变化；不修改 API 删除/回滚。
开放 #40 的 Claude 施工范围为 Preset storage/删除回滚测试；#36 为 Chat 首帧文件。均避开。无新增锁名称、存储、同步或数据迁移，不修改 Preset、Character、Theme、Chat。

## 已完成

- 阅读 AGENTS、开发技能、main 任务记录及 #40/#36 head 记录；确认 #35 已合并。
- 原因：加载时的 available 被传给稍后锁内最新 Binding 文档，目录与 Binding 版本不一致。
- 独立分支建立，首个提交发布本记录。

## 尚未验证

- 实现、负对照、完整 tests/typecheck/lint/build 尚未执行。
- 原生浏览器多窗口与 iPhone 未测试。

## 下一步

复用既有 Binding/资源锁和 IDB 事务，完成实现与回归，创建无 automerge 的独立 PR，等待 CodeRabbit。
