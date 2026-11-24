import assert from 'node:assert/strict'
import test from 'node:test'
import {
  activityTier, captureMode, defaultShunConfig, friendPoolDraw, pickStratified, shunConfigError, shunDay,
  validateShunConfig, weightedIndex, type ShunConfig, type StratifiedCandidate,
} from '../lib/shun-master-rules'

/** Deterministic 32-bit LCG so every statistical gate below is reproducible. */
function seeded(seed: number) {
  let state = seed >>> 0
  return (max: number) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return Math.floor(state / 4294967296 * max)
  }
}

const config = (patch: Partial<ShunConfig>): Partial<ShunConfig> => ({ ...defaultShunConfig, ...patch })

test('all 100 possible tickets match the configured distribution', () => {
  const counts = Array(7).fill(0)
  for (let ticket = 0; ticket < 100; ticket++) counts[weightedIndex(defaultShunConfig.probabilities, () => ticket)]++
  assert.deepEqual(counts, [25, 21, 17, 14, 10, 7, 6])
  assert.equal(counts.reduce((sum, count, index) => sum + count * (index + 1), 0), 308)
})

test('Beijing midnight and the exact capture deadline are exclusive boundaries', () => {
  const deadline = new Date('2026-11-23T16:00:00Z')
  const earlier = new Date(deadline.getTime() - 1)
  assert.equal(shunDay(earlier), '2026-11-23')
  assert.equal(shunDay(deadline), '2026-11-24')
  assert.equal(captureMode(earlier, deadline), 2)
  assert.equal(captureMode(deadline, deadline), 3)
})

test('configs without a budget are valid and legacy budget values are ignored', () => {
  assert.deepEqual(validateShunConfig(defaultShunConfig), defaultShunConfig)
  assert.deepEqual(validateShunConfig({ ...defaultShunConfig, budget: 0 }), defaultShunConfig)
  assert.deepEqual(validateShunConfig({ ...defaultShunConfig, budget: 10_000_000 }), defaultShunConfig)
  assert.equal(shunConfigError({ ...defaultShunConfig, budget: -1 }), null)
})

test('amount probabilities accept any order and any zero tier, as long as they total 100', () => {
  // 1:10 2:15 3:20 4:20 5:15 6:10 7:10 — neither ascending nor descending.
  assert.equal(shunConfigError(config({ probabilities: [10, 15, 20, 20, 15, 10, 10] })), null)
  assert.equal(shunConfigError(config({ probabilities: [1, 1, 1, 1, 1, 1, 94] })), null)
  assert.equal(shunConfigError(config({ probabilities: [0, 50, 0, 50, 0, 0, 0] })), null)
  assert.equal(shunConfigError(config({ probabilities: [100, 0, 0, 0, 0, 0, 0] })), null)
  assert.deepEqual(validateShunConfig(config({ probabilities: [10, 15, 20, 20, 15, 10, 10] }))?.probabilities,
    [10, 15, 20, 20, 15, 10, 10])
})

test('amount probabilities still require a 100% total and a 0-100 integer range', () => {
  assert.match(shunConfigError(config({ probabilities: [10, 10, 10, 10, 10, 10, 10] })) ?? '', /合计 100%/)
  assert.match(shunConfigError(config({ probabilities: [0, 0, 0, 0, 0, 0, 0] })) ?? '', /合计 100%/)
  assert.match(shunConfigError(config({ probabilities: [50, 50, 0, 0, 0, 0, 1] })) ?? '', /合计 100%/)
  assert.match(shunConfigError(config({ probabilities: [101, -1, 0, 0, 0, 0, 0] })) ?? '', /0 到 100 的整数/)
  assert.match(shunConfigError(config({ probabilities: [10.5, 89.5, 0, 0, 0, 0, 0] })) ?? '', /0 到 100 的整数/)
  assert.match(shunConfigError(config({ probabilities: [10, 20, 30, 40, 0, 0] })) ?? '', /7 档/)
})

test('activity weights accept any order, equal values and the 1-300 range', () => {
  for (const weights of [
    [100, 110, 120, 130, 140], [120, 100, 140, 110, 130], [100, 100, 100, 100, 100],
    [1, 1, 1, 1, 1], [300, 300, 300, 300, 300], [300, 1, 150, 2, 299],
  ]) {
    assert.equal(shunConfigError(config({ weights })), null, `乱序权重必须可保存：${weights.join(',')}`)
  }
  assert.match(shunConfigError(config({ weights: [0, 100, 100, 100, 100] })) ?? '', /活跃度权重/)
  assert.match(shunConfigError(config({ weights: [301, 100, 100, 100, 100] })) ?? '', /活跃度权重/)
  assert.match(shunConfigError(config({ weights: [100, 100, 100, 100] })) ?? '', /活跃度权重/)
})

test('the friend chance is an optional 0-100 integer that defaults to 20 for legacy configs', () => {
  assert.equal(defaultShunConfig.friendChance, 20)
  assert.equal(shunConfigError(config({ friendChance: 0 })), null)
  assert.equal(shunConfigError(config({ friendChance: 100 })), null)
  assert.match(shunConfigError(config({ friendChance: -1 })) ?? '', /好友命中概率/)
  assert.match(shunConfigError(config({ friendChance: 101 })) ?? '', /好友命中概率/)
  assert.match(shunConfigError(config({ friendChance: 12.5 })) ?? '', /好友命中概率/)
  // A configuration saved before the friend pool existed stays readable.
  const legacy = { ...defaultShunConfig } as Partial<ShunConfig>
  delete legacy.friendChance
  assert.equal(shunConfigError(legacy), null)
  assert.equal(validateShunConfig(legacy)?.friendChance, 20)
})

test('validation errors identify the actual failing rule', () => {
  assert.equal(shunConfigError(defaultShunConfig), null)
  assert.match(shunConfigError(config({ attempts: 0 })) ?? '', /每日顺取次数/)
  assert.match(shunConfigError(config({ victimCap: 21 })) ?? '', /每日被顺上限/)
  assert.match(shunConfigError(config({ goldenMinutes: 0 })) ?? '', /黄金抓捕期/)
  assert.equal(validateShunConfig(config({ attempts: 0 })), null)
})

test('the activity tier mapping is unchanged and clamped', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 9].map(activityTier), [0, 0, 1, 1, 2, 3, 3, 4, 4])
})

test('five equally weighted non-empty tiers are hit equally often regardless of population size', () => {
  const draw = seeded(20261124)
  // 100 / 200 / 400 / 800 / 1600 users — a 16x spread that used to dominate.
  const candidates: StratifiedCandidate[] = []
  for (const [tier, size] of [[0, 100], [1, 200], [2, 400], [3, 800], [4, 1600]] as const) {
    for (let i = 0; i < size; i++) candidates.push({ id: `t${tier}-${i}`, uid: candidates.length + 1, tier })
  }
  const weights = [100, 100, 100, 100, 100]
  const hits = Array(5).fill(0)
  const runs = 20000
  for (let i = 0; i < runs; i++) hits[pickStratified(candidates, weights, draw)!.tier]++
  for (const count of hits) assert.ok(Math.abs(count / runs - 0.2) < 0.02, `各群体命中率应接近 20%，实际 ${hits.join('/')}`)
})

test('unequal weights are honoured as configured, not diluted by headcount', () => {
  const draw = seeded(777)
  const candidates: StratifiedCandidate[] = []
  for (const [tier, size] of [[0, 5000], [1, 10], [2, 100], [3, 40], [4, 3]] as const) {
    for (let i = 0; i < size; i++) candidates.push({ id: `t${tier}-${i}`, uid: candidates.length + 1, tier })
  }
  const weights = [100, 110, 120, 130, 140]
  const hits = Array(5).fill(0)
  const runs = 30000
  for (let i = 0; i < runs; i++) hits[pickStratified(candidates, weights, draw)!.tier]++
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  hits.forEach((count, tier) => {
    const expected = weights[tier] / total
    assert.ok(Math.abs(count / runs - expected) < 0.02, `第 ${tier} 档期望 ${(expected * 100).toFixed(1)}%，实际 ${(count / runs * 100).toFixed(1)}%`)
  })
})

test('empty tiers are dropped and the remaining weights are renormalised', () => {
  const draw = seeded(99)
  // Only tiers 0 and 2 exist; both configured identically → 50/50.
  const candidates: StratifiedCandidate[] = []
  for (let i = 0; i < 30; i++) candidates.push({ id: `a${i}`, uid: i + 1, tier: 0 })
  for (let i = 0; i < 300; i++) candidates.push({ id: `b${i}`, uid: 100 + i, tier: 2 })
  const hits = [0, 0]
  const runs = 10000
  for (let i = 0; i < runs; i++) {
    const picked = pickStratified(candidates, [100, 100, 100, 100, 100], draw)!
    hits[picked.tier === 0 ? 0 : 1]++
  }
  assert.ok(Math.abs(hits[0] / runs - 0.5) < 0.03, `空群体必须被排除，实际 ${hits.join('/')}`)
})

test('an empty candidate set or a zero-weight tier never produces a target', () => {
  assert.equal(pickStratified([], [100, 100, 100, 100, 100], seeded(1)), null)
  const onlyTier4 = [{ id: 'x', uid: 1, tier: 4 }]
  assert.equal(pickStratified(onlyTier4, [100, 100, 100, 100, 0], seeded(1)), null, '权重为 0 的群体不得被抽中')
})

test('the friend pool is chosen at exactly the configured rate', () => {
  const draw = seeded(4242)
  const runs = 20000
  for (const chance of [0, 20, 50, 100]) {
    let hits = 0
    for (let i = 0; i < runs; i++) if (friendPoolDraw(chance, draw)) hits++
    assert.ok(Math.abs(hits / runs - chance / 100) < 0.015, `好友池概率 ${chance}% 实际 ${(hits / runs * 100).toFixed(2)}%`)
  }
  assert.equal(friendPoolDraw(0, () => 0), false, '0% 时绝不进入好友池')
  assert.equal(friendPoolDraw(100, () => 99), true, '100% 时一定优先好友池')
})
