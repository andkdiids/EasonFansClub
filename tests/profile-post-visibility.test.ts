import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { buildProfilePostWhere } from '../lib/post-moderation'

const read = (path: string) => readFileSync(path, 'utf8')
const publicModulesRoute = read('app/api/users/[userId]/public-modules/route.ts')
const postDeleteRoute = read('app/api/posts/[postId]/route.ts')
const reviewRoute = read('app/api/admin/posts/review/route.ts')

type ProfileWhere = {
  authorId?: string
  isDeleted?: boolean
  status?: string
  publicationStatus?: string | { in?: string[] }
  publishedAt?: { not: null }
  moderationStatus?: { in?: string[] }
  OR?: ProfileWhere[]
}

const profileWhere = (authorId: string, includePending = false) => buildProfilePostWhere(authorId, includePending) as unknown as ProfileWhere

test('个人主页公开发帖条件只允许已发布且未删除的正常审核状态', () => {
  const where = profileWhere('user-a')

  assert.equal(where.authorId, 'user-a')
  assert.equal(where.isDeleted, false)
  assert.equal(where.status, 'PUBLISHED')
  assert.equal(where.publicationStatus, 'PUBLISHED')
  assert.deepEqual(where.publishedAt, { not: null })
  assert.deepEqual(where.moderationStatus?.in, ['APPROVED', 'VIOLATION'])
  assert.equal(where.moderationStatus?.in?.includes('REJECTED'), false)
  assert.equal(where.moderationStatus?.in?.includes('PENDING'), false)
})

test('作者/管理员保留待审核和拒绝状态的私有可见性', () => {
  const where = profileWhere('user-a', true)

  assert.equal(where.isDeleted, false)
  assert.equal(where.authorId, 'user-a')
  assert.equal(where.OR?.length, 2)
  const [immediate, scheduled] = where.OR || []
  assert.equal(immediate.status, 'PUBLISHED')
  assert.deepEqual(immediate.moderationStatus?.in, ['PENDING', 'REJECTED', 'APPROVED', 'VIOLATION'])
  assert.equal(immediate.OR?.some((item) => item.publicationStatus === 'WAITING_REVIEW'), true)
  assert.equal(scheduled.status, 'DRAFT')
  assert.deepEqual(scheduled.publicationStatus && typeof scheduled.publicationStatus !== 'string' ? scheduled.publicationStatus.in : undefined, ['SCHEDULED', 'CANCELLED'])
  assert.deepEqual(scheduled.moderationStatus?.in, ['PENDING', 'REJECTED', 'APPROVED'])
})

test('作者私有列表包含审核态和计划态，拒绝及删除帖子仍受审核过滤', () => {
  const where = profileWhere('user-a', true)
  const rows = [
    { status: 'PUBLISHED', publicationStatus: 'PUBLISHED', isDeleted: false, moderationStatus: 'APPROVED' },
    { status: 'PUBLISHED', publicationStatus: 'WAITING_REVIEW', isDeleted: false, moderationStatus: 'PENDING' },
    { status: 'DRAFT', publicationStatus: 'SCHEDULED', isDeleted: false, moderationStatus: 'PENDING' },
    { status: 'DRAFT', publicationStatus: 'SCHEDULED', isDeleted: false, moderationStatus: 'APPROVED' },
    { status: 'DRAFT', publicationStatus: 'CANCELLED', isDeleted: false, moderationStatus: 'APPROVED' },
    { status: 'DRAFT', publicationStatus: 'SCHEDULED', isDeleted: false, moderationStatus: 'REJECTED' },
    { status: 'DRAFT', publicationStatus: 'SCHEDULED', isDeleted: true, moderationStatus: 'APPROVED' },
    { status: 'DELETED', publicationStatus: 'PUBLISHED', isDeleted: false, moderationStatus: 'APPROVED' },
  ]
  const visible = rows.filter((row) => !row.isDeleted && (where.OR || []).some((branch) => {
    if (branch.status !== row.status || !branch.moderationStatus?.in?.includes(row.moderationStatus)) return false
    if (branch.status === 'PUBLISHED') return (branch.OR || []).some((publication) => publication.publicationStatus === row.publicationStatus)
    const publicationStatus = branch.publicationStatus
    return Boolean(publicationStatus && typeof publicationStatus !== 'string' && publicationStatus.in?.includes(row.publicationStatus))
  }))

  assert.deepEqual(visible.map((row) => row.publicationStatus), ['PUBLISHED', 'WAITING_REVIEW', 'SCHEDULED', 'SCHEDULED', 'CANCELLED', 'SCHEDULED'])
})

test('个人主页列表和数量共用同一个服务端 where，审核/删除后失效个人主页缓存', () => {
  assert.match(publicModulesRoute, /const postWhere = buildProfilePostWhere\(target\.id, canViewPendingPosts\)/)
  assert.match(publicModulesRoute, /prisma\.post\.count\(\{ where: postWhere \}\)/)
  assert.match(publicModulesRoute, /prisma\.post\.findMany\(\{[\s\S]*?where: postWhere/)
  assert.match(reviewRoute, /revalidatePath\('\/user\/\[uid\]', 'page'\)/)
  assert.match(postDeleteRoute, /revalidatePath\('\/profile'\)/)
  assert.match(postDeleteRoute, /revalidatePath\('\/user\/\[uid\]', 'page'\)/)
})
