import type { IconName } from '@/components/UiIcon'

/**
 * All user-facing navigation metadata lives here.
 *
 * A feature key is a permanent identity.  Labels, routes and visual order are
 * presentation details and must never be used as a preference key.
 */
export type NavigationSection = 'primary' | 'quick' | 'ecenter-only'

export type NavigationRegistryItem = {
  featureKey: string
  label: string
  href: string
  icon: Exclude<IconName, 'search' | 'edit' | 'grid' | 'menu' | 'arrow-up' | 'logout'>
  title: string
  defaultSortOrder: number
  defaultEnabled: boolean
  isManageable: boolean
  showInCenter: boolean
  showInQuickNavigation: boolean
  showInDesktopSidebar: boolean
  sidebarSection: NavigationSection
  mobile?: boolean
  editable: boolean
  hideable: boolean
  activePrefixes: readonly string[]
  showsUnread?: boolean
  requiresAdmin?: boolean
}

export const NAVIGATION_REGISTRY = [
  // Fixed bottom-navigation entries are also registered here so that their
  // identity and permissions cannot diverge from the desktop navigation.
  {
    featureKey: 'HOME', label: '首页', href: '/community', icon: 'home', title: '首页',
    defaultSortOrder: 1, defaultEnabled: true, isManageable: false,
    showInCenter: false, showInQuickNavigation: false, showInDesktopSidebar: true,
    sidebarSection: 'primary', mobile: true, editable: true, hideable: false,
    activePrefixes: ['/community', '/'],
  },
  {
    featureKey: 'FORUM', label: 'E院广场', href: '/forum', icon: 'forum', title: 'E院广场',
    defaultSortOrder: 2, defaultEnabled: true, isManageable: true,
    showInCenter: false, showInQuickNavigation: false, showInDesktopSidebar: true,
    sidebarSection: 'primary', mobile: true, editable: true, hideable: true,
    activePrefixes: ['/forum', '/boards', '/posts'],
  },
  {
    featureKey: 'MUSIC', label: 'EasMusic', href: '/music', icon: 'music', title: 'EasMusic',
    defaultSortOrder: 3, defaultEnabled: true, isManageable: true,
    showInCenter: false, showInQuickNavigation: false, showInDesktopSidebar: true,
    sidebarSection: 'primary', mobile: true, editable: true, hideable: true,
    activePrefixes: ['/music'],
  },
  {
    featureKey: 'TODAY', label: '今日', href: '/today', icon: 'archive', title: '历史上的今天',
    defaultSortOrder: 4, defaultEnabled: true, isManageable: true,
    showInCenter: true, showInQuickNavigation: false, showInDesktopSidebar: true,
    sidebarSection: 'primary', editable: true, hideable: true,
    activePrefixes: ['/today'],
  },
  {
    featureKey: 'ANYWHERE_DOOR', label: '随意门', href: '/anywhere-door', icon: 'archive', title: '随意门',
    defaultSortOrder: 5, defaultEnabled: true, isManageable: true,
    showInCenter: true, showInQuickNavigation: false, showInDesktopSidebar: true,
    sidebarSection: 'primary', editable: true, hideable: true,
    activePrefixes: ['/anywhere-door'],
  },
  {
    featureKey: 'ENTERTAINMENT', label: '娱乐天空', href: '/games', icon: 'star', title: '娱乐天空',
    defaultSortOrder: 6, defaultEnabled: true, isManageable: true,
    showInCenter: true, showInQuickNavigation: false, showInDesktopSidebar: true,
    sidebarSection: 'primary', editable: true, hideable: true,
    activePrefixes: ['/games', '/entertainment'],
  },
  {
    featureKey: 'CLINIC', label: '阿士匹灵门诊部', href: '/clinic', icon: 'stethoscope', title: '阿士匹灵门诊部',
    defaultSortOrder: 7, defaultEnabled: true, isManageable: true,
    showInCenter: true, showInQuickNavigation: false, showInDesktopSidebar: true,
    sidebarSection: 'primary', editable: true, hideable: true,
    activePrefixes: ['/clinic'],
  },
  {
    featureKey: 'RATINGS', label: '歌·颂', href: '/ratings', icon: 'chart', title: '歌·颂',
    defaultSortOrder: 8, defaultEnabled: true, isManageable: true,
    showInCenter: true, showInQuickNavigation: false, showInDesktopSidebar: true,
    sidebarSection: 'primary', editable: true, hideable: true,
    activePrefixes: ['/ratings'],
  },
  {
    featureKey: 'TRENDING_POSTS', label: '热门帖子', href: '/trending', icon: 'chart', title: '热门帖子',
    defaultSortOrder: 9, defaultEnabled: true, isManageable: true,
    showInCenter: true, showInQuickNavigation: false, showInDesktopSidebar: true,
    sidebarSection: 'primary', editable: true, hideable: true,
    activePrefixes: ['/trending'],
  },
  {
    featureKey: 'ACTIVITY_CENTER', label: '活动中心', href: '/activities', icon: 'calendar', title: '活动中心',
    defaultSortOrder: 10, defaultEnabled: true, isManageable: true,
    showInCenter: true, showInQuickNavigation: false, showInDesktopSidebar: true,
    sidebarSection: 'primary', editable: true, hideable: true,
    activePrefixes: ['/activities'],
  },
  {
    featureKey: 'STUDIO', label: '贝多芬与我', href: '/studio', icon: 'palette', title: '贝多芬与我',
    defaultSortOrder: 11, defaultEnabled: true, isManageable: true,
    showInCenter: true, showInQuickNavigation: true, showInDesktopSidebar: true,
    sidebarSection: 'primary', editable: true, hideable: true,
    activePrefixes: ['/studio'],
  },
  {
    featureKey: 'NOTIFICATIONS', label: '消息', href: '/notifications', icon: 'bell', title: '消息',
    defaultSortOrder: 11, defaultEnabled: true, isManageable: true,
    showInCenter: true, showInQuickNavigation: false, showInDesktopSidebar: true,
    sidebarSection: 'primary', editable: true, hideable: true, showsUnread: true,
    activePrefixes: ['/notifications'],
  },
  {
    featureKey: 'PROFILE', label: '我的', href: '/profile', icon: 'user', title: '我的',
    defaultSortOrder: 12, defaultEnabled: true, isManageable: false,
    showInCenter: false, showInQuickNavigation: false, showInDesktopSidebar: true,
    sidebarSection: 'primary', mobile: true, editable: true, hideable: false,
    activePrefixes: ['/profile', '/user', '/settings'],
  },
  {
    featureKey: 'ADMIN', label: '后台管理', href: '/admin', icon: 'settings', title: '后台管理',
    defaultSortOrder: 13, defaultEnabled: true, isManageable: true,
    showInCenter: true, showInQuickNavigation: false, showInDesktopSidebar: true,
    sidebarSection: 'primary', editable: true, hideable: true, requiresAdmin: true,
    activePrefixes: ['/admin'],
  },
  // This entry is intentionally not in the desktop sidebar.  It remains in
  // the registry and in the mobile E院中心 menu as an explicitly labelled
  // E院中心-only feature rather than being silently dropped by the editor.
  {
    featureKey: 'CREATE_POST', label: '发布帖子', href: '/posts/new', icon: 'forum', title: '发布帖子',
    defaultSortOrder: 14, defaultEnabled: true, isManageable: true,
    showInCenter: true, showInQuickNavigation: false, showInDesktopSidebar: false,
    sidebarSection: 'ecenter-only', editable: true, hideable: true,
    activePrefixes: ['/posts/new'],
  },
  {
    featureKey: 'CHECKIN', label: '每日挂号', href: '/checkin', icon: 'check', title: '每日挂号',
    defaultSortOrder: 15, defaultEnabled: true, isManageable: true,
    showInCenter: true, showInQuickNavigation: true, showInDesktopSidebar: true,
    sidebarSection: 'quick', editable: true, hideable: true,
    activePrefixes: ['/checkin'],
  },
  {
    featureKey: 'DAILY_PRESCRIPTION', label: '每日处方', href: '/games/daily-prescription', icon: 'pill', title: '每日处方',
    defaultSortOrder: 16, defaultEnabled: true, isManageable: true,
    showInCenter: true, showInQuickNavigation: true, showInDesktopSidebar: true,
    sidebarSection: 'quick', editable: true, hideable: true,
    activePrefixes: ['/games/daily-prescription', '/prescription/history'],
  },
  {
    featureKey: 'BADGE_MUSEUM', label: '勋章展览馆', href: '/badges', icon: 'archive', title: 'E院勋章展览馆',
    defaultSortOrder: 17, defaultEnabled: true, isManageable: true,
    showInCenter: true, showInQuickNavigation: true, showInDesktopSidebar: true,
    sidebarSection: 'quick', editable: true, hideable: true,
    activePrefixes: ['/badges'],
  },
  {
    featureKey: 'ANGEL_GIFT', label: '天使的礼物', href: '/angel-gift', icon: 'gift', title: '天使的礼物',
    defaultSortOrder: 18, defaultEnabled: true, isManageable: true,
    showInCenter: true, showInQuickNavigation: true, showInDesktopSidebar: true,
    sidebarSection: 'quick', editable: true, hideable: true,
    activePrefixes: ['/angel-gift'],
  },
  {
    featureKey: 'MATERIAL_REDEMPTIONS', label: '还有什么可以送给你', href: '/material-redemptions', icon: 'gift', title: '还有什么可以送给你',
    defaultSortOrder: 18, defaultEnabled: true, isManageable: true,
    showInCenter: true, showInQuickNavigation: true, showInDesktopSidebar: true,
    sidebarSection: 'quick', editable: true, hideable: true,
    activePrefixes: ['/material-redemptions'],
  },
  {
    featureKey: 'STICKERS', label: '表情包商店', href: '/stickers', icon: 'sticker', title: '表情包商店',
    defaultSortOrder: 19, defaultEnabled: true, isManageable: true,
    showInCenter: true, showInQuickNavigation: true, showInDesktopSidebar: true,
    sidebarSection: 'quick', editable: true, hideable: true,
    activePrefixes: ['/stickers', '/profile/stickers'],
  },
  {
    featureKey: 'FRIEND_ACTIVITY', label: '好友动态', href: '/friends/activity', icon: 'friends', title: '好友动态',
    defaultSortOrder: 20, defaultEnabled: true, isManageable: true,
    showInCenter: true, showInQuickNavigation: true, showInDesktopSidebar: true,
    sidebarSection: 'quick', editable: true, hideable: true,
    activePrefixes: ['/friends'],
  },
  {
    featureKey: 'FEEDBACK', label: '反馈与更新', href: '/feedback', icon: 'feedback', title: '反馈与更新',
    defaultSortOrder: 21, defaultEnabled: true, isManageable: true,
    showInCenter: true, showInQuickNavigation: true, showInDesktopSidebar: true,
    sidebarSection: 'quick', editable: true, hideable: true,
    activePrefixes: ['/feedback'],
  },
  {
    featureKey: 'SALON', label: '沙龙', href: '/salon', icon: 'camera', title: '沙龙',
    defaultSortOrder: 22, defaultEnabled: true, isManageable: true,
    showInCenter: true, showInQuickNavigation: true, showInDesktopSidebar: true,
    sidebarSection: 'quick', editable: true, hideable: true,
    activePrefixes: ['/salon'],
  },
] as const satisfies readonly NavigationRegistryItem[]

export type NavigationFeatureKey = (typeof NAVIGATION_REGISTRY)[number]['featureKey']
