import { NextResponse } from 'next/server'
import { defaultGrowthLevels, dailyExpLimit, normalizeGrowthLevels } from '@/lib/growth'
import { prisma } from '@/lib/prisma'
import { requireAdmin, sanitizeText } from '@/lib/security'

type RawGrowthLevel = {
  level?: unknown
  name?: unknown
  requiredExp?: unknown
}

export async function GET() {
  const guard = await requireAdmin('growth_manage')
  if (!guard.user) return guard.response

  const [levels, taskCount] = await Promise.all([
    prisma.growthLevelConfig.findMany({
      orderBy: { level: 'asc' },
      select: { level: true, name: true, requiredExp: true },
    }),
    prisma.task.count(),
  ])

  return NextResponse.json({
    dailyExpLimit,
    levels: normalizeGrowthLevels(levels.length ? levels : [...defaultGrowthLevels]),
    taskCount,
  })
}

export async function PATCH(request: Request) {
  const guard = await requireAdmin('growth_manage')
  if (!guard.user) return guard.response

  const body = await request.json().catch(() => null)
  const rawLevels: RawGrowthLevel[] = Array.isArray(body?.levels) ? body.levels : []
  const levels = normalizeGrowthLevels(
    rawLevels.map((item) => ({
      level: Number(item?.level),
      name: sanitizeText(item?.name, 24),
      requiredExp: Number(item?.requiredExp),
    })),
  ).filter((item) => item.level >= 1 && item.level <= 7)

  if (levels.length !== 7 || levels[0].requiredExp !== 0) {
    return NextResponse.json({ message: '请维护完整的 7 个等级，Lv1 经验必须为 0。' }, { status: 400 })
  }
  for (let index = 1; index < levels.length; index += 1) {
    if (levels[index].requiredExp <= levels[index - 1].requiredExp) {
      return NextResponse.json({ message: '升级经验必须逐级递增。' }, { status: 400 })
    }
  }

  await prisma.$transaction(
    levels.map((item) =>
      prisma.growthLevelConfig.upsert({
        where: { level: item.level },
        update: { name: item.name, requiredExp: item.requiredExp },
        create: { level: item.level, name: item.name, requiredExp: item.requiredExp },
      }),
    ),
  )

  const saved = await prisma.growthLevelConfig.findMany({
    orderBy: { level: 'asc' },
    select: { level: true, name: true, requiredExp: true },
  })
  return NextResponse.json({ message: '成长等级配置已保存', levels: normalizeGrowthLevels(saved) })
}
