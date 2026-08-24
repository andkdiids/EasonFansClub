export const MIN_DAILY_PRESCRIPTION_REWARD = 7
export const MAX_DAILY_PRESCRIPTION_REWARD = 27

export type RandomInteger = (maxExclusive: number) => number

// One global pool for 7–27. Each weight is one thousandth of a percentage
// point, so the total weight is 100,000 and the displayed probability is
// weight / 1,000 percent.
export const DAILY_PRESCRIPTION_REWARD_WEIGHTS = [
  { reward: 7, weight: 8024 },
  { reward: 8, weight: 7698 },
  { reward: 9, weight: 7371 },
  { reward: 10, weight: 7045 },
  { reward: 11, weight: 6719 },
  { reward: 12, weight: 6393 },
  { reward: 13, weight: 6067 },
  { reward: 14, weight: 5740 },
  { reward: 15, weight: 5414 },
  { reward: 16, weight: 5088 },
  { reward: 17, weight: 4762 },
  { reward: 18, weight: 4436 },
  { reward: 19, weight: 4110 },
  { reward: 20, weight: 3783 },
  { reward: 21, weight: 3457 },
  { reward: 22, weight: 3131 },
  { reward: 23, weight: 2805 },
  { reward: 24, weight: 2479 },
  { reward: 25, weight: 2152 },
  { reward: 26, weight: 1826 },
  { reward: 27, weight: 1500 },
] as const

export const DAILY_PRESCRIPTION_REWARD_WEIGHT_TOTAL = DAILY_PRESCRIPTION_REWARD_WEIGHTS.reduce(
  (total, option) => total + option.weight,
  0,
)

function assertRandomIntegerResult(value: number, maxExclusive: number) {
  if (!Number.isInteger(value) || value < 0 || value >= maxExclusive) {
    throw new RangeError('DAILY_PRESCRIPTION_RANDOM_INTEGER_OUT_OF_RANGE')
  }
}

export function generateDailyPrescriptionReward(randomInteger: RandomInteger) {
  const rewardRoll = randomInteger(DAILY_PRESCRIPTION_REWARD_WEIGHT_TOTAL)
  assertRandomIntegerResult(rewardRoll, DAILY_PRESCRIPTION_REWARD_WEIGHT_TOTAL)

  let upperBound = 0
  for (const option of DAILY_PRESCRIPTION_REWARD_WEIGHTS) {
    upperBound += option.weight
    if (rewardRoll < upperBound) return option.reward
  }

  throw new Error('DAILY_PRESCRIPTION_REWARD_DRAW_FAILED')
}
