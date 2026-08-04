import { redirect } from 'next/navigation'
import { PageLayoutRenderer } from '@/components/page-layout/PageLayoutRenderer'
import { getCurrentUser } from '@/lib/auth'
import { listUnifiedNotifications } from '@/lib/notifications'
import { getPublishedPageLayoutConfig } from '@/lib/page-layout/service'
import { NotificationsClient } from './NotificationsClient'

export const dynamic = 'force-dynamic'

export default async function NotificationsPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const [notifications, layoutConfig] = await Promise.all([
    listUnifiedNotifications(user.id, { limit: 50 }),
    getPublishedPageLayoutConfig('message'),
  ])

  return (
    <>
      <main className="site-page-main flat-page mx-auto max-w-7xl px-4 py-6 sm:px-5 sm:py-8">
        <PageLayoutRenderer
          pageKey="message"
          config={layoutConfig}
          modules={{
            'message.main': <NotificationsClient initialNotifications={notifications} />,
          }}
        />
      </main>
    </>
  )
}
