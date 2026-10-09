# STATUS — 2026-10-09-codex-theme-config-publication

更新人：Codex
更新时间：2026-10-09T23:57:00+08:00
发现范围：2026-10-09 23:40–23:57 +08:00，检查远端 main `33a6cf7`、开放 PR #78 的 head、diff 与工作记录，以及远端分支列表。#78 仅修 scrollTo 测试类型，无本单文件重叠；已合并的 #75/#77 是《前端》F7/F8，与本单原始 Part 5 / F7 来源不同。读取 main 的 AGENTS/work-status 规范及相关主题代码、测试；本地隔离快照验证，无浏览器或 iPhone 真机访问。未对未发布的本地工作作全局所有权推断。

## 当前任务

进行中：仅处理原始 Part 5 / F7 的主题配置发布等待图片问题；不修改总账中其他同名 F7。

## 谁在改哪里

Codex；分支 `fix/theme-config-publication`；PR 尚未创建；base main `33a6cf797431f603a70278549c788f3ff27b169b`。仅 `components/theme-provider.tsx`、`lib/theme-image-urls.ts`、`tests/theme-provider-recovery.test.ts` 及本工作记录。

## 已完成

- 当前 main 的真实挂载测试证实配置在 Blob pending 时未发布。将验收改为配置先发布后，旧实现失败：ready false != true；修复后通过。
- 配置读取成功立即发布 document/ready；图片同步独立、仍保留 1000ms 超时，旧 revision 和卸载不发布结果；图片失败不使已读配置回退。
- 复用现有 ThemeImageUrls；失效时立即回收未发布批次已创建的 URL，避免另一个 Blob 永久 pending 时延迟回收；已发布 URL 仍按原规则复用、替换及释放。
- 挂载覆盖颜色/字体先发布、图片补齐、读取拒绝、超时、旧请求晚完成、跨标签页切换、重复读取复用、当前主题图片范围、Strict Mode/卸载；原保存和重试测试通过。全套及最终检查仍在执行。

## 尚未验证

- main 的 `tests/chat-first-paint.test.ts:123` 有既有 scrollTo 重载类型错误，应用和测试 TypeScript 检查均受阻；PR #78 正处理，本单不修改该文件。
- 全套首跑 756 项：754 通过、2 失败。navigation-feedback 的 RouteLoading 断言是已知 main 不匹配；聊天 Retry 测试单独重跑 11/11 通过，正在复跑全套。
- CodeRabbit 尚未请求；CI/Vercel 未作为本轮证据；iPhone Safari 真机未验。

## 下一步

完成本地检查并发布独立 PR，请求 CodeRabbit，处理有效意见；保持 open、人工合并。
