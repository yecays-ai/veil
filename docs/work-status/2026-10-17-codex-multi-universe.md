# STATUS — 2026-10-17-codex-multi-universe

更新人：Codex
更新时间：2026-10-17T19:19:00+08:00
发现范围：GitHub API latest main `8c6e9532d4368bdde617fa054147372e835ffaba`；open PR（含 draft）为空；remote branches 13 条，未发现本工单分支。读取 main 的 `AGENTS.md`、`docs/AUDIT_LEDGER.md`、README storage map、Chat Core 与 work-status 约定。未把历史记录当作当前并行施工授权。

## 当前任务

原 6 条 CodeRabbit 审查与复审追加的 3 条 diff 外意见已核实并修复，待最终 head 复审：新增 P1，多 Universe 数据分区与全局 Chats。总账 ID：新增。只解决创建/命名、角色归属、隔离与全局列表筛选。验收话：Peter/Ghost 同时可聊，All 同时可见，筛选互相独立，生成上下文不串世界。做完划掉本工单；不做 Character API/Model binding、语音实机、正式旧数据迁移、Universe 删除/角色迁移或工作区切换。通过相关回归后停止扩展。

## 谁在改哪里

Codex；`feat/multi-universe`；base 为以上 main；[PR #242](https://github.com/yecays-ai/veil/pull/242)。Foundation/Universe、Character 页面、Chats、WorldBooks、Chat prompt/engine/storage、Life day-plan、Memory maintenance、角色删除预览及 backup validation；新增数据与挂载测试。

## 已完成

- 审计：Memory/Journal/State/Background/维护游标由唯一 Character ID 拥有；消息、附件、Shared Media、WorldBook activation/summary 由 Session ID 拥有；Presence/Routine/Life/备注和 Sticker 角色绑定由 Character ID 拥有。无需重建这些存储。用户、Text/Voice/Image API、外观与通用设置保持全局。
- 保留原 `foundation.universe` 为首个分区，`universes` 只存额外分区，避免重复权威；所有消费者用显式 Character 归属。创建 Universe 使用 UUID 与创建/更新时间；Character 归属创建后固定。本工单没有角色跨世界搬迁能力。
- Chats 仍订阅全部会话，排序沿用原规则；Universe 与 All/Private/Groups 为独立维度，重开默认 All。筛选没有进入后台生成逻辑。
- WorldBook 新建/导入指定 Universe；运行时先按 Character Universe 过滤，再解析绑定，包含显式外世界 ID 的绑定也不能绕过。关系图、世界设定、Life day-plan、Memory maintenance 同样从目标角色解析世界。
- Session 持久化 universeId，禁止跨世界群聊，成员删除为空后仍保留归属；备份校验 Universe 引用与成员一致性。只有内部缺失字段夹具使用最小默认，不做迁移系统。
- Node v24.19.0；测试编译、typecheck、改动文件 lint 通过；255 个测试文件 / 2,192 项测试全部通过，零跳过；其中新增 5 项存储/生成/备份隔离、1 项挂载 Chats 筛选/隐藏世界消息更新/重开、1 项挂载 Universe 创建/重命名/Character 选择归属。WorldBook 与 Chats guard 的编译产物负对照均失败，恢复后通过；不修改生产源码作负对照。

- 完整 webpack production build 通过（28 页静态生成），typecheck、改动文件 ESLint 通过。普通沙箱曾遇到 EPERM，允许的构建环境完成了相同命令。
- Windows 默认测试入口的 node_modules 路径发现与工作目录限制：临时运行器逐文件执行 `node --test --test-force-exit`，只在测试子进程恢复 repo cwd；4 并发，所有测试均完成。临时脚本/结果保留于忽略的 node_modules/.cache，未提交运行器改动。
- 首个发布 head `b8ae02483b13ec499eda2d08013cdb9e59420714` 的 Vercel status success；CI #1449 进行中，CodeRabbit pending、review threads 为空（17:04 +08:00）。这不是最终 head 的成功证明。

## PR #242 本轮审查修复

基线 main 仍为 8c6e9532d4368bdde617fa054147372e835ffaba；施工与远端 head 均为 eb6d1fb0e3165eaba4fa1cb5aca09e2871204385，开始时工作区干净。原 6 个 threads 全部有效，均未自行关闭。用户明确暂不合并。

- Major / discussion_r4302202070：Universe 与 relation 草稿按实际 dirty 状态询问丢弃；拒绝时不切换、不创建、不丢草稿；保存期间禁止切换/新建；创建失败保留两个草稿。复用现有 confirmDiscard 与 PageShell guard，不增加迁移或管理能力。
- Major / discussion_r4302202078：缺失 ownership 的 legacy Character 使用实际 stored primary ID；测试覆盖 Foundation load → 用户资料事务 → 再 load，不遗漏角色。
- Minor / discussion_r4302202063：Character 创建表单初始 Universe 使用已加载的 primary；挂载真实 CharacterPage 提交验证。
- Minor / discussion_r4302202067：WorldBook selection 从当前 Foundation 验证，失效时同步回退；列表、新建、导入、排序使用同一个验证后 ID；测试覆盖延迟 load 与后续刷新。
- Minor / discussion_r4302202075：无 Foundation 的 partial backup 允许 WorldBooks；有 Foundation 时仍严格检查 Universe membership。
- Minor / discussion_r4302202077：additional IDs 先按 ownership 同样的 trim/长度规则 normalize，再去重/匹配；测试覆盖空白、重复、primary 重复、超长截断碰撞与幂等。
- 原 6 threads 已由 coderabbitai[bot] 在 db8c3b1 自动 resolved；该 head 复审于 2026-10-17T19:16:25+08:00 另提出 3 条 diff 外意见，均有效。最小修复：缺失 WorldBook Universe 的备份校验/回复读取和缺失 Universe 的空群聊统一回退到实际 stored primary，明确 ownership 不变。新增 3 项测试先 Red 后 Green，覆盖备份、模型 prompt 隔离、群聊筛选解析和备份。不是正式迁移系统。
- 新增合计 20 项行为回归（前一修复 17 项、本次 3 项）；前一修复新增 17 项行为回归（3 个存储/备份 + 14 个挂载 UI）；其中前 13 项在原 head 上先 Red，再 Green，另补 clean/revert/failure 分支。
- Node v24.19.0：29 个相关测试文件 / 286 项测试全部通过，零跳过；测试编译、typecheck、改动文件 ESLint 通过；webpack production build 完成 28 页。此前全量 2,192 项属于上一施工 head，不冒充本轮完整重跑。

## 尚未验证

- 新发布 head 的 CI、CodeRabbit 最终审查与线程解决状态，须按新 head 另核。
- iPhone/Safari、真实模型；没有付费调用或生产数据操作。

## 下一步

更新 PR，逐线程提供修复与测试证据，等待最终 head 的 CodeRabbit 最终结果，核对原 6 thread 继续 resolved 且新增 diff 外意见得到确认。按用户要求不合并。
