# UI 预览（设计验证用）

这些页面由 `scripts/render-preview.ts` 用**固定示例数据**渲染真实的面板组件，
用于检查密度、层级与明暗主题（400px 侧栏宽度，以及 1440px 全屏浮层）。
它们不是运行时截图：颜色使用近似 DSH 主题 token 的调色板，实际运行时颜色来自宿主 `--dsw-*` token。

重新生成：

```powershell
node --experimental-strip-types scripts/render-preview.ts
node scripts/preview-shots.mjs   # 用本机 Edge 无头模式截图
```

场景：文件树 + 变更时间线（亮/暗）、单文件时间线、全屏浮层（亮/暗）、提交详情、Diff、
审计列表/详情、写操作确认、操作菜单、诊断展开、加载中、空仓库、未初始化仓库。