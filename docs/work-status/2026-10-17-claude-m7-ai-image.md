# STATUS — 2026-10-17-claude-m7-ai-image

更新人：Claude
更新时间：2026-10-17T07:50Z（UTC）
发现范围：2026-10-17 查看 yecays-ai/veil 远端，base 为 origin/main 4820816b7538caaacf40faf6d1fd50dc495af79c（含 M1–M6）；没有其它打开的 PR，无重叠路径。

## 当前任务

状态：待审查。M7：AI 生图。Character 用动作行里的 `image` 字段决定发一张照片；有两种：A 带 Character 本人（自拍、穿搭，用 Character 的外貌文字，并在头像存在设备上时当作参考图），B 日常场景（吃的、桌面、窗外，不带 Character 的脸、不用参考图）。默认是 B，不会把所有图都默认成 Character 的脸。

## 谁在改哪里

Claude；分支 feat/m7-ai-image；PR：https://github.com/yecays-ai/veil/pull/240。涉及：lib/imagegen/{config,generate,job}.ts（新）、lib/device-config-storage.ts（新，TTS 与 Image 设置共用的单行设备存储；lib/tts/config-storage.ts 改为它的子类，行为与错误文案不变）、lib/chat/{types,attachment,storage,engine,self-context,message-kind}.ts、lib/presence/actions.ts、lib/backup/validation.ts、components/chat/messages/{image-request(新),message-list}.tsx、components/settings/image-gen-settings.tsx（新）、app/settings/{images/page.tsx(新),page.tsx}、app/messages/chat.css、tests/{imagegen,image-request-ui}.test.ts（新）及两处源码断言更新。

## 做法

- 设置：Settings → Images。Base URL、API Key、Model、可选 Size；存在设备上单独的 IndexedDB（`veil-imagegen-config-v1`），不进备份。没有设置时，Character 完全不会被告知可以发图。
- 动作：`image: {prompt, character}`（≤400 字，`character` 缺省为 false）。不在 Continue 上提供，也不连续两条都提供。
- 占位消息：回复先正常保存，其中有一条 assistant 消息带 `imageGen:{prompt,character}`，`content` 是 `[你发送了一张照片:prompt]`（模型记得这张图拍了什么）。图在回复提交之后才开始生成，不属于这次回复的 attempt：停止或失败都不影响已保存的回复。
- 生成：一次 `POST /images/generations`（带参考图时 `/images/edits` 的 multipart），不重试、不缓存，180 秒超时；结果从 `b64_json` 取，或对 https `url` 无凭据地取一次；用文件头识别格式（只收 png/jpeg/webp），再按普通图片规则压缩，随后一次事务把图片写进 `assets` 并把占位换成 `attachment`（消息已被删除或撤回则什么都不写）。
- 失败/降级：占位保留 Character 想拍的内容文字，显示失败原因，可「Try again」或「Change words」改写 prompt 后重来；刷新页面后没有运行中的任务也显示同样的可重试状态，不留永久“进行中”。
- 备份：`imageGen` 只保存请求（提示词和布尔值），校验 assistant、版本≥2、无其它特殊字段；恢复后可再次重试。

## 已验证（自动化测试：Node + fake IndexedDB + jsdom；不是真机）

- tests/imagegen.test.ts（17）、tests/image-request-ui.test.ts（4）：请求体、edits 的 multipart、url 回退、错误分类且不含正文/Key、超时与停止、动作解析、两种模式的提示词与参考图、占位→图片原子替换、改写后重试、引擎端到端（不提供/不连续/失败后重试）、备份校验。
- typecheck 通过；lint 0 错误；npm test 全量仅 Regex、WorldBook 回滚锁 2 条失败（main 上同样失败）。另有偶发的 CF-02 测试（chat-regenerate-lock-ui）在满载时极少失败，单独运行与重跑均通过，与本改动无关。

## 尚未验证

- 真实生图服务（没有发起任何付费请求）：返回格式（`b64_json`/`url`）、CORS、`/images/edits` 对参考图的支持、真机上占位到图片的显示。模型是否会按两种模式正确选择 `character`。

## 下一步

等 CodeRabbit 与 CI 通过后合并，然后同步测试链接，整理验收清单。
