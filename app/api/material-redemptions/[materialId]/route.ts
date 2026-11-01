import { NextResponse } from 'next/server'
import { resolveRequestAuth } from '@/lib/security'
import { getPublicMaterialRedemption } from '@/lib/material-redemptions'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ materialId: string }> }

export async function GET(request: Request, context: RouteContext) {
  const { materialId } = await context.params
  const auth = await resolveRequestAuth(request)
  if (auth.response) return auth.response
  const material = await getPublicMaterialRedemption(materialId, auth.user?.id)
  if (!material) return NextResponse.json({ ok: false, code: 'NOT_FOUND', message: '物料不存在或暂未公开' }, { status: 404 })
  return NextResponse.json({ material }, { headers: { 'Cache-Control': 'no-store' } })
}
