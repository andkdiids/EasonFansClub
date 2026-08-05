import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { dailyRecommendationIndex } from '../lib/daily-music'

const read = (path: string) => readFileSync(path, 'utf8')

test('daily recommendation stays fixed for an identity during one day', () => {
  const first = dailyRecommendationIndex('user-a', '2026-08-04', 1000)
  assert.equal(first, dailyRecommendationIndex('user-a', '2026-08-04', 1000))
  assert.notEqual(first, dailyRecommendationIndex('user-a', '2026-08-05', 1000))
})

test('different users participate with different recommendation identities', () => {
  assert.notEqual(
    dailyRecommendationIndex('user-a', '2026-08-04', 1000),
    dailyRecommendationIndex('user-b', '2026-08-04', 1000),
  )
  const source = read('prisma/schema.prisma')
  assert.match(source, /@@unique\(\[userId, recommendDate\]\)/)
  assert.match(source, /@@unique\(\[anonymousId, recommendDate\]\)/)
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
  assert.match(submit, /status: 'PENDING'/)
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
  assert.match(create, /type: 'ADMIN'/)
  assert.match(create, /link: '\/admin\/posts\/review'/)
  assert.match(review, /status === 'APPROVED' \? 'APPROVE_POST' : 'REJECT_POST'/)
  assert.match(home, /moderationStatus: 'APPROVED'/)
  assert.match(home, /OR: \[\{ isFeatured: true \}, \{ isPinned: true \}\]/)
})

test('homepage uses date-seeded random albums and only featured or pinned posts', () => {
  const home = read('lib/home-data.ts')
  const surface = read('components/HomeLayoutSurface.tsx')
  assert.match(home, /dailyAlbumRank\(a\.id\) - dailyAlbumRank\(b\.id\)/)
  assert.match(home, /slice\(0, 6\)/)
  assert.match(surface, /data\.posts\.slice\(0,\s*4\)/)
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
  assert.match(manager, /\/api\/uploads\/site-image/)
  assert.match(manager, /\/api\/admin\/home\/hero/)
})

test('homepage keeps the original surface order and does not render shortcut cards', () => {
  const surface = read('components/HomeLayoutSurface.tsx')
  assert.doesNotMatch(surface, /shortcutItems|grid-cols-6|home-hero|community-hero-actions|growthThresholds|homeText\.(level|exp|points)/)
  const positions = [
    surface.indexOf('<HomeHero'),
    surface.indexOf('className="community-stats home-checkin-stats"'),
    surface.indexOf('home-primary-columns'),
    surface.indexOf('homeText.randomAlbums'),
    surface.indexOf('data-featured-post-card'),
    surface.indexOf('homeText.hotConcerts'),
  ]
  assert.ok(positions.every((position) => position >= 0))
  assert.deepEqual([...positions].sort((a, b) => a - b), positions)
})

test('entertainment home card uses the endless-mode leaderboard and concerts remain available', () => {
  const home = read('lib/home-data.ts')
  const api = read('app/api/home/route.ts')
  const surface = read('components/HomeLayoutSurface.tsx')
  assert.match(home, /periodType: 'YEAR', mode: 'ENDLESS'/)
  assert.match(api, /getHomeConcerts\(\)/)
  assert.match(api, /concerts, albums, stats/)
  assert.match(surface, /homeText\.entertainment/)
  assert.match(surface, /home-concert-grid/)
})

test('mobile home layout uses a compact hero, two-by-two stats, and bottom safe space', () => {
  const css = read('app/globals.css')
  const surface = read('components/HomeLayoutSurface.tsx')
  assert.match(css, /\.community-hero \{ height:clamp\(220px,64vw,260px\); \}/)
  assert.match(css, /\.community-stats\.home-checkin-stats \{ grid-template-columns:repeat\(2,minmax\(0,1fr\)\) !important; \}/)
  assert.match(css, /padding-bottom:calc\(var\(--mobile-bottom-nav-total\) \+ var\(--mobile-page-bottom-gap\)\)/)
  assert.match(css, /\.stat-checkin\.is-not-checked>small/)
  assert.match(css, /\.stat-checkin-mobile-mark \{ display:inline; \}/)
  assert.match(surface, /checkinStateClass/)
  assert.match(surface, /stat-checkin-mobile-mark/)
})
