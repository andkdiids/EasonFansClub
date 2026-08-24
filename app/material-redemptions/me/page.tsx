import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { MaterialRedemptionOrdersClient } from './MaterialRedemptionOrdersClient'

export const dynamic = 'force-dynamic'

export default async function MaterialRedemptionOrdersPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login?redirect=%2Fmaterial-redemptions%2Fme')
  return <MaterialRedemptionOrdersClient />
}
