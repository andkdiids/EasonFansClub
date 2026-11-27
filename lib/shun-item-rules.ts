import { randomInt } from 'node:crypto'

export const SHUN_ITEM_CATALOG = {
  EXTRA_ATTEMPT: { name: '顺手牵羊', rarity: '普通', weight: 28 },
  FRIEND_GIFT: { name: '天使的礼物', rarity: '普通', weight: 22 },
  EXTRA_SUSPECT: { name: '十面埋伏', rarity: '稀有', weight: 18 },
  REVENGE: { name: '最佳损友', rarity: '稀有', weight: 14 },
  TARGET_FRIEND: { name: '任我顺', rarity: '珍藏', weight: 9 },
  DOUBLE_AMOUNT: { name: '碌卡', rarity: '珍藏', weight: 6 },
  RETRY_CAPTURE: { name: '时光倒流', rarity: '隐藏', weight: 3 },
} as const

export type ShunItemCode = keyof typeof SHUN_ITEM_CATALOG

export const SHUN_GIFT_WEIGHTS = {
  EXTRA_ATTEMPT: 45,
  EXTRA_SUSPECT: 30,
  REVENGE: 25,
} as const

export const SHUN_COMMUNITY_DROP_RULES = {
  CHECK_IN: { chance: 15, dailyChecks: 1 },
  PRESCRIPTION: { chance: 15, dailyChecks: 1 },
  COMMENT: { chance: 8, dailyChecks: 5 },
  SHARE: { chance: 10, dailyChecks: 3 },
  LIKE: { chance: 5, dailyChecks: 10 },
} as const

export const SHUN_WEEKLY_MILESTONES = [3, 5, 7] as const

export function drawShunItem<K extends ShunItemCode>(
  pool: ReadonlyArray<readonly [K, number]>,
  draw: (max: number) => number = randomInt,
): K {
  if (pool.some(([, weight]) => !Number.isInteger(weight) || weight < 0)
    || pool.reduce((total, [, weight]) => total + weight, 0) !== 100
    || new Set(pool.map(([code]) => code)).size !== pool.length) {
    throw new Error('INVALID_SHUN_ITEM_POOL')
  }
  let remaining = draw(100)
  if (!Number.isInteger(remaining) || remaining < 0 || remaining >= 100) {
    throw new Error('INVALID_SHUN_ITEM_DRAW')
  }
  for (const [code, weight] of pool) {
    remaining -= weight
    if (remaining < 0) return code
  }
  throw new Error('INVALID_SHUN_ITEM_POOL')
}
