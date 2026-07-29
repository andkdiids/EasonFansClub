import type { Metadata } from 'next'
import { AppShell } from '@/components/layout/AppShell'
import { NotificationToast } from '@/components/NotificationToast'
import { MusicPlayerProvider } from '@/components/music/MusicPlayerProvider'
import { VirtualKeyboardManager } from '@/components/VirtualKeyboardManager'
import { hasAdminPermission } from '@/lib/admin-permissions'
import { getCurrentUser, getSessionUserFromCookie } from '@/lib/auth'
import { calculateGrowthSummary, defaultGrowthLevels, getGrowthSummary } from '@/lib/growth'
import { publicImageUrl } from '@/lib/images'
import { getUnreadSummary } from '@/lib/notifications'
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
  const emptyUnreadSummary = { notifications: 0, system: 0, replies: 0, likes: 0, feedbackReplies: 0, feedback: 0, friendRequests: 0, directMessages: 0, messages: 0, total: 0 }
  const [appearance, unreadSummary, canManageLayout, canAccessAdmin, growth] = sessionUser ? await Promise.all([
    getSiteAppearance().catch(() => null),
    getUnreadSummary(sessionUser.id).catch(() => emptyUnreadSummary),
    hasAdminPermission(sessionUser, 'layout.manage').catch(() => false),
    hasAdminPermission(sessionUser).catch(() => false),
    getGrowthSummary(sessionUser.experience || 0).catch(() => fallbackGrowth),
  ]) : [null, emptyUnreadSummary, false, false, fallbackGrowth]
  const logoUrl = publicImageUrl(appearance?.images.navLogoUrl || appearance?.images.logoUrl)
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem('ecfc-theme');if(t!=='day'&&t!=='midnight')t='day';document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t==='midnight'?'dark':'light'}catch(e){}})()` }} />
      </head>
      <body>
        <VirtualKeyboardManager />
        <MusicPlayerProvider>
          <AppShell user={sessionUser} growth={growth} logoUrl={logoUrl} unreadSummary={unreadSummary} canManageLayout={canManageLayout} canAccessAdmin={canAccessAdmin}>
            {children}
          </AppShell>
        </MusicPlayerProvider>
        <NotificationToast enabled={Boolean(sessionUser)} />
      </body>
    </html>
  )
}
