import type { Prisma } from '@prisma/client'
import { annualMemoirPlatforms } from '@/lib/annual-memoir-platforms'
import { createDefaultTopicActivityV2Program, readTopicActivityV2Program } from '@/lib/topic-activity-v2-config'

export function parseMemoirPlatformPoints(value: unknown) {
  return Array.isArray(value) && value.length === annualMemoirPlatforms.length &&
    value.every((points) => Number.isInteger(points) && points > 0 && points <= 2_000_000_000) ? value as number[] : null
}

export async function syncMemoirPlatforms(tx: Prisma.TransactionClient, activityId: string, points?: number[]) {
  const activity = await tx.activity.findUniqueOrThrow({ where: { id: activityId }, select: { topicProgram: true } })
  const program = readTopicActivityV2Program(activity.topicProgram) ?? createDefaultTopicActivityV2Program()
  program.enabled = true
  program.platformRewards = { enabled: true, allowStacking: true, maxPlatforms: null, maxEntries: null }
  program.entries = annualMemoirPlatforms.map(([platformKey, platformName], sortOrder) => {
    const existing = program.entries.find((entry) => entry.platformKey === platformKey && entry.enabled)
    return {
      id: existing?.id ?? activityId + '-memoir-' + platformKey,
      platformKey, platformName, title: platformName, instructions: '上传年度回忆录分享截图，审核通过后发放挂号费。',
      materialRequirement: '', minImages: 1, maxImages: 3, points: points?.[sortOrder] ?? existing?.points ?? 74,
      enabled: true, sortOrder, startsAt: null, endsAt: null, allowResubmit: true,
    }
  })
  await tx.topicActivityRewardEntry.updateMany({
    where: { activityId, id: { notIn: program.entries.map(({ id }) => id) } }, data: { enabled: false },
  })
  for (const entry of program.entries) {
    const config = entry as Prisma.InputJsonObject
    await tx.topicActivityRewardEntry.upsert({ where: { id: entry.id, activityId },
      create: { id: entry.id, activityId, platformKey: entry.platformKey, config, enabled: true, sortOrder: entry.sortOrder },
      update: { config, enabled: true, sortOrder: entry.sortOrder },
    })
  }
  await tx.activity.update({ where: { id: activityId }, data: { topicProgram: program as unknown as Prisma.InputJsonObject } })
}
