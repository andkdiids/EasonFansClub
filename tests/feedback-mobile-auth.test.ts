import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { FEEDBACK_DESCRIPTION_MIN_LENGTH, isFeedbackSubmissionContentValid } from '../lib/feedback'

const read = (path: string) => readFileSync(path, 'utf8')

test('feedback list and submit accept the shared request auth path used by App Bearer sessions', () => {
  const route = read('app/api/feedback/route.ts')
  assert.match(route, /export async function GET\(request: Request\)[\s\S]*?requireRequestUser\(request\)/)
  assert.match(route, /export async function POST\(request: Request\)[\s\S]*?requireRequestUser\(request\)/)
  assert.doesNotMatch(route, /requireUser\(/)
  assert.match(route, /where: \{ userId: guard\.user\.id/)
  assert.match(route, /userId: guard\.user\.id/)
})

test('feedback image authorization happens through the same request auth before multipart parsing', () => {
  const route = read('app/api/uploads/feedback-image/route.ts')
  assert.match(route, /requireRequestUser\(request\)/)
  assert.doesNotMatch(route, /requireUser\(/)
  assert.ok(route.indexOf('requireRequestUser(request)') < route.indexOf('request.formData()'))
  assert.match(route, /feedback\/\$\{guard\.user\.id\}/)
  assert.match(route, /uploadImageVariantFamily/)
  assert.match(route, /rejectInvalidRequestOrigin\(request\)/)
})

test('Bearer auth retains strict precedence and browser cookies remain the fallback when no authorization header exists', () => {
  const source = read('lib/security.ts')
  assert.match(source, /if \(request\.headers\.has\('authorization'\)\)[\s\S]*?resolveMobileAccess\(request\)/)
  assert.match(source, /if \(request\.headers\.has\('authorization'\)\)[\s\S]*?return \{ user, response: null \}[\s\S]*?const user = await getCurrentUser\(\)/)
})

test('feedback POST accepts the active request session while retaining CSRF source checks and request idempotency', () => {
  const route = read('app/api/feedback/route.ts')
  assert.match(route, /export async function POST\(request: Request\)[\s\S]*?rejectInvalidRequestOrigin\(request\)[\s\S]*?requireRequestUser\(request\)/)
  assert.match(route, /Idempotency-Key/)
  assert.match(route, /userId: guard\.user\.id/)
  assert.match(route, /replyId: message\.id/)
  assert.match(route, /feedbackInclude/)
})

test('feedback backend minimum matches the mobile JS trim-and-length rule and uploaded images can satisfy it', () => {
  assert.equal(FEEDBACK_DESCRIPTION_MIN_LENGTH, 10)
  assert.equal(isFeedbackSubmissionContentValid('', 0), false)
  assert.equal(isFeedbackSubmissionContentValid('123456789', 0), false)
  assert.equal(isFeedbackSubmissionContentValid('  1234567890  ', 0), true)
  assert.equal(isFeedbackSubmissionContentValid('12345678😀', 0), true)
  assert.equal(isFeedbackSubmissionContentValid('', 1), true)
  assert.equal(isFeedbackSubmissionContentValid('短', 1), true)
  assert.equal(isFeedbackSubmissionContentValid('短\n\n——\n客户端环境\nApp 版本：test', 0), false)
  assert.equal(isFeedbackSubmissionContentValid('1234567890\n\n——\n客户端环境\nApp 版本：test', 0), true)
})
