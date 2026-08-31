import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { decodePostLikeCursor, encodePostLikeCursor, POST_LIKE_PAGE_SIZE } from '@/lib/post-like-pagination'
import { getLikeAvatarPreview, mergeLikeAvatarUsers } from '@/lib/like-avatar-utils'

function read(path: string) {
  return readFileSync(path, 'utf8')
}

function likers(count: number) {
  return Array.from({ length: count }, (_, index) => ({ id: `user-${index + 1}`, uid: index + 1, avatarUrl: null }))
}

function splitPages<T>(items: T[], pageSize: number) {
  const pages: T[][] = []
  for (let index = 0; index < items.length; index += pageSize) pages.push(items.slice(index, index + pageSize))
  return pages
}

const detailPage = read('app/posts/[postId]/page.tsx')
const avatarComponent = read('components/LikeAvatars.tsx')
const postLikeRoute = read('app/api/posts/[postId]/like/route.ts')
const postActions = read('components/PostActions.tsx')
const actionBar = read('components/ForumDiscoveryActionBar.tsx')

test('3 个点赞用户会全部进入头像预览且没有剩余人数', () => {
  const result = getLikeAvatarPreview(likers(3), 3, 10)
  assert.equal(result.visible.length, 3)
  assert.equal(result.overflow, 0)
})

test('126 个点赞用户的 total 与剩余 +N 计算一致', () => {
  const result = getLikeAvatarPreview(likers(126), 126, 10)
  assert.equal(result.visible.length, 10)
  assert.equal(result.overflow, 116)
  assert.equal(result.visible.length + result.overflow, 126)
})

test('141 个点赞用户按移动端预览显示 7 个，+N 仍基于真实 total', () => {
  const result = getLikeAvatarPreview(likers(141), 141, 7)
  assert.equal(result.visible.length, 7)
  assert.equal(result.overflow, 134)
})

test('141 个点赞用户分页为 50、50、41，合并后无重复且完整', () => {
  const pages = splitPages(likers(141), POST_LIKE_PAGE_SIZE)
  assert.deepEqual(pages.map((page) => page.length), [50, 50, 41])
  const merged = pages.reduce((current, page) => mergeLikeAvatarUsers(current, page), likers(0))
  assert.equal(merged.length, 141)
  assert.equal(new Set(merged.map((liker) => liker.id)).size, 141)
})

test('小于一页和恰好两页时不会凭空产生下一页', () => {
  assert.deepEqual(splitPages(likers(20), POST_LIKE_PAGE_SIZE).map((page) => page.length), [20])
  assert.deepEqual(splitPages(likers(100), POST_LIKE_PAGE_SIZE).map((page) => page.length), [50, 50])
})

test('移动端预览限制为 7 个头像，桌面端为 10 个头像', () => {
  assert.match(avatarComponent, /const MAX_INLINE_AVATARS = 10/)
  assert.match(avatarComponent, /const MOBILE_INLINE_AVATARS = 7/)
  assert.match(avatarComponent, /matchMedia\('\(max-width: 639px\)'\)/)
  assert.match(avatarComponent, /getLikeAvatarPreview\(/)
})

test('50 + 50 + 26 的渐进加载最终合并为完整 126 人且去重', () => {
  const first = likers(50)
  const second = likers(76).map((liker, index) => ({ ...liker, id: `user-${index + 51}` }))
  const merged = mergeLikeAvatarUsers(mergeLikeAvatarUsers([], first), second)
  assert.equal(merged.length, 126)
  assert.equal(mergeLikeAvatarUsers(merged, [merged[0]]).length, 126)
})

test('帖子点赞接口使用 50 + 1 探测、total 和 nextCursor', () => {
  assert.match(postLikeRoute, new RegExp(`take: POST_LIKE_PAGE_SIZE \\+ 1`))
  assert.match(postLikeRoute, /prisma\.like\.count\(/)
  assert.match(postLikeRoute, /total,/)
  assert.match(postLikeRoute, /nextCursor/)
  assert.equal(POST_LIKE_PAGE_SIZE, 50)
})

test('帖子点赞接口只查询并返回头像所需字段，不查询昵称或勋章', () => {
  assert.doesNotMatch(postLikeRoute, /getEquippedBadgesForUsers/)
  const routeSelect = postLikeRoute.slice(postLikeRoute.indexOf('select: {'), postLikeRoute.indexOf('}),\n    prisma.like.count'))
  assert.doesNotMatch(routeSelect, /nickname|displayName|equippedBadge|badge/)
})

test('帖子详情页主帖点赞查询和展示不携带昵称、用户名或勋章', () => {
  const likerSelect = detailPage.slice(detailPage.indexOf('const postLikerSelect'), detailPage.indexOf('type PostLike'))
  assert.doesNotMatch(likerSelect, /nickname|displayName|equippedBadge|badge/)
  const mainLikeBlock = detailPage.slice(detailPage.indexOf('<LikeAvatars'), detailPage.indexOf('</article>', detailPage.indexOf('<LikeAvatars')))
  assert.match(mainLikeBlock, /avatarOnly/)
  assert.doesNotMatch(mainLikeBlock, /nickname|displayName|equippedBadge|UserDisplayName/)
})

test('头像模式展开区域只渲染头像流，不渲染 UserDisplayName', () => {
  const start = avatarComponent.indexOf('{avatarOnly ? (')
  const end = avatarComponent.indexOf(') : (', start)
  assert.ok(start >= 0 && end > start)
  const avatarOnlyBranch = avatarComponent.slice(start, end)
  assert.doesNotMatch(avatarOnlyBranch, /UserDisplayName|nickname|username|equippedBadge/)
  assert.match(avatarOnlyBranch, /、/)
})

test('每个头像后仅在不是最后一位时输出顿号，避免尾部多余分隔', () => {
  assert.match(avatarComponent, /index < displayLikers\.length - 1 \? <span[^>]*>、<\/span> : null/)
  assert.match(avatarComponent, /index < inlineLikers\.length - 1 \|\| overflow > 0/)
})

test('头像仍链接到现有公开用户页并阻止外层展开事件', () => {
  assert.match(avatarComponent, /href=\{`\/user\/\$\{formatUid\(liker\.uid\)\}`\}/)
  assert.match(avatarComponent, /onClick=\{\(event\) => event\.stopPropagation\(\)\}/)
})

test('展开列表限制高度并在滚动到底部时按 nextCursor 加载', () => {
  assert.match(avatarComponent, /max-h-\[min\(50dvh,420px\)\]/)
  assert.match(avatarComponent, /onScroll=\{avatarOnly \? handleListScroll : undefined\}/)
  assert.match(avatarComponent, /loadLikersPage\(nextCursor\)/)
  assert.match(avatarComponent, /cursor=\$\{encodeURIComponent\(cursor\)\}/)
})

test('桌面端无滚动溢出时仍提供加载更多，加载中和最后一页会停止重复请求', () => {
  assert.match(avatarComponent, /data-like-avatar-load-more="true"/)
  assert.match(avatarComponent, /!isLoading && !loadError && nextCursor/)
  assert.match(avatarComponent, /loadingRef\.current/)
  assert.match(avatarComponent, /setNextCursor\(typeof data\.nextCursor === 'string' && data\.nextCursor \? data\.nextCursor : null\)/)
})

test('点赞和取消点赞事件会实时插入或移除当前用户头像', () => {
  assert.match(postActions, /liker: currentUserLiker/)
  assert.match(actionBar, /currentUserLiker\?: PostInteractionLiker \| null/)
  assert.match(detailPage, /currentUserLiker =|currentUserLiker\}/)
  assert.match(avatarComponent, /setLiveLikers\(\(current\) => prependLiker\(current, liker\)\)/)
  assert.match(avatarComponent, /setLiveLikers\(\(current\) => current\.filter\(\(item\) => item\.id !== liker\.id\)\)/)
})

test('头像加载失败继续使用 SafeAvatar 的现有 fallback', () => {
  assert.match(avatarComponent, /<SafeAvatar/)
  assert.match(avatarComponent, /profileImageUrl\(liker\.avatarUrl\)/)
})

test('游标编码解码保持 createdAt + id，并拒绝无效游标', () => {
  const cursor = { createdAt: '2026-08-30T00:00:00.000Z', id: 'like_123' }
  assert.deepEqual(decodePostLikeCursor(encodePostLikeCursor(cursor)), cursor)
  assert.equal(decodePostLikeCursor('invalid-cursor'), null)
})
