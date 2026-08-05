import { redirect } from 'next/navigation'
import { PageLayoutRenderer } from '@/components/page-layout/PageLayoutRenderer'
import { getCurrentUser } from '@/lib/auth'
import { listUnifiedNotifications } from '@/lib/notifications'
import { getPublishedPageLayoutConfig } from '@/lib/page-layout/service'
import { getSiteAppearance } from '@/lib/site-config'
import { publicImageUrl } from '@/lib/images'
import { NotificationsClient } from './NotificationsClient'

export const dynamic = 'force-dynamic'

export default async function NotificationsPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const [notifications, layoutConfig, appearance] = await Promise.all([
    listUnifiedNotifications(user.id, { limit: 50 }),
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
            'message.main': <NotificationsClient initialNotifications={notifications} siteLogoUrl={siteLogoUrl} />,
          }}
        />
      </main>
    </>
  )
}
