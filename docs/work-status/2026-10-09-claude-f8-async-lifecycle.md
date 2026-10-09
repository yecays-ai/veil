# STATUS — 2026-10-09-claude-f8-async-lifecycle

更新人：Claude
更新时间：2026-10-09T23:00:00+08:00
发现范围：2026-10-09 读取远端 main `30437ae`（含 #73）、开放 PR #75（F7）与 #76（Part 5 F4 键盘）；#37/#38 已不在开放列表。本任务只改 `lib/chat/background-cache.ts`、一个测试文件和账本 F8 行；#75 改 `components/chat/chat-room.tsx` 与账本 F7 行，源码无重叠，账本相邻行可能需要合并时手动处理。#36 已关闭；未触碰 F7。

## 当前任务

F8 六处逐项核对，只修仍存在的问题。

## 谁在改哪里

Claude；分支 `claude/f8-async-lifecycle`；PR 见 pull request（base main）。

## 已完成

- ①Foundation Provider、②Messages 列表、③Preset/Regex/WorldBook Hook：已有保护，只记录证据，不改。
- ④头像/Hero：不参与首帧门控，没有把 `src` 存在当作像素完成；不加阻塞式 decode。
- ⑤Chat 缓存：条目数上限，没有字节预算也没有真机内存数据，按“先测量再优化”不改；在代码注释写明预算依据。
- ⑥decode 失败：不再标记为已解码，`ready` reject；等待者立即回退到 Theme 背景。新增 2 项测试，在旧行为上失败。

## 尚未验证

- iPhone 真机：无法肉眼确认的行为以定向测试为准。
- ⑤的真机内存数据没有，该项阻塞，F8 保持“已修待验”。
- GitHub Actions 与 Vercel 因账单/额度不能作为结论。

## 下一步

等待审核与手动合并；⑤ 等真机内存数据。
