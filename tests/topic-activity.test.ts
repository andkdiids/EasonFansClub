import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { normalizeTopicActivityConfig } from '@/lib/topic-activity-config'
import { resolveTopicSubmissionStatus } from '@/lib/topic-activity'

const root = process.cwd()
const read = (file: string) => readFileSync(join(root, file), 'utf8')

test('话题活动默认置顶广场，普通活动默认不置顶；定时奖励必须填写北京时间发放时间', () => {
  const topic = normalizeTopicActivityConfig({}, 'TOPIC_ACTIVITY')
  assert.equal(topic.valid, true)
  if (topic.valid) {
    assert.equal(topic.value.pinToPlaza, true)
    assert.equal(topic.value.rewardGrantMode, 'IMMEDIATE')
    assert.equal(topic.value.rewardGrantAt, null)
  }
  const normal = normalizeTopicActivityConfig({}, 'OTHER')
  assert.equal(normal.valid, true)
  if (normal.valid) assert.equal(normal.value.pinToPlaza, false)
  assert.equal(normalizeTopicActivityConfig({ rewardGrantMode: 'SCHEDULED' }, 'TOPIC_ACTIVITY').valid, false)
  const scheduled = normalizeTopicActivityConfig({ rewardGrantMode: 'SCHEDULED', rewardGrantAt: '2026-10-06T12:30' }, 'TOPIC_ACTIVITY')
  assert.equal(scheduled.valid, true)
  if (scheduled.valid) assert.equal(scheduled.value.rewardGrantAt?.toISOString(), '2026-10-06T04:30:00.000Z')
})

test('同活动多条评论分别审核，但参与状态按是否至少一条通过聚合', () => {
  assert.equal(resolveTopicSubmissionStatus({ total: 0, pending: 0, approved: 0, rejected: 0 }), 'NOT_PARTICIPATED')
  assert.equal(resolveTopicSubmissionStatus({ total: 3, pending: 2, approved: 0, rejected: 1 }), 'PENDING')
  assert.equal(resolveTopicSubmissionStatus({ total: 3, pending: 1, approved: 2, rejected: 0 }), 'APPROVED')
  assert.equal(resolveTopicSubmissionStatus({ total: 2, pending: 0, approved: 0, rejected: 2 }), 'REJECTED')
  assert.equal(resolveTopicSubmissionStatus({ total: 3, pending: 0, approved: 0, rejected: 1 }), 'REJECTED')
})

test('Submission 不限制 activity+user 唯一；评论唯一映射，Participation 按 activity+user 唯一', () => {
  const schema = read('prisma/schema.prisma')
  const submission = schema.match(/model TopicActivitySubmission \{([\s\S]*?)\n\}/)?.[1] || ''
  const participation = schema.match(/model TopicActivityParticipation \{([\s\S]*?)\n\}/)?.[1] || ''
  assert.match(submission, /commentId\s+String\?\s+@unique/)
  assert.doesNotMatch(submission, /@@unique\(\[activityId, userId\]\)/)
  assert.match(participation, /@@unique\(\[activityId, userId\]\)/)
  assert.match(submission, /status\s+TopicActivitySubmissionStatus/)
  assert.match(submission, /commentDeletedAt/)
})

test('评论提交流程只绑定活动主帖的一级评论并在服务端事务创建 submission', () => {
  const route = read('app/api/posts/[postId]/replies/route.ts')
  const service = read('lib/topic-activity.ts')
  assert.match(route, /createTopicSubmissionForCommentInTransaction\(tx/)
  assert.match(route, /parentId: parentId \|\| null/)
  assert.match(route, /!parentId[\s\S]*createTopicSubmissionForCommentInTransaction/)
  assert.match(service, /activityPostId: input\.postId/)
  assert.match(service, /startsAt: \{ lte: input\.now \}/)
  assert.match(service, /endsAt: \{ gte: input\.now \}/)
  assert.match(route, /isAdmin: isActivityAdmin/)
})

test('审核事务以活动行锁串行化，日志、聚合、单次奖励资格和回滚保护均在服务端', () => {
  const service = read('lib/topic-activity.ts')
  const reviewRoute = read('app/api/admin/topic-activity-submissions/[submissionId]/route.ts')
  assert.ok(service.includes('FROM \\`Activity\\`'))
  assert.match(service, /topicActivityReviewLog\.create/)
  assert.match(service, /topicActivityParticipation\.create/)
  assert.match(service, /approvedSubmissionCount: \{ increment: 1 \}/)
  assert.match(service, /grantKey: `\$\{prefix\}:points`/)
  assert.match(service, /grantKey: `\$\{prefix\}:badge:/)
  assert.match(service, /businessKey: grant\.grantKey/)
  assert.match(service, /submission\.Activity\.status === 'CANCELLED'[\s\S]*rewardStatus: 'CANCELLED'/)
  assert.match(reviewRoute, /requireRequestAdmin\(request, 'activity_manage'\)/)
  assert.match(reviewRoute, /TOPIC_ACTIVITY_PARTICIPATION_CREATED/)
})

test('奖励定义在 Activity 行锁内二次校验，参与已达成后不会被并发编辑追溯改写', () => {
  const route = read('app/api/admin/activities/[activityId]/route.ts')
  assert.match(route, /FOR UPDATE[\s\S]*lockedParticipationCount = await tx\.topicActivityParticipation\.count/)
  assert.match(route, /TOPIC_REWARD_LOCKED/)
})

test('累计话题活动勋章按首次有效参与发放且不因审核回滚自动追回', () => {
  const rules = read('lib/badge-rules.ts')
  const rule = rules.match(/TOPIC_ACTIVITY_PARTICIPATION_COUNT:\s*\{([\s\S]*?)\n  \},/)?.[1] || ''
  assert.match(rule, /supportsRetentionWhileEligible:\s*false/)
  assert.match(rule, /TOPIC_ACTIVITY_PARTICIPATION_CREATED/)
})

test('活动广场置顶与管理员普通置顶分字段；到期与现有任务入口并存', () => {
  const schema = read('prisma/schema.prisma')
  const forum = read('app/api/forum/discover/route.ts')
  const job = read('app/api/internal/daily-jobs/activity-auto-checkin/route.ts')
  const worker = read('server.ts')
  assert.match(schema, /activityPinned\s+Boolean\s+@default\(false\)/)
  assert.match(forum, /isPinned: 'desc'[\s\S]*activityPinned: 'desc'/)
  assert.match(job, /expireTopicActivityPins/)
  assert.match(job, /dispatchDueTopicActivityRewards/)
  assert.match(worker, /import\('\.\/lib\/topic-activity'\)/)
  assert.match(worker, /dispatchDueTopicActivityRewards\(\{ batchSize: 200 \}\)/)
  assert.match(worker, /expireTopicActivityPins\(\)/)
})

test('migration 仅增量新增模型、索引与可保留旧值的列，不 DROP / RENAME 表字段', () => {
  const migration = read('prisma/migrations/20261005120000_add_topic_activity_system/migration.sql')
  assert.match(migration, /CREATE TABLE `TopicActivitySubmission`/)
  assert.match(migration, /CREATE TABLE `TopicActivityParticipation`/)
  assert.match(migration, /ADD COLUMN `activityPinned`/)
  assert.doesNotMatch(migration, /\bDROP\b|\bRENAME\b/i)
})
