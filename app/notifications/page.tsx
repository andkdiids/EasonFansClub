import { redirect } from 'next/navigation'
import { PageLayoutRenderer } from '@/components/page-layout/PageLayoutRenderer'
import { SiteHeader } from '@/components/SiteHeader'
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
      <SiteHeader user={user} />
      <main className="mx-auto max-w-4xl px-5 py-8">
        <PageLayoutRenderer
          pageKey="message"
          config={layoutConfig}
          modules={{
            'message.main': (
              <>
                <section className="rounded-2xl border border-sky-100 bg-white/80 p-7 shadow-sm">
                  <p className="text-sm font-black uppercase text-brand-700">Notification Center</p>
                  <h1 className="mt-2 text-4xl font-black text-brand-950">通知中心</h1>
                  <p className="mt-3 text-sm font-bold text-slate-500">只有点击通知或标记已读后，通知才会变为已读。</p>
                </section>
                <NotificationsClient initialNotifications={notifications} initialUnreadCount={unreadCount} />
              </>
            ),
          }}
        />
      </main>
    </>
  )
}
