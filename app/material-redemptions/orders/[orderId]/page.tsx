import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { MaterialRedemptionOrderClient } from './MaterialRedemptionOrderClient'

export const dynamic = 'force-dynamic'

export default async function MaterialRedemptionOrderPage({ params }: { params: Promise<{ orderId: string }> }) {
  const user = await getCurrentUser()
  if (!user) redirect('/login?redirect=%2Fmaterial-redemptions%2Fme')
  const { orderId } = await params
  return <MaterialRedemptionOrderClient orderId={orderId} />
}
