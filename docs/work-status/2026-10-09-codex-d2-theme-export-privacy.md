# STATUS — 2026-10-09-codex-d2-theme-export-privacy

更新人：Codex
更新时间：2026-10-09T18:20:00+08:00
发现范围：第四刀 D2；以 remote main `56b64940ed9143e59aae7dc3b0fe7122a5f10e7f` 为基线检查 Theme export/import、桌面布局和 Here & There 配置。GitHub Actions 受账户计费限制，本任务不修改工作流、权限或分支保护。

## 当前任务

修复 Theme 导出包含 Here & There 角色身份和生成评论的隐私泄漏；本地验证已完成，等待 CodeRabbit 和人工审查。

## 已完成

- 已确认旧导出链路会将 `normalizeSnapshot()` 的 Here & There `characterId`、`comment.characterId`、`comment.generatedAt` 与 `comment.text` 直接写入 JSON。
- 导出边界现在仅为 Here & There 生成外部副本，保留布局、尺寸、位置和时钟显示设置，排除身份和评论字段；本地 snapshot 与持久化格式不变。
- 回归测试通过真实 `exportTheme()` / `importTheme()` 路径检查多个 Here & There、敏感标记、导出不变性、安全字段保留和普通 Theme 兼容性。
- Red 证据：修复前新增契约测试在最终导出 JSON 中找到 `private-peter-id` 和 `D2_PRIVATE_COMMENT_PETER`，因此失败；修复后同一测试与 Theme/Desktop 回归测试共 30 项通过。
- 本地验证已完成：TypeScript typecheck 通过；ESLint 通过（仅有一条未触及的既有 unused-disable 警告）；全量测试 729/729 通过；production build 通过。

## 尚未验证

- 真实浏览器/iPhone：导出一个含 Here & There 绑定与评论的主题，检查分享文件不含角色 ID 或评论，并重新导入确认布局、尺寸和显示设置保留。
- GitHub Actions：因账户计费限制未运行。
- CodeRabbit 与人工审查尚待完成。

