import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

test('today auto events merge published albums, concerts, and approved manual events', () => {
  const service = read('lib/today-events.ts')
  const schema = read('prisma/schema.prisma')
  const migration = read('prisma/migrations/20260804160000_today_auto_events/migration.sql')
  assert.match(service, /releaseDate: \{ not: null \}/)
  assert.match(service, /concertDate/)
  assert.match(service, /isTodayMonthDay/)
  assert.match(service, /TodayEvent\.findMany today\.events/)
  assert.match(schema, /enum TodayEventSource \{[\s\S]*AUTO[\s\S]*ADMIN/)
  for (const type of ['ALBUM', 'CONCERT', 'SONG', 'CAREER', 'AWARD', 'CUSTOM']) {
    assert.match(schema, new RegExp(`enum TodayEventType \\{[\\s\\S]*\\b${type}\\b`))
  }
  assert.match(migration, /MODIFY COLUMN `source` ENUM\('AUTO', 'ADMIN'\)/)
})

test('home today module keeps the original card and rotates multiple events', () => {
  const surface = read('components/HomeLayoutSurface.tsx')
  const homeData = read('lib/home-data.ts')
  assert.match(homeData, /getTodayEventRecords\(\)/)
  assert.match(surface, /home-today-carousel-controls/)
  assert.match(surface, /setInterval/)
  assert.match(surface, /todayEvent\.href \|\| '\/today'/)
})

test('today page sorts complete history by original year and preserves source origin', () => {
  const page = read('app/today/TodayPageClient.tsx')
  const service = read('lib/today-events.ts')
  const route = read('app/api/today/route.ts')
  assert.match(page, /b\.year - a\.year/)
  assert.match(page, /source: 'AUTO' \| 'ADMIN'/)
  assert.match(service, /source: event\.source/)
  assert.match(route, /source: 'ADMIN'/)
  assert.match(route, /getTodayEventRecords\(\)/)
})

test('home registration statistic separates today status from the all-site count', () => {
  const surface = read('components/HomeLayoutSurface.tsx')
  const api = read('app/api/home/route.ts')
  const display = read('lib/home-checkin-display.ts')
  assert.match(surface, /homeText\.goCheckin/)
  assert.match(surface, /homeText\.notCheckedIn/)
  assert.match(surface, /data\.checkedInToday/)
  assert.match(surface, /data\.todayCheckInCount/)
  assert.match(surface, /getHomeCheckInDisplay/)
  assert.doesNotMatch(surface, /homeText\.(totalRegistrations|days|viewRegistrations)/)
  assert.doesNotMatch(surface, /data\.stats\._count\.checkIns|data\.stats\.consecutiveDays/)
  assert.match(api, /const checkedInToday = Boolean\(stats\?\.checkIns\.length\)/)
  assert.match(api, /const todayCheckInCount = siteStats\?\.todayCheckIns \?\? 0/)
  assert.match(api, /checkedInToday, todayCheckInCount/)
  assert.match(display, /status: 'not-checked-in'/)
  assert.match(display, /status: 'checked-in'/)
  assert.match(surface, /window\.addEventListener\('checkin:completed'/)
})

test('homepage target files contain no literal unicode escape markers', () => {
  for (const file of ['components/HomeLayoutSurface.tsx', 'lib/home-data.ts', 'app/api/home/route.ts']) {
    assert.doesNotMatch(read(file), /\\u(?:203a|2713|5206)/)
  }
})
