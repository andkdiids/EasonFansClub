import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { getHospitalOnlyDraftValues, HOSPITAL_ONLY_DRAFT_PREFIX, isHospitalOnlyDraft } from '../lib/registration-draft'
import { loginAccountCharacterError, validateLoginAccountValue } from '../lib/login-account'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

test('registration username examples follow the public rule', () => {
  for (const value of ['Eason', 'Eason123', '陈奕迅', 'Eason_123', '陈奕迅123']) {
    assert.equal(validateLoginAccountValue(value).error, null, value)
  }
  for (const value of ['Eason 123', ' Eason', 'Eason ', 'Eason@123', 'Eason#']) {
    assert.equal(validateLoginAccountValue(value).error, loginAccountCharacterError, value)
  }
})

test('hospital-only drafts are identifiable without a schema change', () => {
  const values = getHospitalOnlyDraftValues('test-identity')
  assert.equal(values.nickname.startsWith(HOSPITAL_ONLY_DRAFT_PREFIX), true)
  assert.equal(isHospitalOnlyDraft(values.nickname), true)
  assert.equal(isHospitalOnlyDraft('Eason'), false)
})

test('register flow keeps confirmation feedback and reload persistence contracts', () => {
  const form = source('app/register/RegisterForm.tsx')
  const prepare = source('app/api/auth/register/prepare/route.ts')
  const status = source('app/api/auth/register/status/route.ts')

  assert.match(form, /nextConfirmPassword && nextConfirmPassword !== nextPassword \? REGISTRATION_PASSWORD_MISMATCH_ERROR/)
  assert.match(form, /hospitalOnly: true/)
  assert.match(form, /eason\.register\.hospitalDraftOnly/)
  assert.match(form, /!hospitalPassed/)
  assert.match(prepare, /body\?\.hospitalOnly === true/)
  assert.match(prepare, /registrationToken: suppliedRegistrationToken/)
  assert.match(status, /const hospitalOnly = isHospitalOnlyDraft\(draft\.nickname\)/)
})
