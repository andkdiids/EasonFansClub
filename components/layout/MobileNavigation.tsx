'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { UiIcon } from '@/components/UiIcon'
import { isAppNavigationActive, primaryNavigation } from './navigation'

export function MobileNavigation({ unreadCount }: Readonly<{ unreadCount: number }>) {
  const pathname = usePathname()
  const items = primaryNavigation.filter((item) => item.mobile)
  const first = items.slice(0, 2)
  const last = items.slice(2)
  const renderItem = (item: (typeof items)[number]) => <Link key={item.href} href={item.href} aria-current={isAppNavigationActive(pathname, item) ? 'page' : undefined} className={item.showsUnread ? 'mobile-notifications' : undefined}>
    <UiIcon name={item.icon} />{item.showsUnread && unreadCount > 0 ? <b>{unreadCount}</b> : null}<span>{item.label}</span>
  </Link>
  return <nav data-mobile-main-nav className="app-mobile-nav" aria-label="移动端导航">
    {first.map(renderItem)}
    <Link href="/posts/new" className="mobile-publish" aria-label="发布帖子"><UiIcon name="edit" /></Link>
    {last.map(renderItem)}
  </nav>
}
