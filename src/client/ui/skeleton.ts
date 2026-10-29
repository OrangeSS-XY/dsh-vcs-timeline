/**
 * 布局骨架屏与跨淡入淡出加载容器（X/Twitter 卡片列表风格）。
 *
 * 设计约束（对应用户原话）：
 *  - 骨架由灰色圆角矩形块组成，位置/尺寸贴近真实内容，绝不改变布局结构；
 *  - 每块上有一道柔和的白色微光从左到右循环扫过（样式见 styles.ts 的
 *    `.dvt-skel-block::after`）；
 *  - 加载完成时骨架保留 240–280ms 淡出，真实内容同时淡入（{@link SkeletonSwap}）；
 *  - 骨架屏不含任何文字、图标或品牌标识，屏幕阅读器只看到 `aria-busy`。
 *
 * 纯 `createElement`、无 JSX；只有 {@link SkeletonSwap} 带状态与副作用。
 * @module dsh-vcs-timeline/client/ui/skeleton
 */

import * as React from 'react'
import type { PanelState } from '../types.ts'

const h = React.createElement

/** 骨架尺寸：数字按 px 处理，字符串原样交给 CSS（`%`、`rem`、`50%` 圆角等）。 */
export type SkeletonSize = number | string

/** 把尺寸值转成 CSS 字符串。 */
function dim(value: SkeletonSize): string {
  return typeof value === 'number' ? `${value}px` : value
}

/** 取数组中循环出现的元素；`noUncheckedIndexedAccess` 下带兜底。 */
function pick<T>(values: readonly T[], index: number, fallback: T): T {
  return values[index % values.length] ?? fallback
}

/* ------------------------------------------------------------------ blocks */

/** 一块灰色圆角占位；宽度省略时由外层 flex 决定。 */
export interface SkeletonBlockProps {
  width?: SkeletonSize
  height?: SkeletonSize
  radius?: SkeletonSize
  className?: string
}

/** 灰色圆角占位块（扫光由样式表的 `::after` 提供）。 */
export function SkeletonBlock(props: SkeletonBlockProps): React.ReactElement {
  const style: React.CSSProperties = { height: dim(props.height ?? 10) }
  if (props.width !== undefined) style.width = dim(props.width)
  if (props.radius !== undefined) style.borderRadius = dim(props.radius)
  return h('div', {
    className: `dvt-skel-block${props.className === undefined ? '' : ` ${props.className}`}`,
    style,
    'aria-hidden': 'true',
  })
}

/** 一行文字占位：默认 10px 高、6px 圆角的细长圆角块。 */
export function SkeletonLine(props: { width?: SkeletonSize; height?: SkeletonSize }): React.ReactElement {
  return h(SkeletonBlock, {
    height: props.height ?? 10,
    radius: 6,
    ...(props.width === undefined ? {} : { width: props.width }),
  })
}

/** 头像/节点用的圆形占位。 */
function SkeletonCircle(props: { size: SkeletonSize; className?: string }): React.ReactElement {
  return h(SkeletonBlock, {
    width: props.size,
    height: props.size,
    radius: '50%',
    ...(props.className === undefined ? {} : { className: props.className }),
  })
}

/* ------------------------------------------------------------- card lists */

/** 宽度循环，让连续几行看起来像真实文本长度。 */
const TEXT_WIDTHS = ['86%', '72%', '94%', '64%', '80%', '70%'] as const
const META_WIDTHS = [48, 60, 54, 44, 58] as const
const TREE_WIDTHS = ['58%', '74%', '46%', '66%', '52%', '70%'] as const
const INDENTS = [0, 0, 12, 12, 24, 0, 12, 0] as const
/** Diff 行宽度循环。 */
const DIFF_WIDTHS = ['64%', '82%', '48%', '74%', '56%', '88%', '42%', '70%'] as const

/** X 风格卡片列表骨架：可选头像圆块、两行文本块、右侧小胶囊。 */
export interface SkeletonCardListProps {
  rows?: number
  /** 每行左侧圆形头像块（X 的回复/动态列表）。 */
  avatar?: boolean
  /** 文本块下方再来一行更小的元信息块。 */
  meta?: boolean
}

/** X 风格列表骨架，行容器不带边框也没有任何文字。 */
export function SkeletonCardList(props: SkeletonCardListProps): React.ReactElement {
  const rows = props.rows ?? 5
  const avatar = props.avatar === true
  const meta = props.meta === true
  return h('div', { className: 'dvt-skeleton dvt-skel-cards', 'aria-hidden': 'true' },
    Array.from({ length: rows }, (_, index) => h('div', { key: index, className: 'dvt-skel-card' },
      avatar ? h(SkeletonCircle, { size: 34, className: 'dvt-skel-avatar' }) : null,
      h('div', { className: 'dvt-skel-card-main' },
        h(SkeletonLine, { width: pick(TEXT_WIDTHS, index + 1, '70%') }),
        h(SkeletonLine, { width: pick(TEXT_WIDTHS, index, '90%') }),
        meta
          ? h('div', { className: 'dvt-skel-card-meta' },
            h(SkeletonLine, { width: pick(META_WIDTHS, index, 48), height: 8 }),
            h(SkeletonLine, { width: pick(META_WIDTHS, index + 2, 56), height: 8 }),
          )
          : null,
      ),
      h(SkeletonBlock, { width: 52, height: 16, radius: 8 }),
    )),
  )
}

/** 时间线专用骨架：日历分组条 + 左侧节点、摘要行、作者/时间行、右侧 ± 与文件数块。 */
export function SkeletonTimelineList(props: { rows?: number }): React.ReactElement {
  const rows = props.rows ?? 6
  return h('div', { className: 'dvt-skeleton dvt-skel-timeline', 'aria-hidden': 'true' },
    h('div', { className: 'dvt-skel-tl-day' }, h(SkeletonLine, { width: 58, height: 8 })),
    Array.from({ length: rows }, (_, index) => h('div', { key: index, className: 'dvt-skel-tl-row' },
      h('div', { className: 'dvt-skel-tl-graph' }, h(SkeletonBlock, { width: 26, height: 26, radius: 8 })),
      h('div', { className: 'dvt-skel-tl-card' },
        h('div', { className: 'dvt-skel-tl-top' },
          h(SkeletonCircle, { size: 16 }),
          h(SkeletonLine, { width: 66, height: 9 }),
          h(SkeletonLine, { width: pick(TEXT_WIDTHS, index, '56%'), height: 10 }),
        ),
        h('div', { className: 'dvt-skel-tl-meta' },
          h(SkeletonLine, { width: pick(META_WIDTHS, index, 44), height: 8 }),
          h(SkeletonLine, { width: 34, height: 8 }),
        ),
      ),
      h('div', { className: 'dvt-skel-tl-stats' },
        h(SkeletonBlock, { width: 26, height: 9, radius: 5 }),
        h(SkeletonBlock, { width: 32, height: 9, radius: 5 }),
      ),
    )),
  )
}

/* ------------------------------------------------------------------ tree */

/** 左侧文件树骨架：标题块 + 搜索块 + 缩进文件行块。 */
export function SkeletonTree(props: { rows?: number }): React.ReactElement {
  const rows = props.rows ?? 10
  return h('aside', { className: 'dvt-tree dvt-skel-tree', 'aria-busy': 'true', 'aria-hidden': 'true' },
    h('div', { className: 'dvt-tree-head dvt-skel-tree-head' },
      h(SkeletonLine, { width: 76, height: 10 }),
      h('div', { className: 'dvt-skel-tree-tools' },
        h(SkeletonBlock, { width: 20, height: 20, radius: 6 }),
        h(SkeletonBlock, { width: 20, height: 20, radius: 6 }),
      ),
    ),
    h('div', { className: 'dvt-skel-tree-search' },
      h(SkeletonBlock, { width: '100%', height: 22, radius: 6 }),
    ),
    h('div', { className: 'dvt-skel-tree-rows' },
      Array.from({ length: rows }, (_, index) => h('div', {
        key: index,
        className: 'dvt-skel-tree-row',
        style: { paddingLeft: `${8 + pick(INDENTS, index, 0)}px` },
      },
      h(SkeletonBlock, { width: 11, height: 11, radius: 3 }),
      h(SkeletonLine, { width: pick(TREE_WIDTHS, index, '58%'), height: 9 }),
      )),
    ),
  )
}

/* --------------------------------------------------- source-specific pages */

/** 热力图条形宽度循环，视觉上像真实的热度分布。 */
const BAR_WIDTHS = ['38%', '72%', '54%', '86%', '46%'] as const

/** 热点仪表盘骨架：摘要块 + 热力网格 + 条形图。 */
function SkeletonHotspots(): React.ReactElement {
  return h('div', { className: 'dvt-skeleton dvt-skel-hs', 'aria-hidden': 'true' },
    h('div', { className: 'dvt-skel-hs-head' },
      h('div', { className: 'dvt-skel-hs-titles' },
        h(SkeletonLine, { width: 190, height: 16 }),
        h(SkeletonLine, { width: 286, height: 10 }),
      ),
      h(SkeletonBlock, { width: 64, height: 26, radius: 999 }),
    ),
    h('div', { className: 'dvt-skel-hs-panel' },
      h(SkeletonLine, { width: 96, height: 9 }),
      h('div', { className: 'dvt-skel-hs-heat' },
        Array.from({ length: 7 * 18 }, (_, index) => h(SkeletonBlock, { key: index, height: 14, radius: 4 })),
      ),
    ),
    h('div', { className: 'dvt-skel-hs-bars' },
      BAR_WIDTHS.map((width, index) => h('div', { key: index, className: 'dvt-skel-hs-bar' },
        h(SkeletonLine, { width: 104, height: 9 }),
        h(SkeletonBlock, { width, height: 8, radius: 999 }),
      )),
    ),
  )
}

/** 三栏待处理工作台骨架：文件列表列 + Diff 列 + 事实卡片列。 */
function SkeletonWorkbench(): React.ReactElement {
  return h('div', { className: 'dvt-skeleton dvt-skel-wb', 'aria-hidden': 'true' },
    h('div', { className: 'dvt-skel-wb-list' },
      h(SkeletonLine, { width: 72, height: 9 }),
      Array.from({ length: 9 }, (_, index) => h('div', {
        key: index,
        className: 'dvt-skel-wb-row',
        style: { paddingLeft: `${pick(INDENTS, index, 0)}px` },
      },
      h(SkeletonBlock, { width: 12, height: 12, radius: 3 }),
      h(SkeletonLine, { width: pick(TREE_WIDTHS, index, '58%'), height: 9 }),
      )),
    ),
    h('div', { className: 'dvt-skel-wb-main' },
      h(SkeletonLine, { width: 148, height: 10 }),
      Array.from({ length: 8 }, (_, index) => h(SkeletonLine, {
        key: index,
        width: pick(DIFF_WIDTHS, index, '70%'),
        height: 9,
      })),
    ),
    h('div', { className: 'dvt-skel-wb-side' },
      Array.from({ length: 3 }, (_, index) => h('div', { key: index, className: 'dvt-skel-wb-card' },
        h(SkeletonLine, { width: 84, height: 9 }),
        h(SkeletonLine, { width: pick(TEXT_WIDTHS, index, '76%'), height: 9 }),
        h(SkeletonLine, { width: pick(TEXT_WIDTHS, index + 2, '62%'), height: 9 }),
      )),
    ),
  )
}

/** 每个 source 对应的主内容骨架布局。 */
export interface SkeletonContentProps {
  source: PanelState['source']
  boot: PanelState['boot']
}

/**
 * Whether the panel currently has nothing to paint for the active surface.
 *
 * A quiet revalidation of already-visible data is **not** loading: the skeleton
 * must never cover real rows. This one predicate is shared by the composition
 * root, the chrome (which hides the sync pill while a skeleton is up) and the
 * status bar (which shows placeholder blocks instead of text).
 */
export function isContentLoading(state: PanelState): boolean {
  if (state.boot === 'loading') return true
  switch (state.source) {
    case 'timeline':
      return state.timeline.loading && state.timeline.events.length === 0
    case 'audit':
      return state.audit.loading && state.audit.operations.length === 0
    case 'pr':
      return state.pullRequests.loading && state.pullRequests.data === null
    case 'hotspots':
      return state.hotspots.loading && state.hotspots.data === null
    case 'pending':
      return state.statusLoading && state.status === null
    default:
      return false
  }
}

/**
 * 按面板来源返回匹配布局的骨架。
 *
 * 冷启动（`boot === 'loading'`）还没有仓库/来源上下文，用通用卡片列表；
 * 之后按 `source` 给出该页面的真实结构，避免“骨架 → 内容”二次跳变。
 */
export function SkeletonContent(props: SkeletonContentProps): React.ReactElement {
  // The panel's default source is the timeline, so the cold boot paints the
  // timeline layout (graph gutter included) instead of a generic list: the
  // first real page then lands in exactly the same geometry.
  if (props.boot === 'loading') {
    return props.source === 'timeline'
      ? h(SkeletonTimelineList, { rows: 6 })
      : h(SkeletonCardList, { rows: 5, meta: true })
  }
  switch (props.source) {
    case 'timeline':
      return h(SkeletonTimelineList, { rows: 6 })
    case 'audit':
      return h(SkeletonCardList, { rows: 5, meta: true })
    case 'pr':
      return h(SkeletonCardList, { rows: 5, meta: true })
    case 'hotspots':
      return h(SkeletonHotspots)
    case 'pending':
      return h(SkeletonWorkbench)
    default:
      return h(SkeletonCardList, { rows: 5, meta: true })
  }
}

/* ------------------------------------------------------------------ swap */

/** 骨架淡出与真实内容淡入的交叉时长（与 styles.ts 的 .24s/.28s 对齐）。 */
export const SKELETON_FADE_MS = 260

/** 用户的“减少动效”偏好；SSR/测试环境无 window 时按 false 处理。 */
function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** 跨淡入淡出的加载容器。 */
export interface SkeletonSwapProps {
  loading: boolean
  /** 加载中（以及淡出期间）覆盖在内容上的骨架。 */
  skeleton: React.ReactNode
  /** 真实内容；作为 children 传入。 */
  children?: React.ReactNode
  className?: string
}

/**
 * 加载中只渲染骨架；加载完成后骨架作为覆盖层停留 {@link SKELETON_FADE_MS}ms
 * 播放淡出，真实内容同时挂载并淡入，之后骨架卸载。
 *
 * 布局：`display:grid` + 两层 `grid-area:1/1` 叠在一起，骨架高度再变化也不会
 * 把下面的内容顶来顶去。可访问性：加载中容器 `aria-busy="true"`；骨架层全程
 * `aria-hidden="true"` 且 `pointer-events:none`，淡出期间真实内容即可交互；
 * 加载完成的那次提交就不再 `aria-busy`。`prefers-reduced-motion` 时跳过淡出，
 * 同一次渲染直接切换（样式表同时关闭动画）。
 */
export function SkeletonSwap(props: SkeletonSwapProps): React.ReactElement {
  const loading = props.loading
  const [previousLoading, setPreviousLoading] = React.useState(loading)
  const [exiting, setExiting] = React.useState(false)
  const [reduced] = React.useState(prefersReducedMotion)

  // 由 props 变化派生“骨架是否正在淡出”。渲染期同步调整状态，保证 loading
  // 落下的那一帧就同时挂载内容与淡出层，不会先卸载骨架再补一个动画。
  if (loading !== previousLoading) {
    setPreviousLoading(loading)
    setExiting(loading ? false : !reduced)
  }

  React.useEffect(() => {
    if (!exiting) return undefined
    const timer = window.setTimeout(() => setExiting(false), SKELETON_FADE_MS)
    return () => window.clearTimeout(timer)
  }, [exiting])

  const layers: React.ReactNode[] = []
  if (loading || exiting) {
    layers.push(h('div', {
      key: 'skeleton',
      className: `dvt-swap-layer dvt-swap-skel${loading ? '' : ' dvt-skel-out'}`,
      'aria-hidden': 'true',
    }, props.skeleton))
  }
  if (!loading) {
    layers.push(h('div', {
      key: 'content',
      className: `dvt-swap-layer dvt-swap-content${exiting ? ' dvt-content-in' : ''}`,
    }, props.children))
  }
  return h('div', {
    className: `dvt-swap${props.className === undefined ? '' : ` ${props.className}`}`,
    ...(loading ? { 'aria-busy': 'true' } : {}),
  }, layers)
}
