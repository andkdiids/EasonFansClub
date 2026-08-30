import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { collectSalonCommentThreadIds, decodeSalonCursor, encodeSalonCursor, getSalonPostVisibilityWhere, parseSalonFilters, salonCategoryLabel, salonPublicBaseWhere } from '@/lib/salon'

const read = (path: string) => readFileSync(path, 'utf8')

test('沙龙 URL 筛选只接受固定分类、巡演、场次和排序参数', () => {
  assert.deepEqual(parseSalonFilters({ category: 'MOBILE_WALLPAPER', concert: 'tour-1', session: 'session-1', sort: 'popular', cursor: 'cursor-1' }), {
    category: 'MOBILE_WALLPAPER',
    tourId: 'tour-1',
    sessionId: 'session-1',
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

test('沙龙作品可见性隔离访客、作者和 post_manage 审核者', () => {
  const guest = getSalonPostVisibilityWhere('post-1')
  assert.deepEqual(guest, { id: 'post-1', ...salonPublicBaseWhere })
  const owner = getSalonPostVisibilityWhere('post-1', 'user-1')
  assert.deepEqual(owner, { id: 'post-1', OR: [salonPublicBaseWhere, { userId: 'user-1' }] })
  assert.deepEqual(getSalonPostVisibilityWhere('post-1', 'admin-1', true), { id: 'post-1' })
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
