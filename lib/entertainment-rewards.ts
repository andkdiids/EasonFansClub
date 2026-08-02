import { randomInt } from 'node:crypto'

import {
  DAILY_PRESCRIPTION_REWARD_TOTAL_WEIGHT,
  drawDailyPrescriptionRewardFromRoll,
  type RandomInteger,
} from '@/lib/daily-prescription-reward'

export * from '@/lib/daily-prescription-reward'

const secureRandomInteger: RandomInteger = (maxExclusive) => randomInt(maxExclusive)

export function drawDailyPrescriptionReward(randomInteger: RandomInteger = secureRandomInteger) {
  return drawDailyPrescriptionRewardFromRoll(randomInteger(DAILY_PRESCRIPTION_REWARD_TOTAL_WEIGHT))
}
