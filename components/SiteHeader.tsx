import Link from 'next/link'
import { Suspense } from 'react'
import { AdminLayoutQuickLink } from '@/components/AdminLayoutQuickLink'
import { hasAdminPermission, isAdminUser } from '@/lib/admin-permissions'
import { getCurrentUser, type SessionUser } from '@/lib/auth'
import { measureBootstrap } from '@/lib/bootstrap-timing'
import { publicImageUrl } from '@/lib/images'
import { getUnreadSummary } from '@/lib/notifications'
import { UserNotificationMenu } from '@/components/UserNotificationMenu'
import { getSiteAppearance, type SiteAppearanceConfig } from '@/lib/site-config'

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
      <header className="sticky top-0 z-30 border-b border-sky-100/80 bg-white/88 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-5 sm:py-4">
          <Link href="/" className="flex min-w-0 shrink-0 items-center gap-3 text-lg font-black text-brand-950 sm:text-xl" title={config.text.siteName}>
            {navLogo ? <img src={navLogo} alt={config.text.siteName} className="h-9 w-9 rounded-2xl object-cover sm:h-10 sm:w-10" /> : null}
            <span className="truncate">{config.text.siteName}</span>
          </Link>

          <nav className="hidden min-w-0 flex-1 items-center justify-center gap-2 overflow-x-auto text-sm font-bold text-slate-700 md:flex">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                title={item.title || item.label}
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-transparent text-lg text-brand-950 transition hover:border-sky-100 hover:bg-sky-50"
              >
                <span aria-hidden>{item.icon}</span>
                <span className="sr-only">{item.label}</span>
              </Link>
            ))}
            {isAdmin ? (
              <Link href="/admin" title="后台" className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-lg text-brand-700 hover:bg-sky-50">
                <span aria-hidden>⚙</span>
                <span className="sr-only">后台</span>
              </Link>
            ) : null}
          </nav>

          {user ? (
            <UserNotificationMenu displayName={displayName} avatarUrl={user.avatarUrl} isAdmin={isAdmin} initialSummary={unreadSummary!} />
          ) : (
            <div className="flex shrink-0 items-center gap-2">
              <Link href="/login" className="rounded-full px-3 py-2 text-sm font-black text-slate-700 hover:bg-sky-50">登录</Link>
              <Link href="/register" className="rounded-full bg-brand-700 px-4 py-2 text-sm font-black text-white">注册</Link>
            </div>
          )}
        </div>
      </header>

      <nav data-mobile-main-nav className="fixed inset-x-3 bottom-3 z-30 grid grid-cols-5 gap-1 rounded-[24px] border border-sky-100 bg-white/92 p-2 shadow-2xl shadow-sky-900/10 backdrop-blur-xl transition md:hidden">
        {mobileNav.map((item) => (
          <Link key={item.href} href={item.href} title={item.title || item.label} className="flex min-h-12 flex-col items-center justify-center rounded-2xl text-brand-950 hover:bg-sky-50">
            <span className="text-lg" aria-hidden>{item.icon}</span>
            <span className="mt-0.5 max-w-full truncate text-[10px] font-black">{item.label}</span>
          </Link>
        ))}
      </nav>
      {user ? (
        <Suspense fallback={null}>
          <HeaderLayoutQuickLink user={user} />
        </Suspense>
      ) : null}
    </>
  )
}
