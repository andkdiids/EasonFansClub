import type { PointActionType, Prisma } from '@prisma/client'

/**
 * Keep the V2 reward path behind one ledger helper.  It locks User first and
 * only then checks PointLog.businessKey, so concurrent retries cannot mint the
 * same points twice.
 */
export type TopicActivityPointsGrantInput = {
  userId: string
  activityId: string
  points: number
  businessKey: string
  reason: string
  sourceEventId?: string | null
  now?: Date
}

export async function grantTopicActivityPointsInTransaction(
  tx: Prisma.TransactionClient,
  input: TopicActivityPointsGrantInput,
) {
  const businessKey = input.businessKey.trim()
  if (!businessKey) throw new Error('TOPIC_V2_POINT_BUSINESS_KEY_REQUIRED')
  if (!Number.isSafeInteger(input.points) || input.points <= 0) {
    throw new Error('TOPIC_V2_POINT_AMOUNT_INVALID')
  }

  const lockedUsers = await tx.$queryRaw<Array<{ id: string; points: number }>>`
    SELECT \`id\`, \`points\` FROM \`User\` WHERE \`id\` = ${input.userId} FOR UPDATE
  `
  const user = lockedUsers[0]
  if (!user) throw new Error('USER_NOT_FOUND')

  const existing = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT \`id\` FROM \`PointLog\` WHERE \`businessKey\` = ${businessKey} LIMIT 1 FOR UPDATE
  `
  if (existing.length > 0) return { granted: false, before: user.points, after: user.points }

  const after = user.points + input.points
  if (!Number.isSafeInteger(after) || after > 2_147_483_647) throw new Error('TOPIC_V2_POINT_BALANCE_LIMIT')
  await tx.user.update({ where: { id: input.userId }, data: { points: { increment: input.points } } })
  await tx.pointLog.create({
    data: {
      userId: input.userId,
      action: 'TOPIC_ACTIVITY_REWARD' as PointActionType,
      points: input.points,
      before: user.points,
      after,
      reason: input.reason.slice(0, 500),
      businessKey,
      activityId: input.activityId,
      sourceEventId: input.sourceEventId || undefined,
      createdAt: input.now || new Date(),
    },
  })
  return { granted: true, before: user.points, after }
}

/** Backwards-compatible name for callers that use the shorter service name. */
export const grantTopicActivityPoints = grantTopicActivityPointsInTransaction
