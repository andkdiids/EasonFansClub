import { requireAdminPage } from '@/components/AdminAccess'
import { ShunAdminTabs } from './ShunAdminTabs'
import { ShunItemAdmin } from './ShunItemAdmin'
import { ShunItemGrantAdmin } from './ShunItemGrantAdmin'
import { ShunMasterAdmin } from './ShunMasterAdmin'
import { hasAdminPermission } from '@/lib/admin-permissions'

export const dynamic = 'force-dynamic'

export default async function ShunMasterAdminPage() {
  const user = await requireAdminPage('/admin/shun-master', 'site_config_manage')
  // 发放分页按「站内奖励发放」权限显示；发放接口在服务端再独立校验一次。
  const canGrant = await hasAdminPermission(user, 'user_reward_manage')
  return <>
    <ShunMasterAdmin />
    <ShunAdminTabs items={<ShunItemAdmin />} grants={canGrant ? <ShunItemGrantAdmin /> : null} />
  </>
}
