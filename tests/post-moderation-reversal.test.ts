import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  buildPostReviewUpdate,
  canTransitionPostModerationStatus,
  getPostModerationAccess,
  isPublicPostModerationStatus,
  publicPostWhere,
} from '../lib/post-moderation'

const read = (path: string) => readFileSync(path, 'utf8')
const reviewRoute = read('app/api/admin/posts/review/route.ts')
const reviewManager = read('app/admin/posts/review/PostReviewManager.tsx')
const postDetail = read('app/posts/[postId]/page.tsx')
const postApi = read('app/api/posts/[postId]/route.ts')
const editPage = read('app/posts/[postId]/edit/page.tsx')
const editRoute = read('app/api/posts/[postId]/route.ts')
const publicModules = read('app/api/users/[userId]/public-modules/route.ts')
const likeRoute = read('app/api/posts/[postId]/like/route.ts')
const favoriteRoute = read('app/api/posts/[postId]/favorite/route.ts')
const replyRoute = read('app/api/posts/[postId]/replies/route.ts')
const replyLikeRoute = read('app/api/replies/[replyId]/like/route.ts')
const replyPinRoute = read('app/api/replies/[replyId]/pin/route.ts')
const viewRoute = read('app/api/posts/[postId]/view/route.ts')

test('帖子审核允许 PENDING/APPROVED/REJECTED 之间的双向最终状态调整', () => {
  for (const [from, to] of [
    ['PENDING', 'APPROVED'],
    ['PENDING', 'REJECTED'],
    ['APPROVED', 'REJECTED'],
    ['REJECTED', 'APPROVED'],
  ] as const) {
    assert.equal(canTransitionPostModerationStatus(from, to), true, `${from} -> ${to}`)
  }
  assert.equal(canTransitionPostModerationStatus('VIOLATION', 'APPROVED'), false)
  assert.equal(canTransitionPostModerationStatus('APPROVED', 'PENDING'), false)
})

test('审核接口按锁定后的当前状态更新，不删除帖子且不修改原始发布时间', () => {
  const patchRoute = reviewRoute.slice(reviewRoute.indexOf('export async function PATCH'))
  assert.match(reviewRoute, /SELECT \\`id\\` FROM \\`Post\\` WHERE \\`id\\` = \$\{postId\} FOR UPDATE/)
  assert.match(reviewRoute, /canTransitionPostModerationStatus\(current\.moderationStatus, status\)/)
  assert.match(reviewRoute, /where: \{ id: postId, isDeleted: false, moderationStatus: current\.moderationStatus \}/)
  assert.match(reviewRoute, /data: buildPostReviewUpdate\(\{ status, reviewedAt, reviewedById: guard\.user\.id, rejectionReason \}\)/)
  assert.match(patchRoute, /changed: true[\s\S]*previousStatus: current\.moderationStatus/)
  assert.doesNotMatch(reviewRoute, /tx\.post\.(delete|deleteMany)\(/)
  assert.doesNotMatch(patchRoute, /data:[\s\S]*createdAt\s*:/)
  assert.match(reviewRoute, /fromStatus: input\.previousStatus/)
  assert.match(reviewRoute, /toStatus: input\.status/)
  assert.match(reviewRoute, /createPostModerationHistory\(prisma,/) 

  const update = buildPostReviewUpdate({
    status: 'REJECTED',
    reviewedAt: new Date('2026-09-05T04:30:00.000Z'),
    reviewedById: 'admin-1',
    rejectionReason: '内容违规',
  })
  assert.deepEqual(update, {
    moderationStatus: 'REJECTED',
    reviewedAt: new Date('2026-09-05T04:30:00.000Z'),
    reviewedById: 'admin-1',
    rejectionReason: '内容违规',
  })
  assert.equal(Object.hasOwn(update, 'content'), false)
  assert.equal(Object.hasOwn(update, 'likeCount'), false)
  assert.equal(Object.hasOwn(update, 'replyCount'), false)
  assert.equal(Object.hasOwn(update, 'createdAt'), false)
})

test('审核中心展示全部/各状态列表，并为已通过和已拒绝帖子提供逆向操作', () => {
  assert.match(reviewRoute, /rawStatus === 'ALL'/)
  assert.match(reviewRoute, /where: status === 'ALL' \? \{ isDeleted: false \} : \{ moderationStatus: status, isDeleted: false \}/)
  assert.match(reviewManager, /const reviewFilters: ReviewFilter\[\] = \['ALL', \.\.\.postModerationStatuses\]/)
  assert.match(reviewManager, /post\.moderationStatus === 'APPROVED'[\s\S]*拒绝通过/)
  assert.match(reviewManager, /post\.moderationStatus === 'REJECTED'[\s\S]*重新通过/)
  assert.match(reviewManager, /拒绝原因（必填）/)
  assert.match(reviewManager, /queueStatus === 'ALL'/)
})

test('拒绝后的公开访问与互动 API 统一使用公开审核条件，作者和管理员保留私有查看', () => {
  assert.deepEqual(publicPostWhere, {
    isDeleted: false,
    status: 'PUBLISHED',
    moderationStatus: { in: ['APPROVED', 'VIOLATION'] },
  })
  assert.equal(isPublicPostModerationStatus('APPROVED'), true)
  assert.equal(isPublicPostModerationStatus('REJECTED'), false)
  assert.equal(getPostModerationAccess('REJECTED', false), 'REJECTED')
  assert.equal(getPostModerationAccess('REJECTED', true), 'VISIBLE')
  assert.equal(getPostModerationAccess('REJECTED', false, true), 'VISIBLE')

  assert.match(postDetail, /getPostModerationAccess\(postCore\.moderationStatus, viewerIsAdmin, viewerIsAuthor\)/)
  assert.match(postDetail, /if \(moderationAccess === 'REJECTED'\)/)
  assert.match(postDetail, /viewerIsAuthor \|\| viewerIsAdmin \? postCore\.rejectionReason : null/)
  assert.match(postApi, /moderationStatus: \{ in: \['APPROVED', 'VIOLATION'\]/)
  assert.match(postApi, /status: 'PUBLISHED', isDeleted: false, moderationStatus: 'APPROVED'/)
  assert.match(postApi, /\.\.\.\(viewer \? \[\{ authorId: viewer\.id \}\] : \[\]\)/)
  assert.match(publicModules, /buildProfilePostWhere\(target\.id, canViewPendingPosts\)/)
  assert.match(editPage, /where: \{ id: postId, isDeleted: false \}/)
  assert.match(editRoute, /moderationStatus: 'PENDING' as const/)

  for (const route of [likeRoute, favoriteRoute, replyRoute, replyLikeRoute, replyPinRoute, viewRoute]) {
    assert.match(route, /publicPostWhere/)
  }
  for (const route of [likeRoute, favoriteRoute, replyLikeRoute, replyPinRoute]) {
    assert.match(route, /FOR UPDATE/)
  }
  assert.match(replyRoute, /const currentPost = await tx\.post\.findFirst\([\s\S]*\.\.\.publicPostWhere/)
  assert.match(replyRoute, /if \('unavailable' in reply\)/)
})

test('审核日志、通知、缓存和一次性奖励分别处理每次状态变化', () => {
  assert.match(reviewRoute, /await writeReviewAudit\(/)
  assert.match(reviewRoute, /await writeReviewHistory\(/)
  assert.match(reviewRoute, /await writeReviewNotification\(/)
  assert.match(reviewRoute, /key: input\.notificationKey \|\| `post-review-result:/)
  assert.match(reviewRoute, /input\.reviewedAt\.getTime\(\)/)
  assert.match(reviewRoute, /revalidatePath\('\/forum'\)/)
  assert.match(reviewRoute, /revalidatePath\('\/search'\)/)
  assert.match(reviewRoute, /revalidatePath\(`\/posts\/\$\{postId\}`\)/)
  assert.match(reviewRoute, /revalidateTag\('trending-posts'\)/)
  assert.match(reviewRoute, /revalidateTag\(HOME_FEATURED_POSTS_CACHE_TAG\)/)
  assert.match(reviewRoute, /if \(String\(result\.previousStatus\) === 'PENDING'\) triggerBadgeEvaluation\(current\.authorId, 'POST_APPROVED', postId\)/)
  assert.match(reviewRoute, /clearApprovalFriendActivity\(/)
  assert.match(editRoute, /reviewNotificationKey = canManagePosts \? null : `post-review:/)
})
