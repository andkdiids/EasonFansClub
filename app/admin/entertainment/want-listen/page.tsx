import { requireAdminPage } from '@/components/AdminAccess'
import { WantListenAdminManager } from './WantListenAdminManager'

export const dynamic = 'force-dynamic'

export default async function WantListenAdminPage() {
  await requireAdminPage('/admin/entertainment/want-listen', 'entertainment_manage')
  return <WantListenAdminManager />
}
