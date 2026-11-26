import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { rejectInvalidRequestOrigin, requireAdmin } from '@/lib/security'
import {
  leaderboardRewardsConfigError,
  validateLeaderboardRewardsConfig,
} from '@/lib/leaderboard-rewards-config'
import {
  getLeaderboardRewardsConfig,
  updateLeaderboardRewardsConfig,
} from '@/lib/leaderboard-rewards-settings'
import { retryLeaderboardSettlement } from '@/lib/leaderboard-rewards-settlement'

export const dynamic = 'force-dynamic'
const json = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } })

/** GET: config + settlement runs + reward/badge audit + operator audit. */
export async function GET() {
  const guard = await requireAdmin('site_config_manage')
  if (!guard.user) return guard.response
  const [settings, runs, rewardStats, badgeStats, audit] = await Promise.all([
    getLeaderboardRewardsConfig(),
    prisma.leaderboardSettlementRun.findMany({
      orderBy: { createdAt: 'desc' }, take: 60,
      select: {
        id: true, kind: true, periodKey: true, status: true, attempts: true,
        result: true, error: true, createdAt: true, startedAt: true, finishedAt: true,
      },
    }),
    prisma.leaderboardRewardGrant.groupBy({
      by: ['runId', 'category'],
      _count: { _all: true },
      _sum: { originalAmount: true, actualAmount: true, clippedAmount: true },
    }),
    prisma.leaderboardBadgeGrant.groupBy({ by: ['badgeKey'], _count: { _all: true } }),
    prisma.userOperationLog.findMany({
      where: { category: 'LEADERBOARD_REWARDS' },
      orderBy: { occurredAt: 'desc' }, take: 50,
      select: { action: true, occurredAt: true, operatorUserId: true, summary: true, metadata: true },
    }),
  ])
  return json({ config: settings, runs, rewardStats, badgeStats, audit })
}

/** PATCH: persist validated config. Toggling on stamps the go-live instant once. */
export async function PATCH(request: Request) {
  const origin = rejectInvalidRequestOrigin(request)
  if (origin) return origin
  const guard = await requireAdmin('site_config_manage')
  if (!guard.user) return guard.response

  const body = await request.json().catch(() => null)
  const error = leaderboardRewardsConfigError(body)
  if (error) return json({ message: error }, 400)
  const validated = validateLeaderboardRewardsConfig(body)!
  const current = await getLeaderboardRewardsConfig()

  // Record the official go-live instant the first time the feature is enabled.
  // This is what prevents any pre-existing period from being auto-settled.
  if (validated.enabled && !current.enabled && !validated.enabledAt) {
    validated.enabledAt = new Date().toISOString()
  }
  if (!validated.enabled) validated.enabledAt = current.enabledAt

  const saved = await prisma.$transaction(async (tx) => {
    const result = await updateLeaderboardRewardsConfig(validated, tx)
    await tx.userOperationLog.create({
      data: {
        userId: guard.user!.id,
        operatorUserId: guard.user!.id,
        category: 'LEADERBOARD_REWARDS',
        action: 'CONFIG_UPDATE',
        summary: `更新排行榜自动奖励配置 (v${result.rulesVersion})`,
        metadata: { rulesVersion: result.rulesVersion, enabled: validated.enabled, enabledAt: validated.enabledAt } as never,
        source: 'WEB',
        operatorType: 'ADMIN',
      },
    })
    return result
  })
  return json({ ok: true, ...saved })
}

/** POST: controlled retry of a settlement run (admin only). */
export async function POST(request: Request) {
  const origin = rejectInvalidRequestOrigin(request)
  if (origin) return origin
  const guard = await requireAdmin('site_config_manage')
  if (!guard.user) return guard.response

  const body = await request.json().catch(() => ({})) as { operation?: unknown; runId?: unknown }
  if (body.operation !== 'retry' || typeof body.runId !== 'string' || !body.runId) {
    return json({ message: '无效的重试请求。' }, 400)
  }
  const config = await getLeaderboardRewardsConfig()
  try {
    const result = await retryLeaderboardSettlement({ runId: body.runId, config, now: new Date() })
    await prisma.userOperationLog.create({
      data: {
        userId: guard.user!.id,
        operatorUserId: guard.user!.id,
        category: 'LEADERBOARD_REWARDS',
        action: 'SETTLEMENT_RETRY',
        summary: `重试排行榜结算 ${body.runId}`,
        metadata: { runId: body.runId } as never,
        source: 'WEB',
        operatorType: 'ADMIN',
      },
    })
    return json({ ok: true, ...result })
  } catch (error) {
    return json({ message: error instanceof Error ? error.message : '重试失败' }, 400)
  }
}
