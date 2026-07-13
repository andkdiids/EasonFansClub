import { requireAdminPage } from '@/components/AdminAccess'
import { SiteHeader } from '@/components/SiteHeader'
import { NotificationBroadcastForm } from './NotificationBroadcastForm'

export const dynamic = 'force-dynamic'

export default async function AdminNotificationsPage() {
  const user = await requireAdminPage('/admin/notifications', 'notification_manage')

  return (
    <>
      <SiteHeader user={user} />
      <NotificationBroadcastForm />
    </>
  )
}
