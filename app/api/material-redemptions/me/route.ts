import { NextResponse } from 'next/server'
import { listOwnMaterialRedemptionOrders } from '@/lib/material-redemptions'
import { requireRequestUser } from '@/lib/security'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const guard = await requireRequestUser(request)
  if (!guard.user) return guard.response
  const status = new URL(request.url).searchParams.get('status') || undefined
  const orders = await listOwnMaterialRedemptionOrders(guard.user.id, status)
  return NextResponse.json({ orders }, { headers: { 'Cache-Control': 'no-store' } })
}
