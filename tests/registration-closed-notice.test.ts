import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  DEFAULT_REGISTRATION_CLOSED_MESSAGE,
  DEFAULT_REGISTRATION_CLOSED_TITLE,
  parseRegistrationControlInput,
  serializeRegistrationControlSettings,
} from '../lib/registration-availability'

const read = (path: string) => readFileSync(path, 'utf8')

test('registration closed copy has safe defaults and preserves configured line breaks', () => {
  const parsed = parseRegistrationControlInput({ mode: 'MANUAL', opensAt: '', closesAt: '' })
  assert.ok(parsed)
  assert.equal(parsed.closedTitle, DEFAULT_REGISTRATION_CLOSED_TITLE)
  assert.equal(parsed.closedMessage, DEFAULT_REGISTRATION_CLOSED_MESSAGE)

  const configured = parseRegistrationControlInput({
    mode: 'DAILY_SCHEDULE',
    dailySchedule: [{ start: '14:00', end: '23:30' }],
    opensAt: '',
    closesAt: '',
    closedTitle: '今日注册已结束',
    closedMessage: '今日注册已经结束，预计明日下午重新开放。\r\n\r\n感谢大家的支持。',
  })
  assert.ok(configured)
  assert.equal(configured.closedTitle, '今日注册已结束')
  assert.equal(configured.closedMessage, '今日注册已经结束，预计明日下午重新开放。\n\n感谢大家的支持。')

  const serialized = serializeRegistrationControlSettings({ ...configured, override: 'NONE' })
  assert.equal(serialized.closedTitle, '今日注册已结束')
  assert.equal(serialized.closedMessage, configured.closedMessage)
})

test('registration admin, public status and closed page use the configured copy', () => {
  const admin = read('app/admin/security-settings/RegistrationControlForm.tsx')
  const status = read('app/api/auth/register/status/route.ts')
  const page = read('app/register/page.tsx')
  const form = read('app/register/RegisterForm.tsx')

  assert.match(admin, /closedTitle: control\.closedTitle/)
  assert.match(admin, /closedMessage: control\.closedMessage/)
  assert.match(admin, /前台关闭时将显示：/)
  assert.match(status, /closedTitle: registrationControl\.closedTitle/)
  assert.match(status, /closedMessage: registrationControl\.closedMessage/)
  assert.match(page, /closedTitle: registrationControl\.closedTitle/)
  assert.match(page, /closedMessage: registrationControl\.closedMessage/)
  assert.match(form, /whitespace-pre-wrap break-words[\s\S]{0,160}\{closedMessage\}/)
  assert.match(form, /if \(!registrationIsOpen\) return/)
  assert.doesNotMatch(form, /<form className="register-form[\s\S]*if \(!registrationIsOpen\)/)
})
