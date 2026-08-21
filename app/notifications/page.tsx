import { redirect } from 'next/navigation'
import { PageLayoutRenderer } from '@/components/page-layout/PageLayoutRenderer'
import { getCurrentUser, getSessionUserFromCookie, isAuthServiceUnavailableError } from '@/lib/auth'
import { listUnifiedNotificationsPage, parseNotificationCategory } from '@/lib/notifications'
import { getPublishedPageLayoutConfig } from '@/lib/page-layout/service'
import { getDefaultPageLayoutConfig } from '@/lib/page-layout/registry'
import { getSiteAppearance } from '@/lib/site-config'
import { publicImageUrl } from '@/lib/images'
import { logNotificationError } from '@/lib/notification-errors'
import { NotificationsClient } from './NotificationsClient'

export const dynamic = 'force-dynamic'
const NOTIFICATION_PAGE_SIZE = 20

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ page?: string; category?: string }> }) {
  const cookieUser = await getSessionUserFromCookie()
  const user = cookieUser
    ? await getCurrentUser().catch((error) => {
        if (!isAuthServiceUnavailableError(error)) throw error
        logNotificationError('page.auth', { userId: cookieUser.id }, error)
        return cookieUser
      })
    : null
  if (!user) redirect('/login')
  const params = await searchParams
  const page = Math.max(1, Number.parseInt(params.page || '1', 10) || 1)
  const category = parseNotificationCategory(params.category)

  const [notificationsResult, layoutResult, appearanceResult] = await Promise.allSettled([
    listUnifiedNotificationsPage(user.id, { page, pageSize: NOTIFICATION_PAGE_SIZE, category }),
    getPublishedPageLayoutConfig('message'),
    getSiteAppearance(),
  ])

  const notifications = notificationsResult.status === 'fulfilled'
    ? notificationsResult.value
    : (() => {
        logNotificationError('page.list', { userId: user.id, page, pageSize: NOTIFICATION_PAGE_SIZE, category }, notificationsResult.reason)
        return {
          items: [],
          total: 0,
          page,
          pageSize: NOTIFICATION_PAGE_SIZE,
          totalPages: 1,
          unreadCount: 0,
          degraded: true,
          failed: true,
        }
      })()
  const layoutConfig = layoutResult.status === 'fulfilled'
    ? layoutResult.value
    : (() => {
        logNotificationError('page.layout', { userId: user.id, pageKey: 'message' }, layoutResult.reason)
        return getDefaultPageLayoutConfig('message')
      })()
  const appearance = appearanceResult.status === 'fulfilled'
    ? appearanceResult.value
    : (() => {
        logNotificationError('page.appearance', { userId: user.id }, appearanceResult.reason)
        return null
      })()
  const siteLogoUrl = appearance ? publicImageUrl(appearance.images.navLogoUrl || appearance.images.logoUrl) : null
  const initialLoadError = notificationsResult.status === 'rejected' || notifications.failed
    ? '通知加载失败，请重试'
    : null
  const initialLoadWarning = notificationsResult.status === 'fulfilled' && notifications.degraded && !notifications.failed
    ? '部分通知暂时无法加载，请点击重试'
    : null

  return (
    <>
      <main className="site-page-main flat-page mx-auto max-w-7xl px-4 py-6 sm:px-5 sm:py-8">
        <PageLayoutRenderer
          pageKey="message"
          config={layoutConfig}
          modules={{
            'message.main': (
              <NotificationsClient
                initialNotifications={notifications.items}
                initialPagination={{
                  page: notifications.page,
                  pageSize: notifications.pageSize,
                  total: notifications.total,
                  totalPages: notifications.totalPages,
                }}
                initialCategory={category}
                siteLogoUrl={siteLogoUrl}
                initialLoadError={initialLoadError}
                initialLoadWarning={initialLoadWarning}
              />
            ),
          }}
        />
      </main>
    </>
  )
}
