export type AppNavigationItem = {
  href: string
  label: string
  icon: 'home' | 'forum' | 'music' | 'calendar' | 'archive' | 'activity' | 'bell' | 'star' | 'check' | 'chart' | 'friends' | 'log' | 'feedback' | 'help' | 'user' | 'sticker' | 'stethoscope' | 'pill'
  activePrefixes?: string[]
  mobile?: boolean
  showsUnread?: boolean
  children?: AppNavigationItem[]
}

export const primaryNavigation: AppNavigationItem[] = [
  { href: '/community', label: '首页', icon: 'home', mobile: true },
  { href: '/forum', label: 'E院广场', icon: 'forum', activePrefixes: ['/forum', '/boards', '/posts'], mobile: true },
  { href: '/music', label: 'EasMusic', icon: 'music', activePrefixes: ['/music'], mobile: true },
  { href: '/today', label: '今日', icon: 'archive', activePrefixes: ['/today'] },
  { href: '/games', label: '娱乐天空', icon: 'star', activePrefixes: ['/games', '/entertainment'] },
  { href: '/clinic', label: '阿士匹灵门诊部', icon: 'stethoscope', activePrefixes: ['/clinic'] },
  { href: '/ratings', label: '歌·颂', icon: 'music', activePrefixes: ['/ratings'] },
  { href: '/activities', label: '活动中心', icon: 'calendar', activePrefixes: ['/activities'] },
  { href: '/notifications', label: '消息', icon: 'bell', activePrefixes: ['/notifications'], showsUnread: true },
  { href: '/profile', label: '我的', icon: 'user', activePrefixes: ['/profile', '/user', '/settings'], mobile: true },
]

export const quickNavigation: AppNavigationItem[] = [
  { href: '/checkin', label: '每日挂号', icon: 'check', activePrefixes: [] },
  { href: '/friends', label: '好友动态', icon: 'friends', activePrefixes: ['/friends'] },
  { href: '/stickers', label: '表情包商店', icon: 'sticker', activePrefixes: ['/stickers', '/profile/stickers'] },
  { href: '/feedback', label: '反馈与更新', icon: 'feedback', activePrefixes: ['/feedback'] },
]

export function isAppNavigationActive(pathname: string, item: AppNavigationItem) {
  const prefixes = item.activePrefixes || [item.href]
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}
