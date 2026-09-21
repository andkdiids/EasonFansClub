import { NextResponse } from 'next/server'
import { adminAuditOperations, createAdminActionAudit } from '@/lib/admin-audit'
import { prisma } from '@/lib/prisma'
import { BETA_ACCESS_PERMISSION } from '@/lib/mobile-beta'
import { enforceApiRateLimit, rejectInvalidRequestOrigin, requireAdmin } from '@/lib/security'

export async function POST(request: Request, context: { params: Promise<{ inviteId: string }> }) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireAdmin(BETA_ACCESS_PERMISSION)
  if (!guard.user) return guard.response
  const rateLimitError = await enforceApiRateLimit(request, guard.user.id, {
    endpoint: '/api/admin/beta-access/invites/:inviteId:POST',
    ip: { limit: 30, windowSeconds: 60 },
    user: { limit: 20, windowSeconds: 60 },
  })
  if (rateLimitError) return rateLimitError
  const { inviteId } = await context.params
  try {
    const result = await prisma.$transaction(async (tx) => {
      const invite = await tx.betaInviteCode.findUnique({ where: { id: inviteId }, select: { id: true, maskedCode: true, status: true } })
      if (!invite) return null
      await tx.betaInviteCode.update({ where: { id: invite.id }, data: { status: 'REVOKED' } })
      await tx.betaDeviceActivation.updateMany({ where: { inviteCodeId: invite.id, status: 'ACTIVE' }, data: { status: 'REVOKED', revokedAt: new Date() } })
      await createAdminActionAudit(tx, {
        operatorId: guard.user.id,
        action: 'UPDATE_SETTING',
        operationType: adminAuditOperations.BETA_INVITE_REVOKE,
        targetType: 'BETA_INVITE',
        targetId: invite.id,
        targetTitle: invite.maskedCode,
        metadata: { maskedCode: invite.maskedCode },
      })
      return invite
    })
    if (!result) return NextResponse.json({ ok: false, code: 'NOT_FOUND', message: '内测码不存在' }, { status: 404 })
    return NextResponse.json({ ok: true, message: '内测码及其设备资格已撤销' }, { headers: { 'Cache-Control': 'no-store, max-age=0' } })
  } catch (error) {
    console.error('[admin.beta-access.revoke-invite]', { errorName: error instanceof Error ? error.name : 'UnknownError' })
    return NextResponse.json({ ok: false, code: 'BETA_INVITE_REVOKE_FAILED', message: '内测码撤销失败，请稍后重试' }, { status: 500 })
  }
}
