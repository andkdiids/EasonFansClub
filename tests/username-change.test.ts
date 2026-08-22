import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { addCalendarMonth, getUsernameChangeAvailability } from '../lib/username-change'

test('username cooldown uses one calendar month, including year boundaries', () => {
  assert.equal(addCalendarMonth(new Date('2026-08-12T09:30:00.000Z')).toISOString(), '2026-09-12T09:30:00.000Z')
  assert.equal(addCalendarMonth(new Date('2026-12-12T09:30:00.000Z')).toISOString(), '2027-01-12T09:30:00.000Z')
})

test('username cooldown clamps a month-end day instead of overflowing', () => {
  assert.equal(addCalendarMonth(new Date('2026-01-31T09:30:00.000Z')).toISOString(), '2026-02-28T09:30:00.000Z')
  assert.equal(addCalendarMonth(new Date('2028-01-31T09:30:00.000Z')).toISOString(), '2028-02-29T09:30:00.000Z')
})

test('username availability opens exactly at the next calendar-month instant', () => {
  const changedAt = new Date('2026-08-12T09:30:00.000Z')
  const nextAllowedAt = new Date('2026-09-12T09:30:00.000Z')
  assert.equal(getUsernameChangeAvailability(null, changedAt).canChange, true)
  assert.equal(getUsernameChangeAvailability(changedAt, new Date('2026-09-12T09:29:59.999Z')).canChange, false)
  assert.equal(getUsernameChangeAvailability(changedAt, nextAllowedAt).canChange, true)
  assert.equal(getUsernameChangeAvailability(changedAt, changedAt).nextAllowedAt?.toISOString(), nextAllowedAt.toISOString())
})

test('username change is server-enforced with a serializable transaction and dedicated timestamp', () => {
  const route = readFileSync('app/api/users/me/route.ts', 'utf8')
  const schema = readFileSync('prisma/schema.prisma', 'utf8')
  const migration = readFileSync('prisma/migrations/20260812110000_add_username_changed_at/migration.sql', 'utf8')

  assert.match(route, /newUsername/)
  assert.match(route, /Prisma\.TransactionIsolationLevel\.Serializable/)
  assert.match(route, /USERNAME_CHANGE_COOLDOWN/)
  assert.match(route, /usernameChangedAt: now/)
  assert.match(schema, /usernameChangedAt\s+DateTime\?/)
  assert.match(migration, /ADD COLUMN `usernameChangedAt` DATETIME\(3\) NULL/)
})

test('profile UI exposes nickname only and keeps the internal login account out of public profile editing', () => {
  const form = readFileSync('app/profile/ProfileSettingsForm.tsx', 'utf8')
  assert.doesNotMatch(form, /更改用户名/)
  assert.doesNotMatch(form, /确认更改用户名/)
  assert.doesNotMatch(form, /newUsername/)
  assert.match(form, /nickname: form\.nickname/)
})
