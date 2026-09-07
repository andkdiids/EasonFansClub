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

// 移动端标准响应式 viewport（Next.js 官方 metadata 单一来源，勿再手动插入
// 第二个 <meta name="viewport">）：
// - width=device-width + initialScale=1：页面严格按设备宽度渲染（不出现桌面
//   980px 布局），375/390/412px 各按其自身 viewport 布局；
// - maximumScale=1 + userScalable=false：禁用双指把整页缩小成“桌面小页面”；
// - interactiveWidget='resizes-content'：Android Chrome/微信 XWeb 等动态地址栏
//   变化时布局视口跟随可视区重排，保证 fixed 底部导航首帧即在可视区底、
//   不会被地址栏/工具栏推出屏幕（旧内核忽略该字段，无副作用）。
// 桌面浏览器不执行 viewport 缩放指令，桌面端零影响。
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  interactiveWidget: 'resizes-content',
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
  const [appearance, canAccessAdmin, growth] = sessionUser ? await Promise.all([
    getSiteAppearance().catch(() => null),
    hasAdminPermission(sessionUser).catch(() => false),
    getGrowthSummary(sessionUser.experience || 0).catch(() => fallbackGrowth),
  ]) : [null, false, fallbackGrowth]
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
    equippedBadges: sessionUser.equippedBadges,
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
            <AppShell user={shellUser} growth={growth} logoUrl={logoUrl} canAccessAdmin={canAccessAdmin} ecenterFeatures={ecenterFeatures}>
              {children}
            </AppShell>
          </MusicPlayerProvider>
        </NotificationProvider>
        <NotificationToast enabled={Boolean(sessionUser)} />
      </body>
    </html>
  )
}
