import { requireAdminPage } from '@/components/AdminAccess'
import { ShunMasterAdmin } from './ShunMasterAdmin'

export const dynamic = 'force-dynamic'

export default async function ShunMasterAdminPage() {
  await requireAdminPage('/admin/shun-master', 'site_config_manage')
  return <ShunMasterAdmin />
}
