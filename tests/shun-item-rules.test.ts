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

test('item config rejects empty enabled pools and incompatible gift entries', async () => {
  const { defaultShunItemDefinitions, defaultShunItemRules, validateShunItemDraft } = await import('../lib/shun-item-config')
  const defaults = { enabled: true, definitions: defaultShunItemDefinitions, rules: defaultShunItemRules }
  assert.ok(validateShunItemDraft(defaults))
  assert.equal(validateShunItemDraft({ ...defaults, definitions: defaults.definitions.map((item) => ({ ...item, enabled: false })) }), null)
  assert.equal(validateShunItemDraft({
    ...defaults, rules: { ...defaultShunItemRules, gifts: { ...defaultShunItemRules.gifts, RETRY_CAPTURE: 0 } },
  }), null)
  assert.equal(validateShunItemDraft({
    ...defaults, definitions: defaults.definitions.map((item) => item.code === 'TARGET_FRIEND' ? { ...item, name: '旧名称' } : item),
  }), null)
})

test('random gifting cannot accept a selected friend while directed takes still can', async () => {
  const { readFile } = await import('node:fs/promises')
  const route = await readFile('app/api/shun-master/[action]/route.ts', 'utf8')
  assert.match(route, /Object\.keys\(body\)\.some\(\(key\) => key !== 'requestId'\)/)
  assert.match(route, /sendShunItemGift\(guard\.user\.id, body\.requestId\)/)
  assert.match(route, /shunAttempt\(guard\.user\.id, body\.requestId, undefined, body\.friendId\)/)
  const box = await readFile('app/shun-master/ShunItemBox.tsx', 'utf8')
  assert.match(box, /onUse\('gift'\)/)
  // V4.2.1 改为双向赠礼结果面板：送出与回礼同时展示。
  assert.match(box, /正在送出这份惊喜/)
  assert.match(box, /礼物已送达！/)
  assert.match(box, /你也收到了/)
})
