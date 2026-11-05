export type ActivityLotteryPublicCompletion = {
  status: 'DRAFT' | 'SCHEDULED' | 'DRAWN' | 'CANCELLED'
  drawnAt: Date | string | null
  winnerCount: number | null
}

export function isActivityLotteryPubliclyComplete(lottery: ActivityLotteryPublicCompletion) {
  return (lottery.status === 'DRAWN' || lottery.status === 'CANCELLED') && Boolean(lottery.drawnAt) && lottery.winnerCount !== null
}

export function hasCompleteActivityLotteryPublicRecords(lottery: ActivityLotteryPublicCompletion, entries: Array<{ prizeId: string | null; hasPrize: boolean; hasUser: boolean }>) {
  return isActivityLotteryPubliclyComplete(lottery)
    && lottery.winnerCount === entries.length
    && entries.every((entry) => Boolean(entry.prizeId && entry.hasPrize && entry.hasUser))
}

export function getActivityLotteryRecordIntegrityIssues(input: {
  status: 'DRAFT' | 'SCHEDULED' | 'DRAWN' | 'CANCELLED'
  drawnAt: Date | string | null
  winnerCount: number | null
  entries: Array<{ prizeId: string | null; hasPrize: boolean }>
}) {
  const issues: string[] = []
  const isCompletedOrMarkedDrawn = input.status === 'DRAWN' || (input.status === 'CANCELLED' && (Boolean(input.drawnAt) || Boolean(input.winnerCount) || input.entries.length > 0))
  if (!isCompletedOrMarkedDrawn) return issues
  if (!input.drawnAt) issues.push('缺少实际开奖时间，未向前台公开')
  if (input.winnerCount === null) issues.push('缺少已记录中奖人数，未向前台公开')
  else if (input.winnerCount !== input.entries.length) issues.push(`声明中奖人数 ${input.winnerCount} 与已保存中奖记录数 ${input.entries.length} 不一致`)
  if (input.entries.some((entry) => !entry.prizeId || !entry.hasPrize)) issues.push('存在未关联奖品的中奖记录')
  return issues
}

export type PublicLotteryWinnerRecord = {
  nickname: string
  avatarUrl: string | null
  tierName: string
  prizeName: string
  createdAt: string
  wonAt: string
  rewardStatus: 'PENDING' | 'FULFILLED' | 'FAILED' | 'NOT_REQUIRED' | 'REDEEMABLE' | 'WAITING_FOR_CHECK_IN' | 'EXPIRED' | 'REDEEMED'
  rewardAt: string | null
}

export function groupActivityLotteryWinnersByPrize<TPrize extends { id: string; winners: PublicLotteryWinnerRecord[] }>(
  prizes: TPrize[],
  winners: Array<PublicLotteryWinnerRecord & { prizeId: string | null }>,
  publiclyComplete: boolean,
) {
  const winnersByPrize = new Map<string, PublicLotteryWinnerRecord[]>()
  if (publiclyComplete) {
    for (const winner of winners) {
      if (!winner.prizeId) continue
      const prizeWinners = winnersByPrize.get(winner.prizeId) || []
      prizeWinners.push({
        nickname: winner.nickname,
        avatarUrl: winner.avatarUrl,
        tierName: winner.tierName,
        prizeName: winner.prizeName,
        createdAt: winner.createdAt,
        wonAt: winner.wonAt,
        rewardStatus: winner.rewardStatus,
        rewardAt: winner.rewardAt,
      })
      winnersByPrize.set(winner.prizeId, prizeWinners)
    }
  }
  return prizes.map((prize) => ({ ...prize, winners: winnersByPrize.get(prize.id) || [] }))
}
