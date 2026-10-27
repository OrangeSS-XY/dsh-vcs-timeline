# UI 预览（设计验证用）

这些页面由 `scripts/render-preview.ts` 用**固定示例数据**渲染真实的面板组件，
用于在 400px（另附 320px 窄栏）宽度下检查密度、层级与明暗主题。
它们不是运行时截图：颜色使用近似 DSH 主题 token 的调色板，实际运行时颜色来自宿主
`--dsw-*` token；示例提交/统计/审计记录都是设计验证用数据，不代表真实仓库。

重新生成：

```powershell
node --experimental-strip-types scripts/render-preview.ts
node scripts/preview-shots.mjs        # 用本机 Edge/Chrome 无头模式截图
# 或
npm run preview:ui
```

| 文件 | 场景 |
| --- | --- |
| `list-light.png` / `list-dark.png` | 提交历史（含合并提交、分支标签、增删统计、文件数） |
| `detail-light.png` | 提交详情：摘要、元信息网格、变更文件（重命名/二进制/统计） |
| `diff-light.png` | 单文件 Diff：行号槽、新增/删除/片段着色、底部统计 |
| `audit-light.png` / `audit-detail-light.png` | 操作审计列表（成功/待确认/失败）与详情 |
| `dialog-light.png` / `dialog-dark.png` | 提交确认对话框（摘要、argv、前置状态、输入、确认） |
| `menu-light.png` | 头部 “⋯” 版本控制菜单（Fetch/Pull/Commit/Push 分组） |
| `diagnostics-light.png` | 底部可展开环境诊断 |
| `loading-dark.png` | 加载骨架 |
| `empty-repos-light.png` / `uninitialized-light.png` | 空状态：未检测到仓库 / 仓库尚无提交 |
| `narrow320-*.png` | 320px 窄侧栏（iframe 视口）下的列表、详情、对话框、审计 |

> 这些截图是**组件渲染验证**，不是 DSH 桌面端的真实页面截图；真实宿主中的 slot 挂载、
> 主题 token 取值与交互行为需要在桌面端打开页签确认（见 `docs/TEST-REPORT.md` §7）。
