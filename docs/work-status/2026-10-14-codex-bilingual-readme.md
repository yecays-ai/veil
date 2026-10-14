# STATUS — 2026-10-14-codex-bilingual-readme

更新人：Codex  
更新时间：2026-10-14T18:21:10+08:00  
发现范围：2026-10-14 检查 fork `Xiaoqiush81/veil`、上游 `yecays-ai/veil`、上游开放 PR 与 `8790e408` 以来主线提交。

## 当前任务

已完成，待 owner 审阅：基于当前主线功能与架构，重写默认英文 README，并新增完整的简体中文版。

## 谁在改哪里

Codex；branch `codex/bilingual-readme`；基线 `8045a304ab0b399700222a260bce242990fa74df`；涉及 `README.md`、`README.zh-CN.md` 与本记录。

开放 PR #188 修改聊天生成生命周期与测试，不涉及 README 路径；本任务不接管其范围。

## 已完成

- 对照当前 App Registry、根布局、Settings、Chat、Presence、Memory、Backup、存储常量、测试脚本及主要领域文档重新整理事实。
- 保留 “A phone across worlds.”，默认英文首页添加简体中文入口。
- 两种语言采用相同信息架构：产品能力、功能地图、架构、请求上下文、数据与隐私、完整备份、网络边界、仓库结构、开发验证、iPhone 与部署。
- 移除旧 README 已失实的“没有全站备份”表述，并明确当前 Moments、Service Worker、凭据与真机验证边界。

## 尚未验证

- 文档链接、Markdown 格式、标题结构、`git diff --check` 与两种语言的事实一致性已检查。
- 本任务只改文档；运行时与真机行为不适用，未据此宣称新的功能验证。

## 下一步

提交并推送到 fork 的文档分支供 owner 审阅；不向上游创建 PR，除非 owner 后续确认。
