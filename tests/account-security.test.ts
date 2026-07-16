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

const completeQuestions = [
  { question: '第一场演唱会在哪里？', answer: '  Hong   Kong  ' },
  { question: '最喜欢哪首歌？', answer: '浮夸' },
  { question: '纪念日是哪天？', answer: ' 2020-01-01 ' },
]

test('完整且不重复的三个密保问题可通过校验', () => {
  assert.equal(validateSecurityQuestions(parseSecurityQuestions(completeQuestions)), null)
})

test('少一题时拒绝注册或设置', () => {
  assert.match(validateSecurityQuestions(parseSecurityQuestions(completeQuestions.slice(0, 2))) || '', /3 个/)
})

test('重复问题会被拒绝且忽略大小写与多余空格', () => {
  const duplicated = [...completeQuestions]
  duplicated[2] = { question: '  最喜欢哪首歌？ ', answer: '另一答案' }
  assert.match(validateSecurityQuestions(parseSecurityQuestions(duplicated)) || '', /不能相同/)
})

test('答案会 trim、统一大小写并折叠空格', () => {
  assert.equal(normalizeSecurityAnswer('  Hong   KONG  '), 'hong kong')
})

test('答案使用密码同等级哈希且不会明文保存', async () => {
  const parsed = parseSecurityQuestions(completeQuestions)
  const hashed = await hashSecurityQuestions(parsed)
  assert.equal(hashed.length, 3)
  assert.equal(hashed.some((item) => item.answerHash.includes('hong kong')), false)
  assert.equal(await verifySecurityAnswers(hashed, completeQuestions.map((item) => ({ answer: item.answer }))), true)
})

test('任意一题错误都会导致三题验证失败', async () => {
  const hashed = await hashSecurityQuestions(parseSecurityQuestions(completeQuestions))
  const answers = completeQuestions.map((item) => ({ answer: item.answer }))
  answers[1] = { answer: '错误答案' }
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
  assert.deepEqual(getSecurityQuestionRecoveryAvailability({ globalEnabled: false, userEnabled: true, questionCount: 3 }), { available: false, reason: 'GLOBAL_DISABLED' })
})

test('全局开启但用户级关闭时仍不可用', () => {
  assert.deepEqual(getSecurityQuestionRecoveryAvailability({ globalEnabled: true, userEnabled: false, questionCount: 3 }), { available: false, reason: 'USER_DISABLED' })
})

test('未完整设置三题时不可启用密保找回', () => {
  assert.deepEqual(getSecurityQuestionRecoveryAvailability({ globalEnabled: true, userEnabled: true, questionCount: 2 }), { available: false, reason: 'QUESTIONS_INCOMPLETE' })
})

test('全局和用户级均开启且三题完整时可用', () => {
  assert.deepEqual(getSecurityQuestionRecoveryAvailability({ globalEnabled: true, userEnabled: true, questionCount: 3 }), { available: true, reason: 'AVAILABLE' })
})
