import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  drawShunItem,
  SHUN_COMMUNITY_DROP_RULES,
  SHUN_GIFT_WEIGHTS,
  SHUN_ITEM_CATALOG,
  type ShunItemCode,
} from '../lib/shun-item-rules'

test('default reward pool allocates all 100 outcomes with the specified weights', () => {
  const pool = (Object.keys(SHUN_ITEM_CATALOG) as ShunItemCode[])
    .map((code) => [code, SHUN_ITEM_CATALOG[code].weight] as const)
  const outcomes = Array.from({ length: 100 }, (_, roll) => drawShunItem(pool, () => roll))
  assert.deepEqual(pool.map(([code]) => outcomes.filter((value) => value === code).length), [28, 22, 18, 14, 9, 6, 3])
})

test('gift outcomes are restricted to the three allowed items', () => {
  const pool = (Object.keys(SHUN_GIFT_WEIGHTS) as Array<keyof typeof SHUN_GIFT_WEIGHTS>)
    .map((code) => [code, SHUN_GIFT_WEIGHTS[code]] as const)
  const outcomes = Array.from({ length: 100 }, (_, roll) => drawShunItem(pool, () => roll))
  assert.deepEqual(pool.map(([code]) => outcomes.filter((value) => value === code).length), [45, 30, 25])
})

test('draw rejects malformed weight totals and duplicate item codes', () => {
  assert.throws(() => drawShunItem([['EXTRA_ATTEMPT', 98]]), /INVALID_SHUN_ITEM_POOL/)
  assert.throws(() => drawShunItem([['EXTRA_ATTEMPT', 50], ['EXTRA_ATTEMPT', 50]]), /INVALID_SHUN_ITEM_POOL/)
  assert.throws(() => drawShunItem([]), /INVALID_SHUN_ITEM_POOL/)
})

test('community probabilities and judgment limits match each event', () => {
  assert.deepEqual(Object.values(SHUN_COMMUNITY_DROP_RULES).map((rule) => [rule.chance, rule.dailyChecks]), [
    [15, 1], [15, 1], [8, 5], [10, 3], [5, 10],
  ])
})
