import type {
  LayoutSpacing,
  LayoutWidth,
  PageLayoutBehavior,
  PageLayoutConfig,
  PageLayoutDevice,
  PageLayoutGridItem,
  PageLayoutModuleConfig,
  PageLayoutModuleDefinition,
  PageLayoutPageKey,
} from '@/lib/page-layout/types'
import { pageLayoutPageKeys } from '@/lib/page-layout/types'

const allWidths = ['full', 'wide', 'medium', 'narrow', 'half', 'third'] as const satisfies readonly LayoutWidth[]
const contentWidths = ['full', 'wide', 'medium', 'narrow'] as const satisfies readonly LayoutWidth[]
const cardWidths = ['full', 'wide', 'medium', 'half', 'third'] as const satisfies readonly LayoutWidth[]
const allSpacing = ['none', 'xs', 'sm', 'md', 'lg', 'xl'] as const satisfies readonly LayoutSpacing[]

const fullGrid = grid(0, 0, 12, 3)
const mobileGrid = grid(0, 0, 4, 2)

export const pageLayoutPages: Record<PageLayoutPageKey, { name: string; description: string; path: string }> = {
  home: { name: '社区首页', description: '社区首页业务模块编排', path: '/community' },
  checkin: { name: '每日挂号', description: '每日挂号页面模块编排', path: '/checkin' },
  forum: { name: 'E院广场', description: '单页论坛首页布局', path: '/forum' },
  announcement: { name: '公告', description: '公告板块页面基础布局', path: '/boards/announcements' },
  music: { name: '音乐馆', description: 'EasMusic 页面基础布局', path: '/music' },
  message: { name: '消息中心', description: '通知中心页面基础布局', path: '/notifications' },
  profile: { name: '个人病历', description: '个人病历页面基础布局', path: '/profile' },
  'admin-home': { name: '管理后台首页', description: '后台首页模块编排', path: '/admin' },
}

export const pageLayoutRegistry: readonly PageLayoutModuleDefinition[] = [
  defineLayoutModule('home', 'home.hero', '首页主视觉', '首页轮播与主要入口', 10, {
    desktop: grid(0, 0, 12, 5),
    minH: 2,
    mobile: grid(0, 0, 4, 4),
    width: 'full',
    allowedWidths: ['full', 'wide'],
    required: true,
  }),
  defineLayoutModule('home', 'home.announcement', '首页公告', '轻量公告提示', 20, {
    desktop: grid(0, 5, 12, 2),
    minH: 2,
    mobile: grid(0, 4, 4, 2),
    supportsTitle: false,
    supportsSubtitle: false,
  }),
  defineLayoutModule('home', 'home.checkinEntry', '今日挂号', '每日挂号快捷入口', 30, {
    desktop: grid(0, 7, 4, 2), minH: 2, mobile: grid(0, 6, 4, 2), width: 'third', allowedWidths: cardWidths,
  }),
  defineLayoutModule('home', 'home.forumEntry', '去E院广场看看', '论坛快捷入口', 31, {
    desktop: grid(4, 7, 4, 2), minH: 2, mobile: grid(0, 8, 4, 2), width: 'third', allowedWidths: cardWidths,
  }),
  defineLayoutModule('home', 'home.musicEntry', 'EasMusic', '音乐快捷入口', 32, {
    desktop: grid(8, 7, 4, 2), minH: 2, mobile: grid(0, 10, 4, 2), width: 'third', allowedWidths: cardWidths,
  }),
  defineLayoutModule('home', 'home.featuredPosts', '精选帖子', '首页精选帖子列表', 40, {
    desktop: grid(0, 10, 12, 5),
    minH: 2,
    mobile: grid(0, 9, 4, 5),
    required: true,
    layoutBehavior: 'auto',
  }),
  defineLayoutModule('home', 'home.dailyMessages', '病友留言', '每日留言精选', 50, {
    desktop: grid(0, 15, 6, 4),
    minH: 2,
    mobile: grid(0, 14, 4, 4),
    width: 'half',
    allowedWidths: cardWidths,
    layoutBehavior: 'auto',
  }),
  defineLayoutModule('home', 'home.music', 'EasMusic', '音乐推荐入口', 60, {
    desktop: grid(6, 15, 6, 4),
    minH: 2,
    mobile: grid(0, 18, 4, 4),
    width: 'half',
    allowedWidths: cardWidths,
    layoutBehavior: 'auto',
  }),
  defineLayoutModule('home', 'home.culture', '活动与文化', '活动和文化内容入口', 70, {
    desktop: grid(0, 19, 6, 4),
    minH: 2,
    mobile: grid(0, 22, 4, 4),
    width: 'half',
    allowedWidths: cardWidths,
    layoutBehavior: 'auto',
  }),
  defineLayoutModule('home', 'home.latestPosts', '最新动态', '预留的首页动态模块', 80, {
    desktop: grid(6, 19, 6, 4),
    minH: 2,
    mobile: grid(0, 26, 4, 4),
    visible: false,
    width: 'half',
    allowedWidths: cardWidths,
    layoutBehavior: 'auto',
  }),
  defineLayoutModule('home', 'home.footer', '页脚', '首页页脚文案', 90, {
    desktop: grid(0, 23, 12, 2),
    mobile: grid(0, 30, 4, 2),
    supportsSubtitle: false,
  }),

  defineLayoutModule('checkin', 'checkin.header', '每日挂号', '根据今日挂号状态显示挂号表单或完成结果', 10, {
    desktop: grid(0, 0, 12, 8),
    tablet: grid(0, 0, 8, 10),
    mobile: grid(0, 0, 4, 12),
    required: true,
    minH: 5,
    layoutBehavior: 'auto',
  }),
  defineLayoutModule('checkin', 'checkin.publicMessages', '病友留言', '匿名展示所有用户每日挂号留言', 20, {
    desktop: grid(0, 8, 6, 6),
    tablet: grid(0, 8, 8, 6),
    mobile: grid(0, 8, 4, 6),
    required: true,
    minH: 4,
    layoutBehavior: 'auto',
  }),
  defineLayoutModule('checkin', 'checkin.friendMessages', '好友挂号留言', '展示好友每日挂号留言和互动', 30, {
    desktop: grid(6, 8, 6, 6),
    tablet: grid(0, 14, 8, 6),
    mobile: grid(0, 14, 4, 6),
    required: true,
    minH: 4,
    layoutBehavior: 'auto',
  }),

  singlePageModule('forum', 'forum.main', 'E院广场', '标题、分区、搜索、筛选、帖子列表与分页', 'auto'),

  defineLayoutModule('announcement', 'announcement.header', '公告头部', '公告页面标题与说明', 10, {
    desktop: grid(0, 0, 12, 3),
    tablet: grid(0, 0, 8, 3),
    mobile: grid(0, 0, 4, 3),
    minW: 4,
    minH: 2,
  }),
  defineLayoutModule('announcement', 'announcement.pinned', '置顶公告', '置顶公告列表区域', 20, {
    desktop: grid(0, 3, 8, 5),
    tablet: grid(0, 3, 8, 5),
    mobile: grid(0, 3, 4, 5),
    minW: 3,
    minH: 3,
    layoutBehavior: 'auto',
  }),
  defineLayoutModule('announcement', 'announcement.list', '公告列表', '公告列表主体区域', 30, {
    desktop: grid(0, 8, 8, 8),
    tablet: grid(0, 8, 8, 8),
    mobile: grid(0, 8, 4, 8),
    minW: 3,
    minH: 4,
    layoutBehavior: 'auto',
  }),
  defineLayoutModule('announcement', 'announcement.updateLogEntry', '更新日志入口', '更新日志与版本信息入口', 40, {
    desktop: grid(8, 3, 4, 3),
    tablet: grid(0, 16, 8, 3),
    mobile: grid(0, 16, 4, 3),
    minW: 2,
    minH: 2,
  }),
  defineLayoutModule('announcement', 'announcement.sidebar', '侧边区域', '公告页侧边信息区域', 50, {
    desktop: grid(8, 6, 4, 5),
    tablet: grid(0, 19, 8, 4),
    mobile: grid(0, 19, 4, 4),
    minW: 2,
    minH: 3,
  }),
  defineLayoutModule('announcement', 'announcement.pagination', '分页区域', '公告分页或加载更多区域', 60, {
    desktop: grid(0, 16, 8, 2),
    tablet: grid(0, 23, 8, 2),
    mobile: grid(0, 23, 4, 2),
    minW: 3,
    minH: 1,
  }),
  singlePageModule('music', 'music.main', '音乐馆内容', 'EasMusic 专辑、歌曲资料与播放框架'),
  singlePageModule('message', 'message.main', '消息中心内容', '通知列表与未读状态', 'auto'),
  defineLayoutModule('profile', 'profile.main', '个人简介与成长资料', '本人可见的简介、资料操作与成长数据', 10, {
    desktop: grid(0, 0, 12, 5),
    tablet: grid(0, 0, 8, 5),
    mobile: grid(0, 0, 4, 5),
    minW: 3,
    minH: 2,
    required: true,
    supportsTitle: false,
    supportsSubtitle: false,
    layoutBehavior: 'auto',
  }),
  defineLayoutModule('profile', 'profile.calendar', '本月挂号日历', '个人本月挂号日历', 30, {
    desktop: grid(0, 4, 5, 8),
    tablet: grid(0, 6, 8, 7),
    mobile: grid(0, 6, 4, 7),
    minW: 3,
    minH: 4,
    layoutBehavior: 'auto',
  }),
  defineLayoutModule('profile', 'profile.recentMessages', '最近留言', '个人最近留言记录', 40, {
    desktop: grid(5, 4, 7, 8),
    tablet: grid(0, 13, 8, 5),
    mobile: grid(0, 13, 4, 5),
    minW: 3,
    minH: 3,
    layoutBehavior: 'auto',
  }),
  defineLayoutModule('profile', 'profile.posts', '发帖与个人记录', '发帖、回复、成就、收藏等个人记录', 50, {
    desktop: grid(0, 12, 12, 7),
    tablet: grid(0, 18, 8, 7),
    mobile: grid(0, 18, 4, 7),
    minW: 3,
    minH: 3,
    layoutBehavior: 'auto',
  }),
  defineLayoutModule('admin-home', 'admin.header', '后台页头', '管理后台欢迎与说明', 10, {
    desktop: grid(0, 0, 12, 3),
    mobile: grid(0, 0, 4, 3),
    required: true,
  }),
  defineLayoutModule('admin-home', 'admin.registrationStatus', '注册状态', '注册模式与环境状态', 20, {
    desktop: grid(0, 3, 12, 3),
    mobile: grid(0, 3, 4, 3),
    supportsSubtitle: false,
  }),
  defineLayoutModule('admin-home', 'admin.stats', '后台数据', '后台核心统计卡片', 30, {
    desktop: grid(0, 6, 12, 3),
    mobile: grid(0, 6, 4, 3),
    supportsTitle: false,
    supportsSubtitle: false,
  }),
  defineLayoutModule('admin-home', 'admin.modules', '后台模块', '后台管理入口列表', 40, {
    desktop: grid(0, 9, 12, 5),
    mobile: grid(0, 9, 4, 5),
  }),
  defineLayoutModule('admin-home', 'admin.deploymentStatus', '部署状态', '预留的部署状态提示模块', 50, {
    desktop: grid(0, 14, 12, 3),
    mobile: grid(0, 14, 4, 3),
    visible: false,
  }),
]

export function isPageLayoutPageKey(value: unknown): value is PageLayoutPageKey {
  return typeof value === 'string' && pageLayoutPageKeys.includes(value as PageLayoutPageKey)
}

export function getPageLayoutRegistry(pageKey: PageLayoutPageKey) {
  return pageLayoutRegistry.filter((item) => item.page === pageKey)
}

export function getPageLayoutModule(pageKey: PageLayoutPageKey, key: string) {
  return getPageLayoutRegistry(pageKey).find((item) => item.key === key) || null
}

export function getPageLayoutPagePath(pageKey: PageLayoutPageKey) {
  return pageLayoutPages[pageKey].path
}

function grid(x: number, y: number, w: number, h: number): PageLayoutGridItem {
  return { x, y, w, h }
}

function tabletFrom(desktop: PageLayoutGridItem): PageLayoutGridItem {
  const w = Math.max(1, Math.min(8, Math.round((desktop.w / 12) * 8)))
  const x = Math.max(0, Math.min(8 - w, Math.round((desktop.x / 12) * 8)))
  return { x, y: desktop.y, w, h: desktop.h }
}

function defineLayoutModule(
  page: PageLayoutPageKey,
  key: string,
  name: string,
  description: string,
  defaultOrder: number,
  options: {
    desktop?: PageLayoutGridItem
    tablet?: PageLayoutGridItem
    mobile?: PageLayoutGridItem
    visible?: boolean
    width?: LayoutWidth
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
    required?: boolean
    layoutBehavior?: PageLayoutBehavior
  } = {},
): PageLayoutModuleDefinition {
  return {
    key,
    page,
    name,
    description,
    defaultOrder,
    defaultVisible: options.visible ?? true,
    defaultGrid: {
      desktop: options.desktop || fullGrid,
      tablet: options.tablet || tabletFrom(options.desktop || fullGrid),
      mobile: options.mobile || mobileGrid,
    },
    defaultWidth: options.width || 'wide',
    defaultMobileWidth: 'full',
    defaultGapTop: 'sm',
    defaultGapBottom: 'sm',
    allowedWidths: options.allowedWidths || contentWidths,
    allowedSpacing: options.allowedSpacing || allSpacing,
    supportsTitle: options.supportsTitle ?? true,
    supportsSubtitle: options.supportsSubtitle ?? true,
    supportsDesktop: options.supportsDesktop ?? true,
    supportsTablet: options.supportsTablet ?? true,
    supportsMobile: options.supportsMobile ?? true,
    layoutBehavior: options.layoutBehavior || 'fixed',
    minW: options.minW ?? 1,
    minH: options.minH ?? 1,
    maxW: options.maxW,
    maxH: options.maxH ?? 40,
    canMove: options.canMove ?? true,
    canResize: options.canResize ?? true,
    canHide: options.canHide ?? !options.required,
    required: options.required,
  }
}

function singlePageModule(page: PageLayoutPageKey, key: string, name: string, description: string, layoutBehavior: PageLayoutBehavior = 'fixed') {
  return defineLayoutModule(page, key, name, description, 10, {
    desktop: grid(0, 0, 12, 8),
    tablet: grid(0, 0, 8, 8),
    mobile: grid(0, 0, 4, 8),
    width: 'full',
    allowedWidths: allWidths,
    required: true,
    supportsTitle: false,
    supportsSubtitle: false,
    layoutBehavior,
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
    gapTop: device === 'mobile' && moduleDefinition.defaultGapTop === 'md' ? 'sm' : moduleDefinition.defaultGapTop,
    gapBottom: device === 'mobile' && moduleDefinition.defaultGapBottom === 'md' ? 'sm' : moduleDefinition.defaultGapBottom,
    alignment: 'left',
    density: 'normal',
    title: null,
    subtitle: null,
  }
}

export function getDefaultPageLayoutConfig(pageKey: PageLayoutPageKey): PageLayoutConfig {
  const modules = getPageLayoutRegistry(pageKey)
  const config = {
    desktop: modules.filter((item) => item.supportsDesktop).map((item) => defaultModuleConfig(item, 'desktop')),
    tablet: modules.filter((item) => item.supportsTablet).map((item) => defaultModuleConfig(item, 'tablet')),
    mobile: modules.filter((item) => item.supportsMobile).map((item) => defaultModuleConfig(item, 'mobile')),
  }
  if (pageKey !== 'checkin') return config
  return {
    desktop: upgradeCheckInDefault(config.desktop, 'desktop'),
    tablet: upgradeCheckInDefault(config.tablet, 'tablet'),
    mobile: upgradeCheckInDefault(config.mobile, 'mobile'),
  }
}

function upgradeCheckInDefault(items: PageLayoutModuleConfig[], device: PageLayoutDevice) {
  const header = items.find((item) => item.key === 'checkin.header')
  const headerEnd = header ? header.grid[device].y + header.grid[device].h : 0
  const publicMessages = items.find((item) => item.key === 'checkin.publicMessages')
  const friendY = device === 'desktop'
    ? headerEnd
    : headerEnd + (publicMessages?.grid[device].h ?? 0)
  return items.map((item) => {
    if (item.key === 'checkin.publicMessages') return { ...item, grid: { ...item.grid, [device]: { ...item.grid[device], y: headerEnd } } }
    if (item.key === 'checkin.friendMessages') return { ...item, grid: { ...item.grid, [device]: { ...item.grid[device], y: friendY } } }
    return item
  })
}
