export const ACTIVITY_LOTTERY_PRIZE_TYPES = ['PHYSICAL', 'VIRTUAL'] as const
export const ACTIVITY_LOTTERY_VIRTUAL_PRIZE_TYPES = ['BADGE', 'REGISTRATION_FEE'] as const
export const MAX_ACTIVITY_LOTTERY_REGISTRATION_FEE = 1_000_000

export type ActivityLotteryPrizeType = (typeof ACTIVITY_LOTTERY_PRIZE_TYPES)[number]
export type ActivityLotteryVirtualPrizeType = (typeof ACTIVITY_LOTTERY_VIRTUAL_PRIZE_TYPES)[number]
