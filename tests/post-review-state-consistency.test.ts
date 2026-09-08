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
const reviewCenterRoute = read('app/api/admin/review/route.ts')
const reviewCenter = read('app/admin/review/ReviewCenter.tsx')
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
  assert.match(reviewRoute, /\? \{ isDeleted: false, \.\.\.keywordFilter \}/)
  assert.match(reviewRoute, /\{ moderationStatus: status, isDeleted: false, \.\.\.keywordFilter \}/)
  assert.match(reviewRoute, /buildPostReviewUpdate\(\{ status, reviewedAt, reviewedById: guard\.user\.id, rejectionReason \}\)/)
  assert.match(reviewRoute, /data: updateData,/)
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
  assert.match(reviewRoute, /POST_REVIEW_ALREADY_REVIEWED/)
  assert.match(reviewRoute, /REVIEW_CONFLICT_REJECT_WINS/)
  assert.match(reviewCenterRoute, /decision === 'APPROVE' \? 'APPROVED' : 'REJECTED'/)
})

test('统一审核中心的状态按钮与服务端状态迁移保持一致', () => {
  assert.match(reviewCenter, /\['ALL', 'PENDING', 'APPROVED', 'REJECTED'\]/)
  assert.match(reviewCenter, /item\.actions\.reject/)
  assert.match(reviewCenter, /item\.actions\.approve/)
  assert.match(reviewCenter, /setRejectReason\(item\.rejectReason \|\| ''\)/)
  assert.match(reviewCenter, /body: JSON\.stringify\(/)
  assert.match(reviewCenterRoute, /rejectReason: reason/)
  assert.match(reviewCenterRoute, /REVIEW_CONFLICT_REJECT_WINS/)
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
