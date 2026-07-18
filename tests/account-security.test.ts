import assert from 'node:assert/strict'
import test from 'node:test'
import {
  hashSecurityQuestions,
  getSecurityQuestionRecoveryAvailability,
  normalizeSecurityAnswer,
  parseSecurityQuestions,
  validateSecurityQuestions,
  verifySecurityAnswers,
} from '../lib/account-security'
import { createPlainToken, hashToken } from '../lib/tokens'
import { hasValidRequestOrigin } from '../lib/security'

const completeQuestions = [{ question: '第一场演唱会在哪里？', answer: '  Hong   Kong  ' }]

test('完整的一个密保问题可通过校验', () => {
  assert.equal(validateSecurityQuestions(parseSecurityQuestions(completeQuestions)), null)
})

test('没有密保问题时拒绝注册或设置', () => {
  assert.match(validateSecurityQuestions(parseSecurityQuestions([])) || '', /1 个/)
})

test('旧的多题输入只解析第一条', () => {
  const parsed = parseSecurityQuestions([...completeQuestions, { question: '第二题', answer: '第二答案' }])
  assert.equal(parsed.length, 1)
  assert.equal(parsed[0].question, '第一场演唱会在哪里?')
})

test('答案会 trim、统一大小写并折叠空格', () => {
  assert.equal(normalizeSecurityAnswer('  Hong   KONG  '), 'hong kong')
})

test('答案使用密码同等级哈希且不会明文保存', async () => {
  const parsed = parseSecurityQuestions(completeQuestions)
  const hashed = await hashSecurityQuestions(parsed)
  assert.equal(hashed.length, 1)
  assert.equal(hashed.some((item) => item.answerHash.includes('hong kong')), false)
  assert.equal(await verifySecurityAnswers(hashed, completeQuestions.map((item) => ({ answer: item.answer }))), true)
})

test('密保答案错误会导致验证失败', async () => {
  const hashed = await hashSecurityQuestions(parseSecurityQuestions(completeQuestions))
  const answers = completeQuestions.map((item) => ({ answer: item.answer }))
  answers[0] = { answer: '错误答案' }
  assert.equal(await verifySecurityAnswers(hashed, answers), false)
})

test('重置凭证为随机明文且数据库哈希不可反推', () => {
  const first = createPlainToken()
  const second = createPlainToken()
  assert.notEqual(first, second)
  assert.notEqual(hashToken(first), first)
  assert.equal(hashToken(first), hashToken(first))
})

test('全局关闭时所有用户都不能使用密保找回', () => {
  assert.deepEqual(getSecurityQuestionRecoveryAvailability({ globalEnabled: false, userEnabled: true, questionCount: 1 }), { available: false, reason: 'GLOBAL_DISABLED' })
})

test('全局开启但用户级关闭时仍不可用', () => {
  assert.deepEqual(getSecurityQuestionRecoveryAvailability({ globalEnabled: true, userEnabled: false, questionCount: 1 }), { available: false, reason: 'USER_DISABLED' })
})

test('未设置密保问题时不可启用密保找回', () => {
  assert.deepEqual(getSecurityQuestionRecoveryAvailability({ globalEnabled: true, userEnabled: true, questionCount: 0 }), { available: false, reason: 'QUESTIONS_INCOMPLETE' })
})

test('全局和用户级均开启且单题完整时可用', () => {
  assert.deepEqual(getSecurityQuestionRecoveryAvailability({ globalEnabled: true, userEnabled: true, questionCount: 1 }), { available: true, reason: 'AVAILABLE' })
})

test('反向代理后的同源安全请求可以通过来源校验', () => {
  const request = new Request('http://internal:3000/api/account/security/questions', { headers: {
    origin: 'https://ecfc.fans',
    'sec-fetch-site': 'same-site',
    'x-forwarded-host': 'ecfc.fans',
    'x-forwarded-proto': 'https',
  } })
  assert.equal(hasValidRequestOrigin(request), true)
})
