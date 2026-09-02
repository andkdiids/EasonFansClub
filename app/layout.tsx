import type { Metadata, Viewport } from 'next'
import { AppShell } from '@/components/layout/AppShell'
import { AuthSessionRestore } from '@/components/AuthSessionRestore'
import { DisableNativeImageDrag } from '@/components/DisableNativeImageDrag'
import { NotificationProvider } from '@/components/NotificationProvider'
import { NotificationToast } from '@/components/NotificationToast'
import { PerformanceAudit } from '@/components/PerformanceAudit'
import { MusicPlayerProvider } from '@/components/music/MusicPlayerProvider'
import { VirtualKeyboardManager } from '@/components/VirtualKeyboardManager'
import { hasAdminPermission } from '@/lib/admin-permissions'
import { getCurrentUser, getSessionUserFromCookie, isAuthServiceUnavailableError } from '@/lib/auth'
import { calculateGrowthSummary, defaultGrowthLevels, getGrowthSummary } from '@/lib/growth'
import { publicImageUrl } from '@/lib/images'
import { getUnreadSummary, type UnreadSummary } from '@/lib/notifications'
import { logNotificationError } from '@/lib/notification-errors'
import { getSiteAppearance } from '@/lib/site-config'
import { getEcenterFeaturesForUser } from '@/lib/ecenter-features'
import { buildPageMetadata, SITE_DESCRIPTION, SITE_TITLE } from '@/lib/share-metadata'
import { WECHAT_SHARE_IMAGE_PATH } from '@/lib/wechat-share-image'
import './globals.css'

// The root shell reads the request session and runtime site configuration.
// Keep its metadata and authenticated shell out of build-time prerendering.
export const dynamic = 'force-dynamic'

export const viewport: Viewport = {
  themeColor: '#0f5f8f',
  colorScheme: 'light dark',
}

export function generateMetadata(): Metadata {
  return {
    ...buildPageMetadata({
      title: SITE_TITLE,
      description: SITE_DESCRIPTION,
      canonical: '/',
      imageUrl: WECHAT_SHARE_IMAGE_PATH,
    }),
    manifest: '/manifest.webmanifest',
    appleWebApp: {
      capable: true,
      title: '私家E院',
      statusBarStyle: 'default',
    },
  }
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const cookieUser = await getSessionUserFromCookie()
  const sessionUser = cookieUser ? await getCurrentUser().catch((error) => {
    if (!isAuthServiceUnavailableError(error)) throw error
    // Keep the JWT-backed shell during a temporary user lookup outage. This is
    // deliberate degraded UI, never an anonymous/null fallback that can cause
    // a later click to redirect a valid session to /login.
    logNotificationError('layout.auth-degraded', { userId: cookieUser.id }, error)
    return cookieUser
  }) : null
  const fallbackGrowth = calculateGrowthSummary(sessionUser?.experience || 0, [...defaultGrowthLevels])
  const emptyUnreadSummary = { notifications: 0, system: 0, replies: 0, likes: 0, wall: 0, feedbackReplies: 0, feedback: 0, friendRequests: 0, directMessages: 0, messages: 0, review: 0, total: 0 }
  const [appearance, canManageLayout, canAccessAdmin, growth] = sessionUser ? await Promise.all([
    getSiteAppearance().catch(() => null),
    hasAdminPermission(sessionUser, 'layout.manage').catch(() => false),
    hasAdminPermission(sessionUser).catch(() => false),
    getGrowthSummary(sessionUser.experience || 0).catch(() => fallbackGrowth),
  ]) : [null, false, false, fallbackGrowth]
  const unreadSummary: UnreadSummary | null = sessionUser
    ? await getUnreadSummary(sessionUser.id, Boolean(canAccessAdmin)).catch((error) => {
        logNotificationError('layout.unread-summary', { userId: sessionUser.id }, error)
        // Do not turn an unavailable core query into a false "0 unread" badge.
        // The client provider keeps the summary unavailable until a later
        // authoritative refresh succeeds.
        return null
      })
    : emptyUnreadSummary
  const ecenterFeatures = sessionUser ? await getEcenterFeaturesForUser(Boolean(canAccessAdmin), sessionUser.id) : []
  const logoUrl = publicImageUrl(appearance?.images.navLogoUrl || appearance?.images.logoUrl)
  const shellUser = sessionUser ? {
    id: sessionUser.id,
    uid: sessionUser.uid,
    nickname: sessionUser.nickname,
    avatarUrl: sessionUser.avatarUrl,
    equippedBadge: sessionUser.equippedBadge,
  } : null
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem('ecfc-theme');if(t!=='day'&&t!=='midnight')t=window.matchMedia('(prefers-color-scheme: dark)').matches?'midnight':'day';document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t==='midnight'?'dark':'light';var m=window.matchMedia('(max-width: 767px)').matches;var p=window.location.pathname;if(m&&p!=='/posts/new'&&/^\\/posts\\/[^/]+$/.test(p))document.documentElement.dataset.forumDetailDiscover='true'}catch(e){}})()` }} />
      </head>
      <body>
        <DisableNativeImageDrag />
        <PerformanceAudit />
        <AuthSessionRestore initialUserId={sessionUser?.id || null} />
        <VirtualKeyboardManager />
        <NotificationProvider userId={sessionUser?.id || null} initialSummary={unreadSummary}>
          <MusicPlayerProvider>
            <AppShell user={shellUser} growth={growth} logoUrl={logoUrl} canManageLayout={canManageLayout} canAccessAdmin={canAccessAdmin} ecenterFeatures={ecenterFeatures}>
              {children}
            </AppShell>
          </MusicPlayerProvider>
        </NotificationProvider>
        <NotificationToast enabled={Boolean(sessionUser)} />
      </body>
    </html>
  )
}
