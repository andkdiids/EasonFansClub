import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { activityAdminSections, belongsToActivityAdminSection } from '@/lib/activity-admin-section'
import { buildTopicReviewNotification, readTopicReviewNotification, topicReviewRejectionReason } from '@/lib/topic-activity-review-notification'
import { reviewTopicActivityV2Submission, submitTopicActivityV2Task } from '@/lib/topic-activity-v2'
import { fixture, instant } from './fixtures/topic-v2-transaction'

const evidence = { activityTitle: '天使的礼物', snapshot: { platformName: '小红书', title: '分享入口', points: 999 },
  status: 'APPROVED' as const, rejectReason: null, grant: { status: 'GRANTED', points: 17 }, eligible: false }

test('approval notification contains actual activity, historical platform/task and committed reward amount', () => {
  const notification = buildTopicReviewNotification(evidence)
  for (const phrase of ['天使的礼物', '小红书', '分享入口', '审核通过', '17 挂号费']) assert.ok(notification.content.includes(phrase))
  assert.ok(!notification.content.includes('999'))
  assert.match(notification.title, /小红书/)
})

test('pending/failed/missing reward does not claim payment or lottery eligibility', () => {
  for (const grant of [null, { status: 'PENDING', points: 99 }, { status: 'FAILED', points: 99 }]) {
    const { content } = buildTopicReviewNotification({ ...evidence, grant })
    assert.match(content, /尚未确认到账/)
    assert.doesNotMatch(content, /99|抽奖资格/)
  }
  assert.match(buildTopicReviewNotification({ ...evidence, eligible: true }).content, /1 次抽奖资格/)
})

test('rejected notification retains real reason and does not claim reward/eligibility', () => {
  const { content } = buildTopicReviewNotification({ ...evidence, status: 'REJECTED', eligible: true, rejectReason: '截图未达到要求' })
  assert.match(content, /天使的礼物.*小红书.*截图未达到要求/)
  assert.doesNotMatch(content, /抽奖资格|已发放/)
})

test('platform rejection requires trimmed 2–200 character reason', () => {
  for (const value of [undefined, null, '', '   ', '字', 'a'.repeat(201)]) assert.equal(topicReviewRejectionReason(value), null)
  assert.equal(topicReviewRejectionReason('  截图不完整  '), '截图不完整')
  assert.equal(topicReviewRejectionReason('a'.repeat(200))?.length, 200)
})

test('notification reads committed grant and eligibility by exact activity/user/entry identity', async () => {
  const calls: unknown[] = []
  const db = {
    activity: { findUnique: async (query: unknown) => { calls.push(query); return { title: evidence.activityTitle } } },
    topicActivityRewardGrant: { findUnique: async (query: unknown) => { calls.push(query); return evidence.grant } },
    topicActivityLotteryEligibility: { findUnique: async (query: unknown) => { calls.push(query); return { valid: true } } },
  }
  const text = await readTopicReviewNotification(db as unknown as Parameters<typeof readTopicReviewNotification>[0], 'activity-a', {
    userId: 'user-a', rewardEntryId: 'entry-a', rewardSnapshot: evidence.snapshot, rejectReason: null,
  }, 'APPROVED')
  assert.equal(calls.length, 3)
  assert.deepEqual(calls[2], { where: { activityId_userId: { activityId: 'activity-a', userId: 'user-a' } }, select: { valid: true } })
  assert.match(text.content, /17 挂号费.*1 次抽奖资格/)
})

test('review route retains auth, origin, changed-only notification and stable deduplication key', () => {
  const source = readFileSync('app/api/admin/activities/[activityId]/v2/submissions/[submissionId]/route.ts', 'utf8')
  assert.match(source, /requireRequestAdmin\(request, 'activity_manage'\)/)
  assert.match(source, /rejectInvalidRequestOrigin\(request\)/)
  assert.match(source, /result.changed\) await safeNotificationWrite\(async \(\) => \{[\s\S]*readTopicReviewNotification[\s\S]*createManyNotifications/)
  assert.match(source, /topic-v2-review:\$\{submissionId\}:\$\{body.status\}:\$\{result.submission.reviewedAt/)
  assert.match(source, /skipDuplicates: true/)
  assert.match(source, /topicReviewRejectionReason\(body.rejectReason\)/)
})

test('rejection -> resubmission -> approval keeps history, one reward and repeated review changed=false', async () => {
  const f = fixture()
  await f.run(async () => {
    const original = f.submission('first')
    await reviewTopicActivityV2Submission({ activityId: f.activity.id, submissionId: original.id, reviewerId: 'admin', status: 'REJECTED', rejectReason: '截图不足', now: instant })
    assert.equal(f.state.grants.length, 0)
    const next = await submitTopicActivityV2Task({ activityId: f.activity.id, userId: 'user-one', rewardEntryId: 'weibo', now: instant })
    const row = f.state.submissions.find((item: { id: string }) => item.id === next.submission.id)
    row.Comment = { postId: 'post-one', parentId: null, isDeleted: false }
    const input = { activityId: f.activity.id, submissionId: row.id, reviewerId: 'admin', status: 'APPROVED' as const, now: instant }
    assert.equal((await reviewTopicActivityV2Submission(input)).changed, true)
    assert.equal((await reviewTopicActivityV2Submission(input)).changed, false)
    assert.equal(f.state.grants.length, 1)
    assert.equal(f.state.logs.length, 1)
    assert.equal(f.state.reviews.length, 2)
    assert.equal(original.status, 'REJECTED')
    assert.equal(row.status, 'APPROVED')
  })
})

test('admin sections isolate current, draft, ended and cancelled with correct time boundary', () => {
  assert.deepEqual(activityAdminSections.map((section) => section.id), ['CURRENT', 'DRAFT', 'ENDED', 'CANCELLED'])
  const ended = { status: 'PUBLISHED' as const, endsAt: new Date(instant.getTime() - 1) }
  assert.equal(belongsToActivityAdminSection(ended, 'CURRENT', instant), false)
  assert.equal(belongsToActivityAdminSection(ended, 'ENDED', instant), true)
  for (const status of ['DRAFT', 'CANCELLED'] as const) {
    assert.equal(belongsToActivityAdminSection({ status }, 'CURRENT', instant), false)
    assert.equal(belongsToActivityAdminSection({ status }, status, instant), true)
  }
  assert.equal(belongsToActivityAdminSection({ status: 'PUBLISHED', startsAt: new Date(instant.getTime() + 1) }, 'CURRENT', instant), true)
})

test('dangerous cascade deletion is not expanded; existing cancelled/active rejection remains', () => {
  const route = readFileSync('app/api/admin/activities/[activityId]/route.ts', 'utf8')
  const deletion = route.slice(route.indexOf('export async function DELETE'))
  assert.match(deletion, /activity.status !== 'DRAFT'/)
  const schema = readFileSync('prisma/schema.prisma', 'utf8')
  assert.match(schema, /model TopicActivitySubmission \{[\s\S]*?Activity\s+Activity\s+@relation\([^\n]*onDelete: Cascade/)
  const admin = readFileSync('app/admin/activities/ActivityAdminManager.tsx', 'utf8')
  assert.match(admin, /useState<ActivityAdminSection>\('CURRENT'\)/)
  assert.match(admin, /避免级联删除历史数据/)
  assert.match(admin, /activity.status === 'DRAFT' && activity.type !== 'TOPIC_ACTIVITY' \? <button[^\n]*kind: 'delete'/)
})
