# STATUS — 2026-10-17-codex-multi-universe

更新人：Codex
更新时间：2026-10-17T17:05:00+08:00
发现范围：GitHub API latest main `8c6e9532d4368bdde617fa054147372e835ffaba`；open PR（含 draft）为空；remote branches 13 条，未发现本工单分支。读取 main 的 `AGENTS.md`、`docs/AUDIT_LEDGER.md`、README storage map、Chat Core 与 work-status 约定。未把历史记录当作当前并行施工授权。

## 当前任务

进行中：新增 P1，多 Universe 数据分区与全局 Chats。总账 ID：新增。只解决创建/命名、角色归属、隔离与全局列表筛选。验收话：Peter/Ghost 同时可聊，All 同时可见，筛选互相独立，生成上下文不串世界。做完划掉本工单；不做 Character API/Model binding、语音实机、正式旧数据迁移、Universe 删除/角色迁移或工作区切换。通过相关回归后停止扩展。

## 谁在改哪里

Codex；`feat/multi-universe`；base 为以上 main；PR 尚未创建。Foundation/Universe、Character 页面、Chats、WorldBooks、Chat prompt/engine/storage、Life day-plan、Memory maintenance、角色删除预览及 backup validation；新增数据与挂载测试。

## 已完成

- 审计：Memory/Journal/State/Background/维护游标由唯一 Character ID 拥有；消息、附件、Shared Media、WorldBook activation/summary 由 Session ID 拥有；Presence/Routine/Life/备注和 Sticker 角色绑定由 Character ID 拥有。无需重建这些存储。用户、Text/Voice/Image API、外观与通用设置保持全局。
- 保留原 `foundation.universe` 为首个分区，`universes` 只存额外分区，避免重复权威；所有消费者用显式 Character 归属。创建 Universe 使用 UUID 与创建/更新时间；Character 归属创建后固定。本工单没有角色跨世界搬迁能力。
- Chats 仍订阅全部会话，排序沿用原规则；Universe 与 All/Private/Groups 为独立维度，重开默认 All。筛选没有进入后台生成逻辑。
- WorldBook 新建/导入指定 Universe；运行时先按 Character Universe 过滤，再解析绑定，包含显式外世界 ID 的绑定也不能绕过。关系图、世界设定、Life day-plan、Memory maintenance 同样从目标角色解析世界。
- Session 持久化 universeId，禁止跨世界群聊，成员删除为空后仍保留归属；备份校验 Universe 引用与成员一致性。只有内部缺失字段夹具使用最小默认，不做迁移系统。
- Node v24.19.0；测试编译、typecheck、改动文件 lint 通过；新增 5 项存储/生成/备份隔离与 1 项挂载 Chats 筛选/隐藏世界消息更新/重开回归通过。全量回归正在运行，结果待更新。

## 尚未验证

- 全量回归最终结果、最终构建、发布 head 的 CI/外部审查/Preview。
- iPhone/Safari、真实模型/付费调用；没有操作生产数据。
- 普通沙箱构建编译和 TypeScript 通过，静态页面生成遇到本地 EPERM；后续用相同构建在允许的环境重试。

## 下一步

完成回归、修复本工单引入的问题，发布 PR 并核对同 head 的 CI/审查结果；真实设备证据单列。
