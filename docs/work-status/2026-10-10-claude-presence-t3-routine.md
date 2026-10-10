# STATUS — 2026-10-10-claude-presence-t3-routine

更新人：Claude
更新时间：2026-10-11T07:00:00+08:00
发现范围：2026-10-11 通过 GitHub API 查看开放 PR（无开放 PR，含草稿）；`origin/main` = `5d3959987c5165946ebe93ee16e579cc996388d7`（含 T1 #109、T2 #110）；已读 `docs/AUDIT_LEDGER.md`（在线系统“未启动、保持登记”，不动首帧布局；本工单不碰界面）。

## 当前任务

Character Presence 第一批 T3：作息生成。待审查。

## 谁在改哪里

Claude；分支 `claude/project-thread-459m41`（T2 合并后从最新 main 重建）；PR [#111](https://github.com/yecays-ai/veil/pull/111)；base `5d39599`。
新增：`lib/presence/routine.ts`、`tests/presence-routine.test.ts`、本记录。
修改：`components/profile-pages.tsx`（保存角色成功后触发一次检查）、`lib/chat/request-diagnostics.ts`（请求来源加 `presence-routine`）。
不碰 Foundation 数据结构、聊天、`lib/presence/storage.ts`、`compute.ts`，不碰任何界面元素。

## 已完成

- 作息由模型生成（只返回一个 JSON：默认状态、抖动分钟、最多 12 段每周时间块，角色当地时间），整份校验通过才保存，任何一处不合法就不写入。
- 触发：只在“保存角色成功后”检查一次。依据是 occupation / backstory / personality 的指纹（`routineBasis`），记录在作息的来源标记里（`generated:<指纹>`）。指纹和已存的一致就不发请求，所以改名字、头像、签名、说话风格等不会重新生成；新建角色与上述三项真正变化时才生成。没有定时器、没有后台重试。
- 请求：沿用 Here & There 的 API / 绑定 / 预设解析（API 被禁用或没配置则跳过），一次非聊天请求，max tokens 上限 700，整体超时 90 秒，可取消；同一角色同时只有一个请求，生成期间又保存则在结束后补查（可连续补查，每次补查都对应一次新的保存）。
- 安全：模型回复不合法、请求失败、超长、期间角色被改动或删除（指纹变了）都放弃，不覆盖已有作息；失败不会自动重试，下次保存才再检查。
- 本地检查（2026-10-11 +08:00，Node 24.21.0）：`npm test` 849/849 通过（含新增 11 项；第一次完整运行时既有的 CF-02 偶发失败出现一次，重跑通过，台账已登记该偶发）；`npm run typecheck` 通过；`npm run lint` 0 error / 3 条既有 warning；`npm run build` 通过；`git diff --check` 无输出。证据级别：自动化测试（内存存储、假模型），非真机。

## 尚未验证

- 未用真实模型验证回复质量与格式遵守度（只测了解析与各种坏回复）；提示词是第一版，需要真机或真实 API 看看生成出的作息是否自然。
- 未验证真机上保存角色时界面无变化（本工单没有界面改动，请求在保存成功后后台进行）。
- 已有角色没有作息：它们第一次被保存时会生成一次（指纹和空记录不同），之后同上规则；没有批量补生成。
- 已知窄窗口：模型回复后做最后检查与写入 Presence 之间极短的时间内，角色若被编辑或删除，可能写入一份旧指纹的作息（编辑的情况会被补查纠正；删除的情况由既有的遗留数据清理处理）。有界，未再加锁或跨存储事务。
- 提示词与上限（12 段、700 tokens、90 秒）是暂定值。

## 下一步

等 Lan 审查合并 T3；确认后再开始 T4（界面接入）。
