import { redirect } from 'next/navigation'
import { PageLayoutRenderer } from '@/components/page-layout/PageLayoutRenderer'
import { getCurrentUser } from '@/lib/auth'
import { listUnifiedNotificationsPage, parseNotificationCategory } from '@/lib/notifications'
import { getPublishedPageLayoutConfig } from '@/lib/page-layout/service'
import { getSiteAppearance } from '@/lib/site-config'
import { publicImageUrl } from '@/lib/images'
import { NotificationsClient } from './NotificationsClient'

export const dynamic = 'force-dynamic'
const NOTIFICATION_PAGE_SIZE = 20

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ page?: string; category?: string }> }) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  const params = await searchParams
  const page = Math.max(1, Number.parseInt(params.page || '1', 10) || 1)
  const category = parseNotificationCategory(params.category)

  const [notifications, layoutConfig, appearance] = await Promise.all([
    listUnifiedNotificationsPage(user.id, { page, pageSize: NOTIFICATION_PAGE_SIZE, category }),
    getPublishedPageLayoutConfig('message'),
    getSiteAppearance(),
  ])

  const siteLogoUrl = publicImageUrl(appearance.images.navLogoUrl || appearance.images.logoUrl)

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
              />
            ),
          }}
        />
      </main>
    </>
  )
}
