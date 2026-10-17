import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { readTopicLotteryMigrationPhases } from '../scripts/topic-lottery-migration-plan'
import { runIsolatedMysqlUtf8 } from '../scripts/mysql-isolated-utf8'
import { PrismaClient } from '@prisma/client'
import sharp from 'sharp'

// Opt-in only. Never inherit DATABASE_URL, load dotenv, reset a database, or
// connect to a remote host. Bootstrap the locked pre-V2 schema in this fresh
// disposable database before running this suite; see the acceptance document.
test('V2 real MySQL: additive migration, legacy compatibility and concurrent ledgers', {
  skip: process.env.TOPIC_V2_MYSQL_QA !== '1', timeout: 180_000,
}, async (t) => {
  const supplied = process.env.TOPIC_V2_MYSQL_URL
  assert.ok(supplied, 'explicit isolated test URL required')
  const url = new URL(supplied)
  assert.equal(url.protocol, 'mysql:')
  assert.equal(url.hostname, '127.0.0.1')
  assert.equal(url.port, '33307')
  assert.ok(['/ecfc_topic_v2_acceptance_20261013', '/ecfc_topic_v2_acceptance_20261014', '/ecfc_topic_v2_acceptance_20261014b'].includes(url.pathname))
  assert.equal(url.search, '', 'no connection target overrides')
  const client = process.env.TOPIC_V2_MYSQL_CLIENT
  assert.ok(client, 'explicit isolated MySQL CLI required for session-scoped DDL')
  process.env.DATABASE_URL = supplied
  const { prisma } = await import('@/lib/prisma')
  const services = await import('@/lib/topic-activity-v2')
  const interactive = await import('@/lib/topic-activity-v2-interactive')
  const { createDefaultTopicActivityV2Program } = await import('@/lib/topic-activity-v2-config')
  const { renderTopicV2Poster } = await import('@/lib/topic-activity-v2-poster')
  const now = new Date('2026-10-13T04:00:00Z')
  let sequence = 0
  const id = (name: string) => 'v2qa-' + name + '-' + ++sequence
  const adminId = 'v2qa-admin', userId = 'v2qa-user', otherId = 'v2qa-other'
  const boardId = 'v2qa-board'
  const legacyId = 'v2qa-legacy'
  const snap = async () => prisma.$queryRawUnsafe('SELECT id, title, rewardPoints, formSchema FROM Activity ORDER BY id')
  const createUser = async (user: string) => {
    await prisma.$executeRawUnsafe('INSERT INTO User (id,username,usernameNormalized,passwordHash,nickname,updatedAt) VALUES (?,?,?,?,?,?)', user, user, user, 'test-only-not-a-password', '隔离测试用户', now)
    await prisma.$executeRawUnsafe('INSERT INTO Profile (id,userId,displayName,updatedAt) VALUES (?,?,?,?)', user + '-profile', user, '隔离测试用户', now)
  }
  try {
    await t.test('actual additive SQL preserves pre-existing Activity/Submission/Grant/PointLog data', async () => {
      const columns = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*) AS count FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'Activity' AND column_name = 'topicProgram'`
      assert.equal(Number(columns[0].count), 0, 'fresh pre-V2 database required; no implicit reset')
      for (const user of [adminId, userId, otherId]) await createUser(user)
      await prisma.$executeRawUnsafe('INSERT INTO Board (id,name,slug,updatedAt) VALUES (?,?,?,?)', boardId, boardId, boardId, now)
      await prisma.$executeRawUnsafe('INSERT INTO Activity (id,title,description,type,status,rewardPoints,updatedAt) VALUES (?,?,?,?,?,?,?)', legacyId, '旧活动', '保留旧数据', 'TOPIC_ACTIVITY', 'PUBLISHED', 74, now)
      await prisma.$executeRawUnsafe('INSERT INTO TopicActivitySubmission (id,activityId,userId,status,updatedAt) VALUES (?,?,?,?,?)', 'v2qa-old-submission', legacyId, userId, 'APPROVED', now)
      await prisma.$executeRawUnsafe('INSERT INTO TopicActivityParticipation (id,activityId,userId,approvedSubmissionCount,rewardStatus,updatedAt) VALUES (?,?,?,?,?,?)', 'v2qa-old-participation', legacyId, userId, 1, 'GRANTED', now)
      await prisma.$executeRawUnsafe('INSERT INTO TopicActivityRewardGrant (id,participationId,activityId,userId,kind,grantKey,status,points,updatedAt) VALUES (?,?,?,?,?,?,?,?,?)', 'v2qa-old-grant', 'v2qa-old-participation', legacyId, userId, 'POINTS', `topic-activity:${legacyId}:${userId}:points`, 'GRANTED', 74, now)
      await prisma.$executeRawUnsafe('INSERT INTO PointLog (id,userId,action,points,`before`,`after`,businessKey,activityId) VALUES (?,?,?,?,?,?,?,?)', 'v2qa-old-log', userId, 'TOPIC_ACTIVITY_REWARD', 74, 0, 74, `topic-activity:${legacyId}:${userId}:points`, legacyId)
      await prisma.$executeRawUnsafe('UPDATE User SET points=74 WHERE id=?', userId)
      const before = await snap()
      const oldLog = await prisma.$queryRawUnsafe('SELECT * FROM PointLog ORDER BY id')
      const sql = await readFile('prisma/migrations/20261013100000_add_topic_activity_v2_web/migration.sql', 'utf8')
      runIsolatedMysqlUtf8(client, url.pathname.slice(1), sql)
      for (const { sql } of readTopicLotteryMigrationPhases()) {
        runIsolatedMysqlUtf8(client, url.pathname.slice(1), sql)
      }
      assert.deepEqual(await snap(), before)
      assert.deepEqual(await prisma.$queryRawUnsafe('SELECT * FROM PointLog ORDER BY id'), oldLog)
      const old = await prisma.topicActivityRewardGrant.findUniqueOrThrow({ where: { id: 'v2qa-old-grant' } })
      assert.equal(old.origin, 'LEGACY'); assert.equal(old.rewardEntryId, null); assert.equal(old.rewardSnapshot, null)
      assert.equal((await prisma.activity.findUniqueOrThrow({ where: { id: legacyId } })).topicProgram, null)
      assert.equal((await prisma.topicActivitySubmission.findUniqueOrThrow({ where: { id: 'v2qa-old-submission' } })).status, 'APPROVED')
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).points, 74)
    })
    function entry(entryId: string, platform = entryId) {
      return { id: entryId, platformKey: platform, platformName: platform, title: '隔离测试入口', instructions: '测试提交', materialRequirement: '', minImages: 0, maxImages: 0, points: 96, enabled: true, sortOrder: 0, startsAt: null, endsAt: null, allowResubmit: true }
    }
    const scenario = async (platforms = ['same'], maxPlatforms: number | null = null, maxEntries: number | null = null) => {
      const activityId = id('activity'), postId = id('post')
      const program = createDefaultTopicActivityV2Program()
      program.enabled = true
      program.platformRewards = { enabled: true, allowStacking: true, maxPlatforms, maxEntries }
      program.entries = platforms.map((platform) => entry(id('entry'), platform))
      program.poll = { ...program.poll, enabled: true, title: '投票', options: [{ id: 'a', label: '甲' }, { id: 'b', label: '乙' }], maxChoices: 1 }
      program.test = { ...program.test, enabled: true, title: '知识测试', mode: 'KNOWLEDGE', allowRetake: true,
        questions: [{ id: 'q1', prompt: '知识题', points: 2, options: [{ id: 'yes', label: '正确' }, { id: 'no', label: '错误' }], correctOptionId: 'yes' }],
        results: [{ id: 'low', title: '继续练习', description: '0分', scoreMin: 0, scoreMax: 1 }, { id: 'high', title: '完成', description: '2分', scoreMin: 2, scoreMax: 2 }] }
      await prisma.post.create({ data: { id: postId, title: '隔离活动主帖', content: '仅测试', authorId: adminId, boardId } })
      await prisma.activity.create({ data: { id: activityId, title: '隔离活动', description: '仅测试', type: 'TOPIC_ACTIVITY', status: 'PUBLISHED', activityPostId: postId,
        startsAt: new Date('2026-10-01T00:00:00Z'), endsAt: new Date('2026-10-31T00:00:00Z') } })
      await services.saveTopicActivityV2Program(activityId, adminId, program)
      return { activityId, postId, program }
    }
    const submit = (s: Awaited<ReturnType<typeof scenario>>, index = 0, user = userId) => services.submitTopicActivityV2Task({ activityId: s.activityId, rewardEntryId: s.program.entries[index].id, userId: user, now })
    const approve = (submissionId: string) => services.reviewTopicActivityV2Submission({ submissionId, reviewerId: adminId, status: 'APPROVED', now })
    const reject = (submissionId: string) => services.reviewTopicActivityV2Submission({ submissionId, reviewerId: adminId, status: 'REJECTED', rejectReason: '补交材料', now })
    const assertLedger = async (activityId: string, expectedPoints: number, expectedCount: number) => {
      const grants = await prisma.topicActivityRewardGrant.findMany({ where: { activityId, kind: 'POINTS', status: 'GRANTED' } })
      const logs = await prisma.pointLog.findMany({ where: { activityId } })
      assert.equal(grants.length, expectedCount); assert.equal(logs.length, expectedCount)
      assert.equal(logs.reduce((sum, log) => sum + log.points, 0), expectedPoints)
      for (const log of logs) {
        assert.equal(log.after - log.before, log.points)
        assert.equal(grants.find((grant) => grant.grantKey === log.businessKey)?.points, log.points)
      }
    }
    await t.test('20 simultaneous admin approvals pay once and write one review log', async () => {
      const s = await scenario(), created = await submit(s)
      const results = await Promise.all(Array.from({ length: 20 }, () => approve(created.submission.id)))
      assert.equal(results.filter((result) => result.changed).length, 1)
      assert.equal(await prisma.topicActivityReviewLog.count({ where: { submissionId: created.submission.id } }), 1)
      await assertLedger(s.activityId, 96, 1)
      const post = await prisma.post.findUniqueOrThrow({ where: { id: s.postId } })
      assert.equal(post.replyCount, 1)
      assert.equal((await prisma.reply.findUniqueOrThrow({ where: { id: created.commentId } })).parentId, null)
    })
    await t.test('simultaneous duplicate task submits create only one real root comment', async () => {
      const s = await scenario()
      const results = await Promise.allSettled(Array.from({ length: 8 }, () => submit(s)))
      assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
      for (const result of results) if (result.status === 'rejected') assert.equal(result.reason.code, 'TOPIC_V2_RESUBMISSION_NOT_ALLOWED')
      assert.equal(await prisma.reply.count({ where: { postId: s.postId } }), 1)
    })
    await t.test('reject/resubmit keeps history; paid resubmission never pays twice', async () => {
      const s = await scenario(), first = await submit(s)
      await reject(first.submission.id)
      const second = await submit(s)
      assert.notEqual(first.commentId, second.commentId)
      assert.equal((await prisma.topicActivitySubmission.findUniqueOrThrow({ where: { id: first.submission.id } })).status, 'REJECTED')
      await approve(second.submission.id)
      const third = await submit(s)
      await Promise.all([approve(third.submission.id), approve(third.submission.id)])
      await assertLedger(s.activityId, 96, 1)
    })
    await t.test('same platform multiple entries occupy one slot; different platform stacks', async () => {
      const s = await scenario(['same', 'same', 'other'], 2)
      const submissions = await Promise.all(s.program.entries.map((_, index) => submit(s, index)))
      await Promise.all(submissions.map((item) => approve(item.submission.id)))
      await assertLedger(s.activityId, 288, 3)
    })
    await t.test('real concurrent different-platform approvals enforce maxPlatforms=1', async () => {
      const s = await scenario(['first', 'second'], 1)
      const submissions = await Promise.all([submit(s, 0), submit(s, 1)])
      const results = await Promise.allSettled(submissions.map((item) => approve(item.submission.id)))
      assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
      assert.equal(results.find((result) => result.status === 'rejected')?.reason.code, 'TOPIC_V2_MAX_PLATFORMS_REACHED')
      await assertLedger(s.activityId, 96, 1)
    })
    await t.test('same-platform maxEntries=1 remains limited after a paid comment is reversed', async () => {
      const s = await scenario(['same', 'same'], null, 1)
      const first = await submit(s), second = await submit(s, 1)
      await approve(first.submission.id); await reject(first.submission.id)
      await assert.rejects(approve(second.submission.id), { code: 'TOPIC_V2_MAX_ENTRIES_REACHED' })
      await prisma.reply.update({ where: { id: first.commentId }, data: { isDeleted: true } })
      await assert.rejects(approve(first.submission.id), { code: 'TOPIC_V2_SUBMISSION_UNAVAILABLE' })
      await assertLedger(s.activityId, 96, 1)
    })
    await t.test('database unique constraint rejects a different key for same activity/entry/user', async () => {
      const s = await scenario(), created = await submit(s); await approve(created.submission.id)
      const grant = await prisma.topicActivityRewardGrant.findFirstOrThrow({ where: { activityId: s.activityId } })
      await assert.rejects(prisma.topicActivityRewardGrant.create({ data: { participationId: grant.participationId, activityId: s.activityId, userId,
        rewardEntryId: grant.rewardEntryId, kind: 'POINTS', grantKey: id('duplicate'), points: 96 } }), { code: 'P2002' })
      await assertLedger(s.activityId, 96, 1)
    })
    await t.test('real FK forbids orphan entries and deletion of a referenced entry', async () => {
      await assert.rejects(prisma.topicActivityRewardEntry.create({ data: { id: id('orphan'), activityId: 'missing', platformKey: 'same', config: {} } }), { code: 'P2003' })
      const s = await scenario(); await submit(s)
      await assert.rejects(prisma.topicActivityRewardEntry.delete({ where: { id: s.program.entries[0].id } }), { code: 'P2003' })
    })
    await t.test('submission snapshot preserves 96 after entry configuration becomes 200', async () => {
      const s = await scenario(), created = await submit(s)
      s.program.entries[0].points = 200
      await services.saveTopicActivityV2Program(s.activityId, adminId, s.program)
      await approve(created.submission.id); await assertLedger(s.activityId, 96, 1)
    })
    await t.test('PointLog failure rolls back review, grant, participation and balance atomically', async () => {
      const s = await scenario(), created = await submit(s)
      const before = (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).points
      assert.match(s.activityId, /^v2qa-activity-\d+$/u)
      await prisma.$executeRawUnsafe("ALTER TABLE PointLog ADD CONSTRAINT v2qa_pointlog_failure CHECK (activityId <> '" + s.activityId + "')")
      try { await assert.rejects(approve(created.submission.id)) }
      finally { await prisma.$executeRawUnsafe('ALTER TABLE PointLog DROP CHECK v2qa_pointlog_failure') }
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).points, before)
      assert.equal((await prisma.topicActivitySubmission.findUniqueOrThrow({ where: { id: created.submission.id } })).status, 'PENDING')
      assert.equal(await prisma.topicActivityReviewLog.count({ where: { submissionId: created.submission.id } }), 0)
      assert.equal(await prisma.topicActivityParticipation.count({ where: { activityId: s.activityId } }), 0)
      assert.equal(await prisma.topicActivityRewardGrant.count({ where: { activityId: s.activityId } }), 0)
      await approve(created.submission.id); await assertLedger(s.activityId, 96, 1)
    })
    await t.test('fixed 74 independent of platform 96; concurrent fixed claims remain one log', async () => {
      const s = await scenario(); s.program.fixedReward = { ...s.program.fixedReward, enabled: true, points: 74, condition: 'POLL', requiresReview: false }
      await services.saveTopicActivityV2Program(s.activityId, adminId, s.program)
      await interactive.castTopicV2Vote({ activityId: s.activityId, userId, choices: ['a'], now })
      const created = await submit(s); await approve(created.submission.id)
      await Promise.all(Array.from({ length: 8 }, () => services.claimTopicActivityV2FixedReward({ activityId: s.activityId, userId, now })))
      await assertLedger(s.activityId, 170, 2)
    })
    await t.test('real medal service grants once across concurrent platform, poll and test events', async () => {
      const s = await scenario(), badgeId = id('badge')
      await prisma.badge.create({ data: { id: badgeId, name: badgeId, slug: badgeId, code: badgeId } })
      s.program.medal = { enabled: true, badgeId, description: '仅隔离测试', triggers: ['PLATFORM', 'POLL', 'TEST'], allowLateReview: true }
      await services.saveTopicActivityV2Program(s.activityId, adminId, s.program)
      const created = await submit(s)
      await Promise.all([
        approve(created.submission.id),
        interactive.castTopicV2Vote({ activityId: s.activityId, userId, choices: ['a'], now }),
        interactive.submitTopicV2Test({ activityId: s.activityId, userId, answers: { q1: 'yes' }, requestKey: 'medal-test-request', now }),
      ])
      assert.equal(await prisma.topicActivityRewardGrant.count({ where: { activityId: s.activityId, kind: 'BADGE', status: 'GRANTED' } }), 1)
      assert.equal(await prisma.userBadge.count({ where: { userId, badgeId } }), 1)
      await assertLedger(s.activityId, 96, 1)
    })
    await t.test('legacy grant key protects old reward after V2 enablement; nullable entry uniqueness compatible', async () => {
      const program = createDefaultTopicActivityV2Program(); program.enabled = true
      await services.saveTopicActivityV2Program(legacyId, adminId, program)
      const result = await services.claimTopicActivityV2FixedReward({ activityId: legacyId, userId, now })
      assert.equal(result.changed, false); await assertLedger(legacyId, 74, 1)
      await prisma.topicActivityRewardGrant.create({ data: { participationId: 'v2qa-old-participation', activityId: legacyId, userId,
        kind: 'POINTS', grantKey: id('nullable-legacy'), status: 'CANCELLED', points: 10 } })
    })
    await t.test('manual fixed claim preserves snapshot and duplicate approval makes one audit', async () => {
      const s = await scenario(); s.program.fixedReward = { ...s.program.fixedReward, enabled: true, points: 74, condition: 'ADMIN_REVIEW', requiresReview: true }
      await services.saveTopicActivityV2Program(s.activityId, adminId, s.program)
      await services.claimTopicActivityV2FixedReward({ activityId: s.activityId, userId, now })
      await assertLedger(s.activityId, 0, 0)
      s.program.fixedReward.points = 999; await services.saveTopicActivityV2Program(s.activityId, adminId, s.program)
      await Promise.all([1, 2, 3].map(() => services.claimTopicActivityV2FixedReward({ activityId: s.activityId, userId, reviewerId: adminId, decision: 'APPROVED', now })))
      await assertLedger(s.activityId, 74, 1)
      assert.equal(await prisma.adminActionLog.count({ where: { action: 'TOPIC_ACTIVITY_V2_FIXED_REWARD_APPROVED', detail: { path: '$.activityId', equals: s.activityId } } }), 1)
    })
    await t.test('FORM submit/admin reply gate applies even to an admin participating as a user', async () => {
      const s = await scenario()
      await prisma.activity.update({ where: { id: s.activityId }, data: { participationMode: 'FORM', formSchema: { fields: [], commentPolicy: { gateMode: 'AFTER_ADMIN_REPLY', commentLimit: 'MULTIPLE' } } } })
      await assert.rejects(submit(s, 0, adminId), { code: 'FORM_REQUIRED_BEFORE_COMMENT' })
      const form = await prisma.topicActivityFormSubmission.create({ data: { activityId: s.activityId, userId: adminId, formSchemaSnapshot: { fields: [] }, answersSnapshot: {} } })
      await assert.rejects(submit(s, 0, adminId), { code: 'ADMIN_REPLY_REQUIRED' })
      await prisma.topicActivitySubmissionReply.create({ data: { submissionId: form.id, senderUserId: adminId, senderRole: 'ADMIN', content: '已回复' } })
      const created = await submit(s, 0, adminId); await approve(created.submission.id)
      await assertLedger(s.activityId, 96, 1)
    })
    await t.test('poll concurrent replay persists once; changing disallowed vote is rejected', async () => {
      const s = await scenario()
      await Promise.all(Array.from({ length: 8 }, () => interactive.castTopicV2Vote({ activityId: s.activityId, userId, choices: ['a'], now })))
      assert.equal(await prisma.topicActivityPollVote.count({ where: { activityId: s.activityId } }), 1)
      await assert.rejects(interactive.castTopicV2Vote({ activityId: s.activityId, userId, choices: ['b'], now }), { code: 'POLL_ALREADY_SUBMITTED' })
      assert.deepEqual((await interactive.getTopicV2Poll(s.activityId, userId, now)).myChoices, ['a'])
    })
    await t.test('knowledge result persists and replays after disconnect; foreign owner denied; real PNG valid', async () => {
      const s = await scenario(), requestKey = 'knowledge-request'
      const results = await Promise.all(Array.from({ length: 8 }, () => interactive.submitTopicV2Test({ activityId: s.activityId, userId, answers: { q1: 'yes' }, requestKey, now })))
      assert.equal(results.filter((result) => result.changed).length, 1)
      assert.equal(await prisma.topicActivityTestAttempt.count({ where: { activityId: s.activityId } }), 1)
      const attemptId = results[0].attempt.id
      await prisma.$disconnect()
      const persisted = await interactive.getTopicV2Attempt(s.activityId, attemptId, userId)
      assert.equal((persisted.resultSnapshot as { score: number }).score, 2)
      const independent = new PrismaClient({ datasources: { db: { url: supplied } } })
      try { assert.deepEqual((await independent.topicActivityTestAttempt.findUniqueOrThrow({ where: { id: attemptId } })).resultSnapshot, persisted.resultSnapshot) }
      finally { await independent.$disconnect() }
      await assert.rejects(interactive.getTopicV2Attempt(s.activityId, attemptId, otherId), { status: 404 })
      await assert.rejects(interactive.submitTopicV2Test({ activityId: s.activityId, userId, answers: { q1: 'no' }, requestKey, now }), { code: 'TEST_REQUEST_KEY_CONFLICT' })
      const png = await renderTopicV2Poster(persisted.resultSnapshot, s.activityId)
      assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
      const metadata = await sharp(png).metadata(); assert.equal(metadata.format, 'png'); assert.ok(metadata.width! >= 256)
    })
    await t.test('personality server weights persist; editing creates a new version without rewriting prior result', async () => {
      const s = await scenario()
      s.program.test.mode = 'PERSONALITY'
      s.program.test.questions = [{ id: 'q1', prompt: '选择偏好', points: 0, options: [{ id: 'yes', label: '甲', weights: { first: 2 } }, { id: 'no', label: '乙', weights: { second: 3 } }] }]
      s.program.test.results = [{ id: 'first', title: '甲结果', description: '甲说明' }, { id: 'second', title: '乙结果', description: '乙说明' }]
      await services.saveTopicActivityV2Program(s.activityId, adminId, s.program)
      const submitted = await interactive.submitTopicV2Test({ activityId: s.activityId, userId, answers: { q1: 'no' }, requestKey: 'personality-request', now })
      assert.equal(submitted.attempt.resultId, 'second')
      assert.equal((submitted.attempt.resultSnapshot as { score: unknown }).score, null)
      s.program.test.results[1].title = '不允许静默修改'
      const saved = await services.saveTopicActivityV2Program(s.activityId, adminId, s.program)
      assert.equal(saved.test.id, s.program.test.id)
      assert.equal(saved.test.version, 2)
      assert.equal(((await interactive.getTopicV2Attempt(s.activityId, submitted.attempt.id, userId)).resultSnapshot as { title: string }).title, '乙结果')
    })
    await t.test('global balance equals sum of immutable PointLog deltas with no broken chain', async () => {
      for (const user of [userId, adminId, otherId]) {
        const logs = await prisma.pointLog.findMany({ where: { userId: user } })
        const balance = (await prisma.user.findUniqueOrThrow({ where: { id: user } })).points
        assert.equal(balance, logs.reduce((sum, log) => sum + log.points, 0))
        const ordered = [...logs].sort((a, b) => a.before - b.before)
        for (let index = 1; index < ordered.length; index++) assert.equal(ordered[index].before, ordered[index - 1].after)
      }
    })
  } finally { await prisma.$disconnect() }
})
