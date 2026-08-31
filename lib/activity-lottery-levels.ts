export const ACTIVITY_LOTTERY_TIER_NAMES = ['一等奖', '二等奖', '三等奖', '参与奖'] as const

export const MAX_ACTIVITY_LOTTERY_PRIZES = ACTIVITY_LOTTERY_TIER_NAMES.length

export function activityLotteryTierName(index: number) {
  return ACTIVITY_LOTTERY_TIER_NAMES[index] || ''
}
