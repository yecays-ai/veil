# STATUS — 2026-10-13-codex-memory-m5b2

更新人：Codex
更新时间：2026-10-13T01:09:03+08:00
发现范围：2026-10-13T00:56:00+08:00 通过 GitHub API 复查 main、全部开放 PR（含 draft）、PR #161 当前 head/评论及全部远端 branch heads（均单页未达 100 条）；唯一开放 PR 为 #161，head `5c995b32aaab7c686d08ff65a2705dda0f25370c`，待审未合并；main 完整 SHA 见下。此前“无开放 PR”未标明观察时点，已用本次实际查询更正。远端遗留 Chat/网络分支仍存在，不接管或覆盖它们。读取当前 main AUDIT_LEDGER、既有 M5a/M5b1、handoff 与直接依赖；本地未发布任务不可见，远端查询成功但本地目录无 Git 元数据，不能把它当作已同步的工作树；旧 `veil-audit-main` 分支未动。独立目录的 634 份初始基线逐 blob 校验，发布走 GitHub API。

## 当前任务

M5b 第二刀：最小生产接线施工完成，默认关闭，待独立 PR 审查；不启用、不部署、不合并。

## 谁在改哪里

Codex；分支 `codex/memory-m5b2-production-wiring`；[PR #161](https://github.com/yecays-ai/veil/pull/161)。唯一基线 `9fe2a5e324b40a1f6cf45b894a7d6b8f4c6db739`，即 #160 合并提交；初版施工提交 `64c107f703c22fe4e4032dbb23405308d9b0569e`，交接提交 `e44a57572d86668a97571a0feeeaf77886b102db`；收尾补上两个 ready 队首保留边界，不开新 PR。

涉及 root gate、ChatStorage 动态资格/epoch、M5a post-dispatch authority、维护 config/runner/scheduler/browser、两份定向测试、施工记录/交接/总账。不改 M4.1 算法、Memory Bank、Presence、存储版本、provider、M6–M8。

## 已完成

- 请求前原子派发，跨标签页 owner，五分钟门槛与 durable 恢复；旧批次在新聊天时继续，来源实际改变仍拒绝；第一刀解析及唯一自动提交。
- 非法/敏感预检，以及 safe claim 后来源全删，按既有失败协议保留空洞，不反复占 ready 队首、不跳水位、不产生模型调用。
- 未启用生产 tracking/维护，无真实付费模型调用；默认关闭挂载/重挂载实测零存储读取、零请求。仅 stub/fake 数据。
- 定向 645/645（零跳过）；类型检查、改动路径 lint、webpack build（24 页）通过。细节、命令、Red/Green、性能及保留状态见 [施工记录](../memory-m5b2-construction.md)。
- #161 本次仅修复三条审查意见：将瞬时读取/refresh 错误排除于输入拒绝 failed 处理；会话读取失败最多两次 5 秒重查，clear/stop 使旧回调失效，保留读取期间收到的唤醒；更正上述发现范围。新增 7 项回归先 Red 后 Green，两份受影响测试 45/45、完整相关回归 652/652（零跳过）、typecheck、改动路径 lint、webpack build 通过；仅 stub，不启用维护、不调用真实模型。
- 30 次 stub 暖演练：独占 hold p95 1.643 ms，runner p95 13.363 ms；注入 snapshot 争用约 19.5 ms。不是设备/真实网络保证。

## 尚未验证

- `dcc950d` 的 GitHub CI 已通过，同 SHA 的 Vercel 预览 READY；CodeRabbit 复审提出一条本轮 scheduler 修复的并发唤醒边界，已补 Red/Green。收尾修订后最新 head 须重新看平台结果，本地检查不替代它们。
- 真实模型提取质量、用量/费用、所有模型输入 Token 适配、iPhone 前后台/强制关闭/多标签页及大 History 性能。既有 M3/M4 用户真机观察不等于 M5 验收。
- uncertain/failed/too-large 及安全 claim 耗尽保留状态，不能自动跳过水位或重发；后续显式处理暂无 UI。

## 下一步

PR #161 已创建；核实最新 CI/预览后停止施工，等待 Lan 手动审查、合并及另行启用授权。
