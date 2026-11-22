import assert from 'node:assert/strict'
import test from 'node:test'
import { memoirTimeFields, parseMemoirYear, validateMemoirAdminInput } from '../lib/annual-memoir-admin'
import { getMemoirAvailability } from '../lib/annual-memoir-policy'

const input = {
  previewAt: '2026-12-01T09:00', reservationClosesAt: '2026-12-11T20:00',
  reportOpensAt: '2026-12-12T15:00', notificationAt: '2026-12-12T15:00',
  endsAt: '2026-12-31T23:00', enabled: false, reservationPoints: 7,
}
const parse = () => {
  const result = validateMemoirAdminInput(input)
  assert.ok(result.ok)
  return result.data
}

test('five Shanghai times derive a single exclusive window and end-of-activity settlement', () => {
  assert.equal(Object.keys(memoirTimeFields).length, 5)
  const data = parse()
  assert.equal(data.reservationPoints, 7)
  assert.equal(data.statisticsStartAt.toISOString(), '2025-12-31T16:00:00.000Z')
  assert.equal(data.statisticsEndAt.toISOString(), '2026-12-11T16:00:00.000Z')
  assert.equal(data.settlementAt.getTime(), data.endsAt.getTime())
  assert.equal(data.reservationOpensAt.getTime(), data.previewAt.getTime())
  for (const text of ['2026-12-11T23:59:59+08:00', '2026-12-11T23:59:59.999+08:00']) {
    assert.ok(new Date(text) < data.statisticsEndAt)
  }
  assert.equal(new Date('2026-12-12T00:00:00+08:00').getTime(), data.statisticsEndAt.getTime())
})

test('reservation opens at announcement and closes at the exclusive deadline', () => {
  const schedule = parse()
  const state = (now: Date) => getMemoirAvailability({ configuredAndPublished: true, schedule, now, hasSnapshot: false })
  assert.equal(state(new Date(schedule.previewAt.getTime() - 1)).canReserve, false)
  assert.equal(state(schedule.previewAt).canReserve, true)
  assert.equal(state(schedule.reservationClosesAt).canReserve, false)
  assert.equal(state(schedule.endsAt).canSettle, true)
})

test('invalid time input names the first bad field and ignores obsolete derived settings', () => {
  const result = validateMemoirAdminInput({ ...input, reportOpensAt: input.reservationClosesAt })
  assert.ok(!result.ok)
  assert.equal(result.field, 'reportOpensAt')
  assert.deepEqual(validateMemoirAdminInput({ ...input, reservationPoints: 0, statisticsEndAt: '2026-12-30T01:00' }),
    validateMemoirAdminInput({ ...input, reservationPoints: 0 }))
})

test('draft creation accepts an explicit year and retains the 2026 default for existing clients', () => {
  assert.equal(parseMemoirYear(input), 2026)
  assert.equal(parseMemoirYear({ year: 2027 }), 2027)
  for (const year of [null, '2027', 2027.5, 999, 10000]) assert.equal(parseMemoirYear({ year }), null)
  const schedule = Object.fromEntries(Object.entries(input).map(([key, value]) =>
    [key, typeof value === 'string' ? value.replace('2026-', '2027-') : value]))
  const result = validateMemoirAdminInput(schedule, 2027)
  assert.ok(result.ok)
  assert.equal(result.data.statisticsStartAt.toISOString(), '2026-12-31T16:00:00.000Z')
})
