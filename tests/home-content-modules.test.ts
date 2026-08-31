import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

test('homepage groups accumulated check-ins with registration and adds the prescription shortcut', () => {
  const surface = read('components/HomeLayoutSurface.tsx')
  const css = read('app/globals.css')

  assert.match(surface, /community-stats home-checkin-stats/)
  assert.match(surface, /className=\{`stat-registration \$\{checkinStateClass\}`\}/)
  assert.match(surface, /<div className="stat-total">[\s\S]*homeText\.totalCheckins[\s\S]*homeText\.viewCheckin/)
  assert.match(surface, /<div className="stat-birthdays">/)
  assert.match(surface, /href="\/games\/daily-prescription" className="stat-prescription"/)
  assert.match(css, /\.community-stats\.home-checkin-stats \{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\) !important;/)
  assert.match(css, /\.community-stats\.home-checkin-stats > \.stat-registration \{[\s\S]*display: grid;[\s\S]*grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\);[\s\S]*min-height: 184px;/)
  assert.match(css, /\.community-stats\.home-checkin-stats > \.stat-registration > \.stat-checkin \{[\s\S]*border-right: 1px solid var\(--border\);/)
  assert.match(css, /\.community-stats\.home-checkin-stats > \.stat-registration > \.stat-total \{[\s\S]*border-top: 0;/)
  assert.match(css, /@media \(max-width: 767px\) \{[\s\S]*\.community-stats\.home-checkin-stats > \.stat-registration \{[\s\S]*grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\);/)
})

test('homepage no longer requests or renders the removed featured post and hot concert modules', () => {
  const api = read('app/api/home/route.ts')
  const surface = read('components/HomeLayoutSurface.tsx')

  assert.doesNotMatch(api, /getHomePosts|getHomeConcerts|posts:|concerts:/)
  assert.doesNotMatch(surface, /data\.posts|data\.concerts|homeText\.(featured|hotConcerts)|精选帖子|热门演唱会|home-concerts-section/)
})

test('homepage recent activities query filters ongoing published activities in the database', () => {
  const homeData = read('lib/home-data.ts')
  const surface = read('components/HomeLayoutSurface.tsx')

  assert.match(homeData, /status: 'PUBLISHED'/)
  assert.match(homeData, /startsAt: \{ lte: now \}/)
  assert.match(homeData, /OR:\s*\[\{\s*endsAt:\s*\{\s*gt:\s*now\s*\}\s*\},\s*\{\s*endsAt:\s*null\s*\}\s*\]/)
  assert.match(homeData, /orderBy:\s*\[\{\s*endsAt:\s*'asc'\s*\}/)
  assert.match(homeData, /take: 4/)
  assert.match(surface, /home-activities-section/)
  assert.match(surface, /href=\{`\/activities\/\$\{activity\.id\}`\}/)
  assert.match(surface, /home-concert-grid home-activity-grid/)
  assert.match(surface, /if \(!data\.activities\.length\) return null/)
})

test('homepage anywhere-door module uses only the latest synced mreasonchan post without rendering media', () => {
  const homeData = read('lib/home-data.ts')
  const api = read('app/api/home/route.ts')
  const surface = read('components/HomeLayoutSurface.tsx')
  const panelStart = surface.indexOf('const renderAnywhereDoorPanel = () =>')
  const panelEnd = surface.indexOf('\n  return (\n    <div className="community-home"', panelStart)
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
  assert.match(api, /activities, albums, stats, dailyMusic, siteStats, todayEvents, anywhereDoor/)
})

test('new homepage modules keep compact responsive and theme-token based styles', () => {
  const css = read('app/globals.css')
  const responsiveStart = css.lastIndexOf('@media (max-width: 767px)')
  assert.ok(responsiveStart >= 0)
  const responsive = css.slice(responsiveStart)

  assert.match(css, /\.home-activity-grid \{ grid-template-columns: repeat\(4, minmax\(0, 1fr\)\); \}/)
  assert.match(responsive, /\.home-activity-grid \{ grid-template-columns: 1fr; \}/)
  assert.match(css, /\.home-anywhere-door-item[\s\S]*background: var\(--surface-subtle\)/)
  assert.match(css, /\.home-anywhere-door-item strong[\s\S]*-webkit-line-clamp: 2/)
  assert.match(css, /\.home-checkin-stats \.stat-prescription[\s\S]*align-items: flex-start/)
})
