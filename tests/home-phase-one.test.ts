import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { DAILY_MUSIC_RECOMMENDATION_SEED, dailyRecommendationIndex, globalDailyRecommendationIndex } from '../lib/daily-music'

const read = (path: string) => readFileSync(path, 'utf8')

test('daily recommendation stays fixed for an identity during one day', () => {
  const first = dailyRecommendationIndex('user-a', '2026-08-04', 1000)
  assert.equal(first, dailyRecommendationIndex('user-a', '2026-08-04', 1000))
  assert.notEqual(first, dailyRecommendationIndex('user-a', '2026-08-05', 1000))
})

test('all users share one stable Shanghai-date recommendation identity', () => {
  const first = globalDailyRecommendationIndex('2026-08-04', 1000)
  assert.equal(first, globalDailyRecommendationIndex('2026-08-04', 1000))
  assert.equal(first, dailyRecommendationIndex(DAILY_MUSIC_RECOMMENDATION_SEED, '2026-08-04', 1000))
  assert.notEqual(first, globalDailyRecommendationIndex('2026-08-05', 1000))
  const source = read('prisma/schema.prisma')
  assert.match(source, /@@unique\(\[userId, recommendDate\]\)/)
  assert.match(source, /@@unique\(\[anonymousId, recommendDate\]\)/)
  const music = read('lib/daily-music.ts')
  assert.match(music, /DAILY_MUSIC_RECOMMENDATION_SEED = 'easmusic-global'/)
  assert.doesNotMatch(music, /userDailyMusicRecommendation\.(findUnique|create|findMany)/)
})

test('daily recommendation has a random fallback when no daily record exists', () => {
  const music = read('lib/daily-music.ts')
  const home = read('lib/home-data.ts')
  assert.match(music, /export async function getFallbackDailyMusicRecommendation/)
  assert.match(music, /previewUrl: \{ not: null \}/)
  assert.match(home, /getFallbackDailyMusicRecommendation\(userId, anonymousId\)/)
})

test('today content has a PENDING/APPROVED/REJECTED review workflow and admin entry', () => {
  const schema = read('prisma/schema.prisma')
  const submit = read('app/api/today/route.ts')
  const review = read('app/api/admin/today/[eventId]/route.ts')
  assert.match(schema, /enum TodayEventStatus \{[\s\S]*PENDING[\s\S]*APPROVED[\s\S]*REJECTED/)
  assert.match(submit, /const moderationStatus = isSuperAdmin\(guard\.user\) \? 'APPROVED'[^\n]*'PENDING'/)
  assert.match(submit, /status: moderationStatus/)
  assert.match(review, /requireAdmin\('today_manage'\)/)
  assert.match(read('app/admin/today/page.tsx'), /requireAdminPage\('\/admin\/today', 'today_manage'\)/)
  assert.match(read('components/HomeLayoutSurface.tsx'), /homeText\.noToday|todayEvent \? /)
  assert.match(read('app/today/page.tsx'), /getTodayEventRecords\(\)/)
})

test('post review creates an admin notification and public home query only accepts reviewed posts', () => {
  const create = read('app/api/posts/route.ts')
  const review = read('app/api/admin/posts/review/route.ts')
  const home = read('lib/home-data.ts')
  assert.match(create, /moderationStatus/)
  assert.match(create, /type: 'REVIEW'/)
  assert.match(create, /link: '\/admin\/posts\/review'/)
  assert.match(review, /status === 'APPROVED' \? 'APPROVE_POST' : 'REJECT_POST'/)
  assert.match(home, /moderationStatus: \{ in: \['APPROVED', 'VIOLATION'\] \}/)
  assert.match(home, /OR: \[\{ isFeatured: true \}, \{ isPinned: true \}\]/)
})

test('homepage uses date-seeded random albums and no longer renders the removed post module', () => {
  const home = read('lib/home-data.ts')
  const surface = read('components/HomeLayoutSurface.tsx')
  assert.match(home, /dailyAlbumRank\(a\.id, dateKey\) - dailyAlbumRank\(b\.id, dateKey\)/)
  assert.match(home, /slice\(0, 6\)/)
  assert.doesNotMatch(surface, /data\.posts|data-featured-post-card|精选帖子/)
  assert.match(surface, /homeText\.dailyMusic/)
})

test('Hero carousel only consumes enabled slides and supports autoplay, controls, and swipe', () => {
  const hero = read('components/HomeHero.tsx')
  const manager = read('app/admin/home/HomeHeroManager.tsx')
  assert.match(hero, /slides\.filter\(\(item\) => item\.isVisible\)/)
  assert.match(hero, /setInterval/)
  assert.match(hero, /onPointerDown/)
  assert.match(hero, /function previous\(\)/)
  assert.match(hero, /function next\(\)/)
  assert.match(manager, /\/api\/uploads\/hero-media/)
  assert.match(manager, /\/api\/admin\/home\/hero/)
})

test('homepage keeps the hero intact and places the requested first row before lower modules', () => {
  const surface = read('components/HomeLayoutSurface.tsx')
  assert.doesNotMatch(surface, /shortcutItems|grid-cols-6|home-hero|community-hero-actions|growthThresholds|homeText\.(level|exp|points)/)
  const heroPosition = surface.indexOf('<HomeHero')
  const firstRowStart = surface.indexOf('<div className="home-first-row"')
  const dataPosition = surface.indexOf('community-stats home-checkin-stats', firstRowStart)
  const firstRowPanelsPosition = surface.indexOf('home-primary-columns home-first-row-panels', firstRowStart)
  const secondaryPosition = surface.indexOf('<div className="home-secondary-content"')
  assert.ok(heroPosition >= 0)
  assert.ok(firstRowStart > heroPosition)
  assert.ok(dataPosition > firstRowStart)
  assert.ok(firstRowPanelsPosition > dataPosition)
  assert.ok(secondaryPosition > firstRowPanelsPosition)

  const firstRow = surface.slice(firstRowStart, secondaryPosition)
  assert.ok(firstRow.indexOf('{renderTodayPanel()}') < firstRow.indexOf('{renderAnywhereDoorPanel()}'))
  assert.ok(firstRow.indexOf('{renderAnywhereDoorPanel()}') < firstRow.indexOf('{renderSalonPanel()}'))
  assert.doesNotMatch(firstRow, /renderDailyMusicPanel|renderEntertainmentPanel/)

  const secondary = surface.slice(secondaryPosition)
  assert.ok(secondary.indexOf('{renderActivityCenterPanel()}') < secondary.indexOf('{renderDailyMusicPanel()}'))
  assert.ok(secondary.indexOf('{renderDailyMusicPanel()}') < secondary.indexOf('{renderEntertainmentPanel()}'))
  assert.ok(secondary.indexOf('{renderEntertainmentPanel()}') < secondary.indexOf('homeText.randomAlbums'))
  assert.equal(secondary.indexOf('{renderRecentActivitiesPanel()}'), -1)
})

test('entertainment home card uses the endless-mode leaderboard without loading removed concert data', () => {
  const home = read('lib/home-data.ts')
  const leaderboard = read('lib/guess-song-leaderboard.ts')
  const api = read('app/api/home/route.ts')
  const surface = read('components/HomeLayoutSurface.tsx')
  assert.match(home, /getGuessSongModeHighScores\(\)/)
  assert.match(leaderboard, /periodType: 'HISTORY'/)
  assert.match(leaderboard, /periodKey: 'ALL'/)
  assert.doesNotMatch(api, /getHomeConcerts\(\)|getHomePosts\(\)/)
  assert.match(api, /activities, albums, stats/)
  assert.match(surface, /homeText\.entertainment/)
  assert.doesNotMatch(surface, /homeText\.hotConcerts|data\.concerts|home-concerts-section/)
})

test('mobile home layout uses a compact hero, two-by-two stats, and bottom safe space', () => {
  const css = read('app/globals.css')
  const surface = read('components/HomeLayoutSurface.tsx')
  assert.match(css, /\.community-hero \{ height:clamp\(220px,64vw,260px\); \}/)
  assert.match(css, /\.community-stats\.home-checkin-stats \{ grid-template-columns:repeat\(2,minmax\(0,1fr\)\) !important; \}/)
  assert.match(css, /padding-bottom:calc\(var\(--mobile-bottom-nav-total\) \+ var\(--mobile-page-bottom-gap\)\)/)
  assert.match(css, /\.community-stats\.home-checkin-stats\.home-first-row-data \{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\) !important;/)
  assert.match(css, /\.home-secondary-columns \{\s*display: grid;\s*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/)
  assert.match(css, /\.home-secondary-columns > \.community-panel \{[\s\S]*height: 100%;/)
  assert.match(css, /\.home-secondary-columns > \.home-entertainment-panel \{ grid-column: 1 \/ -1; \}/)
  const responsiveStart = css.lastIndexOf('@media (max-width: 767px)')
  assert.ok(responsiveStart >= 0)
  assert.match(css.slice(responsiveStart), /\.home-secondary-columns \{\s*grid-template-columns: minmax\(0, 1fr\);\s*gap: 16px;/)
  assert.doesNotMatch(css, /stat-checkin-mobile-mark|\.stat-checkin\.is-not-checked>small/)
  assert.match(surface, /checkinStateClass/)
  assert.match(surface, /renderActivityCenterPanel\(\)/)
  assert.match(surface, /stat-registration-cta/)
  assert.doesNotMatch(surface, /stat-checkin-mobile-mark/)
})
