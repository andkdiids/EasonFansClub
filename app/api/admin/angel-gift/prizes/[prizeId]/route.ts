import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { disablePharmacyPrize, PharmacyError, updatePharmacyPrize } from '@/lib/pharmacy'
import { rejectInvalidRequestOrigin, requireAdmin } from '@/lib/security'

export const dynamic = 'force-dynamic'

function objectBody(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function errorResponse(error: unknown, operation: string) {
  if (error instanceof PharmacyError) return NextResponse.json({ ok: false, code: error.code, message: error.message }, { status: error.status })
  console.error(`[admin.angel-gift.prize.${operation}]`, error)
  return NextResponse.json({ ok: false, code: 'SERVER_ERROR', message: '奖品暂时无法保存，请稍后重试' }, { status: 500 })
}

export async function PATCH(request: Request, context: { params: Promise<{ prizeId: string }> }) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireAdmin('angel_gift_manage')
  if (!guard.user) return guard.response
  const { prizeId } = await context.params
  const body = objectBody(await request.json().catch(() => null))
  if (!body) return NextResponse.json({ ok: false, code: 'INVALID_PRIZE', message: '奖品参数格式不正确' }, { status: 400 })
  try {
    const prize = await updatePharmacyPrize({ operatorId: guard.user.id, prizeId, data: body })
    revalidatePath('/angel-gift')
    revalidatePath('/admin/angel-gift')
    return NextResponse.json({ ok: true, prize }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return errorResponse(error, 'patch')
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ prizeId: string }> }) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireAdmin('angel_gift_manage')
  if (!guard.user) return guard.response
  const { prizeId } = await context.params
  try {
    const prize = await disablePharmacyPrize({ operatorId: guard.user.id, prizeId })
    revalidatePath('/angel-gift')
    revalidatePath('/admin/angel-gift')
    return NextResponse.json({ ok: true, prize, message: '奖品已停用，历史记录仍会保留' }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return errorResponse(error, 'delete')
  }
}

