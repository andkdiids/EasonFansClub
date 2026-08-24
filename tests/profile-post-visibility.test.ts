import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { buildProfilePostWhere } from '../lib/post-moderation'

const read = (path: string) => readFileSync(path, 'utf8')
const publicModulesRoute = read('app/api/users/[userId]/public-modules/route.ts')
const postDeleteRoute = read('app/api/posts/[postId]/route.ts')
const reviewRoute = read('app/api/admin/posts/review/route.ts')

test('个人主页公开发帖条件只允许已发布且未删除的正常审核状态', () => {
  const where = buildProfilePostWhere('user-a')

  assert.equal(where.authorId, 'user-a')
  assert.equal(where.isDeleted, false)
  assert.equal(where.status, 'PUBLISHED')
  assert.deepEqual(where.moderationStatus.in, ['APPROVED', 'VIOLATION'])
  assert.equal(where.moderationStatus.in.includes('REJECTED'), false)
  assert.equal(where.moderationStatus.in.includes('PENDING'), false)
})

test('作者/管理员保留待审核可见性，但拒绝状态仍然永远排除', () => {
  const where = buildProfilePostWhere('user-a', true)

  assert.equal(where.isDeleted, false)
  assert.equal(where.status, 'PUBLISHED')
  assert.equal(where.moderationStatus.in.includes('PENDING'), true)
  assert.equal(where.moderationStatus.in.includes('APPROVED'), true)
  assert.equal(where.moderationStatus.in.includes('VIOLATION'), true)
  assert.equal(where.moderationStatus.in.includes('REJECTED'), false)
})

test('正常、拒绝、删除混合数据在服务端过滤后只会进入有效集合', () => {
  const where = buildProfilePostWhere('user-a', true)
  const allowedModerationStatuses = new Set(where.moderationStatus.in)
  const rows = [
    { status: 'PUBLISHED', isDeleted: false, moderationStatus: 'APPROVED' },
    { status: 'PUBLISHED', isDeleted: false, moderationStatus: 'PENDING' },
    { status: 'PUBLISHED', isDeleted: false, moderationStatus: 'REJECTED' },
    { status: 'PUBLISHED', isDeleted: true, moderationStatus: 'APPROVED' },
    { status: 'DELETED', isDeleted: false, moderationStatus: 'APPROVED' },
  ]
  const visible = rows.filter((row) => row.status === where.status && row.isDeleted === where.isDeleted && allowedModerationStatuses.has(row.moderationStatus as never))

  assert.deepEqual(visible.map((row) => row.moderationStatus), ['APPROVED', 'PENDING'])
})

test('个人主页列表和数量共用同一个服务端 where，审核/删除后失效个人主页缓存', () => {
  assert.match(publicModulesRoute, /const postWhere = buildProfilePostWhere\(target\.id, canViewPendingPosts\)/)
  assert.match(publicModulesRoute, /prisma\.post\.count\(\{ where: postWhere \}\)/)
  assert.match(publicModulesRoute, /prisma\.post\.findMany\(\{[\s\S]*?where: postWhere/)
  assert.match(reviewRoute, /revalidatePath\('\/user\/\[uid\]', 'page'\)/)
  assert.match(postDeleteRoute, /revalidatePath\('\/profile'\)/)
  assert.match(postDeleteRoute, /revalidatePath\('\/user\/\[uid\]', 'page'\)/)
})
