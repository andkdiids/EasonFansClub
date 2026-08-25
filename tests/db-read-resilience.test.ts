import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { DbTimeoutError, isRetryableDatabaseConnectionError } from '../lib/db-timeout'

const read = (path: string) => readFileSync(path, 'utf8')

test('只把瞬时连接/池超时视为可降级错误', () => {
  assert.equal(isRetryableDatabaseConnectionError({ code: 'P1017' }), true)
  assert.equal(isRetryableDatabaseConnectionError({ code: 'P2024' }), true)
  assert.equal(isRetryableDatabaseConnectionError(new DbTimeoutError('site-setting')), true)
  assert.equal(isRetryableDatabaseConnectionError({ code: 'P2002' }), false)
  assert.equal(isRetryableDatabaseConnectionError(new Error('invalid registration setting')), false)
})

test('注册页只对连接异常使用无重试的安全默认值', () => {
  const registration = read('lib/registration.ts')
  const timeout = read('lib/db-timeout.ts')

  assert.match(registration, /safeRetryableDbRead\('registration\.control'/)
  assert.match(registration, /safeRetryableDbRead\('registration\.security'/)
  assert.match(registration, /safeRetryableDbRead\('registration\.ehospital'/)
  assert.match(timeout, /Unknown errors are rethrown/)
  assert.match(timeout, /no-retry/)
})
