export const MIN_DAILY_PRESCRIPTION_REWARD = 7
export const MAX_DAILY_PRESCRIPTION_REWARD = 27

export type RandomInteger = (maxExclusive: number) => number

export const DAILY_PRESCRIPTION_REWARD_RANGES = {
  low: { min: 7, max: 11 },
  middle: { min: 12, max: 21 },
  high: { min: 22, max: 27 },
} as const

export const DAILY_PRESCRIPTION_REWARD_RANGE_WEIGHTS = {
  low: 27,
  middle: 46,
  high: 27,
} as const

type RewardRange = (typeof DAILY_PRESCRIPTION_REWARD_RANGES)[keyof typeof DAILY_PRESCRIPTION_REWARD_RANGES]

// These are range weights only. Every integer inside the selected range is
// drawn uniformly in a separate step.
const REWARD_RANGE_OPTIONS: ReadonlyArray<{ range: RewardRange; weight: number }> = [
  { range: DAILY_PRESCRIPTION_REWARD_RANGES.low, weight: DAILY_PRESCRIPTION_REWARD_RANGE_WEIGHTS.low },
  { range: DAILY_PRESCRIPTION_REWARD_RANGES.middle, weight: DAILY_PRESCRIPTION_REWARD_RANGE_WEIGHTS.middle },
  { range: DAILY_PRESCRIPTION_REWARD_RANGES.high, weight: DAILY_PRESCRIPTION_REWARD_RANGE_WEIGHTS.high },
]

function assertRandomIntegerResult(value: number, maxExclusive: number) {
  if (!Number.isInteger(value) || value < 0 || value >= maxExclusive) {
    throw new RangeError('DAILY_PRESCRIPTION_RANDOM_INTEGER_OUT_OF_RANGE')
  }
}

function selectRewardRange(randomInteger: RandomInteger, excludeLowRange: boolean) {
  const eligibleRanges = excludeLowRange
    ? REWARD_RANGE_OPTIONS.filter((option) => option.range !== DAILY_PRESCRIPTION_REWARD_RANGES.low)
    : REWARD_RANGE_OPTIONS
  const totalWeight = eligibleRanges.reduce((total, option) => total + option.weight, 0)
  const rangeRoll = randomInteger(totalWeight)
  assertRandomIntegerResult(rangeRoll, totalWeight)

  let upperBound = 0
  for (const option of eligibleRanges) {
    upperBound += option.weight
    if (rangeRoll < upperBound) return option.range
  }

  throw new Error('DAILY_PRESCRIPTION_REWARD_RANGE_DRAW_FAILED')
}

export function areRecentDailyPrescriptionRewardsAllLow(recentRewards: readonly number[]) {
  return recentRewards.length >= 3
    && recentRewards.slice(0, 3).every(
      (reward) => Number.isInteger(reward)
        && reward >= DAILY_PRESCRIPTION_REWARD_RANGES.low.min
        && reward <= DAILY_PRESCRIPTION_REWARD_RANGES.low.max,
    )
}

export function generateDailyPrescriptionReward(
  randomInteger: RandomInteger,
  options: { excludeLowRange?: boolean } = {},
) {
  const range = selectRewardRange(randomInteger, options.excludeLowRange === true)
  const rangeSize = range.max - range.min + 1
  const valueRoll = randomInteger(rangeSize)
  assertRandomIntegerResult(valueRoll, rangeSize)
  return range.min + valueRoll
}
