import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { validateRegistrationPasswordFields } from '../lib/registration-password'

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('registration password validation distinguishes required, length, and mismatch errors', () => {
  assert.deepEqual(validateRegistrationPasswordFields('', ''), {
    password: '请输入密码',
    confirmPassword: '请输入确认密码',
  })
  assert.deepEqual(validateRegistrationPasswordFields('1234567', '1234567'), {
    password: '密码至少需要 8 位',
  })
  assert.deepEqual(validateRegistrationPasswordFields('abcdefgh', 'abcdefgi'), {
    confirmPassword: '两次输入的密码不一致',
  })
  assert.deepEqual(validateRegistrationPasswordFields('abcdefgh', 'abcdefgh'), {})
})

test('registration uses the shared password rule on both client and server', () => {
  const form = source('app/register/RegisterForm.tsx')
  const prepare = source('app/api/auth/register/prepare/route.ts')
  const register = source('app/api/auth/register/route.ts')
  const login = source('app/login/LoginForm.tsx')

  assert.match(form, /placeholder="请输入密码（至少8位）"/)
  assert.match(form, /validateRegistrationPasswordFields\(password, confirmPassword\)/)
  assert.match(prepare, /validateRegistrationPasswordFields\(password, confirmPassword\)/)
  assert.match(register, /validateRegistrationPasswordFields\(password, confirmPassword\)/)
  assert.doesNotMatch(login, /密码至少需要 8 位/)
})
