import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { prisma } from '@/lib/prisma'
import { getUserBadgeMetric } from '@/lib/badge-metrics'
import { createTopicSubmissionForCommentInTransaction, reviewTopicActivitySubmission, grantTopicActivityRewardItems } from '@/lib/topic-activity'
import { normalizeTopicActivityFormSchema, validateTopicActivityFormAnswers, validateTopicActivityFormAttachments } from '@/lib/topic-activity-form'
import { serializeTopicActivityFormSubmission } from '@/lib/topic-activity-form-view'

const read = (file: string) => readFileSync(join(process.cwd(), file), 'utf8')
const now = new Date('2026-10-07T04:00:00Z')

test('global attachments validate allowed flag, limit, IDs and IMAGE-field duplicates independently', () => {
  assert.deepEqual(validateTopicActivityFormAttachments(undefined, false), { valid: true, value: [] })
  assert.equal(validateTopicActivityFormAttachments(['asset-1'], false).valid, false)
  assert.equal(validateTopicActivityFormAttachments(['asset-1'], true).valid, true)
  assert.equal(validateTopicActivityFormAttachments(['bad space'], true).valid, false)
  assert.equal(validateTopicActivityFormAttachments([7], true).valid, false)
  assert.equal(validateTopicActivityFormAttachments(['asset-1', 'asset-1'], true).valid, false)
  assert.equal(validateTopicActivityFormAttachments(Array.from({ length: 10 }, (_, i) => `asset-${i}`), true).valid, false)
  assert.equal(validateTopicActivityFormAttachments(['asset-1'], true, ['asset-1']).valid, false)
  const schema = normalizeTopicActivityFormSchema({ fields: [{ id: 'name', label: '姓名', type: 'TEXT', required: true }, { id: 'image', label: '截图', type: 'IMAGE' }] }, true)
  assert.equal(schema.valid, true)
  if (!schema.valid) return
  const fields = validateTopicActivityFormAnswers(schema.value, { name: '用户', image: ['field-image'] })
  assert.equal(fields.valid, true)
  if (fields.valid) assert.equal(validateTopicActivityFormAttachments(['global-image'], true, fields.value.assetIds).valid, true)
})

test('legacy form review values display submitted/replied, never approved or rejected', async () => {
  for (const status of ['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN']) {
    const row = { id: 'form-1', activityId: 'activity-1', userId: 'user-1', status, formSchemaSnapshot: { fields: [] }, answersSnapshot: [], submittedAt: now, reviewedAt: now, rejectReason: '旧审核原因', ImageAssets: [], Replies: [] }
    const submitted = await serializeTopicActivityFormSubmission(row)
    assert.equal(submitted.status, 'SUBMITTED')
    assert.equal(submitted.rejectReason, null)
    assert.equal(submitted.reviewedAt, null)
    assert.deepEqual(submitted.attachments, [])
    const replied = await serializeTopicActivityFormSubmission({ ...row, Replies: [{ id: 'reply-1', content: '资料已收到', createdAt: now, Sender: { id: 'admin-1', nickname: '管理员' }, ImageAssets: [] }] })
    assert.equal(replied.status, 'REPLIED')
    assert.equal(replied.replies.length, 1)
  }
})

test('FORM, BOTH and COMMENT all create a comment submission in a valid canonical window', async () => {
  for (const participationMode of ['FORM', 'BOTH', 'COMMENT']) {
    let created = 0
    const tx = { activity: { findFirst: async () => ({ id: 'activity-1', participationMode }) }, topicActivitySubmission: { create: async () => { created++; return { id: 'submission-1' } } } }
    await createTopicSubmissionForCommentInTransaction(tx as unknown as Parameters<typeof createTopicSubmissionForCommentInTransaction>[0], { postId: 'post-1', commentId: 'comment-1', userId: 'admin-1', isAdmin: true, now })
    assert.equal(created, 1)
  }
})

// In-memory transaction double: no database or production state is accessed.
function fixture(mode: 'FORM' | 'BOTH' | 'COMMENT', forms: number, scheduled = false, legacyFormCount = 0) {
  const activity = { id: 'activity-1', title: '测试', type: 'TOPIC_ACTIVITY', status: 'PUBLISHED', activityPostId: 'post-1', participationMode: mode, rewardGrantMode: scheduled ? 'SCHEDULED' : 'IMMEDIATE', rewardGrantAt: scheduled ? new Date(now.getTime() + 60_000) : null, rewardPoints: 7, rewardBadgeIds: [] }
  const submissions = ['a', 'b'].map((id) => ({ id, activityId: activity.id, userId: 'user-1', commentId: `comment-${id}`, status: 'PENDING', commentDeletedAt: null, Activity: activity, Comment: { postId: 'post-1', parentId: null, isDeleted: false }, reviewedAt: null as Date | null, rejectReason: null as string | null }))
  type Participation = { id: string; activityId: string; userId: string; approvedSubmissionCount: number; rewardStatus: string; rewardGrantedAt: Date | null; reviewReversedAfterReward: boolean; firstApprovedSubmissionId?: string; firstApprovedAt?: Date; rewardEligibleAt?: Date }
  let participation: Participation | null = legacyFormCount ? { id: 'participation-1', activityId: activity.id, userId: 'user-1', approvedSubmissionCount: legacyFormCount, rewardStatus: 'NOT_ELIGIBLE', rewardGrantedAt: null, reviewReversedAfterReward: false } : null
  type Grant = { id: string; participationId: string; activityId: string; userId: string; kind: string; points: number; grantKey: string; status: string }
  const grants: Grant[] = []
  const logs: Array<{ businessKey: string; points: number }> = []
  const reviews: unknown[] = []
  let points = 100
  const tx = {
    $queryRaw: async () => [],
    topicActivitySubmission: {
      findUnique: async ({ where }: { where: { id: string } }) => submissions.find((row) => row.id === where.id),
      count: async ({ where }: { where: { id?: { not: string } } }) => submissions.filter((row) => row.status === 'APPROVED' && row.id !== where.id?.not && !row.Comment.isDeleted).length,
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => Object.assign(submissions.find((row) => row.id === where.id)!, data),
    },
    topicActivityFormSubmission: { findFirst: async () => forms ? { id: 'form-1' } : null },
    topicActivityReviewLog: { create: async (data: unknown) => { reviews.push(data) } },
    topicActivityParticipation: {
      findUnique: async () => participation,
      create: async ({ data }: { data: Partial<Participation> }) => (participation = { id: 'participation-1', activityId: activity.id, userId: 'user-1', approvedSubmissionCount: 0, rewardStatus: 'NOT_ELIGIBLE', rewardGrantedAt: null, reviewReversedAfterReward: false, ...data }),
      update: async ({ data }: { data: Partial<Participation> }) => Object.assign(participation!, data),
    },
    topicActivityRewardGrant: {
      findMany: async ({ where }: { where: { status?: { in: string[] } } }) => grants.filter((row) => !where.status || where.status.in.includes(row.status)),
      createMany: async ({ data }: { data: Grant[] }) => { for (const row of data) if (!grants.some((grant) => grant.grantKey === row.grantKey)) grants.push({ ...row, id: `grant-${grants.length}`, status: 'PENDING' }) },
      findUnique: async ({ where }: { where: { id: string } }) => { const grant = grants.find((row) => row.id === where.id); return grant ? { ...grant, Activity: activity, Participation: participation } : null },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => Object.assign(grants.find((row) => row.id === where.id)!, data),
      updateMany: async () => ({ count: 0 }),
    },
    pointLog: { findUnique: async ({ where }: { where: { businessKey: string } }) => logs.find((log) => log.businessKey === where.businessKey), create: async ({ data }: { data: { businessKey: string; points: number } }) => { logs.push(data) } },
    user: { findUnique: async () => ({ points }), update: async ({ data }: { data: { points: { increment: number } } }) => { points += data.points.increment } },
  }
  return { activity, submissions, tx, grants, logs, reviews, points: () => points, participation: () => participation }
}

async function withFixture(f: ReturnType<typeof fixture>, work: () => Promise<void>) {
  const replace = (target: object, key: string, method: unknown) => {
    const original = Reflect.get(target, key)
    Reflect.set(target, key, method)
    return () => { Reflect.set(target, key, original) }
  }
  const restore = [replace(prisma, '$transaction', async (callback: (tx: unknown) => Promise<unknown>) => callback(f.tx)), replace(prisma.activity, 'findUnique', async () => f.activity), replace(prisma.topicActivityParticipation, 'findUnique', async () => f.participation())]
  try { await work() } finally { restore.reverse().forEach((reset) => reset()) }
}

test('required form missing blocks comment approval before review, eligibility, points or logs', async () => {
  const f = fixture('FORM', 0)
  await withFixture(f, async () => { await assert.rejects(reviewTopicActivitySubmission({ submissionId: 'a', reviewerId: 'admin-1', status: 'APPROVED', now }), /FORM_REQUIRED_BEFORE_APPROVAL/) })
  assert.equal(f.submissions[0].status, 'PENDING')
  assert.equal(f.participation(), null)
  assert.equal(f.reviews.length, 0)
  assert.equal(f.grants.length, 0)
  assert.equal(f.points(), 100)
})

test('form then multiple approved comments: one participation, one 7-point grant and one PointLog', async () => {
  const f = fixture('FORM', 2, false, 3)
  await withFixture(f, async () => {
    const first = await reviewTopicActivitySubmission({ submissionId: 'a', reviewerId: 'user-1', status: 'APPROVED', now })
    assert.equal(first.firstParticipationCreated, true, 'legacy approved forms do not masquerade as an approved comment')
    const second = await reviewTopicActivitySubmission({ submissionId: 'b', reviewerId: 'admin-1', status: 'APPROVED', now })
    assert.equal(second.firstParticipationCreated, false)
    const repeat = await reviewTopicActivitySubmission({ submissionId: 'a', reviewerId: 'admin-1', status: 'APPROVED', now })
    assert.equal(repeat.changed, false)
  })
  assert.equal(f.participation()?.approvedSubmissionCount, 2)
  assert.equal(f.participation()?.rewardStatus, 'GRANTED')
  assert.equal(f.points(), 107)
  assert.equal(f.logs.length, 1)
  assert.equal(f.grants.length, 1)
  assert.equal(f.reviews.length, 2)
})

test('legacy BOTH comments preserve V5 review compatibility; scheduled approval waits for grant time', async () => {
  const f = fixture('BOTH', 0, true)
  await withFixture(f, async () => { await reviewTopicActivitySubmission({ submissionId: 'a', reviewerId: 'admin-1', status: 'APPROVED', now }) })
  assert.equal(f.participation()?.approvedSubmissionCount, 1)
  assert.equal(f.participation()?.rewardStatus, 'PENDING')
  assert.equal(f.points(), 100)
  assert.equal(f.logs.length, 0)
})

test('legacy form-only reward eligibility cannot dispatch points even if cached approved count is positive', async () => {
  const f = fixture('FORM', 1, false, 1)
  f.grants.push({ id: 'legacy-grant', participationId: 'participation-1', activityId: 'activity-1', userId: 'user-1', kind: 'POINTS', points: 7, grantKey: 'topic-activity:activity-1:user-1:points', status: 'PENDING' })
  await withFixture(f, async () => { await grantTopicActivityRewardItems(['legacy-grant'], now) })
  assert.equal(f.grants[0].status, 'CANCELLED')
  assert.equal(f.points(), 100)
  assert.equal(f.logs.length, 0)
})

test('ENDED retains approved comment scheduled rewards, CANCELLED never grants or claws back', async () => {
  const ended = fixture('BOTH', 0, true)
  await withFixture(ended, async () => {
    await reviewTopicActivitySubmission({ submissionId: 'a', reviewerId: 'admin-1', status: 'APPROVED', now })
    await grantTopicActivityRewardItems(ended.grants.map((row) => row.id), new Date(now.getTime() + 60_001))
    await grantTopicActivityRewardItems(ended.grants.map((row) => row.id), new Date(now.getTime() + 120_000))
  })
  assert.equal(ended.points(), 107)
  assert.equal(ended.logs.length, 1)
  const cancelled = fixture('BOTH', 0, true)
  await withFixture(cancelled, async () => {
    await reviewTopicActivitySubmission({ submissionId: 'a', reviewerId: 'admin-1', status: 'APPROVED', now })
    cancelled.activity.status = 'CANCELLED'
    await grantTopicActivityRewardItems(cancelled.grants.map((row) => row.id), new Date(now.getTime() + 60_001))
  })
  assert.equal(cancelled.points(), 100)
  assert.equal(cancelled.grants[0].status, 'CANCELLED')
  ended.activity.status = 'CANCELLED'
  await withFixture(ended, async () => { await grantTopicActivityRewardItems(ended.grants.map((row) => row.id), now) })
  assert.equal(ended.points(), 107)
})

test('form submission collects assets transactionally without participation, reward or notification', () => {
  const form = read('app/api/activities/[activityId]/form-submissions/route.ts')
  assert.doesNotMatch(form, /topicActivityParticipation|topicActivityRewardGrant|createManyNotifications|triggerBadgeEvaluation/)
  assert.match(form, /attachmentAssetIds/)
  assert.match(form, /purpose: 'FORM_ANSWER', formSubmissionId: null, replyId: null/)
  assert.match(form, /linked\.count !== assets\.length/)
  assert.match(form, /ACTIVITY_ENDED/)
  assert.match(form, /ACTIVITY_CANCELLED/)
  const retired = read('app/api/admin/topic-activity-form-submissions/[submissionId]/review/route.ts')
  assert.match(retired, /FORM_REVIEW_DISABLED/)
  assert.match(retired, /status: 410/)
  assert.doesNotMatch(retired, /reviewTopicActivityFormSubmission|createManyNotifications|triggerBadgeEvaluation/)
})

test('form admin counts all legacy statuses and filters reply existence rather than approval', () => {
  const route = read('app/api/admin/activities/[activityId]/form-submissions/route.ts')
  assert.match(route, /count\(\{ where: scope \}\)/)
  assert.match(route, /Replies: \{ some: \{\} \}/)
  assert.match(route, /Replies: \{ none: \{\} \}/)
  assert.doesNotMatch(route, /pendingForms|approvedForms|rejectedForms|params\.get\('status'\)/)
})

test('count and reward validity use approved undeleted comments, not cached legacy form aggregates', () => {
  for (const path of ['lib/badge-metrics.ts', 'lib/badge-rule-engine.ts', 'lib/badge-historical.ts']) {
    const text = read(path)
    const part = text.slice(text.indexOf("TOPIC_ACTIVITY_PARTICIPATION_COUNT"))
    assert.match(part, /topicActivitySubmission\.groupBy/)
    assert.match(part, /status: 'APPROVED', commentDeletedAt: null/)
    assert.match(part, /status: \{ not: 'CANCELLED' \}/)
  }
  const service = read('lib/topic-activity.ts')
  assert.doesNotMatch(service, /approvedForms|reviewTopicActivityFormSubmission/)
  assert.match(service, /approvedComments <= 0 \|\| grant\.Activity\.status === 'CANCELLED'/)
  assert.match(service, /firstApprovedSubmissionId: input\.submissionId/)
})

test('badge participation metric groups distinct activities: ACTIVE + ENDED count, CANCELLED and forms do not', async () => {
  const original = prisma.topicActivitySubmission.groupBy
  let inspected = false
  Reflect.set(prisma.topicActivitySubmission, 'groupBy', async (query: { by: string[]; where: { status: string; commentDeletedAt: unknown; Activity: { status: { not: string } }; Comment: { is: { parentId: unknown; isDeleted: boolean } } } }) => {
    assert.deepEqual(query.by, ['activityId'])
    assert.equal(query.where.status, 'APPROVED')
    assert.equal(query.where.commentDeletedAt, null)
    assert.equal(query.where.Activity.status.not, 'CANCELLED')
    assert.deepEqual(query.where.Comment.is, { parentId: null, isDeleted: false })
    inspected = true
    return [{ activityId: 'active-a' }, { activityId: 'ended-b' }]
  })
  try { assert.equal(await getUserBadgeMetric('user-1', 'TOPIC_ACTIVITY_PARTICIPATION_COUNT'), 2) }
  finally { Reflect.set(prisma.topicActivitySubmission, 'groupBy', original) }
  assert.equal(inspected, true)
})

test('only comment review and admin reply send system workflow notifications; privacy remains guarded', () => {
  const reply = read('app/api/admin/topic-activity-form-submissions/[submissionId]/replies/route.ts')
  assert.match(reply, /title: '话题活动有新回复'/)
  assert.match(reply, /actorId: null/)
  assert.match(reply, /submission\.Activity\.title/)
  assert.match(reply, /submissionId=\$\{encodeURIComponent\(submission\.id\)/)
  assert.doesNotMatch(reply, /activity\.status|ACTIVITY_ENDED|ACTIVITY_CANCELLED/)
  const detail = read('app/api/topic-activity-form-submissions/[submissionId]/route.ts')
  assert.match(detail, /submission\.userId === auth\.user\.id/)
  assert.match(detail, /hasAdminPermission\(auth\.user, 'activity_manage'\)/)
  const comments = read('app/api/posts/[postId]/replies/route.ts')
  assert.match(comments, /appendContentImages\(textContent, imageUrls\)/)
  assert.match(comments, /canReviewTopicActivity \? \{ formSubmissionCount/)
})
