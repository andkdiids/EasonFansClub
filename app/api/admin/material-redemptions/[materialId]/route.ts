import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { MaterialRedemptionError, serializeAdminMaterial, updateMaterialRedemption } from '@/lib/material-redemptions'
import { rejectInvalidRequestOrigin, requireAdmin } from '@/lib/security'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ materialId: string }> }

function respondError(error: unknown) {
  if (error instanceof MaterialRedemptionError) return NextResponse.json({ ok: false, code: error.code, message: error.message }, { status: error.status })
  console.error('[admin.material-redemption.detail]', error)
  return NextResponse.json({ ok: false, code: 'MATERIAL_REDEMPTION_SERVICE_UNAVAILABLE', message: '物料兑换服务暂时不可用，请稍后重试' }, { status: 500 })
}

export async function GET(_request: Request, context: RouteContext) {
  const guard = await requireAdmin('material_redemption_manage')
  if (!guard.user) return guard.response
  const { materialId } = await context.params
  const material = await prisma.materialRedemption.findUnique({ where: { id: materialId }, include: { rules: { orderBy: { sortOrder: 'asc' } } } })
  if (!material) return NextResponse.json({ ok: false, code: 'MATERIAL_NOT_FOUND', message: '物料不存在' }, { status: 404 })
  return NextResponse.json({ material: serializeAdminMaterial(material) }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function PUT(request: Request, context: RouteContext) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireAdmin('material_redemption_manage')
  if (!guard.user) return guard.response
  const { materialId } = await context.params
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ ok: false, code: 'INVALID_REQUEST', message: '请求格式无效' }, { status: 400 })
  try {
    return NextResponse.json({ material: await updateMaterialRedemption(guard.user.id, materialId, body as Record<string, unknown>) })
  } catch (error) {
    return respondError(error)
  }
}
