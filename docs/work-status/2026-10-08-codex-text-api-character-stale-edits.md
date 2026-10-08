# STATUS — text-api-character-stale-edits

更新人：GPT/Codex
更新时间：2026-10-08T13:35:00+08:00
发现范围：2026-10-08 实时检查 yecays-ai/veil 的 main、远程开放 PR（含草稿）、变更文件、分支以及 main/开放 PR head 上的 work-status；未发布的本地工作不可见。

## 当前任务

实现已完成，验证通过，待发布独立 PR：仅修复 Text API / Character 陈旧编辑、异步状态发布和失败恢复。用户明确要求禁止 automerge，不等待审核、不直接合并。

## 谁在改哪里

- Codex；分支 `fix/text-api-character-stale-edits`；PR 尚未创建；开工 base `d12b0e0306bfe70e24deda208d6adc337fdd42f7`，发布前已无冲突 rebase 到最新 main `b74bdd5b936c5b3cb6a82721e711cdaa8225eedc`。
- 生产路径：`lib/api-config-storage.ts`、`lib/settings/text-api.ts`、`lib/foundation.ts`、`components/foundation-provider.tsx`、`components/profile-pages.tsx`、`components/settings/text-api-settings.tsx`。
- 回归：`tests/stale-editor-writes.test.ts`、`tests/stale-editor-ui.test.ts`、`tests/ui-save-consistency.test.ts`；本任务记录。
- 开工时开放 PR #33 `fix/chat-wallpaper-decode` head `9eb876a87402dd897b818477e3a6055f8898a423`：Chat 壁纸、样式、存储及测试；#34 `claude/nifty-shannon-mkqijz` head `136a56b95ff2183e25bae58ce777d0b3b57fd3f6`：Contacts 详情/存储/并发测试；均无本次文件重叠。main 和两条 PR head 的 work-status 仅发现此前 AI handoff 记录，未发现其当前任务专属记录。
- 已合并 PR #20/#23/#24/#25/#28 的修复未覆盖当前 Text API 无条件 put、Character 表单缺失编辑基线及 Foundation 结果发布顺序。
- 发布前重新发现 #33/#34/#35 已合并；仅开放 PR #36 `fix/chat-first-frame-complete` head `ea68ffe691138e6520ab6e7a06f753fd0e1df423`，实际文件为 Messages 首页、Chat session hook/lifecycle/prefetch/storage、相关测试和独立记录；已读其 head 上任务记录，无本次重叠。GitHub 集成临时连接失败后使用已存 Git 凭据通过 Git/API 完成发现和发布，无凭据输出或配置修改。
- 不修改 Contacts、Bindings、Regex、WorldBook、Preset、Chat 文件；Text API 删除沿用既有关联清理，仅保护它之前的 API 删除与失败回滚；Character 既有关联清理原样保留。

## 已完成

- 修改前以真实 fake IndexedDB 复现：旧 API 编辑覆盖另一编辑、删除后旧 API 保存复活、Character CAS 重试将旧表单覆盖新字段。
- API 编辑基线在同一 readwrite 事务内核对；删除同样核对；创建要求 ID 不存在；失败回滚仅在同一事务确认仍缺失时恢复，保留并发新记录。无需数据库版本、迁移或数据重置。
- Text API 读请求拥有发布序号；保存用事务已提交返回值更新列表，不再追加可能失败/陈旧的读取。冲突刷新列表但不重设表单基线；失败保留草稿与明确提示；首读失败可重试。
- Character 编辑/删除捕获所见记录基线，在 Foundation CAS 每次重试时校验；只校验当前 Character，保留其他 Character/User/Universe 更新。删除冲突刷新后仍保留正在编辑的草稿。
- Character 编辑组件按当前角色身份挂载，页面复用切换角色不保留其他身份的草稿或基线；无需改变路由或数据架构。
- Foundation provider 按序执行事务及结果发布，并保护挂载生命周期；失败不阻塞后续显式重试。Character 冲突尝试重读持久化版本，以便取消后重新编辑。
- 15 项新增真实 IndexedDB/挂载 React 回归通过；最新 main 基线全量 490 项测试通过；TypeScript/typecheck、lint、生产 build 与 diff 空白检查通过。没有物理设备验收。

## 尚未验证

- React/JSDOM 和 fake IndexedDB 不是物理设备、多标签真实浏览器验收；未声称 iOS 或真机验证。
- Character 删除资源契约留后续工单：`deleteCharacter` 仅通过 `normalizeFoundation` 删除 Foundation 关系和节点；`CharacterPage` 随后在独立 Bindings 事务清理 Character 条目，两者不原子。其他域的 Contacts、Chat/session/messages、背景/资产引用没有完整统一删除契约；关联清理失败/遗留引用与资产所有权需资源契约工单核对。此单不新增、调整或实施相关清理。

## 下一步

发布此独立 PR并补入链接；不加 automerge、不等待审核、不直接合并。Character 删除资源契约另立工单。
