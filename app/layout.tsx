import type { Metadata } from 'next'
import { AppShell } from '@/components/layout/AppShell'
import { NotificationToast } from '@/components/NotificationToast'
import { VirtualKeyboardManager } from '@/components/VirtualKeyboardManager'
import { hasAdminPermission } from '@/lib/admin-permissions'
import { getSessionUserFromCookie } from '@/lib/auth'
import { publicImageUrl } from '@/lib/images'
import { getUnreadSummary } from '@/lib/notifications'
import { getSiteAppearance } from '@/lib/site-config'
import './globals.css'

export const metadata: Metadata = {
  title: '私家E院 | Eason Fans Club',
  description: '陈奕迅中文粉丝社区',
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const sessionUser = await getSessionUserFromCookie()
  const [appearance, unreadSummary, canManageLayout] = sessionUser ? await Promise.all([
    getSiteAppearance().catch(() => null),
    getUnreadSummary(sessionUser.id).catch(() => ({ total: 0 })),
    hasAdminPermission(sessionUser, 'layout.manage').catch(() => false),
  ]) : [null, { total: 0 }, false]
  const logoUrl = publicImageUrl(appearance?.images.navLogoUrl || appearance?.images.logoUrl)
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem('ecfc-theme');if(t!=='day'&&t!=='midnight')t=matchMedia('(prefers-color-scheme: dark)').matches?'midnight':'day';document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t==='midnight'?'dark':'light'}catch(e){}})()` }} />
      </head>
      <body>
        <VirtualKeyboardManager />
        <AppShell user={sessionUser} logoUrl={logoUrl} unreadCount={unreadSummary.total} canManageLayout={canManageLayout}>
          {children}
        </AppShell>
        <NotificationToast enabled={Boolean(sessionUser)} />
      </body>
    </html>
  )
}
