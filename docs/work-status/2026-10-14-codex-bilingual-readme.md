# STATUS — 2026-10-14-codex-bilingual-readme

更新人：Codex
更新时间：2026-10-14T19:06:00+08:00
发现范围：2026-10-14 检查 fork `Xiaoqiush81/veil`、上游 `yecays-ai/veil`、上游开放 PR 与 `8790e408` 以来主线提交。

## 当前任务

已完成，待审查：基于当前主线功能与架构，重写默认英文 README，并新增完整的简体中文版；已创建上游 PR #190。

## 谁在改哪里

Codex；branch `codex/bilingual-readme`；基线 `8045a304ab0b399700222a260bce242990fa74df`；上游 PR [#190](https://github.com/yecays-ai/veil/pull/190)；涉及 `README.md`、`README.zh-CN.md` 与本记录。

开放 PR #188 修改聊天生成生命周期与测试，不涉及 README 路径；本任务不接管其范围。

## 已完成

- 对照当前 App Registry、根布局、Settings、Chat、Presence、Memory、Backup、存储常量、测试脚本及主要领域文档重新整理事实。
- 保留 “A phone across worlds.”，默认英文首页添加简体中文入口。
- 两种语言采用相同信息架构：产品能力、功能地图、架构、请求上下文、数据与隐私、完整备份、网络边界、仓库结构、开发验证、iPhone 与部署。
- 移除旧 README 已失实的“没有全站备份”表述，并明确当前 Moments、Service Worker、凭据与真机验证边界。
- 根据 owner 反馈重写展示顺序与语气：先用 Emoji 功能速览和面向用户的短章节介绍聊天、Memory、Universe、外观、隐私与 iPhone，再以分隔线进入开发者内容；减少说明书式措辞。
- 根据 CodeRabbit 对 PR #190 的隐私说明审查，明确聊天请求会把对话上下文与 API Key 直接发送给用户配置的服务商；已对照 `lib/chat/provider.ts` 的请求头与请求体核实。

## 尚未验证

- 文档链接、Markdown 格式、标题结构、`git diff --check` 与两种语言的事实一致性已检查。
- 本任务只改文档；运行时与真机行为不适用，未据此宣称新的功能验证。

## 下一步

PR #190 已推送至上游 `yecays-ai/veil`；CodeRabbit 的一条可执行评论已整改，等待复审与 owner 手动合并；不自动合并。
