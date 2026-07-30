export type AppNavigationItem = {
  href: string
  label: string
  icon: 'home' | 'forum' | 'music' | 'calendar' | 'archive' | 'activity' | 'bell' | 'star' | 'check' | 'chart' | 'friends' | 'log' | 'feedback' | 'help' | 'user'
  activePrefixes?: string[]
  mobile?: boolean
  showsUnread?: boolean
}

export const primaryNavigation: AppNavigationItem[] = [
  { href: '/community', label: '首页', icon: 'home', mobile: true },
  { href: '/forum', label: 'E院广场', icon: 'forum', activePrefixes: ['/forum', '/boards', '/posts'], mobile: true },
  { href: '/music', label: 'EasMusic', icon: 'music', activePrefixes: ['/music'], mobile: true },
  { href: '/activities', label: '活动中心', icon: 'calendar', activePrefixes: ['/activities'] },
  { href: '/games', label: '娱乐天空', icon: 'star', activePrefixes: ['/games', '/entertainment'] },
  { href: '/notifications', label: '消息', icon: 'bell', activePrefixes: ['/notifications'], showsUnread: true },
  { href: '/profile', label: '我的', icon: 'user', activePrefixes: ['/profile', '/user', '/settings'], mobile: true },
  { href: '/trending', label: '热门帖子', icon: 'chart', activePrefixes: ['/trending'] },
]

export const quickNavigation: AppNavigationItem[] = [
  { href: '/checkin', label: '每日挂号', icon: 'check', activePrefixes: [] },
  { href: '/friends', label: '好友动态', icon: 'friends', activePrefixes: ['/friends'] },
  { href: '/feedback', label: '反馈与更新', icon: 'feedback', activePrefixes: ['/feedback'] },
]

export function isAppNavigationActive(pathname: string, item: AppNavigationItem) {
  const prefixes = item.activePrefixes || [item.href]
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}
