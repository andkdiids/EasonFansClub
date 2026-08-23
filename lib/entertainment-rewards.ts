import { randomInt } from 'node:crypto'

import {
  areRecentDailyPrescriptionRewardsAllLow,
  generateDailyPrescriptionReward,
  type RandomInteger,
} from '@/lib/daily-prescription-reward'

export * from '@/lib/daily-prescription-reward'

const secureRandomInteger: RandomInteger = (maxExclusive) => randomInt(maxExclusive)

export function drawDailyPrescriptionReward(
  recentRewards: readonly number[] = [],
  randomInteger: RandomInteger = secureRandomInteger,
) {
  return generateDailyPrescriptionReward(randomInteger, {
    excludeLowRange: areRecentDailyPrescriptionRewardsAllLow(recentRewards),
  })
}
