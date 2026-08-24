import { randomInt } from 'node:crypto'

import { generateDailyPrescriptionReward, type RandomInteger } from '@/lib/daily-prescription-reward'

export * from '@/lib/daily-prescription-reward'

const secureRandomInteger: RandomInteger = (maxExclusive) => randomInt(maxExclusive)

export function drawDailyPrescriptionReward(
  randomInteger: RandomInteger = secureRandomInteger,
) {
  return generateDailyPrescriptionReward(randomInteger)
}
