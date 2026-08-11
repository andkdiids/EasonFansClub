import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { formatCalendarDate, toCalendarDateKey } from '../lib/calendar-date'
import { getTodayEventDateParts, parseTodayDate } from '../lib/today'

const read = (path: string) => readFileSync(path, 'utf8')

test('calendar dates keep their selected day across UTC and Beijing time', () => {
  assert.equal(toCalendarDateKey('2026-08-11'), '2026-08-11')
  assert.equal(toCalendarDateKey(new Date('2026-08-10T16:00:00.000Z')), '2026-08-11')
  assert.equal(toCalendarDateKey('2026-08-10T16:00:00.000Z'), '2026-08-11')
  assert.equal(formatCalendarDate('2026-08-11'), '2026年08月11日')
  assert.equal(formatCalendarDate('2026-01-01'), '2026年01月01日')
  assert.equal(formatCalendarDate('2026-12-31'), '2026年12月31日')
})

test('TodayEvent input uses a DATE-safe UTC representation', () => {
  const parsed = parseTodayDate('2026-08-11')
  assert.ok(parsed)
  assert.equal(parsed.date.toISOString(), '2026-08-11T00:00:00.000Z')
})

test('old TodayEvent rows use their canonical month/day without a data migration', () => {
  assert.deepEqual(
    getTodayEventDateParts(new Date('2026-08-10T00:00:00.000Z'), 8, 11),
    { key: '2026-08-11', year: 2026, month: 8, day: 11 },
  )
  assert.deepEqual(
    getTodayEventDateParts(new Date('2025-12-31T00:00:00.000Z'), 1, 1),
    { key: '2026-01-01', year: 2026, month: 1, day: 1 },
  )
  assert.deepEqual(
    getTodayEventDateParts(new Date('2026-12-31T00:00:00.000Z'), 12, 31),
    { key: '2026-12-31', year: 2026, month: 12, day: 31 },
  )
})

test('TodayEvent APIs and server page do not serialize a calendar date as ISO time', () => {
  for (const file of [
    'app/api/admin/today/route.ts',
    'app/api/admin/today/[eventId]/route.ts',
    'app/admin/today/page.tsx',
  ]) {
    const source = read(file)
    assert.doesNotMatch(source, /event\.date\.toISOString\(\)/)
    assert.doesNotMatch(source, /updated\.date\.toISOString\(\)/)
  }
})
