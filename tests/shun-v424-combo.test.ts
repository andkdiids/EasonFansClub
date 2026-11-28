import test from 'node:test'
import assert from 'node:assert/strict'
import { comboEffectLines, normalizeAttackCodes, resolveShunCombo, SHUN_ATTACK_CODES } from '../lib/shun-combo.ts'

const [TARGET, DOUBLE, SUSPECT] = SHUN_ATTACK_CODES

test('V4.2.4 接受全部八种攻击道具组合并保持稳定顺序', () => {
  const cases: Array<[string[], number, number]> = [
    [[], 1, 3],
    [[TARGET], 1, 3],
    [[DOUBLE], 2, 3],
    [[SUSPECT], 1, 4],
    [[TARGET, DOUBLE], 2, 3],
    [[TARGET, SUSPECT], 1, 4],
    [[DOUBLE, SUSPECT], 2, 4],
    [[TARGET, DOUBLE, SUSPECT], 2, 4],
  ]
  for (const [input, multiplier, candidateCount] of cases) {
    const codes = normalizeAttackCodes(input)
    assert.deepEqual(codes, SHUN_ATTACK_CODES.filter((code) => input.includes(code)), input.join('+'))
    const combo = resolveShunCombo(codes ?? [])
    assert.equal(combo.multiplier, multiplier, `multiplier: ${input.join('+')}`)
    assert.equal(combo.candidateCount, candidateCount, `candidates: ${input.join('+')}`)
    assert.equal(combo.targetFriend, input.includes(TARGET))
    assert.equal(combo.extraSuspect, input.includes(SUSPECT))
  }
})

test('V4.2.4 拒绝未知道具与同种攻击道具重复叠加', () => {
  assert.equal(normalizeAttackCodes(null), null)
  assert.equal(normalizeAttackCodes('TARGET_FRIEND'), null)
  assert.equal(normalizeAttackCodes([TARGET, TARGET]), null)
  assert.equal(normalizeAttackCodes([DOUBLE, DOUBLE, SUSPECT]), null)
  assert.equal(normalizeAttackCodes(['EXTRA_ATTEMPT']), null)
  assert.equal(normalizeAttackCodes(['FRIEND_GIFT', 'REVENGE', 'RETRY_CAPTURE']), null)
})

test('V4.2.4 效果预览只描述规则，不暴露金额或余额', () => {
  const lines = comboEffectLines([TARGET, DOUBLE, SUSPECT])
  assert.equal(lines.length, 3)
  assert.ok(lines.some((line) => line.includes('指定一位通讯录好友')))
  assert.ok(lines.some((line) => line.includes('最多14挂号费')))
  assert.ok(lines.some((line) => line.includes('三选一')) && lines.some((line) => line.includes('四选一')))
  assert.ok(!lines.some((line) => /\d+.*挂号费.*(余额|抽中)/.test(line)))
  assert.deepEqual(comboEffectLines([]), [])
})
