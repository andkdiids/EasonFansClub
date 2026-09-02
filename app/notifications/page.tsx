import { redirect } from 'next/navigation'
import { hasAdminPermission } from '@/lib/admin-permissions'
import { getCurrentUser, getSessionUserFromCookie, isAuthServiceUnavailableError } from '@/lib/auth'
import { listUnifiedNotificationsPage, parseNotificationCategory } from '@/lib/notifications'
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
  const canReview = await hasAdminPermission(user).catch(() => false)
  const requestedCategory = parseNotificationCategory(params.category)
  const category = requestedCategory === 'review' && !canReview ? 'all' : requestedCategory

  const [notificationsResult, appearanceResult] = await Promise.allSettled([
    listUnifiedNotificationsPage(user.id, { page, pageSize: NOTIFICATION_PAGE_SIZE, category, canReview }),
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
          degraded: true,
          failed: true,
        }
      })()
  const appearance = appearanceResult.status === 'fulfilled'
    ? appearanceResult.value
    : (() => {
        logNotificationError('page.appearance', { userId: user.id }, appearanceResult.reason)
        return null
      })()
  const siteLogoUrl = appearance ? publicImageUrl(appearance.images.navLogoUrl || appearance.images.logoUrl) : null
  const initialPagination = notifications.failed || (notifications.degraded && notifications.items.length === 0)
    ? { page: 1, pageSize: notifications.pageSize, total: 0, totalPages: 1 }
    : {
        page: notifications.page,
        pageSize: notifications.pageSize,
        total: notifications.total,
        totalPages: notifications.totalPages,
      }
  const initialLoadError = notificationsResult.status === 'rejected' || notifications.failed || (notifications.degraded && notifications.items.length === 0)
    ? '通知加载失败，请重试'
    : null
  const initialLoadWarning = notificationsResult.status === 'fulfilled' && notifications.degraded && !notifications.failed && notifications.items.length > 0
    ? '部分通知暂时无法加载，请点击重试'
    : null

  return (
    <>
      <main className="site-page-main flat-page mx-auto max-w-7xl px-4 py-6 sm:px-5 sm:py-8">
        <NotificationsClient
          initialNotifications={notifications.items}
          initialPagination={initialPagination}
          initialCategory={category}
          canReview={canReview}
          siteLogoUrl={siteLogoUrl}
          initialLoadError={initialLoadError}
          initialLoadWarning={initialLoadWarning}
        />
      </main>
    </>
  )
}
