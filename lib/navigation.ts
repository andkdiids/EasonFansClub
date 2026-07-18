export function isMusicRoute(pathname: string) {
  return pathname === '/music' || pathname.startsWith('/music/')
}

export function isNavigationItemActive(pathname: string, href: string) {
  const target = href.split(/[?#]/)[0].replace(/\/$/, '') || '/'
  if (!target.startsWith('/')) return false
  if (target === '/') return pathname === '/'
  return pathname === target || pathname.startsWith(`${target}/`)
}
