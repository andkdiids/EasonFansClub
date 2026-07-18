import Link from 'next/link'
import { Suspense } from 'react'
import { AdminLayoutQuickLink } from '@/components/AdminLayoutQuickLink'
import { hasAdminPermission, isAdminUser } from '@/lib/admin-permissions'
import { getCurrentUser, type SessionUser } from '@/lib/auth'
import { measureBootstrap } from '@/lib/bootstrap-timing'
import { publicImageUrl } from '@/lib/images'
import { getUnreadSummary } from '@/lib/notifications'
import { UserNotificationMenu } from '@/components/UserNotificationMenu'
import { SiteHeaderFrame } from '@/components/SiteHeaderFrame'
import { getSiteAppearance, type SiteAppearanceConfig } from '@/lib/site-config'
import { DesktopSiteNavigation, MobileSiteNavigation } from '@/components/SiteNavigation'

type SiteHeaderProps = {
  user?: SessionUser | null
  config?: SiteAppearanceConfig
}

async function HeaderLayoutQuickLink({ user }: { user: SessionUser }) {
  const canManageLayout = await measureBootstrap('header.layoutPermission', hasAdminPermission(user, 'layout.manage'))
  return <AdminLayoutQuickLink enabled={canManageLayout} />
}

export async function SiteHeader({ user: providedUser, config: providedConfig }: SiteHeaderProps = {}) {
  const [user, config] = await Promise.all([
    providedUser !== undefined ? Promise.resolve(providedUser) : getCurrentUser(),
    providedConfig ? Promise.resolve(providedConfig) : measureBootstrap('site.appearance', getSiteAppearance()),
  ])
  const unreadSummary = user ? await measureBootstrap('header.notifications.unread', getUnreadSummary(user.id)).catch(() => ({ notifications: 0, feedbackReplies: 0, friendRequests: 0, directMessages: 0, total: 0 })) : null
  const navItems = config.nav.filter((item) => item.isVisible).sort((a, b) => a.sortOrder - b.sortOrder)
  const isAdmin = Boolean(user && isAdminUser(user))
  const displayName = user?.nickname || ''
  const navLogo = publicImageUrl(config.images.navLogoUrl)
  const mobileNav = navItems.slice(0, 5)

  return (
    <>
      <SiteHeaderFrame>
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2 sm:px-5 sm:py-4">
          <Link href="/" className="site-header-brand flex min-w-0 shrink-0 items-center gap-3 text-lg font-black text-brand-950 transition-colors duration-500 sm:text-xl" title={config.text.siteName}>
            {navLogo ? <img src={navLogo} alt={config.text.siteName} className="h-9 w-9 rounded-2xl object-cover sm:h-10 sm:w-10" /> : null}
            <span className="truncate">{config.text.siteName}</span>
          </Link>

          <DesktopSiteNavigation items={navItems} isAdmin={isAdmin} />

          {user ? (
            <UserNotificationMenu displayName={displayName} avatarUrl={user.avatarUrl} isAdmin={isAdmin} initialSummary={unreadSummary!} />
          ) : (
            <div className="flex shrink-0 items-center gap-2">
              <Link href="/login" className="site-header-auth-link rounded-full px-3 py-2 text-sm font-black text-slate-700 transition-colors hover:bg-sky-50">登录</Link>
              <Link href="/register" className="rounded-full bg-brand-700 px-4 py-2 text-sm font-black text-white">注册</Link>
            </div>
          )}
        </div>
      </SiteHeaderFrame>

      <MobileSiteNavigation items={mobileNav} />
      {user ? (
        <Suspense fallback={null}>
          <HeaderLayoutQuickLink user={user} />
        </Suspense>
      ) : null}
    </>
  )
}
