import Link from 'next/link'
import { isAdminUser } from '@/lib/admin-permissions'
import { getCurrentUser, type SessionUser } from '@/lib/auth'
import { safeDb } from '@/lib/db-timeout'
import { publicImageUrl } from '@/lib/images'
import { getUnreadNotificationCount } from '@/lib/notifications'
import { prisma } from '@/lib/prisma'
import { getSiteAppearance, type SiteAppearanceConfig } from '@/lib/site-config'
import { formatUid } from '@/lib/uid'

type SiteHeaderProps = {
  user?: SessionUser | null
  config?: SiteAppearanceConfig
}

export async function SiteHeader({ user: providedUser, config: providedConfig }: SiteHeaderProps = {}) {
  const user = providedUser !== undefined ? providedUser : await getCurrentUser()
  const config = providedConfig ?? (await getSiteAppearance())
  const navItems = config.nav.filter((item) => item.isVisible).sort((a, b) => a.sortOrder - b.sortOrder)
  const isAdmin = Boolean(user && isAdminUser(user))
  const [profile, unreadCount] = user
    ? await Promise.all([
        safeDb(
          'header.profile',
          prisma.profile.findUnique({
            where: { userId: user.id },
            select: { avatarUrl: true, displayName: true },
          }),
          null,
        ),
        safeDb('header.notifications.unread', getUnreadNotificationCount(user.id), 0),
      ])
    : [null, 0]

  const displayName = profile?.displayName || user?.nickname || ''
  const avatar = publicImageUrl(profile?.avatarUrl)
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
            <details className="relative shrink-0">
              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-full bg-sky-50 px-2 py-1 pr-3">
                <span className="grid h-9 w-9 place-items-center overflow-hidden rounded-full bg-brand-950 text-sm font-black text-white">
                  {avatar ? <img src={avatar} alt={displayName} className="h-full w-full object-cover" /> : displayName.slice(0, 1)}
                </span>
                {unreadCount > 0 ? <span className="absolute left-8 top-1 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-white" aria-label="有未读通知" /> : null}
                <span className="hidden max-w-28 truncate text-sm font-black text-brand-950 sm:block">{displayName}</span>
              </summary>
              <div className="absolute right-0 mt-3 w-56 rounded-2xl border border-sky-100 bg-white p-2 shadow-xl shadow-sky-900/10">
                <Link href={`/user/${formatUid(user.uid)}`} className="block rounded-xl px-4 py-3 text-sm font-bold text-slate-700 hover:bg-sky-50">个人主页</Link>
                <Link href="/notifications" className="flex items-center justify-between rounded-xl px-4 py-3 text-sm font-bold text-slate-700 hover:bg-sky-50">
                  <span>通知中心</span>
                  {unreadCount > 0 ? <span className="rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-black text-white">{unreadCount > 99 ? '99+' : unreadCount}</span> : null}
                </Link>
                <Link href="/feedback" className="block rounded-xl px-4 py-3 text-sm font-bold text-slate-700 hover:bg-sky-50">反馈与更新</Link>
                <Link href="/friends" className="block rounded-xl px-4 py-3 text-sm font-bold text-slate-700 hover:bg-sky-50">我的好友</Link>
                <Link href="/profile" className="block rounded-xl px-4 py-3 text-sm font-bold text-slate-700 hover:bg-sky-50">账号设置</Link>
                {isAdmin ? <Link href="/admin" className="block rounded-xl px-4 py-3 text-sm font-bold text-brand-700 hover:bg-sky-50">后台管理</Link> : null}
                <form action="/api/auth/logout" method="post">
                  <button className="w-full rounded-xl px-4 py-3 text-left text-sm font-bold text-red-600 hover:bg-red-50">退出登录</button>
                </form>
              </div>
            </details>
          ) : (
            <div className="flex shrink-0 items-center gap-2">
              <Link href="/login" className="rounded-full px-3 py-2 text-sm font-black text-slate-700 hover:bg-sky-50">登录</Link>
              <Link href="/register" className="rounded-full bg-brand-700 px-4 py-2 text-sm font-black text-white">注册</Link>
            </div>
          )}
        </div>
      </header>

      <nav className="fixed inset-x-3 bottom-3 z-30 grid grid-cols-5 gap-1 rounded-[24px] border border-sky-100 bg-white/92 p-2 shadow-2xl shadow-sky-900/10 backdrop-blur-xl md:hidden">
        {mobileNav.map((item) => (
          <Link key={item.href} href={item.href} title={item.title || item.label} className="flex min-h-12 flex-col items-center justify-center rounded-2xl text-brand-950 hover:bg-sky-50">
            <span className="text-lg" aria-hidden>{item.icon}</span>
            <span className="mt-0.5 max-w-full truncate text-[10px] font-black">{item.label}</span>
          </Link>
        ))}
      </nav>
    </>
  )
}
