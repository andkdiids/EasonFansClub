export const MIN_DAILY_PRESCRIPTION_REWARD = 7
export const MAX_DAILY_PRESCRIPTION_REWARD = 27

export type RandomInteger = (maxExclusive: number) => number

/**
 * Higher rewards intentionally have smaller integer weights: weight = 28 - reward.
 * Keeping the draw in integer intervals makes every boundary deterministic in tests
 * and avoids floating-point probability accumulation.
 */
export function getRewardWeight(reward: number) {
  if (!Number.isInteger(reward) || reward < MIN_DAILY_PRESCRIPTION_REWARD || reward > MAX_DAILY_PRESCRIPTION_REWARD) {
    throw new RangeError('DAILY_PRESCRIPTION_REWARD_OUT_OF_RANGE')
  }
  return 28 - reward
}

export const DAILY_PRESCRIPTION_REWARD_WEIGHTS: ReadonlyArray<{ reward: number; weight: number }> = Array.from(
  { length: MAX_DAILY_PRESCRIPTION_REWARD - MIN_DAILY_PRESCRIPTION_REWARD + 1 },
  (_, offset) => {
    const reward = MIN_DAILY_PRESCRIPTION_REWARD + offset
    return { reward, weight: getRewardWeight(reward) }
  },
)

export const DAILY_PRESCRIPTION_REWARD_TOTAL_WEIGHT = DAILY_PRESCRIPTION_REWARD_WEIGHTS.reduce(
  (total, item) => total + item.weight,
  0,
)

export function drawDailyPrescriptionRewardFromRoll(randomRoll: number) {
  if (!Number.isInteger(randomRoll) || randomRoll < 0 || randomRoll >= DAILY_PRESCRIPTION_REWARD_TOTAL_WEIGHT) {
    throw new RangeError('DAILY_PRESCRIPTION_REWARD_ROLL_OUT_OF_RANGE')
  }

  let upperBound = 0
  for (const item of DAILY_PRESCRIPTION_REWARD_WEIGHTS) {
    upperBound += item.weight
    if (randomRoll < upperBound) return item.reward
  }

  throw new Error('DAILY_PRESCRIPTION_REWARD_DRAW_FAILED')
}
