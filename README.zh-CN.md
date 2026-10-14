# VEIL

> A phone across worlds.

[English](README.md)

VEIL 是一款使用 Next.js 与 TypeScript 构建、本地优先且移动端优先的陪伴手机应用。它将 Character、对话、关系、Presence、长期 Memory 与可定制的主屏幕整合在一个由浏览器持有数据的私密应用中。

VEIL 刻意保持 Character 中立：应用提供世界与交互模型，名字、身份、故事、模型服务、提示词和规则都属于用户。

## 主要能力

- **陪伴手机界面**——分页主屏幕、Dock、App、Widget、主题、壁纸、图标、字体与 iPhone 主屏幕展示模式。
- **Characters 与 Universe**——一个 User、多个 Characters 和一个共享 Universe，包含有方向的关系、共同历史、关系图布局、资料与 Character State。
- **Messages**——私聊和群聊、流式回复、重试/继续/重新生成、引用、搜索、多选操作、自定义聊天背景、气泡节奏和单会话 CSS。
- **Presence**——时区感知的作息、情境、在线状态、Last Seen、Character 自主状态变化与关系感知上下文。
- **长期 Memory**——每个 Character 独立的记忆、Journal、State、历史、来源感知检索、滚动摘要、用户编辑与撤销，以及可选的容量触发自动维护。
- **上下文工具**——可配置的 Presets、Text API、Bindings、WorldBooks、Regex 处理和仅开发环境启用的上下文检查器。
- **本地数据安全**——浏览器持有的持久化数据、协同写入、限定范围的删除清理、整站备份与恢复、校验、回滚和中断恢复。

**Moments** 目前只有空页面框架，尚不是可发布内容的社交动态系统。

## 产品模型

VEIL 遵循以下架构原则：

1. **本地优先。** 用户数据保存在当前站点来源的浏览器中；日常使用不需要 VEIL 账号或应用服务器。
2. **显式调用模型。** AI 工作使用用户配置的 OpenAI-compatible 服务；请求具有明确的所有者、有限上下文、取消机制和过期结果保护。
3. **数据域相互隔离。** Foundation、聊天、Memory、外观、凭据、联系人、Presence 和创作资源各自拥有独立的持久化权威与清理规则。
4. **用户创作优先。** 用户手动编辑的 Memory 不会被自动维护覆盖；破坏性流程保持显式，并尽可能可恢复。
5. **边界小而可观察。** UI 快照和内存缓存只是视图，不是备份权威；持久化、请求和后台工作的所有权留在专用模块中。

## 功能地图

| 区域 | 提供的能力 |
| --- | --- |
| Home | 多页 App 网格、Dock、编辑模式、防碰撞布局、可调整尺寸的 Widgets，最多八页 |
| Appearance | 颜色、字体、壁纸、App 图标、Dock 样式与布局、命名预设、导入导出及受限 CSS 变量覆盖 |
| Profile | 单例 User 资料、头像、个人信息、位置、时区与展示设置 |
| Characters | Character 创建与资料、叙事字段、头像裁剪、生活设置、Presence、State、Memory 入口和协调删除 |
| Universe | 共享世界信息、有方向的 Character 关系、关系类型与上下文、可拖动关系图、平移和视图适配 |
| Contacts | 联系关系、备注、资料背景、Presence、私聊入口和群聊选择 |
| Messages | 私聊/群聊会话、持久化历史、模型回复、消息操作、会话设置、背景、WorldBooks、Regex 和 Memory 上下文 |
| Memory | 每个 Character 的 Memories、Journal、State 和 History；本地检索、滚动摘要和可选自动维护 |
| Settings | Text API、Presets、Bindings、WorldBooks、Regex、备份恢复、运行设置与 Memory Maintenance |
| Here & There | User/Character 时钟、位置、可选天气及可选模型评论 |

## 架构

```text
Next.js App Router 页面
        │
React 功能组件与 Providers
        │
领域服务（chat、memory、presence、foundation、theme、backup）
        │
存储适配器与写入协调
        │
浏览器持有的 localStorage + IndexedDB
```

### 应用外壳

`app/layout.tsx` 组装持久应用外壳：

- `RestoreGate` 在存在中断恢复时阻止普通启动，要求继续恢复或回滚。
- `ProductBootstrap` 安装和更新规范的 Preset、Regex 与 Binding 默认项。
- `MemoryMaintenanceGate` 在 VEIL 打开期间持有可选的自动 Memory 工作。
- `PhoneShell`、`ThemeProvider` 与 `FoundationProvider` 发布视觉外壳和持久资料数据。
- 诊断 Gate 只在明确启用时工作，不会成为持久化权威。

路由统一注册在 `lib/app-registry.ts`。主屏幕直接读取该注册表，不维护第二份 App 清单。

### 核心领域

- **Foundation**——`lib/foundation-types.ts`、`lib/foundation.ts` 与 `lib/foundation-storage.ts` 持有 User、Characters、Universe、关系、节点位置和运行状态。
- **Chat**——`lib/chat/` 持有会话生命周期、存储、Prompt 构建、模型请求、消息操作、回复拆分、背景、上下文检查和请求诊断。
- **Memory**——`lib/memory/` 持有每个 Character 的记忆、来源、lineage、Journal、State 覆盖层、滚动摘要、维护调度和清理意图。
- **Presence**——`lib/presence/` 持有作息计算、存储情境、笔记、动作、实时发布和显示投影。
- **Appearance**——主题模块持有装饰和布局；图片字节与主题元数据分开保存。
- **创作资源**——Presets、WorldBooks、Regex、Text API 配置与 Bindings 相互独立，只在构建请求时组合。
- **Backup**——`lib/backup/` 持有包校验、ZIP 编码、协调快照、恢复预览、整机替换、安全副本、回滚和恢复日志。

### 请求与上下文流程

Character 回复会先通过 Global → Character → Character × App Bindings 解析 Text API 和 Preset，然后在有限预算内，仅组装目标会话、Character/Universe 上下文、已激活的 WorldBook 内容、Presence/State 信息和检索到的 Memory。显示用和 Prompt 用 Regex 在各自定义的边界执行。

发送消息与请求回复是两个独立操作。模型失败或取消不能丢弃已经持久化的用户消息。API Key 不会进入 Prompt、诊断信息或备份。

## 数据、备份与隐私

VEIL 没有云同步，也没有保存在服务器上的浏览器数据副本。清除网站数据会删除本地 VEIL 数据，除非用户已经导出备份。

| 数据域 | 浏览器持久化权威 |
| --- | --- |
| 外观元数据、Contacts、Bindings、Presets、Regex、WorldBooks、Presence | `localStorage` 文档 |
| User、Characters、Universe | IndexedDB `veil-core-v1` |
| 会话、消息、聊天设置和聊天图片 | IndexedDB `veil-chat-v2` |
| 长期 Memory、Journal、lineage、操作记录和维护游标 | IndexedDB `veil-memory-v1` |
| Text API 配置和凭据 | IndexedDB `veil-api-config-v1` |
| 外观图片字节 | IndexedDB `veil-appearance-images-v1` |

React 状态、Providers、实时文档快照和缓存都不是额外备份。

### 全站备份与恢复

**Settings → Backup & Restore** 会导出经过校验的 VEIL ZIP，其中包含受支持的持久化数据域和本地图片字节。API 配置元数据会进入备份，但 **API Key 永远不会被导出**，恢复后必须重新填写。

导入采用整机替换，不做数据合并。写入前会先校验并预览包内容；替换过程使用协调写入门禁、安全副本、结果验证、回滚和恢复日志。如果恢复时页面或浏览器关闭，普通应用 Providers 会保持未挂载，直到用户继续或回滚中断操作。

备份文件没有加密，可能包含私密资料、对话、Memory、位置与图片，请按敏感文件保存。真机容量仍取决于浏览器配额、可用内存和 iOS 文件处理能力。

### 网络边界

VEIL 可能连接：

- 用户配置的 OpenAI-compatible Text API，用于聊天、Presence 相关生成、Here & There 评论和可选的 Memory 自动维护；
- 当参与者保存了位置且 Here & There 请求天气时使用的 Open-Meteo 天气及地理编码接口；
- 浏览器渲染用户填写的外部图片 URL 时对应的资源地址。

没有配置位置的参与者不会发出位置查询。仓库中没有 VEIL 自有遥测服务。

## 仓库结构

```text
app/                 Next.js 路由、布局、metadata、manifest 与全局 CSS
components/          功能 UI、Providers、对话框、Widgets 与设置页面
config/              产品默认配置
lib/                 领域逻辑、存储适配器、请求构建和备份代码
docs/                架构说明、审计证据与任务交接
e2e/                 本地 Playwright 浏览器冒烟测试
scripts/             测试运行器与维护检查
tests/               Node、JSDOM 与 fake IndexedDB 回归测试
```

修改子系统前，建议先阅读：

- [仓库 Agent 指南](AGENTS.md)
- [Chat Core v1](docs/chat-core-v1.md)
- [备份格式 v1](docs/backup-format-v1.md)与[备份入口](docs/backup-entry.md)
- [Memory 构建](docs/memory-m5a-construction.md)与[Memory 集成](docs/memory-m6-p2-integration.md)
- [生命周期回归契约](docs/regression-contracts.md)
- [当前审计总账](docs/AUDIT_LEDGER.md)

历史报告和任务记录只描述各自对应的版本。如果旧文档与当前源码或审计总账冲突，以后两者为准。

## 本地开发

### 环境要求

- Node.js 24.x
- npm

```sh
npm ci
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)。

Foundation、主屏幕、Appearance 和本地编辑器无需外部凭据即可工作。需要生成文本时，在 **Settings → Text API** 创建 OpenAI-compatible 服务，然后全局选择，或在 **Settings → Bindings** 中指定。

### 验证

交付前运行仓库检查：

```sh
npm test
npm run typecheck
npm run lint
npm run build
```

附加测试：

```sh
npm run test:mutations  # 生命周期变异检查
npm run test:memory     # Memory 检索聚焦运行器
npm run test:browser    # 本地 Playwright 跨标签页冒烟测试
```

`npm test` 将测试编译到 `node_modules/.cache/veil-desktop-tests`，并输出 JSON 格式的生命周期回归契约。`test:browser` 默认在端口 `3123` 构建并启动隔离副本，使用全新 Chromium context，不调用模型，也不会接触真实用户数据。首次使用需运行 `npx playwright install chromium`，或设置 `PLAYWRIGHT_CHROMIUM_EXECUTABLE`。

自动化浏览器检查只能作为移动端的初步证据。iPhone Safari 与主屏幕模式问题需要物理设备验收。

## iPhone 主屏幕模式

VEIL 提供 Web App Manifest、Apple standalone metadata、`viewport-fit=cover`、安全区处理和 iOS `navigator.standalone` fallback。独立模式会隐藏模拟手机边框与状态栏，同时保留原生安全区。

目前没有 Service Worker，也没有打包安装图标。部署 metadata 变化后，应先移除旧快捷方式，再通过 Safari **分享 → 添加到主屏幕**，让 iOS 重新读取信息。

## 部署

在 Vercel 中导入仓库根目录，选择 Next.js preset，保留默认安装/构建命令，并使用 Node.js 24.x。基础应用不需要环境变量。Text API 凭据由每个浏览器在本地配置，不属于部署 Secret。

## 参与开发

- 修改前阅读 `AGENTS.md` 和相关领域文档。
- 除非任务明确包含迁移，否则保留本地用户数据和现有存储格式。
- 后台工作必须有边界、可取消并具有明确所有者。
- 对修改的行为和数据安全边界增加聚焦回归测试。
- 将源码阅读、自动化测试、浏览器检查和真机验收视为不同证据等级。
- 保持 PR 聚焦；合并和发布决定由仓库所有者控制。
