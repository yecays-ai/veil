# STATUS — 2026-10-08-codex-c9-binding-manager

更新人：GPT/Codex
更新时间：2026-10-08T18:06:00+08:00
发现范围：GitHub API 最新 main、全部开放 PR（含草稿）、各 PR 文件和 head 任务记录、全部远端分支及 main 工作记录；本地独立 clone。发布前刷新确认 #40 已合并，仅开放 #36。未发布本地任务不可见。

## 当前任务

实现与本地验证完成，PR #42 待 CodeRabbit：工单 03 C9 — Binding Manager 陈旧资源列表并发误删。禁止 automerge/直接合并。

## 谁在改哪里

Codex；分支 `fix/c9-binding-manager-safe-cleanup`；[PR #42](https://github.com/yecays-ai/veil/pull/42)；开工 base `feefc49d49f418fa0e0eecfac630d27733017875`，已同步并验证最新 main `130d0c1b0733c9c4866377b29cbc7547c4a22561`（含 #40）。
涉及 `components/settings/bindings/use-binding-manager.ts`、`lib/binding-storage.ts`、`lib/bindings.ts`、`lib/binding-resource-validation.ts`、`lib/api-config-storage.ts`（仅新增同步回调的只读事务接口）、`tests/binding-resource-concurrency.test.ts` 和本记录。
该 Text API 接口是避免目录校验后 API 并发写入所必需的直接依赖；不修改 API 删除/回滚。#40 的 Preset storage/回滚测试与 #36 的 Chat 首帧文件均无本单 diff 重叠。无新增锁名称、存储、同步、依赖或数据迁移，不修改 Preset、Character、Theme、Chat。

## 已完成

- 阅读 AGENTS、开发技能、main 任务记录及 #40/#36 head 记录；确认 #35 已合并。
- 原因：加载时的 available 被传给稍后锁内最新 Binding 文档，目录与 Binding 版本不一致。
- 独立分支建立，首个提交发布本记录。
- 清理复用 #35 的队列、Binding Web Lock、提交前比较/重算；在 Binding 锁内获取 Preset/WorldBook/Regex 已有锁，读非写入适配器路径，最后在 API readonly 事务内同步校验/写入。资源锁保持到回调完成；锁竞争/无锁/读失败均拒绝清理。页面离开后校验写入所有权。UI available 仅是是否尝试清理的提示，不再是删除权威。
- 用户修改仍按原 transact/list intent；实际删除后仍清除失效引用，API 仍 fail-closed，None/继承与列表顺序不变。
- 新增 12 个行为测试：实际挂载旧目录 + 外来新增四类资源及 Binding、Binding 锁等待、不同 Binding 交错提交、所有作用域失效清理、主动解绑、资源锁/异步间隔、真实 IDB 有效事务与另一连接写入、无锁、目录损坏/读失败/写失败与重试。没有新增 source-string 断言。
- Node 等价包脚本：测试编译、完整测试 550/550（最新 main 538 + 本单 12）、重点 Binding 测试 31/31、typecheck、lint、production build、diff 检查通过。npm 不可用，使用仓库 skill 指定的 Node 入口。
- 三项负对照均普通行为断言失败、无取消/跳过：实际旧 main hook 丢失新增资源 Binding；仅重读但不持资源锁允许目录在异步间隔变化；API list 读取已完成后回调无法证明事务仍有效。只改外部编译产物，运行后恢复。

## 尚未验证

- 原生浏览器多窗口与 iPhone 未测试。
- 保护针对遵守现有 Web Lock 契约的窗口；沿用 #35 的 localStorage CAS 限制，不宣称对不遵守锁的旧客户端提供原子提交。不是跨存储原子删除/回滚事务。
- 远端 CI 与 CodeRabbit 待 PR 发布后检查。

## 下一步

发布独立 PR，不加 automerge、不直接合并；等待并处理 CodeRabbit，再更新交接。
