import assert from 'node:assert/strict'
import test from 'node:test'
import { getMemoirAvailability, isValidMemoirSchedule } from '../lib/annual-memoir-policy'

const at = (day: string) => new Date(`2026-12-${day}T00:00:00+08:00`)
const schedule = {
  previewAt: at('01'), reservationOpensAt: at('02'), reservationClosesAt: at('12'),
  statisticsStartAt: new Date('2026-01-01T00:00:00+08:00'), statisticsEndAt: at('12'),
  reportOpensAt: at('12'), notificationAt: new Date('2026-12-12T10:00:00+08:00'),
  endsAt: at('31'), settlementAt: at('31'),
}
const state = (now: Date, hasSnapshot = false, configuredAndPublished = true) =>
  getMemoirAvailability({ schedule, now, hasSnapshot, configuredAndPublished })

test('a persisted configuration row may contain fields besides the schedule', () => {
  const row = { ...schedule, activityId: 'synthetic', enabled: true, statisticsLockedAt: null }
  assert.equal(isValidMemoirSchedule(row), true)
  assert.equal(getMemoirAvailability({
    schedule: row, now: at('02'), hasSnapshot: false, configuredAndPublished: true,
  }).canReserve, true)
})

test('preview and reservation are separately gated at Beijing boundaries', () => {
  assert.equal(state(new Date(at('01').getTime() - 1)).visible, false)
  assert.equal(state(at('01')).visible, true)
  assert.equal(state(at('01')).canReserve, false)
  assert.equal(state(at('02')).canReserve, true)
  assert.equal(state(at('12')).canReserve, false)
})

test('viewing a frozen snapshot survives closure and disabling the activity', () => {
  assert.equal(state(at('12')).canGenerate, true)
  assert.equal(state(at('12'), true).canGenerate, false)
  assert.equal(state(at('12'), true).canSubmitShare, true)
  assert.equal(state(at('31'), true).canSubmitShare, false)
  assert.equal(state(at('31'), true, false).canViewSnapshot, true)
})

test('notifications and settlement respect their configured boundaries', () => {
  assert.equal(state(at('12')).canNotify, false)
  assert.equal(state(schedule.notificationAt).canNotify, true)
  assert.equal(state(at('30')).canSettle, false)
  assert.equal(state(at('31')).canSettle, true)
  assert.equal(isValidMemoirSchedule({ ...schedule, settlementAt: at('30') }), false)
  assert.equal(state(at('12'), false, false).canGenerate, false)
})
