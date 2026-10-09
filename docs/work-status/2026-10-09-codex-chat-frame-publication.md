# STATUS — 2026-10-09-codex-chat-frame-publication

更新时间：2026-10-09T08:05:00Z

## 谁在改哪里

Codex；branch codex/chat-frame-publication-20261009；PR #63 https://github.com/yecays-ai/veil/pull/63，base main@67c9ef246afcd03e491eba0271d190f0723c6dde。独立 PR，不自动合并。生产范围仅 components/chat/chat-room.tsx 与 components/chat/use-chat-background.ts；没有修改 PR #36 涉及的 Messages/session prefetch/session lifecycle/storage 文件。工作区为只读项目镜像，通过 GitHub API 更新分支。

## 已完成

- 核对原始审计编号：F5「Chat 和 Messages 仍是每挂载读取；外壳与内容天然分批出现」。F3 是独立背景选择问题，只登记待调查，不扩大本次范围。
- 证据确认：Foundation identity ready 后 ChatRoom 先发布人物 Header/default Theme 背景；route session lifecycle 随后发布 session/messages；背景 hook 再读取全局设置及当前图像并等 decode。它们没有共享发布边界。
- F5 当前生命周期改为：并行读取设置与 route session；保持稳定页面/操作锚点；当前 session、人物标识、初始消息、会话 CSS、当前 wallpaper 仅在首帧 boundary 同步发布。网络头像、消息图、历史非首帧资源不阻塞。当前 wallpaper 读取/decode 最多等 1200ms；settings read 最多等 1200ms，失败/超时以现有 Theme 背景放行，迟到的成功结果仍更新背景。保留原有有界图片 URL cache 与清理。
- A/B route 测试覆盖旧会话消息不可见；延迟 decode、壁纸读取卡住、全局缓存设置、Header/history/composer 锚点及背景作用域有测试覆盖。
- 基线红灯证据：初始测试提交 e805115 的 Actions run 37899042060，Typecheck/Lint 通过，两个新增断言按预期失败：壁纸未准备时首帧不应发布消息、首帧 readiness 不应提前为 true。
- CodeRabbit 对 f4755f7 提出 typing indicator、settings read 有界回退、superseding refresh ready 三条 actionable 及状态文档结构一条 nitpick；前三条已按意见修复，状态文档已按仓库章节整理，等待最新提交复审。
- AUDIT_LEDGER.md 已用原 ID 登记 F5「已修待验」与独立 F3「待调查」。

## 尚未验证

- 最新提交 f8a4256 后 CI 全套、Build 与 diff check 尚待完成。
- 最新提交 CodeRabbit 复审与 unresolved threads 尚待确认。
- Preview 需确认指向最新提交。
- iPhone Safari/Standalone 真机对比未执行；自动化与 React commit 不作为视觉验收。F5 保持“已修待验”。

## 下一步

等待最新提交 CI 完成并修复任何失败；检查 CodeRabbit 最新审查与未解决 actionable threads；确认 Preview 和合并条件。用户按同一设备/同启动方式对比 main 与 Preview 时，分别记录点击到首个可见画面的时间，以及背景、人物、消息是否在首屏分阶段出现；不调查点击延迟，不自动合并。
