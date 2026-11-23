import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { rejectInvalidRequestOrigin, requireAdmin } from '@/lib/security'
import { defaultShunConfig, shunDay, validateShunConfig } from '@/lib/shun-master-rules'
import { getShunCandidateSummary, setShunEnabled, ShunError, updateShunConfig, validLaunchNotice } from '@/lib/shun-master'

export const dynamic = 'force-dynamic'
const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } })

export async function GET(request: Request) {
  const guard = await requireAdmin('site_config_manage')
  if (!guard.user) return guard.response
  const query = new URL(request.url).searchParams
  const day = query.get('day') || shunDay(new Date())
  const page = Number(query.get('page') || '1')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isSafeInteger(page) || page < 1 || page > 200) return json({ message: '查询参数无效。' }, 400)
  const [settings, records, amounts, totals, actors, audit, abuse, [outstanding], refusalAudit] = await Promise.all([
    prisma.shunMasterSettings.findUnique({ where: { id: 1 } }),
    prisma.shunMasterRound.findMany({ where: { day }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * 50, take: 51,
      select: { id: true, actorId: true, victimId: true, rolled: true, amount: true, createdAt: true,
        result: true, recovered: true, compensation: true, capturedAt: true } }),
    prisma.shunMasterRound.groupBy({ by: ['rolled', 'amount'], where: { day }, _count: { _all: true } }),
    prisma.shunMasterRound.aggregate({ where: { day }, _count: true, _sum: { amount: true, recovered: true, compensation: true } }),
    prisma.shunMasterRound.groupBy({ by: ['actorId'], where: { day } }),
    prisma.userOperationLog.findMany({ where: { category: 'SHUN_MASTER', action: { in: ['CONFIG_UPDATE', 'COMPENSATION', 'NO_TARGET'] } },
      orderBy: { occurredAt: 'desc' }, take: 30, select: { action: true, occurredAt: true, operatorUserId: true, summary: true, metadata: true } }),
    prisma.accountSecurityLog.findMany({ where: { action: 'API_ABUSE_RATE_LIMIT', metadata: { path: '$.endpoint', string_starts_with: 'shun-master:' } },
      orderBy: { createdAt: 'desc' }, take: 30, select: { id: true, userId: true, createdAt: true, metadata: true } }),
    prisma.$queryRaw<{ count: bigint; oldest: Date | null }[]>`
      SELECT COUNT(*) AS count, MIN(createdAt) AS oldest FROM ShunMasterRound
      WHERE result IS NULL AND JSON_LENGTH(candidates) = 3
    `,
    prisma.userOperationLog.findMany({ where: { category: 'SHUN_MASTER', action: { in: ['LEAVE', 'PROTECT', 'UNPROTECT', 'REJOIN'] } },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }], take: 50,
      select: { id: true, userId: true, action: true, occurredAt: true } }),
  ])
  const config = validateShunConfig(settings?.config) || defaultShunConfig
  const reserved = settings?.reserved || 0
  const compensated = settings?.compensated || 0
  const [candidatePool, refusalCount, activeRefusals, effectiveEnabled] = await Promise.all([
    getShunCandidateSummary(prisma, shunDay(new Date()), config.victimCap),
    prisma.shunMasterProtection.count({ where: { protected: true } }),
    prisma.shunMasterProtection.findMany({ where: { protected: true }, orderBy: [{ updatedAt: 'desc' }, { userId: 'asc' }],
      take: 50, select: { userId: true, updatedAt: true } }),
    config.enabled && validLaunchNotice(prisma, settings?.launchNoticeId),
  ])
  return json({ config, effectiveEnabled, rulesVersion: settings?.rulesVersion ?? 1, day, reserved, compensated, budgetWarning: config.budget - reserved - compensated < 7,
    records: records.slice(0, 50), hasMore: records.length > 50, amounts, totals, activePlayers: actors.length, audit, abuse,
    outstanding: { count: Number(outstanding.count), oldest: outstanding.oldest }, candidatePool, refusalCount, activeRefusals, refusalAudit })
}

export async function PATCH(request: Request) {
  const origin = rejectInvalidRequestOrigin(request)
  if (origin) return origin
  const guard = await requireAdmin('site_config_manage')
  if (!guard.user) return guard.response
  const body = await request.json().catch(() => null)
  try {
    if (body?.operation === 'enable' || body?.operation === 'disable') {
      return json(await setShunEnabled(guard.user.id, body.operation === 'enable', body.confirmed === true))
    }
    if (body?.operation !== undefined) return json({ message: '不支持的配置操作。' }, 400)
    const config = validateShunConfig({ ...body, enabled: false })
    if (!config) return json({ message: '检查次数、预算、活跃权重及递减概率。概率必须合计 100%。' }, 400)
    return json(await updateShunConfig(guard.user.id, config))
  } catch (error) {
    if (error instanceof ShunError) return json({ code: error.code, message: error.message }, error.status)
    return json({ message: '配置保存失败。' }, 500)
  }
}
