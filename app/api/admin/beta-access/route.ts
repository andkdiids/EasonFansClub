import { NextResponse } from 'next/server'
import { adminAuditOperations, createAdminActionAudit } from '@/lib/admin-audit'
import { enforceApiRateLimit, rejectInvalidRequestOrigin, requireAdmin } from '@/lib/security'
import { prisma } from '@/lib/prisma'
import {
  BETA_ACCESS_PERMISSION,
  BetaAccessError,
  deriveBetaInviteStatus,
  generateBetaInviteCode,
  getBetaAccessConfig,
  setBetaAccessRequired,
} from '@/lib/mobile-beta'

export const dynamic = 'force-dynamic'

const noStoreHeaders = { 'Cache-Control': 'private, no-store, max-age=0' }

function bodyRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function jsonError(message: string, status = 400, code = 'INVALID_INPUT') {
  return NextResponse.json({ ok: false, code, message }, { status, headers: noStoreHeaders })
}

function parsePositiveInt(value: unknown, fallback: number, max: number) {
  const parsed = typeof value === 'number' || typeof value === 'string' ? Number(value) : fallback
  return Number.isInteger(parsed) && parsed > 0 && parsed <= max ? parsed : null
}

function parseExpiry(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string') return undefined
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime()) || parsed <= new Date()) return undefined
  const max = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
  return parsed > max ? undefined : parsed
}

export async function GET() {
  const guard = await requireAdmin(BETA_ACCESS_PERMISSION)
  if (!guard.user) return guard.response
  const [config, rows] = await Promise.all([
    getBetaAccessConfig(),
    prisma.betaInviteCode.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        maskedCode: true,
        status: true,
        maxActivations: true,
        activationCount: true,
        expiresAt: true,
        createdAt: true,
        Activations: { orderBy: { activatedAt: 'desc' }, select: { id: true, status: true, activatedAt: true, lastVerifiedAt: true, revokedAt: true } },
      },
    }),
  ])
  const invites = rows.map((row) => ({
    ...row,
    status: deriveBetaInviteStatus(row, new Date()),
    lastActivationAt: row.Activations[0]?.activatedAt || null,
  }))
  return NextResponse.json({ config, invites }, { headers: noStoreHeaders })
}

export async function POST(request: Request) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireAdmin(BETA_ACCESS_PERMISSION)
  if (!guard.user) return guard.response
  const rateLimitError = await enforceApiRateLimit(request, guard.user.id, {
    endpoint: '/api/admin/beta-access:POST',
    ip: { limit: 30, windowSeconds: 60 },
    user: { limit: 20, windowSeconds: 60 },
  })
  if (rateLimitError) return rateLimitError
  const input = bodyRecord(await request.json().catch(() => null))
  const action = typeof input.action === 'string' ? input.action : 'create'

  if (action === 'toggle') {
    if (input.confirm !== true || typeof input.enabled !== 'boolean') return jsonError('请确认要修改 Android 内测准入状态', 400, 'CONFIRMATION_REQUIRED')
    const enabled = input.enabled
    const before = await getBetaAccessConfig()
    if (before.betaAccessRequired === enabled) return NextResponse.json({ ok: true, config: before, changed: false }, { headers: noStoreHeaders })
    try {
      const config = await prisma.$transaction(async (tx) => {
        const next = await setBetaAccessRequired(enabled, tx)
        await createAdminActionAudit(tx, {
          operatorId: guard.user.id,
          action: 'UPDATE_SETTING',
          operationType: enabled ? adminAuditOperations.BETA_GATE_ENABLE : adminAuditOperations.BETA_GATE_DISABLE,
          targetType: 'SITE_SETTING',
          targetId: 'mobile.betaAccess.required',
          targetTitle: 'Android 内测准入',
          reason: enabled ? '开启 Android 内测准入' : '关闭 Android 内测准入',
          metadata: { before: before.betaAccessRequired, after: enabled },
        })
        return next
      })
      return NextResponse.json({ ok: true, config, changed: true }, { headers: noStoreHeaders })
    } catch (error) {
      console.error('[admin.beta-access.toggle]', { errorName: error instanceof Error ? error.name : 'UnknownError' })
      return jsonError('内测准入状态保存失败，请稍后重试', 500, 'BETA_GATE_WRITE_FAILED')
    }
  }

  if (action !== 'create') return jsonError('内测管理操作不正确')
  const quantity = parsePositiveInt(input.quantity, 1, 100)
  const maxActivations = parsePositiveInt(input.maxActivations, 1, 100)
  const expiresAt = parseExpiry(input.expiresAt)
  if (!quantity || !maxActivations || expiresAt === undefined) return jsonError('数量、最大激活设备数或有效期不正确')

  try {
    const created = await prisma.$transaction(async (tx) => {
      const result: Array<{ id: string; code: string; maskedCode: string }> = []
      for (let index = 0; index < quantity; index += 1) {
        const generated = generateBetaInviteCode()
        const invite = await tx.betaInviteCode.create({
          data: {
            codeHash: generated.codeHash,
            codePrefix: generated.codePrefix,
            maskedCode: generated.maskedCode,
            maxActivations,
            expiresAt,
            createdById: guard.user.id,
          },
          select: { id: true, maskedCode: true },
        })
        await createAdminActionAudit(tx, {
          operatorId: guard.user.id,
          action: 'UPDATE_SETTING',
          operationType: adminAuditOperations.BETA_INVITE_CREATE,
          targetType: 'BETA_INVITE',
          targetId: invite.id,
          targetTitle: invite.maskedCode,
          metadata: { maskedCode: invite.maskedCode, maxActivations, expiresAt: expiresAt?.toISOString() || null },
        })
        result.push({ id: invite.id, code: generated.code, maskedCode: invite.maskedCode })
      }
      return result
    })
    return NextResponse.json({ ok: true, codes: created, message: '内测码已创建；完整内测码只会在本次显示' }, { headers: noStoreHeaders })
  } catch (error) {
    if (error instanceof BetaAccessError) return jsonError(error.message, error.status, error.code)
    console.error('[admin.beta-access.create]', { errorName: error instanceof Error ? error.name : 'UnknownError' })
    return jsonError('内测码创建失败，请稍后重试', 500, 'BETA_INVITE_CREATE_FAILED')
  }
}
