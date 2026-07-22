import { redirect } from 'next/navigation'
import { PageLayoutRenderer } from '@/components/page-layout/PageLayoutRenderer'
import { getCurrentUser } from '@/lib/auth'
import { getUnreadNotificationCount, listUnifiedNotifications } from '@/lib/notifications'
import { getPublishedPageLayoutConfig } from '@/lib/page-layout/service'
import { NotificationsClient } from './NotificationsClient'

export const dynamic = 'force-dynamic'

export default async function NotificationsPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const [notifications, unreadCount, layoutConfig] = await Promise.all([
    listUnifiedNotifications(user.id, { limit: 50 }),
    getUnreadNotificationCount(user.id),
    getPublishedPageLayoutConfig('message'),
  ])

  return (
    <>
      <main className="site-page-main flat-page mx-auto max-w-7xl px-4 py-6 sm:px-5 sm:py-8">
        <PageLayoutRenderer
          pageKey="message"
          config={layoutConfig}
          modules={{
            'message.main': <NotificationsClient initialNotifications={notifications} initialUnreadCount={unreadCount} />,
          }}
        />
      </main>
    </>
  )
}
