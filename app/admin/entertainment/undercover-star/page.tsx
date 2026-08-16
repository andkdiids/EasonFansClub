import { requireAdminPage } from '@/components/AdminAccess'
import { UndercoverStarAdminManager } from './UndercoverStarAdminManager'

export const dynamic = 'force-dynamic'

export default async function UndercoverStarAdminPage() {
  await requireAdminPage('/admin/entertainment/undercover-star', 'entertainment_manage')
  return <UndercoverStarAdminManager />
}
