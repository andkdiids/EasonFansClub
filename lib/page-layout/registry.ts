import type {
  LayoutSpacing,
  LayoutWidth,
  PageLayoutBehavior,
  PageLayoutConfig,
  PageLayoutDevice,
  PageLayoutGridItem,
  PageLayoutModuleConfig,
  PageLayoutModuleDefinition,
  PageLayoutModuleCategory,
  PageLayoutPageDefinition,
  PageLayoutPageKey,
} from '@/lib/page-layout/types'
import { pageLayoutPageKeys } from '@/lib/page-layout/types'

const allWidths = ['full', 'wide', 'medium', 'narrow', 'half', 'third'] as const satisfies readonly LayoutWidth[]
const contentWidths = ['full', 'wide', 'medium', 'narrow'] as const satisfies readonly LayoutWidth[]
const cardWidths = ['full', 'wide', 'medium', 'half', 'third'] as const satisfies readonly LayoutWidth[]
const allSpacing = ['none', 'xs', 'sm', 'md', 'lg', 'xl'] as const satisfies readonly LayoutSpacing[]

/**
 * These definitions cover both the editable pages and the historical home
 * layout key. The home entry remains available to service/API consumers so
 * existing rows can be read safely, but it is deliberately omitted from the
 * editor-facing registry below.
 */
const PAGE_LAYOUT_PAGE_DEFINITIONS = [
  { key: 'home', name: '首页', description: '社区首页业务模块编排', path: '/community', navigationFeatureKey: 'HOME' },
  { key: 'checkin', name: '每日挂号', description: '每日挂号页面模块编排', path: '/checkin', navigationFeatureKey: 'CHECKIN' },
  { key: 'forum', name: 'E院广场', description: 'E院广场标题、分区、搜索与帖子内容', path: '/forum', navigationFeatureKey: 'FORUM' },
  { key: 'announcement', name: '公告', description: '公告板块页面基础布局', path: '/forum?board=announcements', navigationFeatureKey: 'FORUM' },
  { key: 'music', name: 'EasMusic', description: 'EasMusic 专辑、歌曲资料与播放框架', path: '/music', navigationFeatureKey: 'MUSIC' },
  { key: 'message', name: '消息中心', description: '通知中心页面基础布局', path: '/notifications', navigationFeatureKey: 'NOTIFICATIONS' },
  { key: 'profile', name: '个人病历', description: '个人病历与成长资料页面布局', path: '/profile', navigationFeatureKey: 'PROFILE' },
  { key: 'admin-home', name: '管理后台首页', description: '管理后台首页模块编排', path: '/admin', navigationFeatureKey: 'ADMIN' },
] as const satisfies readonly PageLayoutPageDefinition[]

/** Pages currently offered by the admin layout editor. Home is fixed. */
export const PAGE_LAYOUT_REGISTRY = PAGE_LAYOUT_PAGE_DEFINITIONS.filter((page) => page.key !== 'home')

export const pageLayoutPages = PAGE_LAYOUT_PAGE_DEFINITIONS.reduce((result, page) => {
  result[page.key] = page
  return result
}, {} as Record<PageLayoutPageKey, PageLayoutPageDefinition>)

/**
 * The module registry is shared by live rendering, draft normalization and
 * the admin editor. componentKey is stable UI identity, not a user-provided
 * component name or a persisted implementation detail.
 */
export const PAGE_MODULE_REGISTRY: readonly PageLayoutModuleDefinition[] = [
  defineLayoutModule('home', 'home.hero', '首页主视觉', '首页轮播与主要入口', 10, {
    componentKey: 'HOME_HERO', category: '首页',
    desktop: grid(0, 0, 12, 5), tablet: grid(0, 0, 8, 5), mobile: grid(0, 0, 4, 4),
    width: 'full', allowedWidths: ['full', 'wide'], heightMode: 'FIXED', layoutBehavior: 'fixed',
    core: true, minW: 4, minH: 2,
  }),
  defineLayoutModule('home', 'home.announcement', '首页公告', '轻量公告提示', 20, {
    componentKey: 'HOME_ANNOUNCEMENT', category: '公告',
    desktop: grid(0, 5, 12, 2), tablet: grid(0, 5, 8, 2), mobile: grid(0, 4, 4, 2),
    supportsTitle: false, supportsSubtitle: false, heightMode: 'FIXED', layoutBehavior: 'fixed',
    minW: 4, minH: 1,
  }),
  defineLayoutModule('home', 'home.stats', 'E院数据与挂号状态', 'E院人数、今日挂号、累计签到、今日生日与每日处方', 30, {
    componentKey: 'HOME_STATS', category: '首页',
    desktop: grid(0, 7, 12, 3), tablet: grid(0, 7, 8, 4), mobile: grid(0, 6, 4, 4),
    heightMode: 'FIXED', layoutBehavior: 'fixed', core: true, minW: 4, minH: 2,
  }),
  defineLayoutModule('home', 'home.today', '今日', '今日历史内容与挂号记录', 40, {
    componentKey: 'HOME_TODAY', category: '挂号',
    desktop: grid(0, 10, 4, 4), tablet: grid(0, 11, 4, 5), mobile: grid(0, 10, 4, 4),
    width: 'third', allowedWidths: cardWidths, heightMode: 'AUTO', layoutBehavior: 'auto', minW: 2, minH: 3,
  }),
  defineLayoutModule('home', 'home.anywhereDoor', '随意门', '随意门最新动态与快捷入口', 50, {
    componentKey: 'HOME_ANYWHERE_DOOR', category: '挂号',
    desktop: grid(4, 10, 4, 4), tablet: grid(4, 11, 4, 5), mobile: grid(0, 14, 4, 3),
    width: 'third', allowedWidths: cardWidths, heightMode: 'AUTO', layoutBehavior: 'auto', minW: 2, minH: 2,
  }),
  defineLayoutModule('home', 'home.salon', '沙龙', '社区沙龙与每日动态', 60, {
    componentKey: 'HOME_SALON', category: '广场',
    desktop: grid(8, 10, 4, 4), tablet: grid(0, 16, 8, 5), mobile: grid(0, 17, 4, 5),
    width: 'third', allowedWidths: cardWidths, heightMode: 'AUTO', layoutBehavior: 'auto', minW: 2, minH: 3,
  }),
  defineLayoutModule('home', 'home.activityCenter', '活动中心', '正在进行与即将开始的活动', 70, {
    componentKey: 'HOME_ACTIVITY_CENTER', category: '首页',
    desktop: grid(0, 14, 4, 5), tablet: grid(0, 21, 4, 5), mobile: grid(0, 22, 4, 5),
    width: 'third', allowedWidths: cardWidths, heightMode: 'AUTO', layoutBehavior: 'auto', minW: 2, minH: 3,
  }),
  defineLayoutModule('home', 'home.dailyMusic', 'EasMusic 今日推荐', '每日音乐推荐与播放入口', 80, {
    componentKey: 'HOME_DAILY_MUSIC', category: 'EasMusic',
    desktop: grid(4, 14, 4, 5), tablet: grid(4, 21, 4, 5), mobile: grid(0, 27, 4, 6),
    width: 'third', allowedWidths: cardWidths, heightMode: 'AUTO', layoutBehavior: 'auto', minW: 2, minH: 3,
  }),
  defineLayoutModule('home', 'home.entertainment', '娱乐天空', '娱乐榜单与今日热度', 90, {
    componentKey: 'HOME_ENTERTAINMENT', category: '首页',
    desktop: grid(8, 14, 4, 5), tablet: grid(0, 26, 8, 5), mobile: grid(0, 33, 4, 5),
    width: 'third', allowedWidths: cardWidths, heightMode: 'AUTO', layoutBehavior: 'auto', minW: 2, minH: 3,
  }),
  defineLayoutModule('home', 'home.albums', '每日推荐专辑', '每日歌曲与专辑内容', 100, {
    componentKey: 'HOME_ALBUMS', category: 'EasMusic',
    desktop: grid(0, 19, 12, 6), tablet: grid(0, 31, 8, 6), mobile: grid(0, 38, 4, 6),
    width: 'full', allowedWidths: allWidths, heightMode: 'AUTO', layoutBehavior: 'auto', core: true, minW: 4, minH: 3,
  }),

  defineLayoutModule('checkin', 'checkin.header', '每日挂号', '根据今日挂号状态显示挂号表单或完成结果', 10, {
    componentKey: 'CHECKIN_HEADER', category: '挂号',
    desktop: grid(0, 0, 12, 8), tablet: grid(0, 0, 8, 10), mobile: grid(0, 0, 4, 12),
    heightMode: 'AUTO', layoutBehavior: 'auto', core: true, minW: 4, minH: 5,
  }),
  defineLayoutModule('checkin', 'checkin.publicMessages', '病友留言', '匿名展示所有用户每日挂号留言', 20, {
    componentKey: 'CHECKIN_PUBLIC_MESSAGES', category: '挂号',
    desktop: grid(0, 8, 6, 6), tablet: grid(0, 10, 8, 6), mobile: grid(0, 12, 4, 6),
    heightMode: 'AUTO', layoutBehavior: 'auto', core: true, minW: 3, minH: 4,
  }),
  defineLayoutModule('checkin', 'checkin.friendMessages', '好友挂号留言', '展示好友每日挂号留言和互动', 30, {
    componentKey: 'CHECKIN_FRIEND_MESSAGES', category: '挂号',
    desktop: grid(6, 8, 6, 6), tablet: grid(0, 16, 8, 6), mobile: grid(0, 18, 4, 6),
    heightMode: 'AUTO', layoutBehavior: 'auto', core: true, minW: 3, minH: 4,
  }),

  singlePageModule('forum', 'forum.main', 'E院广场', '标题、分区、搜索、筛选、帖子列表与分页', 'FORUM_MAIN', '广场'),
  singlePageModule('announcement', 'announcement.main', '公告', '公告列表与公告详情入口', 'ANNOUNCEMENT_MAIN', '公告'),
  singlePageModule('music', 'music.main', 'EasMusic', 'EasMusic 专辑、歌曲资料与播放框架', 'MUSIC_MAIN', 'EasMusic'),
  singlePageModule('message', 'message.main', '消息中心', '通知列表与未读状态', 'MESSAGE_MAIN', '消息'),
  singlePageModule('profile', 'profile.main', '个人病历', '本人可见的简介、资料操作与成长数据', 'PROFILE_MAIN', '个人资料'),
  singlePageModule('admin-home', 'admin.main', '管理后台首页', '管理后台欢迎信息、统计与管理入口', 'ADMIN_MAIN', '后台'),
]

/** Compatibility name retained for existing service and API consumers. */
export const pageLayoutRegistry = PAGE_MODULE_REGISTRY
export const MODULE_REGISTRY = PAGE_MODULE_REGISTRY

export function isPageLayoutPageKey(value: unknown): value is PageLayoutPageKey {
  return typeof value === 'string' && pageLayoutPageKeys.includes(value as PageLayoutPageKey)
}

export type EditablePageLayoutPageKey = Exclude<PageLayoutPageKey, 'home'>

export function isEditablePageLayoutPageKey(value: unknown): value is EditablePageLayoutPageKey {
  return typeof value === 'string' && PAGE_LAYOUT_REGISTRY.some((page) => page.key === value)
}

export function getPageLayoutRegistry(pageKey: PageLayoutPageKey) {
  return PAGE_MODULE_REGISTRY.filter((item) => item.page === pageKey)
}

export function getPageLayoutModule(pageKey: PageLayoutPageKey, key: string) {
  return getPageLayoutRegistry(pageKey).find((item) => item.key === key) || null
}

export function getPageLayoutPagePath(pageKey: PageLayoutPageKey) {
  return pageLayoutPages[pageKey].path.split(/[?#]/, 1)[0]
}

function grid(x: number, y: number, w: number, h: number): PageLayoutGridItem {
  return { x, y, w, h }
}

function defineLayoutModule(
  page: PageLayoutPageKey,
  key: string,
  name: string,
  description: string,
  defaultOrder: number,
  options: {
    componentKey: string
    category: PageLayoutModuleCategory
    desktop?: PageLayoutGridItem
    tablet?: PageLayoutGridItem
    mobile?: PageLayoutGridItem
    visible?: boolean
    width?: LayoutWidth
    mobileWidth?: LayoutWidth
    allowedWidths?: readonly LayoutWidth[]
    allowedSpacing?: readonly LayoutSpacing[]
    supportsTitle?: boolean
    supportsSubtitle?: boolean
    supportsDesktop?: boolean
    supportsTablet?: boolean
    supportsMobile?: boolean
    minW?: number
    minH?: number
    maxW?: number
    maxH?: number
    canMove?: boolean
    canResize?: boolean
    canHide?: boolean
    core?: boolean
    required?: boolean
    heightMode?: 'AUTO' | 'FIXED'
    layoutBehavior?: PageLayoutBehavior
    surfaceClassName?: string
  },
): PageLayoutModuleDefinition {
  const core = options.core ?? options.required ?? false
  const heightMode = options.heightMode ?? (options.layoutBehavior === 'fixed' ? 'FIXED' : 'AUTO')
  const layoutBehavior = options.layoutBehavior ?? (heightMode === 'FIXED' ? 'fixed' : 'auto')
  return {
    key,
    page,
    name,
    description,
    componentKey: options.componentKey,
    category: options.category,
    defaultOrder,
    defaultVisible: options.visible ?? true,
    defaultGrid: {
      desktop: options.desktop || grid(0, 0, 12, 4),
      tablet: options.tablet || grid(0, 0, 8, 4),
      mobile: options.mobile || grid(0, 0, 4, 4),
    },
    defaultWidth: options.width || 'wide',
    defaultMobileWidth: options.mobileWidth || 'full',
    defaultGapTop: 'sm',
    defaultGapBottom: 'sm',
    allowedWidths: options.allowedWidths || contentWidths,
    allowedSpacing: options.allowedSpacing || allSpacing,
    supportsTitle: options.supportsTitle ?? true,
    supportsSubtitle: options.supportsSubtitle ?? true,
    supportsDesktop: options.supportsDesktop ?? true,
    supportsTablet: options.supportsTablet ?? true,
    supportsMobile: options.supportsMobile ?? true,
    layoutBehavior,
    heightMode,
    minW: options.minW ?? 1,
    minH: options.minH ?? 1,
    maxW: options.maxW,
    maxH: options.maxH ?? 40,
    canMove: options.canMove ?? true,
    canResize: options.canResize ?? true,
    canHide: options.canHide ?? !core,
    core,
    resizable: options.canResize ?? true,
    hideable: options.canHide ?? !core,
    surfaceClassName: options.surfaceClassName,
    required: core,
  }
}

function singlePageModule(
  page: PageLayoutPageKey,
  key: string,
  name: string,
  description: string,
  componentKey: string,
  category: PageLayoutModuleCategory,
) {
  return defineLayoutModule(page, key, name, description, 10, {
    componentKey,
    category,
    desktop: grid(0, 0, 12, 12),
    tablet: grid(0, 0, 8, 12),
    mobile: grid(0, 0, 4, 12),
    width: 'full',
    allowedWidths: allWidths,
    supportsTitle: false,
    supportsSubtitle: false,
    heightMode: 'AUTO',
    layoutBehavior: 'auto',
    core: true,
    minW: 4,
    minH: 4,
  })
}

function defaultModuleConfig(moduleDefinition: PageLayoutModuleDefinition, device: PageLayoutDevice): PageLayoutModuleConfig {
  return {
    key: moduleDefinition.key,
    order: moduleDefinition.defaultOrder,
    visible: moduleDefinition.defaultVisible,
    isHidden: !moduleDefinition.defaultVisible,
    grid: {
      desktop: { ...moduleDefinition.defaultGrid.desktop },
      tablet: { ...moduleDefinition.defaultGrid.tablet },
      mobile: { ...moduleDefinition.defaultGrid.mobile },
    },
    width: device === 'mobile' ? moduleDefinition.defaultMobileWidth || 'full' : moduleDefinition.defaultWidth,
    gapTop: moduleDefinition.defaultGapTop,
    gapBottom: moduleDefinition.defaultGapBottom,
    alignment: 'left',
    density: 'normal',
    title: null,
    subtitle: null,
  }
}

export function getDefaultPageLayoutConfig(pageKey: PageLayoutPageKey): PageLayoutConfig {
  const modules = getPageLayoutRegistry(pageKey)
  return {
    desktop: modules.filter((item) => item.supportsDesktop).map((item) => defaultModuleConfig(item, 'desktop')),
    tablet: modules.filter((item) => item.supportsTablet).map((item) => defaultModuleConfig(item, 'tablet')),
    mobile: modules.filter((item) => item.supportsMobile).map((item) => defaultModuleConfig(item, 'mobile')),
  }
}
