export const pageLayoutPageKeys = ['home', 'checkin', 'forum', 'announcement', 'music', 'message', 'profile', 'admin-home'] as const
export type PageLayoutPageKey = (typeof pageLayoutPageKeys)[number]

export const layoutWidths = ['full', 'wide', 'medium', 'narrow', 'half', 'third'] as const
export type LayoutWidth = (typeof layoutWidths)[number]

export const layoutSpacings = ['none', 'xs', 'sm', 'md', 'lg', 'xl'] as const
export type LayoutSpacing = (typeof layoutSpacings)[number]

export const layoutAlignments = ['left', 'center', 'right'] as const
export type LayoutAlignment = (typeof layoutAlignments)[number]

export const layoutDensities = ['compact', 'normal', 'spacious'] as const
export type LayoutDensity = (typeof layoutDensities)[number]

export const pageLayoutBehaviors = ['fixed', 'auto'] as const
export type PageLayoutBehavior = (typeof pageLayoutBehaviors)[number]

export const pageLayoutHeightModes = ['AUTO', 'FIXED'] as const
export type PageLayoutHeightMode = (typeof pageLayoutHeightModes)[number]

export type PageLayoutModuleCategory = '首页' | '挂号' | '广场' | '公告' | 'EasMusic' | '消息' | '个人资料' | '后台'

export const pageLayoutDevices = ['desktop', 'tablet', 'mobile'] as const
export type PageLayoutDevice = (typeof pageLayoutDevices)[number]

export type PageLayoutGridItem = {
  x: number
  y: number
  w: number
  h: number
}

export type PageLayoutModuleConfig = {
  key: string
  order: number
  visible: boolean
  isHidden: boolean
  grid: Record<PageLayoutDevice, PageLayoutGridItem>
  width: LayoutWidth
  gapTop: LayoutSpacing
  gapBottom: LayoutSpacing
  alignment: LayoutAlignment
  density: LayoutDensity
  title: string | null
  subtitle: string | null
}

export type PageLayoutConfig = Record<PageLayoutDevice, PageLayoutModuleConfig[]>

export type PageLayoutWarning = {
  device: PageLayoutDevice
  key: string
  kind: 'UNKNOWN' | 'DEPRECATED'
  message: string
}

export type PageLayoutModuleDefinition = {
  key: string
  page: PageLayoutPageKey
  name: string
  description: string
  /** Stable component identity. The renderer resolves this key to the real UI component. */
  componentKey: string
  category: PageLayoutModuleCategory
  defaultOrder: number
  defaultVisible: boolean
  defaultGrid: Record<PageLayoutDevice, PageLayoutGridItem>
  defaultWidth: LayoutWidth
  defaultMobileWidth?: LayoutWidth
  defaultGapTop: LayoutSpacing
  defaultGapBottom: LayoutSpacing
  allowedWidths: readonly LayoutWidth[]
  allowedSpacing: readonly LayoutSpacing[]
  supportsTitle: boolean
  supportsSubtitle: boolean
  supportsDesktop: boolean
  supportsTablet: boolean
  supportsMobile: boolean
  layoutBehavior: PageLayoutBehavior
  heightMode: PageLayoutHeightMode
  minW: number
  minH: number
  maxW?: number
  maxH?: number
  canMove: boolean
  canResize: boolean
  canHide: boolean
  /** User-facing aliases used by the editor and kept alongside legacy fields. */
  core: boolean
  resizable: boolean
  hideable: boolean
  surfaceClassName?: string
  required?: boolean
}

export type PageLayoutPageDefinition = {
  key: PageLayoutPageKey
  name: string
  description: string
  path: string
  navigationFeatureKey?: string
}

export type SerializedPageLayout = {
  pageKey: PageLayoutPageKey
  registry: PageLayoutModuleDefinition[]
  warnings: PageLayoutWarning[]
  defaults: PageLayoutConfig
  draftConfig: PageLayoutConfig
  publishedConfig: PageLayoutConfig
  previousPublishedConfig: PageLayoutConfig | null
  version: number
  updatedAt: string | null
  publishedAt: string | null
  updatedById?: string | null
  publishedById?: string | null
}

export type SerializedPageLayoutRevision = {
  id: string
  pageKey: PageLayoutPageKey
  pageLayoutId: string
  version: number
  config: PageLayoutConfig
  note: string | null
  source: 'MANUAL' | 'ROLLBACK' | 'DEFAULT'
  createdAt: string
  publishedById: string | null
  publishedByName: string | null
}
