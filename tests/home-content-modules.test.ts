import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { getHomeCheckInDisplay } from '../lib/home-checkin-display'
import { getHomeDailyPrescriptionDisplay } from '../lib/home-daily-prescription'
import { getHomeActivityStatusLabel, sortHomeActivities } from '../lib/home-activity'

const read = (path: string) => readFileSync(path, 'utf8')

test('homepage keeps registration state in one dynamic card and uses a four-cell stats grid', () => {
  const surface = read('components/HomeLayoutSurface.tsx')
  const css = read('app/globals.css')

  assert.match(surface, /community-stats home-checkin-stats/)
  assert.match(surface, /className=\{`stat-registration \$\{checkinStateClass\}`\}/)
  assert.match(surface, /aria-label="E院数据与挂号状态"/)
  assert.match(surface, /data\.checkedInToday[\s\S]*data\.todayCheckInCount/)
  assert.match(surface, /className="stat-checkin stat-registration-cta"[\s\S]*homeText\.todayCheckins[\s\S]*homeText\.notCheckedIn[\s\S]*homeText\.goCheckin/)
  assert.doesNotMatch(surface, /homeText\.(totalRegistrations|days|viewRegistrations)/)
  assert.doesNotMatch(surface, /data\.stats\._count\.checkIns|data\.stats\.consecutiveDays/)
  assert.doesNotMatch(surface, /data\.siteStats\?\.todayCheckIns/)
  assert.match(surface, /<div className="stat-birthdays">/)
  assert.match(surface, /href="\/games\/daily-prescription" className="stat-prescription"/)
  assert.match(surface, /dailyPrescriptionReward/)
  assert.match(surface, /homeText\.prescriptionFee/)
  assert.doesNotMatch(surface, /<strong>今日处方<\/strong>/)
  assert.match(css, /\.home-first-row-data \{\s*display: grid;\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);\s*grid-template-rows: repeat\(2, minmax\(0, 1fr\)\);/)
  assert.match(css, /\.community-stats\.home-checkin-stats\.home-first-row-data \{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\) !important;/)
  assert.match(css, /\.community-stats\.home-checkin-stats\.home-first-row-data > \.stat-registration \{[\s\S]*display: flex;[\s\S]*padding: 12px 14px;/)
  assert.match(css, /\.community-stats\.home-checkin-stats\.home-first-row-data > \.stat-registration > \.stat-total \{[\s\S]*margin-top: 0;[\s\S]*border-top: 0;/)
})

test('homepage check-in display keeps the user state and today total independent', () => {
  assert.deepEqual(getHomeCheckInDisplay({ loaded: true, checkedInToday: false, todayCheckInCount: 1999 }), { status: 'not-checked-in', todayCheckInCount: null })
  assert.deepEqual(getHomeCheckInDisplay({ loaded: true, checkedInToday: true, todayCheckInCount: 2000 }), { status: 'checked-in', todayCheckInCount: 2000 })
  assert.deepEqual(getHomeCheckInDisplay({ loaded: true, checkedInToday: true, todayCheckInCount: 27 }), { status: 'checked-in', todayCheckInCount: 27 })
  assert.deepEqual(getHomeCheckInDisplay({ loaded: false, checkedInToday: false, todayCheckInCount: 2000 }), { status: 'loading', todayCheckInCount: null })
})

test('homepage registration cell uses one whole-cell check-in link without changing state content', () => {
  const surface = read('components/HomeLayoutSurface.tsx')
  const start = surface.indexOf('<Link href="/checkin" className={`stat-registration ${checkinStateClass}`}>')
  const end = surface.indexOf('</Link>', start)
  assert.ok(start >= 0)
  assert.ok(end > start)
  const registrationCell = surface.slice(start, end)

  assert.equal((registrationCell.match(/<Link href="\/checkin"/g) || []).length, 1)
  assert.match(registrationCell, /checkinDisplay\.status === 'checked-in'/)
  assert.match(registrationCell, /fmt\(checkinDisplay\.todayCheckInCount\)/)
  assert.match(registrationCell, /checkinDisplay\.status === 'not-checked-in'/)
  assert.match(registrationCell, /homeText\.goCheckin/)
  assert.doesNotMatch(registrationCell, /<Link href="\/checkin" className="stat-checkin/)
})

test('homepage displays the stored daily prescription reward without treating an unclaimed state as zero', () => {
  const homeData = read('lib/home-data.ts')
  const api = read('app/api/home/route.ts')
  const surface = read('components/HomeLayoutSurface.tsx')

  assert.match(homeData, /prisma\.entertainmentDailyDraw\.findUnique\([\s\S]*select: \{ points: true \}/)
  assert.match(homeData, /where: \{ userId_dateKey: \{ userId, dateKey \} \}/)
  assert.doesNotMatch(homeData, /issueEntertainmentDailyDraw/)
  assert.match(api, /getHomeDailyPrescriptionReward\(user\?\.id\)/)
  assert.match(surface, /window\.addEventListener\('user:points-updated', refresh\)/)

  assert.deepEqual(getHomeDailyPrescriptionDisplay(null), { status: 'unclaimed', points: null })
  assert.deepEqual(getHomeDailyPrescriptionDisplay(7), { status: 'claimed', points: 7 })
  assert.deepEqual(getHomeDailyPrescriptionDisplay(21), { status: 'claimed', points: 21 })
  assert.deepEqual(getHomeDailyPrescriptionDisplay(27), { status: 'claimed', points: 27 })
})

test('homepage no longer requests or renders the removed featured post and hot concert modules', () => {
  const api = read('app/api/home/route.ts')
  const surface = read('components/HomeLayoutSurface.tsx')

  assert.doesNotMatch(api, /getHomePosts|getHomeConcerts|posts:|concerts:/)
  assert.doesNotMatch(surface, /data\.posts|data\.concerts|homeText\.(featured|hotConcerts)|精选帖子|热门演唱会|home-concerts-section/)
})

test('homepage activity center filters, sorts, and labels current public activities', () => {
  const homeData = read('lib/home-data.ts')
  const surface = read('components/HomeLayoutSurface.tsx')

  assert.match(homeData, /status: 'PUBLISHED'/)
  assert.match(homeData, /registrationStartAt: \{ lte: now \}/)
  assert.match(homeData, /registrationStartAt: null/)
  assert.doesNotMatch(homeData, /startsAt: \{ lte: now \}/)
  assert.match(homeData, /endsAt: \{ gt: now \}/)
  assert.match(homeData, /endsAt: null/)
  assert.match(homeData, /orderBy: \[\{ startsAt: 'asc' \}, \{ id: 'asc' \}\]/)
  assert.match(homeData, /sortHomeActivities/)
  assert.match(homeData, /take: 8/)
  assert.match(homeData, /slice\(0, 2\)/)
  assert.match(surface, /home-activities-section/)
  assert.match(surface, /aria-label=\{homeText\.activityCenter\}/)
  assert.match(surface, /href=\{`\/activities\/\$\{activity\.id\}`\}/)
  assert.match(surface, /home-concert-grid home-activity-grid/)
  assert.match(surface, /activity\.locationName/)
  assert.match(surface, /activity\.statusLabel/)
  assert.match(surface, /homeText\.activitiesEmpty/)
  assert.doesNotMatch(surface, /if \(!data\.activities\.length\) return null/)

  const now = new Date('2026-08-31T12:00:00.000Z')
  const activity = (overrides: Record<string, unknown> = {}) => ({
    id: 'activity',
    status: 'PUBLISHED' as const,
    startsAt: '2026-08-31T10:00:00.000Z',
    endsAt: '2026-08-31T13:00:00.000Z',
    registrationStartAt: '2026-08-30T00:00:00.000Z',
    registrationEndAt: '2026-09-01T00:00:00.000Z',
    signupLimit: null,
    signupCount: 0,
    ...overrides,
  })

  assert.equal(getHomeActivityStatusLabel(activity(), now), '进行中')
  assert.equal(getHomeActivityStatusLabel(activity({ registrationEndAt: '2026-08-31T11:00:00.000Z' }), now), '报名已截止')
  assert.equal(getHomeActivityStatusLabel(activity({ startsAt: '2026-08-31T14:00:00.000Z', endsAt: '2026-08-31T16:00:00.000Z' }), now), '报名中')
  assert.deepEqual(sortHomeActivities([
    activity({ id: 'upcoming', startsAt: '2026-08-31T14:00:00.000Z', endsAt: '2026-08-31T16:00:00.000Z' }),
    activity({ id: 'ongoing-late', startsAt: '2026-08-31T11:00:00.000Z' }),
    activity({ id: 'ongoing-early', startsAt: '2026-08-31T09:00:00.000Z' }),
  ], now).map((item) => item.id), ['ongoing-early', 'ongoing-late', 'upcoming'])
})

test('homepage anywhere-door module uses only the latest synced mreasonchan post without rendering media', () => {
  const homeData = read('lib/home-data.ts')
  const api = read('app/api/home/route.ts')
  const surface = read('components/HomeLayoutSurface.tsx')
  const panelStart = surface.indexOf('const renderAnywhereDoorPanel = () =>')
  const panelEnd = surface.indexOf('\n  const renderSalonPanel = () =>', panelStart)
  assert.ok(panelStart >= 0)
  assert.ok(panelEnd > panelStart)
  const panel = surface.slice(panelStart, panelEnd)

  assert.match(homeData, /ANYWHERE_DOOR_TARGET/)
  assert.match(homeData, /prisma\.socialPost\.findFirst\(/)
  assert.match(homeData, /status: 'READY', authorUsername: ANYWHERE_DOOR_TARGET/)
  assert.match(homeData, /orderBy:\s*\[\{\s*publishedAt:\s*'desc'\s*\},\s*\{\s*id:\s*'desc'\s*\}\s*\]/)
  assert.match(homeData, /caption: true, publishedAt: true/)
  assert.match(homeData, /createHomeAnywhereDoorTitle/)
  assert.match(homeData, /publishedAt: post\.publishedAt\.toISOString\(\)/)
  assert.match(api, /getHomeAnywhereDoorLatest\(\)/)
  assert.match(panel, /home-anywhere-door-section/)
  assert.match(panel, /data\.anywhereDoor\.href/)
  assert.match(panel, /data\.anywhereDoor\.publishedAt/)
  assert.doesNotMatch(panel, /<Image|coverUrl|imageUrl|avatarUrl|MediaCarousel/)
})

test('homepage Salon preview reuses approved public posts with a bounded thumbnail projection', () => {
  const homeData = read('lib/home-data.ts')
  const api = read('app/api/home/route.ts')
  const surface = read('components/HomeLayoutSurface.tsx')
  const panelStart = surface.indexOf('const renderSalonPanel = () =>')
  const panelEnd = surface.indexOf('\n  return (', panelStart)
  assert.ok(panelStart >= 0)
  assert.ok(panelEnd > panelStart)
  const panel = surface.slice(panelStart, panelEnd)

  assert.match(homeData, /salonPublicBaseWhere/)
  assert.match(homeData, /prisma\.salonPost\.findMany\(/)
  assert.match(homeData, /status: 'APPROVED'/)
  assert.match(homeData, /take: 3/)
  assert.match(homeData, /select: \{ thumbnailUrl: true \}/)
  assert.match(homeData, /publicImageUrl\(post\.media\[0\]\?\.thumbnailUrl\)/)
  assert.match(api, /getHomeSalonPosts\(\)/)
  assert.match(panel, /data\.salonPosts\.length/)
  assert.match(panel, /href=\{`\/salon\/\$\{post\.id\}`\}/)
  assert.match(panel, /home-salon-content/)
  assert.match(panel, /homeText\.salonEmpty/)
})

test('homepage loads activities and latest anywhere-door content in the main parallel payload', () => {
  const api = read('app/api/home/route.ts')
  const callStart = api.indexOf('const [activities, albums')
  const callEnd = api.indexOf('])', callStart)
  assert.ok(callStart >= 0)
  assert.ok(callEnd > callStart)
  const calls = api.slice(callStart, callEnd)

  assert.match(api, /Promise\.all\(\[/)
  assert.match(calls, /getHomeActivities\(\)/)
  assert.match(calls, /getHomeAnywhereDoorLatest\(\)/)
  assert.doesNotMatch(calls, /getHomePosts|getHomeConcerts/)
  assert.match(api, /activities, albums, stats, dailyMusic, siteStats, todayEvents, anywhereDoor, dailyPrescriptionReward/)
})

test('new homepage modules keep compact responsive and theme-token based styles', () => {
  const css = read('app/globals.css')
  const responsiveStart = css.indexOf('@media (max-width:767px)', css.indexOf('.home-concert-grid'))
  assert.ok(responsiveStart >= 0)
  const responsive = css.slice(responsiveStart)

  assert.match(css, /\.home-concert-grid \{ display:grid; grid-template-columns:repeat\(4,minmax\(0,1fr\)\);/)
  assert.match(responsive, /\.home-concert-grid \{ grid-template-columns:1fr; \}/)
  assert.match(css, /\.home-anywhere-door-item[\s\S]*background: var\(--surface-subtle\)/)
  assert.match(css, /\.home-anywhere-door-item strong[\s\S]*-webkit-line-clamp: 2/)
  assert.match(css, /\.home-checkin-stats \.stat-prescription[\s\S]*align-items: flex-start/)
})

test('homepage entertainment, daily music, and activity cards share a desktop three-column row', () => {
  const surface = read('components/HomeLayoutSurface.tsx')
  const css = read('app/globals.css')
  const entertainmentIndex = surface.indexOf('{renderEntertainmentPanel()}')
  const musicIndex = surface.indexOf('{renderDailyMusicPanel()}')
  const activityIndex = surface.indexOf('{renderActivityCenterPanel()}')

  assert.ok(entertainmentIndex >= 0)
  assert.ok(musicIndex > entertainmentIndex)
  assert.ok(activityIndex > musicIndex)
  assert.doesNotMatch(surface, /className="hero-primary-button home-entertainment-button"/)

  assert.match(css, /@media \(min-width:1200px\) \{[\s\S]*\.home-secondary-columns \{[\s\S]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);[\s\S]*gap: 16px 14px;/)
  assert.match(css, /@media \(min-width:1200px\) \{[\s\S]*\.home-secondary-columns > \.home-activities-section \{[\s\S]*grid-column: auto;/)
  assert.doesNotMatch(css, /\.home-secondary-columns > \.community-panel \{[\s\S]*min-height: 220px;[\s\S]*height: 100%;/)
  assert.match(css, /@media \(min-width:768px\) and \(max-width:1199px\) \{[\s\S]*\.home-secondary-columns \{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/)
  assert.match(css, /\.home-secondary-columns \.home-entertainment-ranking-head/)
  assert.match(css, /\.home-secondary-columns \.home-daily-music \{[\s\S]*grid-template-columns: 56px minmax\(0, 1fr\) auto;/)
  assert.match(css, /\.home-secondary-columns \.home-activity-card \{[\s\S]*grid-template-columns: 52px minmax\(0, 1fr\);/)
  assert.match(css, /@media \(max-width:767px\) \{[\s\S]*\.home-secondary-columns \{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/)
  assert.match(css, /@media \(max-width: 339px\) \{[\s\S]*\.home-secondary-columns \{[\s\S]*grid-template-columns: minmax\(0, 1fr\);/)
})
