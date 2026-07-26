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
  { href: '/music', label: 'EasMusic', icon: 'music', activePrefixes: ['/music'] },
  { href: '/activities', label: '演唱会', icon: 'calendar', activePrefixes: ['/activities'] },
  { href: '/entertainment', label: '娱乐中心', icon: 'star', activePrefixes: ['/entertainment'] },
  { href: '/notifications', label: '消息', icon: 'bell', activePrefixes: ['/notifications'], mobile: true, showsUnread: true },
  { href: '/profile', label: '我的', icon: 'user', activePrefixes: ['/profile', '/user', '/settings'], mobile: true },
  { href: '/rankings', label: '排行榜', icon: 'chart', activePrefixes: ['/rankings'] },
]

export const quickNavigation: AppNavigationItem[] = [
  { href: '/checkin', label: '每日挂号', icon: 'check', activePrefixes: [] },
  { href: '/friends', label: '好友动态', icon: 'friends', activePrefixes: ['/friends'] },
  { href: '/feedback#updates', label: '更新日志', icon: 'log', activePrefixes: [] },
  { href: '/feedback', label: '反馈中心', icon: 'feedback', activePrefixes: ['/feedback'] },
]

export function isAppNavigationActive(pathname: string, item: AppNavigationItem) {
  const prefixes = item.activePrefixes || [item.href]
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}
