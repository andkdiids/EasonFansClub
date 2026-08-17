import assert from 'node:assert/strict'
import test from 'node:test'
import { registrationControlWriteError } from '../lib/registration'
import {
  parseRegistrationControlInput,
  serializeRegistrationControlSettings,
} from '../lib/registration-availability'

// The previous SiteSetting.value was VARCHAR(191). The registration control
// settings persist as separate SiteSetting rows, so both the close notice and
// the serialized daily schedule are independently bounded by that limit.
const VARCHAR_191_LIMIT = 191

test('close notice up to 2000 chars is preserved and exceeds VARCHAR(191)', () => {
  const longMessage = '关'.repeat(2000)
  const parsed = parseRegistrationControlInput({ mode: 'MANUAL', opensAt: '', closesAt: '', closedMessage: longMessage })
  assert.ok(parsed)
  assert.equal(parsed.closedMessage?.length, 2000)
  assert.ok((parsed.closedMessage?.length ?? 0) > VARCHAR_191_LIMIT, 'close notice exceeds the old VARCHAR(191) limit')
})

test('multi-window daily schedule serializes and round-trips without changing fields', () => {
  const schedule = [
    { start: '03:00', end: '09:00' },
    { start: '16:00', end: '19:00' },
  ]
  const parsed = parseRegistrationControlInput({ mode: 'DAILY_SCHEDULE', dailySchedule: schedule, opensAt: '', closesAt: '' })
  assert.ok(parsed)
  assert.deepEqual(parsed.dailySchedule, schedule)
  const serialized = serializeRegistrationControlSettings({ ...parsed, override: 'NONE' })
  assert.deepEqual(serialized.dailySchedule, schedule)
})

test('registration control SiteSetting values exceed VARCHAR(191) and require TEXT', () => {
  const closedMessageValue = '注'.repeat(2000)
  const dailyScheduleValue = JSON.stringify(
    Array.from({ length: 10 }, () => ({ start: '00:00', end: '23:59' })),
  )
  assert.ok(closedMessageValue.length > VARCHAR_191_LIMIT, 'close notice row exceeds VARCHAR(191)')
  assert.ok(dailyScheduleValue.length > VARCHAR_191_LIMIT, 'max daily schedule JSON row exceeds VARCHAR(191)')
})

test('P2000 maps to REGISTRATION_SETTING_TOO_LONG with 500', async () => {
  const response = registrationControlWriteError(Object.assign(new Error('value too long'), { code: 'P2000' }))
  assert.equal(response.status, 500)
  const body = await response.json()
  assert.equal(body.code, 'REGISTRATION_SETTING_TOO_LONG')
})

test('P2022 maps to REGISTRATION_SETTING_SCHEMA_INCOMPATIBLE with 500', async () => {
  const response = registrationControlWriteError(Object.assign(new Error('bad schema'), { code: 'P2022' }))
  assert.equal(response.status, 500)
  const body = await response.json()
  assert.equal(body.code, 'REGISTRATION_SETTING_SCHEMA_INCOMPATIBLE')
})

test('P2025 maps to REGISTRATION_SETTING_NOT_FOUND with 409', async () => {
  const response = registrationControlWriteError(Object.assign(new Error('not found'), { code: 'P2025' }))
  assert.equal(response.status, 409)
  const body = await response.json()
  assert.equal(body.code, 'REGISTRATION_SETTING_NOT_FOUND')
})

test('unknown database error maps to REGISTRATION_SETTING_UPDATE_FAILED with 500', async () => {
  const response = registrationControlWriteError(new Error('boom'))
  assert.equal(response.status, 500)
  const body = await response.json()
  assert.equal(body.code, 'REGISTRATION_SETTING_UPDATE_FAILED')
})
