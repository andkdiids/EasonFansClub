import { requireAdminPage } from '@/components/AdminAccess'

import { NotificationBroadcastForm } from './NotificationBroadcastForm'

export const dynamic = 'force-dynamic'

export default async function AdminNotificationsPage() {
  const user = await requireAdminPage('/admin/notifications', 'notification_manage')

  return (
    <>
      
      <NotificationBroadcastForm />
    </>
  )
}
