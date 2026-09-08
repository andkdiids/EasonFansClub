import { requireAdminPage } from '@/components/AdminAccess'
import { UserOperationCenter } from './UserOperationCenter'

export const dynamic = 'force-dynamic'

export default async function AdminUserOperationsPage() {
  await requireAdminPage('/admin/user-operations', 'user_manage')
  return <UserOperationCenter />
}
