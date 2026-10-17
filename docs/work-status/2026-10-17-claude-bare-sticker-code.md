# STATUS — 2026-10-17-claude-bare-sticker-code

更新人：Claude
更新时间：2026-10-17T08:00Z（UTC）
发现范围：2026-10-17 查看 yecays-ai/veil 远端，base 为 origin/main 4820816b7538caaacf40faf6d1fd50dc495af79c；另有打开的 PR #240（M7），本任务只改 lib/chat/sticker-storage.ts 的新函数与 lib/chat/engine.ts 中 finalize 前的几行，不与 M7 的改动区重叠（合并时若有冲突在后合并的一方解决）。

## 当前任务

状态：待审查。修复 Character 偶发把表情包 code（如 S08）单独写成正文一行、没有放进 `<veil-action>`，结果显示成文字气泡而没发出表情包的问题。

## 谁在改哪里

Claude；分支 fix/bare-sticker-code；PR：https://github.com/yecays-ai/veil/pull/241。涉及：lib/chat/sticker-storage.ts（`takeBareStickerCode`）、lib/chat/engine.ts（finalizeReply 之前）、tests/chat-stickers.test.ts。

## 做法

仅当本轮没有成功解析出的 action 表情包、且正文里有一整行（去首尾空白）恰好等于本轮提供过的 code、且该 code 经现有 resolve 成功时，取最后一行这样的内容当作选择：从正文移除这一行，走原有 sticker 保存链路。其它情况一律不动；不做全局正则，不增加模型请求。

## 已验证（自动化测试，不是真机）

tests/chat-stickers.test.ts 新增 4 条：独立 code 行发出表情包并移除该行、仅 code 的回复；未提供的 code、非独立行、没有表情包库时保持原文；action 里有合法 sticker 时只按 action 执行且正文里的裸 code 原样保留；保存时 resolve 失败则保持原文。

## 尚未验证

真机上真实模型的表现。流式输出期间，裸 code 行在最终落库前仍会短暂出现在气泡里，落库时才移除。

## 下一步

开 PR，CI 与 CodeRabbit 完成后合并。
