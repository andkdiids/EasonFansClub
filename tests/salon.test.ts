import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  appendUniqueSalonPosts,
  collectSalonCommentThreadIds,
  createEmptySalonCategoryCounts,
  decodeSalonCursor,
  decodeSalonRecommendationCursor,
  encodeSalonCursor,
  encodeSalonRecommendationCursor,
  getSalonPostVisibilityWhere,
  normalizeSalonConcertSelection,
  parseSalonFilters,
  parseSalonRecommendationSeed,
  SALON_CATEGORIES,
  SALON_CATEGORY_CONFIG,
  SALON_PAGE_SIZE,
  SALON_RECOMMENDATION_CANDIDATE_POOL,
  salonCategoryLabel,
  salonPublicBaseWhere,
} from '@/lib/salon'

const read = (path: string) => readFileSync(path, 'utf8')

test('沙龙 URL 筛选只接受固定分类、巡演、场次和排序参数', () => {
  assert.deepEqual(parseSalonFilters({ category: 'MOBILE_WALLPAPER', concert: 'tour-1', session: 'session-1', sort: 'popular', cursor: 'cursor-1' }), {
    category: 'MOBILE_WALLPAPER',
    tourId: 'tour-1',
    sessionId: 'session-1',
    cursor: 'cursor-1',
    sort: 'popular',
  })
  assert.deepEqual(parseSalonFilters({ category: 'NOT_ALLOWED', concert: '  ', sort: 'unknown' }), { sort: 'latest' })
  assert.equal(salonCategoryLabel('DESKTOP_WALLPAPER'), '电脑壁纸')
  assert.equal(salonCategoryLabel('unknown'), 'unknown')
})

test('沙龙游标可往返，并拒绝过长或不完整的游标', () => {
  const encoded = encodeSalonCursor({ id: 'post-24', approvedAt: '2026-08-30T01:02:03.000Z', likeCount: 17 })
  const decoded = decodeSalonCursor(encoded)
  assert.equal(decoded?.id, 'post-24')
  assert.equal(decoded?.approvedAt, '2026-08-30T01:02:03.000Z')
  assert.equal(decoded?.likeCount, 17)
  assert.equal(decodeSalonCursor('not-base64-json'), null)
  assert.equal(decodeSalonCursor('x'.repeat(513)), null)
})

test('沙龙推荐会话游标固定于同一 feed，并可安全往返', () => {
  const seedValue = `${Date.now().toString(36)}.test-session`
  const seed = parseSalonRecommendationSeed(seedValue)
  assert.equal(seed?.value, seedValue)
  const cursor = encodeSalonRecommendationCursor({ seed: seedValue, window: 0, offset: SALON_PAGE_SIZE })
  assert.deepEqual(decodeSalonRecommendationCursor(cursor, seedValue), { seed: seedValue, window: 0, offset: SALON_PAGE_SIZE })
  assert.equal(decodeSalonRecommendationCursor(cursor, `${Date.now().toString(36)}.other-session`), null)
  assert.equal(decodeSalonRecommendationCursor(encodeSalonRecommendationCursor({ seed: seedValue, window: 1, offset: SALON_RECOMMENDATION_CANDIDATE_POOL }), seedValue), null)
})

test('沙龙分类数量默认覆盖全部分类，且公开条件不包含审核中作品', () => {
  assert.deepEqual(createEmptySalonCategoryCounts(), {
    all: 0,
    CONCERT: 0,
    MOBILE_WALLPAPER: 0,
    DESKTOP_WALLPAPER: 0,
    TIME_TRAVEL: 0,
  })
  assert.deepEqual(SALON_CATEGORIES.map((category) => SALON_CATEGORY_CONFIG[category].label), ['演唱会记录', '手机壁纸', '电脑壁纸', '时光倒流二十年'])
  assert.equal(salonPublicBaseWhere.status, 'APPROVED')
  assert.deepEqual(salonPublicBaseWhere.approvedAt, { not: null })
})

test('沙龙分页按 24 条分批合并时保持顺序、完整和唯一', () => {
  const allPosts = Array.from({ length: 100 }, (_, index) => ({ id: `salon-${index + 1}` }))
  const pages = Array.from({ length: Math.ceil(allPosts.length / SALON_PAGE_SIZE) }, (_, page) => allPosts.slice(page * SALON_PAGE_SIZE, (page + 1) * SALON_PAGE_SIZE))
  let loaded: Array<{ id: string }> = []
  for (const page of pages) loaded = appendUniqueSalonPosts(loaded, page)
  assert.deepEqual(pages.map((page) => page.length), [24, 24, 24, 24, 4])
  assert.equal(loaded.length, 100)
  assert.equal(new Set(loaded.map((post) => post.id)).size, 100)
  assert.deepEqual(appendUniqueSalonPosts(loaded, pages[0] || []), loaded)
})

test('沙龙服务端和客户端沿用真实游标、稳定排序与推荐刷新会话', () => {
  const service = read('lib/salon.ts')
  const route = read('app/api/salon/posts/route.ts')
  const home = read('components/salon/SalonHome.tsx')
  assert.match(service, /const cursor = get\('cursor'\)\?\.trim\(\) \|\| undefined/)
  assert.match(service, /take: SALON_PAGE_SIZE \+ 1/)
  assert.match(service, /\{ approvedAt: 'desc' \}, \{ id: 'desc' \}/)
  assert.match(service, /\{ likeCount: 'desc' \}, \{ approvedAt: 'desc' \}, \{ id: 'desc' \}/)
  assert.match(route, /decodeSalonCursor/)
  assert.match(route, /getSalonCategoryCounts\(\)/)
  assert.match(home, /query\.set\('cursor', requestCursor\)/)
  assert.match(home, /appendUniqueSalonPosts/)
  assert.match(home, /loadingMoreRef\.current \|\| requestRef\.current/)
  assert.match(home, /query\.set\('mode', 'recommend'\)/)
  assert.match(home, /feedSeedRef\.current = data\.feedSeed/)
  assert.match(home, /pullDistanceRef\.current >= 64/)
})

test('沙龙作品可见性隔离访客、作者和 post_manage 审核者', () => {
  const guest = getSalonPostVisibilityWhere('post-1')
  assert.deepEqual(guest, { id: 'post-1', ...salonPublicBaseWhere })
  const owner = getSalonPostVisibilityWhere('post-1', 'user-1')
  assert.deepEqual(owner, { id: 'post-1', OR: [salonPublicBaseWhere, { userId: 'user-1' }] })
  assert.deepEqual(getSalonPostVisibilityWhere('post-1', 'admin-1', true), { id: 'post-1' })
})

test('壁纸分类允许可选演唱会关联，场次选择使用统一的父子值', () => {
  assert.equal(SALON_CATEGORY_CONFIG.MOBILE_WALLPAPER.label, '手机壁纸')
  assert.equal(SALON_CATEGORY_CONFIG.DESKTOP_WALLPAPER.label, '电脑壁纸')
  assert.equal(SALON_CATEGORY_CONFIG.MOBILE_WALLPAPER.allowsConcert, true)
  assert.equal(SALON_CATEGORY_CONFIG.DESKTOP_WALLPAPER.allowsSession, true)
  assert.equal(SALON_CATEGORY_CONFIG.MOBILE_WALLPAPER.requiresConcert, false)
  assert.deepEqual(normalizeSalonConcertSelection({ tourId: ' tour-a ', sessionId: ' session-a ', concertId: ' session-a ' }), {
    tourId: 'tour-a',
    sessionId: 'session-a',
    hasConflict: false,
  })
  assert.equal(normalizeSalonConcertSelection({ tourId: 'tour-a', sessionId: 'session-a', concertId: 'session-b' }).hasConflict, true)
  assert.equal(normalizeSalonConcertSelection({ tourId: 'tour-a', sessionId: 'session-a' }).sessionId, 'session-a')
  assert.equal(normalizeSalonConcertSelection({ concertId: 'legacy-session' }).sessionId, 'legacy-session')
})

test('删除沙龙评论时能收集整棵回复子树', () => {
  const ids = collectSalonCommentThreadIds([
    { id: 'root', parentId: null },
    { id: 'reply-a', parentId: 'root' },
    { id: 'reply-b', parentId: 'reply-a' },
    { id: 'other', parentId: null },
    { id: 'other-reply', parentId: 'other' },
  ], 'root')
  assert.deepEqual(ids, ['root', 'reply-a', 'reply-b'])
})

test('沙龙模型复用 MusicConcert 场次，不新增第二套演唱会实体', () => {
  const schema = read('prisma/schema.prisma')
  const migration = read('prisma/migrations/20260830190000_add_salon/migration.sql')
  assert.match(schema, /model SalonPost \{[\s\S]*?concertId\s+String[\s\S]*?concert\s+MusicConcert/)
  assert.match(schema, /SalonPostLike[\s\S]*?@@unique\(\[postId, userId\]/)
  assert.match(schema, /SalonComment[\s\S]*?parentId\s+String\?/)
  assert.doesNotMatch(schema, /model SalonConcert\s*\{|model ConcertSession\s*\{|model TourSession\s*\{/)
  assert.match(migration, /FOREIGN KEY \(`concertId`\) REFERENCES `MusicConcert`\(`id`\)/)
  assert.match(migration, /`status` ENUM\('PENDING', 'APPROVED', 'REJECTED'\) NOT NULL DEFAULT 'PENDING'/)
  assert.match(migration, /`thumbnailUrl` TEXT NOT NULL/)
})

test('未关联演唱会的旧壁纸仍使用自己的分类，不回退到历史影像', () => {
  const home = read('components/salon/SalonHome.tsx')
  assert.equal(SALON_CATEGORY_CONFIG.MOBILE_WALLPAPER.label, '手机壁纸')
  assert.equal(SALON_CATEGORY_CONFIG.DESKTOP_WALLPAPER.label, '电脑壁纸')
  assert.match(home, /formatSalonPostContext\(post\.category, post\.concert\)/)
  assert.doesNotMatch(home, /历史影像/)
})

test('沙龙投稿链路保留原图、使用有限 WebP 变体并在审核后公开', () => {
  const route = read('app/api/salon/posts/route.ts')
  const feed = read('lib/salon.ts')
  const admin = read('app/api/admin/salon/route.ts')
  assert.match(route, /SALON_MAX_FILES/)
  assert.match(route, /SALON_MAX_FILE_SIZE/)
  assert.match(route, /uploadImageVariantFamily/)
  assert.match(route, /original: image\.buffer/)
  assert.match(route, /variants: \['thumb-md', 'card', 'large'\]/)
  assert.match(feed, /status: 'APPROVED'/)
  assert.match(admin, /requireAdmin\('post_manage'\)/)
  assert.match(admin, /type: 'ADMIN'/)
})

test('沙龙访客页面和只读 API 绕过通用登录中间件，写操作仍由路由鉴权', () => {
  const middleware = read('middleware.ts')
  const postRoute = read('app/api/salon/posts/[postId]/route.ts')
  const commentsRoute = read('app/api/salon/posts/[postId]/comments/route.ts')
  assert.match(middleware, /'\/salon'/)
  assert.ok(middleware.includes("if (/^\\/salon\\/[^/]+$/.test(pathname)) return true"))
  assert.ok(middleware.includes("if (/^\\/api\\/salon\\/posts\\/[^/]+\\/comments$/.test(pathname)) return true"))
  assert.match(postRoute, /const guard = await requireUser\(\)/)
  assert.match(commentsRoute, /const guard = await requireUser\(\)/)
})

test('沙龙页面和接口使用缩略图首屏、原图详情与固定数量分页', () => {
  const home = read('components/salon/SalonHome.tsx')
  const detail = read('components/salon/SalonDetail.tsx')
  const service = read('lib/salon.ts')
  assert.match(home, /src=\{media\.thumbnailUrl\}/)
  assert.match(home, /IntersectionObserver/)
  assert.match(detail, /src=\{activeMedia\.previewUrl\}/)
  assert.match(detail, /setActiveIndex\(index\)/)
  assert.match(service, /export const SALON_PAGE_SIZE = 24/)
  assert.match(service, /take: SALON_PAGE_SIZE \+ 1/)
  assert.match(service, /likedIds = viewerId && pageRows\.length/)
})

test('沙龙社交写入使用服务端唯一约束、事务计数和现有通知类型', () => {
  const likeRoute = read('app/api/salon/posts/[postId]/like/route.ts')
  const commentsRoute = read('app/api/salon/posts/[postId]/comments/route.ts')
  const schema = read('prisma/schema.prisma')
  assert.match(likeRoute, /prisma\.\$transaction\(async \(tx\)/)
  assert.match(likeRoute, /postId_userId/)
  assert.match(likeRoute, /type: 'LIKE'/)
  assert.match(commentsRoute, /type: 'REPLY'/)
  assert.match(commentsRoute, /commentCount: \{ increment: 1 \}/)
  assert.match(schema, /@@unique\(\[postId, userId\], map: "SalonPostLike_postId_userId_key"\)/)
})
