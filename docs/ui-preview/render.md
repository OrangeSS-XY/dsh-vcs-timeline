# UI 预览（设计验证用）

这些页面由 `scripts/render-preview.ts` 用**固定示例数据**渲染真实的面板组件，
用于检查密度、层级与明暗主题（400px 侧栏宽度，以及 1600px 对话区宽度）。
它们不是运行时截图：颜色使用近似 DSH 主题 token 的调色板，实际运行时颜色来自宿主 `--dsw-*` token。

截图前会把 SSR 生成的 `<style>` 内容反转义（React 服务端渲染会转义文本，而 `<style>` 是原始文本元素，
不反转义的话 `[data-*="…"]` 属性选择器与子选择器会在预览样式表里静默失效）。

重新生成：

```powershell
node --experimental-strip-types scripts/render-preview.ts
node scripts/preview-shots.mjs   # 用本机 Edge 无头模式截图
```

场景：文件树 + 时间线（亮/暗，侧栏与宽屏）、单文件三栏（树 | Diff | 操作信息）、提交详情、
PR 列表 / 未认证提示、审计列表/详情、写操作确认、操作菜单、诊断展开、加载中、空仓库、未初始化仓库。

热点仪表盘（`source: hotspots`，1600×900）：`hotspot-files-light` / `hotspot-authors-light` /
`hotspot-activity-light` 三个维度各一个亮色场景，外加 `hotspot-authors-dark` 验证暗色 token；
固定报告里包含 20 个文件的 churn 长尾、6 位贡献者（含一位 churn 未知）、10 条近期提交（含合并、
文件列表被截断与纯二进制提交）。

另外两个场景渲染独立演示页 `SwimlaneDemo`（`src/client/ui/swimlane.ts`，自带样式与 MOCK 数据）：
`swimlane-wide`（1440×900，260px 文件树 + 页头/工具栏 + 多轨道泳道）与
`swimlane-sidebar`（420×900，插件右侧栏宽度，窄屏下文件树折叠为抽屉）。
只重建这两个演示页时可用 `node --experimental-strip-types scripts/render-preview.ts --demo-only`。