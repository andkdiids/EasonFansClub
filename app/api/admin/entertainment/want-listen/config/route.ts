import { requireAdmin, rejectInvalidRequestOrigin } from '@/lib/security'
import { getWantListenConfig, saveWantListenConfig } from '@/lib/want-listen'
import { handleWantListenError, wantListenError, wantListenOk } from '@/lib/want-listen-api'
import { getWantListenPeriod } from '@/lib/want-listen-period'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

async function overview() {
  const today = getWantListenPeriod('DAY')
  const todayStartedWhere = { createdAt: { gte: today.start || undefined, lt: today.end || undefined } }
  const todayWhere = { status: 'COMPLETED' as const, completedAt: { gte: today.start || undefined, lt: today.end || undefined } }
  const [participants, todayModes, history, averages] = await Promise.all([
    prisma.wantListenSession.findMany({ where: todayStartedWhere, distinct: ['userId'], select: { userId: true } }),
    prisma.wantListenSession.groupBy({ by: ['mode'], where: todayWhere, _count: { _all: true } }),
    prisma.wantListenSession.count({ where: { status: 'COMPLETED' } }),
    prisma.wantListenStats.groupBy({ by: ['mode'], _sum: { totalQuestions: true, totalCorrect: true } }),
  ])
  const todayByMode = new Map(todayModes.map((row) => [row.mode, row._count._all]))
  const averageByMode = new Map(averages.map((row) => [
    row.mode,
    row._sum.totalQuestions ? Math.round(((row._sum.totalCorrect || 0) / row._sum.totalQuestions) * 1000) / 10 : 0,
  ]))
  return {
    todayParticipants: participants.length,
    todayCompletedGames: todayModes.reduce((sum, row) => sum + row._count._all, 0),
    todayByMode: {
      WANT_LISTEN: todayByMode.get('WANT_LISTEN') || 0,
      CANTONESE_FRAGMENT: todayByMode.get('CANTONESE_FRAGMENT') || 0,
      FALSE_TITLE: todayByMode.get('FALSE_TITLE') || 0,
    },
    averageAccuracyByMode: {
      WANT_LISTEN: averageByMode.get('WANT_LISTEN') || 0,
      CANTONESE_FRAGMENT: averageByMode.get('CANTONESE_FRAGMENT') || 0,
      FALSE_TITLE: averageByMode.get('FALSE_TITLE') || 0,
    },
    historicalCompletedGames: history,
  }
}

export async function GET() {
  const guard = await requireAdmin('entertainment_manage')
  if (!guard.user) return wantListenError('当前账号没有想听管理权限', guard.response.status)
  try {
    const [config, stats] = await Promise.all([getWantListenConfig(), overview()])
    return wantListenOk({ config, stats })
  } catch (error) {
    return handleWantListenError(error, 'admin.config.get')
  }
}

export async function PUT(request: Request) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return wantListenError('请求来源校验失败，请刷新页面后重试。', 403)
  const guard = await requireAdmin('entertainment_manage')
  if (!guard.user) return wantListenError('当前账号没有想听管理权限', guard.response.status)
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  try {
    const current = await getWantListenConfig()
    const config = {
      enabled: typeof body?.enabled === 'boolean' ? body.enabled : current.enabled,
      wantListenEnabled: typeof body?.wantListenEnabled === 'boolean' ? body.wantListenEnabled : current.wantListenEnabled,
      cantoneseFragmentEnabled: typeof body?.cantoneseFragmentEnabled === 'boolean' ? body.cantoneseFragmentEnabled : current.cantoneseFragmentEnabled,
      falseTitleEnabled: typeof body?.falseTitleEnabled === 'boolean' ? body.falseTitleEnabled : current.falseTitleEnabled,
    }
    return wantListenOk({ config: await saveWantListenConfig(config), message: '想听设置已保存。' })
  } catch (error) {
    return handleWantListenError(error, 'admin.config.save')
  }
}
