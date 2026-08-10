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
  assert.match(reviewRoute, /where: \{ moderationStatus: status, isDeleted: false \}/)
  assert.match(reviewRoute, /data: buildPostReviewUpdate\(\{ status, reviewedAt, reviewedById: guard\.user\.id, rejectionReason \}\)/)
  assert.doesNotMatch(reviewRoute, /data:\s*\{\s*status:\s*status/)
})

test('审核 API 具备四种状态迁移、幂等守卫和并发锁', () => {
  assert.match(reviewRoute, /SELECT \\`id\\` FROM \\`Post\\` WHERE \\`id\\` = \$\{postId\} FOR UPDATE/)
  assert.match(reviewRoute, /const statusChanged = current\.moderationStatus !== updated\.moderationStatus/)
  assert.match(reviewRoute, /if \(statusChanged\) \{[\s\S]*tx\.notification\.create/)
  assert.match(reviewRoute, /APPROVED' && current\.moderationStatus !== 'APPROVED'/)
  assert.match(reviewRoute, /previousStatus: result\.previousStatus/)
})

test('后台三个列表和重新审核按钮都直接对应 PENDING / APPROVED / REJECTED', () => {
  assert.match(reviewManager, /postModerationStatuses\.map/)
  assert.match(reviewManager, /重新拒绝/)
  assert.match(reviewManager, /重新通过/)
  assert.match(reviewManager, /拒绝原因（可选）/)
  assert.match(reviewManager, /rejectionReason: reason/)
  assert.match(reviewManager, /setPosts\(\(current\) => current\.filter\(\(post\) => post\.id !== postId\)\)/)
})

test('帖子详情和公开查询使用同一审核访问规则', () => {
  assert.deepEqual(publicPostWhere, { isDeleted: false, status: 'PUBLISHED', moderationStatus: 'APPROVED' })
  assert.equal(getPostModerationAccess('APPROVED', false), 'VISIBLE')
  assert.equal(getPostModerationAccess('PENDING', false), 'PENDING')
  assert.equal(getPostModerationAccess('REJECTED', false), 'REJECTED')
  assert.equal(getPostModerationAccess('REJECTED', true), 'VISIBLE')
  assert.match(postDetail, /getPostModerationAccess\(post\.moderationStatus, viewerIsAdmin\)/)
  assert.match(postDetail, /if \(moderationAccess === 'REJECTED'\)/)
})
