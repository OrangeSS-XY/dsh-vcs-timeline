# UI 预览（设计验证用）

这些页面由 `scripts/render-preview.ts` 用**固定示例数据**渲染真实的面板组件，
用于检查密度、层级与明暗主题（400px 侧栏宽度，以及 1600px 对话区宽度）。
它们不是运行时截图：亮/暗 token 取自安装的 DSH 单色主题——`--dsw-alias-brand-primary` 是单色
`#0f1115`（亮）/ `#f5f6f8`（暗），不是蓝色强调色；图表与热力的蓝紫色只来自面板样式表里的
`--dvt-data-blue` / `--dvt-data-purple`，因此两套 token 下数据色保持一致。

截图前会把 SSR 生成的 `<style>` 内容反转义（React 服务端渲染会转义文本，而 `<style>` 是原始文本元素，
不反转义的话 `[data-*="…"]` 属性选择器与子选择器会在预览样式表里静默失效）。

重新生成：

```powershell
node --experimental-strip-types scripts/render-preview.ts
node scripts/preview-shots.mjs   # 用本机 Edge 无头模式截图
```

场景：文件树 + 时间线（亮/暗，侧栏与宽屏）、单文件三栏（树 | Diff | 操作信息）、提交详情、
PR 列表 / 未认证提示、审计列表/详情、写操作确认、操作菜单、诊断展开、加载中、空仓库、未初始化仓库。

加载骨架（v1.5.1）：`loading-skeleton-light` / `loading-skeleton-dark`（1600×900）展示时间线首次加载的
灰块布局骨架——140px 泳道占位、64px 行、头像/摘要/±块、左侧文件树骨架与底部状态栏灰块，整屏无 loading
文字；`loading-dark` 保留冷启动卡片骨架。白色扫光与骨架淡出/内容淡入都是运行时动画，静态截图里看不到，
规则见 [docs/DYNAMIC-LOADING.md](../DYNAMIC-LOADING.md) §3.6。

热点仪表盘（`source: hotspots`，1600×900）：`hotspot-files-light` / `hotspot-authors-light` /
`hotspot-activity-light` 三个维度各一个亮色场景，外加 `hotspot-authors-dark` 验证暗色 token；
固定报告里包含 20 个文件的 churn 长尾、6 位贡献者（含一位 churn 未知）、10 条近期提交（含合并、
文件列表被截断与纯二进制提交）。

活动日历（热点默认维度）：`hotspot-calendar-churn-light`（1600×900，代码修改量热力）、
`hotspot-calendar-pushes-light`（推送次数热力，审计 fixture 含 6 次成功推送 + 1 次失败推送）、
`hotspot-calendar-churn-dark`（暗色）与 `hotspot-calendar-sidebar`（420×900，单列 + 日历横向滚动）。
固定日数据覆盖最近 20 个 UTC 日（含一个零提交日与一个未提供行级统计的日），窗口外与未来格分别淡显。

PR 分析看板（`source: pr`，1600×900）：`pr-dashboard-light`（filter=all）、
`pr-dashboard-conflicts-light`（filter=conflicts，只保留冲突行）、`pr-dashboard-anonymous-light`
（`authenticated:false`，合并数显示不可用并给诚实提示）、`pr-dashboard-dark` 与
`pr-dashboard-sidebar`（420×900，单列）。fixture 含可合并 / 冲突 / 草稿 / 修改意见 / 已合并（mergedAt）/
已关闭 / 可合并性未知的 PR、4 位作者与 30 天合并窗口（`historyTruncated:true`）。

另外两个场景渲染独立演示页 `SwimlaneDemo`（`src/client/ui/swimlane.ts`，自带样式与 MOCK 数据）：
`swimlane-wide`（1440×900，260px 文件树 + 页头/工具栏 + 多轨道泳道）与
`swimlane-sidebar`（420×900，插件右侧栏宽度，窄屏下文件树折叠为抽屉）。
只重建这两个演示页时可用 `node --experimental-strip-types scripts/render-preview.ts --demo-only`。