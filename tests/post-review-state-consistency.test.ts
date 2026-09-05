import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  buildPostReviewUpdate,
  getPostModerationAccess,
  publicPostWhere,
} from '../lib/post-moderation'

const read = (path: string) => readFileSync(path, 'utf8')
const reviewRoute = read('app/api/admin/posts/review/route.ts')
const reviewManager = read('app/admin/posts/review/PostReviewManager.tsx')
const postDetail = read('app/posts/[postId]/page.tsx')
const postEditRoute = read('app/api/posts/[postId]/route.ts')
const postActions = read('components/PostActions.tsx')
const publicModulesRoute = read('app/api/users/[userId]/public-modules/route.ts')
const discoveryHome = read('components/ForumDiscoveryHome.tsx')
const notifications = read('lib/notifications.ts')

test('审核状态只写入 Post.moderationStatus，并清理互斥审核元数据', () => {
  const reviewedAt = new Date('2026-08-10T10:00:00.000Z')
  assert.deepEqual(buildPostReviewUpdate({
    status: 'APPROVED',
    reviewedAt,
    reviewedById: 'admin-1',
    rejectionReason: '旧原因',
  }), {
    moderationStatus: 'APPROVED',
    reviewedAt,
    reviewedById: 'admin-1',
    rejectionReason: null,
  })
  assert.deepEqual(buildPostReviewUpdate({
    status: 'REJECTED',
    reviewedAt,
    reviewedById: 'admin-1',
    rejectionReason: '内容需要修改',
  }), {
    moderationStatus: 'REJECTED',
    reviewedAt,
    reviewedById: 'admin-1',
    rejectionReason: '内容需要修改',
  })
  assert.match(reviewRoute, /status === 'ALL' \? \{ isDeleted: false \} : \{ moderationStatus: status, isDeleted: false \}/)
  assert.match(reviewRoute, /data: buildPostReviewUpdate\(\{ status, reviewedAt, reviewedById: guard\.user\.id, rejectionReason \}\)/)
  assert.doesNotMatch(reviewRoute, /data:\s*\{\s*status:\s*status/)
})

test('审核 API 具备四种状态迁移、幂等守卫和并发锁', () => {
  assert.match(reviewRoute, /SELECT \\`id\\` FROM \\`Post\\` WHERE \\`id\\` = \$\{postId\} FOR UPDATE/)
  assert.match(reviewRoute, /canTransitionPostModerationStatus\(current\.moderationStatus, status\)/)
  assert.match(reviewRoute, /moderationStatus: current\.moderationStatus/)
  assert.match(reviewRoute, /reviewStatus === 'APPROVED'/)
  assert.match(reviewRoute, /writeApprovalFriendActivity/)
  assert.doesNotMatch(reviewRoute, /tx\.notification\.create/)
  assert.match(reviewRoute, /previousStatus: result\.previousStatus/)
  assert.match(reviewRoute, /changed: false/)
})

test('后台三个列表和重新审核按钮都直接对应 PENDING / APPROVED / REJECTED', () => {
  assert.match(reviewManager, /reviewFilters\.map/)
  assert.match(reviewManager, /拒绝通过/)
  assert.match(reviewManager, /重新通过/)
  assert.match(reviewManager, /拒绝原因（必填）/)
  assert.match(reviewManager, /rejectionReason: reason/)
  assert.match(reviewManager, /setPosts\(\(current\) => current\.filter\(\(post\) => post\.id !== postId\)\)/)
})

test('帖子详情和公开查询使用同一审核访问规则', () => {
  assert.deepEqual(publicPostWhere, { isDeleted: false, status: 'PUBLISHED', moderationStatus: { in: ['APPROVED', 'VIOLATION'] } })
  assert.equal(getPostModerationAccess('APPROVED', false), 'VISIBLE')
  assert.equal(getPostModerationAccess('PENDING', false), 'PENDING')
  assert.equal(getPostModerationAccess('REJECTED', false), 'REJECTED')
  assert.equal(getPostModerationAccess('REJECTED', true), 'VISIBLE')
  assert.equal(getPostModerationAccess('PENDING', false, true), 'VISIBLE')
  assert.match(postDetail, /getPostModerationAccess\(postCore\.moderationStatus, viewerIsAdmin, viewerIsAuthor\)/)
  assert.match(postDetail, /isPublicPostModerationStatus\(post\.moderationStatus\)/)
  assert.match(postDetail, /if \(moderationAccess === 'REJECTED'\)/)
})

test('普通用户编辑已审核帖子会开启新的审核周期，管理员编辑保持原有豁免', () => {
  assert.match(postEditRoute, /!canManagePosts\s*\?\s*\{[\s\S]*moderationStatus: 'PENDING'/)
  assert.match(postEditRoute, /reviewedAt: null/)
  assert.match(postEditRoute, /reviewedById: null/)
  assert.match(postEditRoute, /rejectionReason: null/)
  assert.match(postEditRoute, /message: canManagePosts \? '帖子已保存' : '修改已保存，正在等待审核/)
  assert.match(postEditRoute, /checkPostForbiddenWords\(\{ title: rawTitle, content: rawContent \}, user\)/)
  assert.match(postEditRoute, /reviewNotificationKey = canManagePosts \? null : `post-review:\$\{postId\}:\$\{randomUUID\(\)\}`/)
  assert.match(postEditRoute, /title: '帖子编辑后待审核'/)
  assert.match(postEditRoute, /emitRealtimeToAdmins\('notification'\)/)
  assert.match(postEditRoute, /friendActivity\.deleteMany/)
  assert.match(postEditRoute, /revalidateTag\('trending-posts'\)/)
  assert.doesNotMatch(postEditRoute, /body\.moderationStatus|body\.reviewedAt|body\.reviewedById/)
  assert.doesNotMatch(postEditRoute, /\bisAdmin\b/)
  assert.match(postActions, /!canManage && !canDelete && !canEdit/)
  assert.match(publicModulesRoute, /canViewPendingPosts/)
  assert.match(publicModulesRoute, /viewer\.id === target\.id \|\| await hasAdminPermission\(viewer, 'post_manage'\)/)
  assert.match(discoveryHome, /storedAge <= DISCOVERY_SESSION_MAX_AGE_MS/)
  assert.match(notifications, /split\(':', 1\)\[0\]/)
})
