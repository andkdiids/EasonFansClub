import type { Prisma } from '@prisma/client'
import { getShanghaiDateKey } from '@/lib/checkin'
import { grantGrowthReward } from '@/lib/growth-tasks/service'

export function contentShareSourceEventId(date = new Date()) {
  return `content:${getShanghaiDateKey(date)}`
}

export async function recordContentShareTask(
  tx: Prisma.TransactionClient,
  userId: string,
  now = new Date(),
) {
  return grantGrowthReward(tx, {
    userId,
    taskCode: 'CONTENT_SHARE_ACTIVE',
    sourceEventId: contentShareSourceEventId(now),
    reason: '分享内容',
    now,
  })
}
