import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { listPublicMaterialRedemptions } from '@/lib/material-redemptions'

export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await getCurrentUser()
  const materials = await listPublicMaterialRedemptions()
  return NextResponse.json({ materials, userId: user?.id || null }, { headers: { 'Cache-Control': 'no-store' } })
}
