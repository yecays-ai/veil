# STATUS — 2026-10-12-codex-memory-m5a

更新人：Codex
更新时间：2026-10-12T21:18:00+08:00
发现范围：通过 GitHub integration 核实 main、开放 PR（含 draft）与远端分支；main 为 fa464aa380d548d1c5997989d62df12af8b9af80，开放 PR 为空。独立本地快照的 609 个版本文件逐一核对 Git blob SHA；未覆盖其他工作目录。无法观察未发布的本地任务。

## 当前任务

实现完成，待 PR 人工审查和验收：M5a 四项地基。M5b 冻结；不接入模型、自动提取、生产跟踪或维护 UI。

## 谁在改哪里

Codex；分支 codex/memory-m5a-foundation；[PR #159](https://github.com/yecays-ai/veil/pull/159)，待用户手动审查、合并与验收。基线 main fa464aa380d548d1c5997989d62df12af8b9af80。
范围：Memory 存储/批次协议/序号/lineage/启动清理，Chat/Core 冷读取与 scope，Backup 校验/恢复授权，两个聊天清理调用的 scope 传递，现有 Backup 阻止替换提示，以及直接相关测试。

## 已完成

- 基线四项缺口行为复现：4/4 Red。
- 被动批次协议、受限自动提交、原子进度、稳定序号、来源核验、独占 scope 与 lineage 清理已实现。
- 最终影响范围回归 558/558；此前一次全量 1,396/1,396（最终只读来源与序号边界收敛后仅重跑影响范围）。测试编译、typecheck、定向 lint 和最终 webpack build 通过。lint 两条原有 Hook warning。
- 独立测量：250 次独占，p50/p95/max 1.249/2.362/5.828 ms；10 ms 注入暂停使共享 writer 等待 22.881 ms，释放后才继续。Node 24.19.0 + fake IndexedDB；不是设备指标。
- 生产跟踪关闭；被动协议无生产实例、provider 或自动调度，新增生产模型调用为 0。检索与请求算法文件基线 blob 未变。
- 完整修改清单、状态协议、测试命令、锁证据和限制见 [M5a 施工记录](../memory-m5a-construction.md)。

## 尚未验证

- PR #159 已发布；核对 33 个提交文件 blob 全部一致，main 仍为基线。发布时 GitHub verify 运行中、CodeRabbit pending，尚无远端通过结论；未主动部署。首次缓存目录创建受执行器拒绝，经批准的本地构建已通过。
- 真浏览器跨标签页、iOS、真实 IndexedDB 大聊天容量与崩溃恢复验收。

## 下一步

独立 PR #159 已提交，之后等待用户手动审查、合并和验收，不自动合并/部署，不启动 M5b。
