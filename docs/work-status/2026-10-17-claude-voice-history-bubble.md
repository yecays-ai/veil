# STATUS — 2026-10-17-claude-voice-history-bubble

更新人：Claude
更新时间：2026-10-17T18:35:00Z
发现范围：2026-10-17T18:30:00Z 基于 origin/main 5158713（#248 已合并）；GitHub 上开放 PR #249 只动 TTS 的 speech.ts、config.ts、设置页提示、TTS 测试和删除 relay，与本任务路径不重叠；本任务动 lib/chat/attachment.ts、app/messages/chat.css 和三个测试。

## 当前任务

语音消息体验小修复：Character 语音在后续对话里对模型显示为语音消息；语音气泡单行高度（待审查）。

## 谁在改哪里

Claude；分支 `fix/character-voice-history-and-bubble`；PR 链接见 PR 描述。

## 已完成

- Character 的语音消息（`role=assistant` 且 `voice=true`）发给模型和记忆/摘要输入时写成 `[你发送了一条语音消息：<transcript>]`；数据库里的 `content`、气泡文字和列表预览不变，用户语音的原有语义不变。
- 语音气泡高度：播放按钮去掉通用 `.chat-app button` 的 40px 最小高度，行高固定为一行文字高；宽度不限。
- 测试：模型侧文案（Character / 用户 / 普通文字）、后续历史里出现语音标记而数据库与预览保持原文、CSS 的单行高度规则。
- 检查命令与结果见 PR 描述。

## 尚未验证

- iPhone Safari 真机上气泡实际高度与不同语音长度下的宽度；真实模型对该标记的反应。

## 下一步

lan 在 PR 预览地址验收；通过后合并。
