import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { resolveHomepageFeaturedConcert, type HomepageFeaturedConcertInput } from '../lib/homepage-featured-concert'

const read = (path: string) => readFileSync(path, 'utf8')

function featuredConcert(overrides: Partial<HomepageFeaturedConcertInput> = {}): HomepageFeaturedConcertInput {
  return {
    homepageFeatured: true,
    status: 'REGISTRATION',
    title: 'Recording Sessions',
    subtitle: '限时演唱会专题副标题',
    slug: 'recording-sessions',
    backgroundImageUrl: 'https://images.example.test/recording-sessions.webp',
    startDate: '2026-11-01',
    endDate: '2026-12-12',
    ...overrides,
  }
}

test('有效且由后台启用的演唱会生成使用配置数据的首页 Hero 内容', () => {
  const result = resolveHomepageFeaturedConcert(featuredConcert())
  assert.deepEqual(result, {
    title: 'Recording Sessions',
    subtitle: '限时演唱会专题副标题',
    href: '/concerts/recording-sessions',
    backgroundImageUrl: 'https://images.example.test/recording-sessions.webp',
    dateRangeLabel: '2026.11.01 — 2026.12.12',
  })
})

test('关闭首页开关或活动状态不允许展示时，解析结果回退为空', () => {
  assert.equal(resolveHomepageFeaturedConcert(featuredConcert({ homepageFeatured: false })), null)
  for (const status of ['DRAFT', 'ENDED', 'ARCHIVED']) {
    assert.equal(resolveHomepageFeaturedConcert(featuredConcert({ status })), null)
  }
})

test('不完整或不安全的专题数据不会生成失效 Hero 链接', () => {
  assert.equal(resolveHomepageFeaturedConcert(featuredConcert({ title: '  ' })), null)
  assert.equal(resolveHomepageFeaturedConcert(featuredConcert({ slug: '../admin' })), null)
  assert.equal(resolveHomepageFeaturedConcert(featuredConcert({ startDate: null, endDate: null })), null)
  assert.equal(resolveHomepageFeaturedConcert(featuredConcert({ startDate: '2026-02-30' })), null)
  assert.equal(resolveHomepageFeaturedConcert(featuredConcert({ startDate: '2026-12-12', endDate: '2026-11-01' })), null)
})

test('后台字段缺省时保留单一日期且不要求背景图片', () => {
  const result = resolveHomepageFeaturedConcert(featuredConcert({ subtitle: null, backgroundImageUrl: null, startDate: new Date('2026-11-01T00:00:00.000Z'), endDate: null }))
  assert.equal(result?.dateRangeLabel, '2026.11.01 起')
  assert.equal(result?.subtitle, null)
  assert.equal(result?.backgroundImageUrl, null)
  assert.equal(result?.href, '/concerts/recording-sessions')
})

test('社区首页查询复用 ConcertEvent 后台开关、允许状态、图片、日期与排序，且查询失败保留安全回退', () => {
  const community = read('app/community/page.tsx')
  const query = read('lib/homepage-featured-concert-query.ts')
  const optional = read('lib/welcome-optional-data.ts')
  assert.match(community, /loadWelcomeOptionalData\('featured-event-query', getHomepageFeaturedConcert\)/)
  assert.match(community, /featuredConcert=\{featuredConcert\}/)
  assert.match(query, /where: \{ homepageFeatured: true, status: \{ in: \[\.\.\.homepageConcertStatuses\] \} \}/)
  assert.match(query, /orderBy: \{ updatedAt: 'desc' \}/)
  for (const field of ['title', 'subtitle', 'slug', 'backgroundImageUrl', 'startDate', 'endDate']) assert.match(query, new RegExp(`${field}: true`))
  assert.match(read('lib/homepage-featured-concert.ts'), /publicImageUrl\(event\.backgroundImageUrl\)/)
  assert.match(optional, /\[welcome\.optional-data\.unavailable\]/)
  assert.match(optional, /return null/)
})

test('有效专题固定优先于轮播；无效或关闭时仍使用原 Hero slides', () => {
  const hero = read('components/HomeHero.tsx')
  const surface = read('components/HomeLayoutSurface.tsx')
  assert.match(hero, /if \(featuredConcert\) \{/)
  assert.match(hero, /community-concert-hero-link/)
  assert.match(hero, /href=\{featuredConcert\.href\}/)
  assert.match(hero, /featuredConcert\.backgroundImageUrl/)
  assert.match(hero, /限时演唱会 · Recording Sessions/)
  assert.match(hero, /演出日期/)
  assert.match(hero, /进入专题/)
  assert.match(hero, /aria-roledescription="carousel"/) // Existing carousel remains the null-event fallback.
  assert.match(surface, /slides=\{slides\}/)
  assert.match(surface, /featuredConcert=\{featuredConcert\}/)
})

test('专题 Hero 保留紧凑移动高度、完整 CTA 和移动端背景定位', () => {
  const css = read('app/globals.css')
  assert.match(css, /\.community-concert-hero \{ height:clamp\(245px,72vw,310px\); \}/)
  assert.match(css, /\.community-concert-hero-image \{ object-position:center; \}/)
  assert.match(css, /\.community-concert-hero-cta \{ min-height:42px;/)
  assert.match(css, /\.community-concert-hero-title \{ max-width:100%;/)
})

test('活动中心继续使用独立展示开关，不随首页 Hero 状态改动', () => {
  const activities = read('app/activities/page.tsx')
  const admin = read('app/admin/concerts/ConcertEventAdminManager.tsx')
  assert.match(activities, /activityCenterVisible: true/)
  assert.match(activities, /ConcertCountdown/)
  assert.match(admin, /homepageFeatured/)
  assert.match(admin, /activityCenterVisible/)
  assert.match(admin, /backgroundImageUrl/)
})
