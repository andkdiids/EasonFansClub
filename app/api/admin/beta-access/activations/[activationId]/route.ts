import { NextResponse } from 'next/server'
import { adminAuditOperations, createAdminActionAudit } from '@/lib/admin-audit'
import { prisma } from '@/lib/prisma'
import { BETA_ACCESS_PERMISSION } from '@/lib/mobile-beta'
import { enforceApiRateLimit, rejectInvalidRequestOrigin, requireAdmin } from '@/lib/security'

export async function POST(request: Request, context: { params: Promise<{ activationId: string }> }) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireAdmin(BETA_ACCESS_PERMISSION)
  if (!guard.user) return guard.response
  const rateLimitError = await enforceApiRateLimit(request, guard.user.id, {
    endpoint: '/api/admin/beta-access/activations/:activationId:POST',
    ip: { limit: 30, windowSeconds: 60 },
    user: { limit: 20, windowSeconds: 60 },
  })
  if (rateLimitError) return rateLimitError
  const { activationId } = await context.params
  try {
    const result = await prisma.$transaction(async (tx) => {
      const activation = await tx.betaDeviceActivation.findUnique({ where: { id: activationId }, select: { id: true, status: true, InviteCode: { select: { id: true, maskedCode: true } } } })
      if (!activation) return null
      await tx.betaDeviceActivation.update({ where: { id: activation.id }, data: { status: 'REVOKED', revokedAt: new Date() } })
      await createAdminActionAudit(tx, {
        operatorId: guard.user.id,
        action: 'UPDATE_SETTING',
        operationType: adminAuditOperations.BETA_ACTIVATION_REVOKE,
        targetType: 'BETA_ACTIVATION',
        targetId: activation.id,
        targetTitle: activation.InviteCode.maskedCode,
        metadata: { inviteId: activation.InviteCode.id, maskedCode: activation.InviteCode.maskedCode },
      })
      return activation
    })
    if (!result) return NextResponse.json({ ok: false, code: 'NOT_FOUND', message: '设备资格不存在' }, { status: 404 })
    return NextResponse.json({ ok: true, message: '设备内测资格已撤销' }, { headers: { 'Cache-Control': 'no-store, max-age=0' } })
  } catch (error) {
    console.error('[admin.beta-access.revoke-activation]', { errorName: error instanceof Error ? error.name : 'UnknownError' })
    return NextResponse.json({ ok: false, code: 'BETA_ACTIVATION_REVOKE_FAILED', message: '设备资格撤销失败，请稍后重试' }, { status: 500 })
  }
}
