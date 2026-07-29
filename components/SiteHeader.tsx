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
import { BrandMark } from '@/components/BrandMark'

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
  const unreadSummary = user ? await measureBootstrap('header.notifications.unread', getUnreadSummary(user.id)).catch(() => ({
    notifications: 0, system: 0, replies: 0, likes: 0, feedbackReplies: 0, feedback: 0, friendRequests: 0, directMessages: 0, messages: 0, total: 0,
  })) : null
  const navItems = config.nav.filter((item) => item.isVisible).sort((a, b) => a.sortOrder - b.sortOrder)
  const isAdmin = Boolean(user && isAdminUser(user))
  const displayName = user?.nickname || ''
  const navLogo = publicImageUrl(config.images.navLogoUrl)
  const mobileNav = navItems.slice(0, 5)

  return (
    <>
      <SiteHeaderFrame>
        <div className="site-header-inner mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/community" className="site-header-brand min-w-0 shrink-0" title={config.text.siteName}>
            <BrandMark logoUrl={navLogo} compact />
          </Link>

          <DesktopSiteNavigation items={navItems} isAdmin={isAdmin} />

          {user ? (
            <UserNotificationMenu currentUserId={user.id} displayName={displayName} avatarUrl={user.avatarUrl} isAdmin={isAdmin} initialSummary={unreadSummary!} />
          ) : (
            <div className="flex shrink-0 items-center gap-2">
              <Link href="/login" className="site-header-auth-link flat-button-secondary">登录</Link>
              <Link href="/register" className="flat-button-primary">注册</Link>
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
