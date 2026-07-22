import type { Metadata } from 'next'
import { AppShell } from '@/components/layout/AppShell'
import { NotificationToast } from '@/components/NotificationToast'
import { VirtualKeyboardManager } from '@/components/VirtualKeyboardManager'
import { hasAdminPermission } from '@/lib/admin-permissions'
import { getCurrentUser, getSessionUserFromCookie } from '@/lib/auth'
import { calculateGrowthSummary, defaultGrowthLevels, getGrowthSummary } from '@/lib/growth'
import { publicImageUrl } from '@/lib/images'
import { getUnreadNotificationCount } from '@/lib/notifications'
import { getSiteAppearance } from '@/lib/site-config'
import './globals.css'

export const metadata: Metadata = {
  title: '私家E院 | Eason Fans Club',
  description: '陈奕迅中文粉丝社区',
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const cookieUser = await getSessionUserFromCookie()
  const sessionUser = cookieUser ? await getCurrentUser().catch(() => cookieUser) : null
  const fallbackGrowth = calculateGrowthSummary(sessionUser?.experience || 0, [...defaultGrowthLevels])
  const [appearance, unreadCount, canManageLayout, canAccessAdmin, growth] = sessionUser ? await Promise.all([
    getSiteAppearance().catch(() => null),
    getUnreadNotificationCount(sessionUser.id).catch(() => 0),
    hasAdminPermission(sessionUser, 'layout.manage').catch(() => false),
    hasAdminPermission(sessionUser).catch(() => false),
    getGrowthSummary(sessionUser.experience || 0).catch(() => fallbackGrowth),
  ]) : [null, 0, false, false, fallbackGrowth]
  const logoUrl = publicImageUrl(appearance?.images.navLogoUrl || appearance?.images.logoUrl)
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem('ecfc-theme');if(t!=='day'&&t!=='midnight')t=matchMedia('(prefers-color-scheme: dark)').matches?'midnight':'day';document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t==='midnight'?'dark':'light'}catch(e){}})()` }} />
      </head>
      <body>
        <VirtualKeyboardManager />
        <AppShell user={sessionUser} growth={growth} logoUrl={logoUrl} unreadCount={unreadCount} canManageLayout={canManageLayout} canAccessAdmin={canAccessAdmin}>
          {children}
        </AppShell>
        <NotificationToast enabled={Boolean(sessionUser)} />
      </body>
    </html>
  )
}
