import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { rejectInvalidRequestOrigin, requireAdmin } from '@/lib/security'
import { defaultShunConfig, shunConfigError, shunDay, validateShunConfig } from '@/lib/shun-master-rules'
import { ACTIVITY_TIER_LABELS, SHUN_ACTIVITY_TIERS } from '@/lib/shun-config'
import { shunOpenHoursState } from '@/lib/shun-open-hours'
import { getShunCandidateSummary, setShunEnabled, ShunError, updateShunConfig } from '@/lib/shun-master'

export const dynamic = 'force-dynamic'
const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } })

export async function GET(request: Request) {
  const guard = await requireAdmin('site_config_manage')
  if (!guard.user) return guard.response
  const query = new URL(request.url).searchParams
  const day = query.get('day') || shunDay(new Date())
  const page = Number(query.get('page') || '1')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isSafeInteger(page) || page < 1 || page > 200) return json({ message: '查询参数无效。' }, 400)
  const [settings, records, amounts, totals, actors, audit, abuse, [outstanding], refusalAudit, matchSources] = await Promise.all([
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
    // Admin-only match-source audit of the two-stage lottery: how many transfers
    // came from the friend pool and which activity tier they were drawn from.
    prisma.shunMasterRound.groupBy({ by: ['friendHit', 'victimTier'], where: { day }, _count: { _all: true } }),
  ])
  // Admin-only notification audit of the deferred send flow. Players never see
  // pending state, pool sources or retry pressure.
  const [notifyGroups, notifyAuto, notifyRetry] = await Promise.all([
    prisma.shunMasterRound.groupBy({ by: ['notifyStatus'], where: { day }, _count: { _all: true } }),
    prisma.shunMasterRound.count({ where: { day, notifyAuto: true } }),
    prisma.shunMasterRound.aggregate({ where: { day }, _sum: { notifyAttempts: true } }),
  ])
  const notifyCounts = new Map(notifyGroups.map((row) => [row.notifyStatus, row._count._all]))
  const notifyStats = {
    day,
    pending: notifyCounts.get('PENDING') ?? 0,
    plain: notifyCounts.get('SENT_PLAIN') ?? 0,
    letter: notifyCounts.get('SENT_LETTER') ?? 0,
    auto: notifyAuto,
    retryAttempts: notifyRetry._sum.notifyAttempts ?? 0,
  }
  const config = validateShunConfig(settings?.config) || defaultShunConfig
  const reserved = settings?.reserved || 0
  const compensated = settings?.compensated || 0
  const totalTransfers = matchSources.reduce((sum, row) => sum + row._count._all, 0)
  const friendHits = matchSources.filter((row) => row.friendHit).reduce((sum, row) => sum + row._count._all, 0)
  const tiers = Array.from({ length: SHUN_ACTIVITY_TIERS }, (_, tier) => ({
    tier, label: ACTIVITY_TIER_LABELS[tier],
    count: matchSources.filter((row) => row.victimTier === tier).reduce((sum, row) => sum + row._count._all, 0),
  }))
  const matchStats = {
    day,
    total: totalTransfers,
    friendHits,
    friendRate: totalTransfers ? Math.round(friendHits / totalTransfers * 1000) / 10 : 0,
    tiers,
    // Rounds created before the audit columns existed carry no recorded tier.
    unknownTier: matchSources.filter((row) => row.victimTier === null).reduce((sum, row) => sum + row._count._all, 0),
  }
  const [candidatePool, refusalCount, activeRefusals] = await Promise.all([
    getShunCandidateSummary(prisma, shunDay(new Date()), config.victimCap),
    prisma.shunMasterProtection.count({ where: { protected: true } }),
    prisma.shunMasterProtection.findMany({ where: { protected: true }, orderBy: [{ updatedAt: 'desc' }, { userId: 'asc' }],
      take: 50, select: { userId: true, updatedAt: true } }),
  ])
  // Admin-only recovery-bonus audit. Cumulative on purpose: the published
  // figures are "累计额外奖励挂号费 / 累计原额追回挂号费", and the trigger rate
  // must be comparable with the configured chance.
  const [bonusAggregate, bonusCount] = await Promise.all([
    prisma.shunMasterRound.aggregate({ where: { result: 'SUCCESS' },
      _count: { _all: true }, _sum: { bonusAwarded: true, recovered: true } }),
    prisma.shunMasterRound.count({ where: { bonusAwarded: { gt: 0 } } }),
  ])
  const bonusStats = {
    recoveredCount: bonusAggregate._count._all,
    bonusCount,
    bonusRate: bonusAggregate._count._all ? Math.round(bonusCount / bonusAggregate._count._all * 1000) / 10 : 0,
    bonusTotal: bonusAggregate._sum.bonusAwarded ?? 0,
    recoveredTotal: bonusAggregate._sum.recovered ?? 0,
  }
  // One instant for both fields: the panel must never show a window state and a
  // clock that disagree.
  const requestedAt = new Date()
  return json({ config, effectiveEnabled: config.enabled, rulesVersion: settings?.rulesVersion ?? 1, day, reserved, compensated,
    // Live view of the daily window, judged with the admin request's own server
    // clock so the panel shows exactly what the settlement gate would decide.
    openHoursNow: shunOpenHoursState(config, requestedAt), serverNow: requestedAt.toISOString(),
    records: records.slice(0, 50), hasMore: records.length > 50, amounts, totals, activePlayers: actors.length, audit, abuse,
    outstanding: { count: Number(outstanding.count), oldest: outstanding.oldest }, candidatePool, refusalCount, activeRefusals, refusalAudit,
    matchStats, notifyStats, bonusStats })
}

export async function PATCH(request: Request) {
  const origin = rejectInvalidRequestOrigin(request)
  if (origin) return origin
  const guard = await requireAdmin('site_config_manage')
  if (!guard.user) return guard.response
  const body = await request.json().catch(() => null)
  const isToggle = body?.operation === 'enable' || body?.operation === 'disable'
  try {
    if (isToggle) {
      return json(await setShunEnabled(guard.user.id, body.operation === 'enable'))
    }
    if (body?.operation !== undefined) return json({ message: '不支持的配置操作。' }, 400)
    const draft = { ...body, enabled: false }
    const config = validateShunConfig(draft)
    if (!config) return json({ message: shunConfigError(draft) ?? '配置无效。' }, 400)
    return json(await updateShunConfig(guard.user.id, config))
  } catch (error) {
    if (error instanceof ShunError) return json({ code: error.code, message: error.message }, error.status)
    return json({ message: isToggle ? '游戏状态更新失败，请重试。' : '配置保存失败。' }, 500)
  }
}
