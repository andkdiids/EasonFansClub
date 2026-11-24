import assert from 'node:assert/strict'
import test from 'node:test'
import { captureMode, defaultShunConfig, shunConfigError, shunDay, validateShunConfig, weightedIndex } from '../lib/shun-master-rules'

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

test('validation errors identify the actual failing rule', () => {
  assert.equal(shunConfigError(defaultShunConfig), null)
  assert.match(shunConfigError({ ...defaultShunConfig, attempts: 0 }) ?? '', /每日顺取次数/)
  assert.match(shunConfigError({ ...defaultShunConfig, victimCap: 21 }) ?? '', /每日被顺上限/)
  assert.match(shunConfigError({ ...defaultShunConfig, goldenMinutes: 0 }) ?? '', /黄金抓捕期/)
  assert.match(shunConfigError({ ...defaultShunConfig, probabilities: [25, 21, 17, 14, 10, 7, 5] }) ?? '', /概率必须合计 100%/)
  assert.match(shunConfigError({ ...defaultShunConfig, probabilities: [25, 21, 17, 14, 10, 6, 7] }) ?? '', /严格递减/)
  assert.match(shunConfigError({ ...defaultShunConfig, weights: [131, 122, 115, 108, 100] }) ?? '', /活跃度权重/)
  assert.equal(validateShunConfig({ ...defaultShunConfig, probabilities: [25, 21, 17, 14, 10, 7, 5] }), null)
  assert.equal(validateShunConfig({ ...defaultShunConfig, weights: [131, 122, 115, 108, 100] }), null)
})
