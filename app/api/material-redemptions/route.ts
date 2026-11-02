import { NextResponse } from 'next/server'
import { requireRequestUser } from '@/lib/security'
import { listPublicMaterialRedemptions } from '@/lib/material-redemptions'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const guard = await requireRequestUser(request)
  if (!guard.user) return guard.response
  const materials = await listPublicMaterialRedemptions()
  return NextResponse.json({ materials, userId: guard.user.id }, { headers: { 'Cache-Control': 'no-store' } })
}
