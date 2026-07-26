import { randomInt } from 'node:crypto'

export const ENTERTAINMENT_REWARD_POOL = [
  { points: 5, weight: 35 },
  { points: 8, weight: 30 },
  { points: 10, weight: 20 },
  { points: 15, weight: 10 },
  { points: 20, weight: 5 },
] as const

export function selectEntertainmentReward(roll = randomInt(100)) {
  const normalizedRoll = Math.max(0, Math.min(99, Math.floor(roll)))
  let upperBound = 0

  for (const reward of ENTERTAINMENT_REWARD_POOL) {
    upperBound += reward.weight
    if (normalizedRoll < upperBound) return reward.points
  }

  return ENTERTAINMENT_REWARD_POOL[0].points
}
