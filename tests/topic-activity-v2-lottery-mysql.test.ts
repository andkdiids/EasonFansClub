import assert from 'node:assert/strict'
import test from 'node:test'
import { readTopicLotteryMigrationPhases } from '../scripts/topic-lottery-migration-plan'
import { runIsolatedMysqlUtf8 } from '../scripts/mysql-isolated-utf8'

test('Topic V2 physical lottery: isolated real MySQL eligibility, draw and private fulfillment', { skip: process.env.TOPIC_V2_LOTTERY_MYSQL_QA !== '1', timeout: 180_000 }, async (t) => {
  const supplied = process.env.TOPIC_V2_MYSQL_URL
  assert.ok(supplied, 'explicit isolated URL required')
  const url = new URL(supplied)
  assert.equal(url.protocol, 'mysql:'); assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.port, '33307')
  assert.ok(['/ecfc_topic_v2_acceptance_20261013', '/ecfc_topic_v2_acceptance_20261014', '/ecfc_topic_v2_acceptance_20261014b', '/ecfc_topic_v2_acceptance_20261019'].includes(url.pathname)); assert.equal(url.search, '')
  process.env.DATABASE_URL = supplied
  const oldKeys = process.env.TOPIC_LOTTERY_ADDRESS_KEYS, oldActive = process.env.TOPIC_LOTTERY_ADDRESS_ACTIVE_KEY_ID
  process.env.TOPIC_LOTTERY_ADDRESS_KEYS = JSON.stringify({ qa: Buffer.alloc(32, 7).toString('base64') })
  process.env.TOPIC_LOTTERY_ADDRESS_ACTIVE_KEY_ID = 'qa'
  const { prisma } = await import('@/lib/prisma')
  const v2 = await import('@/lib/topic-activity-v2')
  const core = await import('@/lib/topic-activity-v2-lottery')
  const delivery = await import('@/lib/topic-activity-v2-lottery-fulfillment')
  const { createDefaultTopicActivityV2Program } = await import('@/lib/topic-activity-v2-config')
  const { defaultTopicLotteryConfig } = await import('@/lib/topic-activity-v2-lottery-config')
  const { topicActivityOriginalObjectKey } = await import('@/lib/topic-activity-image-original')
  const { getPublicActivityLotteries, drawActivityLottery } = await import('@/lib/activity-lottery')
  const at = new Date('2026-10-13T04:00:00Z'), cutoff = new Date('2026-10-13T04:20:00Z'), drawAt = new Date('2026-10-13T04:30:00Z'), deadline = new Date('2026-10-20T04:00:00Z')
  let sequence = 0
  const id = (kind: string) => 'lotqa-' + kind + '-' + ++sequence
  const admin = 'lotqa-admin', users = ['lotqa-user-a', 'lotqa-user-b', 'lotqa-user-c', 'lotqa-user-d']
  const fixtureAddress = { recipient: '隔离测试收件人', phone: '13800000000', province: '测试省', city: '测试市', district: '测试区', address: '仅本地测试路 1 号', remark: '合成测试资料' }
  try {
    await t.test('actual lottery migration is additive and preserves legacy/V2 ledgers', async () => {
      const present = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='TopicActivityLottery'`
      const before = await prisma.$queryRawUnsafe('SELECT * FROM PointLog ORDER BY id')
      const grants = await prisma.$queryRawUnsafe('SELECT * FROM TopicActivityRewardGrant ORDER BY id')
      if (Number(present[0].count) === 0) {
        const client = process.env.TOPIC_V2_MYSQL_CLIENT
        assert.ok(client, 'explicit isolated MySQL CLI required when lottery migrations must be applied')
        for (const { sql } of readTopicLotteryMigrationPhases()) {
          runIsolatedMysqlUtf8(client, url.pathname.slice(1), sql)
        }
      }
      assert.deepEqual(await prisma.$queryRawUnsafe('SELECT * FROM PointLog ORDER BY id'), before)
      assert.deepEqual(await prisma.$queryRawUnsafe('SELECT * FROM TopicActivityRewardGrant ORDER BY id'), grants)
      assert.equal(await prisma.topicActivityLottery.count(), 0, 'fresh lottery fixtures required; never reset implicitly')
    })
    for (const user of [admin, ...users]) await prisma.user.create({ data: { id: user, username: user, usernameNormalized: user, nickname: '隔离测试用户', passwordHash: 'not-a-real-password', role: user === admin ? 'ADMIN' : 'USER',
      Profile: { create: { displayName: '隔离测试用户' } } } })
    const board = await prisma.board.create({ data: { name: id('board'), slug: id('board') } })
  const scenario = async (options: { quantity?: number; mode?: 'AUTO' | 'MANUAL'; enabled?: boolean; sourceCount?: number } = {}) => {
      const activityId = id('activity')
      const post = await prisma.post.create({ data: { authorId: admin, boardId: board.id, title: '隔离抽奖主帖', content: '仅测试' } })
      await prisma.activity.create({ data: { id: activityId, title: '隔离抽奖活动', description: '仅本地', type: 'TOPIC_ACTIVITY', status: 'PUBLISHED', startsAt: new Date('2026-10-01T00:00:00Z'), endsAt: new Date('2026-10-31T00:00:00Z'), activityPostId: post.id, allowImageAttachments: true } })
      const program = createDefaultTopicActivityV2Program(); program.enabled = true
      program.platformRewards = { enabled: true, allowStacking: true, maxPlatforms: null, maxEntries: null }
      program.entries = [0, 1, 2].map((index) => ({ id: id('entry'), platformKey: 'platform-' + index, platformName: '平台' + index, title: '截图任务', instructions: '本地测试截图', materialRequirement: '截图',
        minImages: 1, maxImages: 1, points: 96, enabled: true, sortOrder: index, startsAt: null, endsAt: null, allowResubmit: true }))
      await v2.saveTopicActivityV2Program(activityId, admin, program)
    const config = { ...defaultTopicLotteryConfig(), enabled: options.enabled ?? true, mode: options.mode || 'MANUAL', sourceEntryIds: program.entries.slice(0, options.sourceCount ?? program.entries.length).map((entry) => entry.id),
        drawAt: drawAt.toISOString(), eligibilityDeadline: cutoff.toISOString(), addressDeadline: deadline.toISOString(), prizes: [{ id: id('prize'), name: '隔离实物奖品', description: '非生产奖品', imageUrl: null, quantity: options.quantity || 1, sortOrder: 0 }] }
      await core.saveTopicLotteryConfig(activityId, admin, config, at)
      return { activityId, program, config }
    }
    const submit = async (s: Awaited<ReturnType<typeof scenario>>, userId = users[0], entryIndex = 0, when = at) => {
      const uploadId = id('image')
      const asset = await prisma.topicActivityImageAsset.create({ data: { activityId: s.activityId, uploadedByUserId: userId, purpose: 'FORM_ANSWER',
        storageKey: topicActivityOriginalObjectKey({ activityId: s.activityId, purpose: 'FORM_ANSWER', uploadId, filename: 'fixture.png', format: 'png' }), mimeType: 'image/png', width: 10, height: 10, size: 100 } })
      return v2.submitTopicActivityV2Task({ activityId: s.activityId, userId, rewardEntryId: s.program.entries[entryIndex].id, assetIds: [asset.id], now: when })
    }
    const approve = (submissionId: string, when = at) => v2.reviewTopicActivityV2Submission({ submissionId, reviewerId: admin, status: 'APPROVED', now: when })
    const reject = (submissionId: string) => v2.reviewTopicActivityV2Submission({ submissionId, reviewerId: admin, status: 'REJECTED', now: at })
    const draw = (s: Awaited<ReturnType<typeof scenario>>, when = drawAt) => core.drawTopicLottery({ activityId: s.activityId, actorId: admin, trigger: 'MANUAL', now: when })
    const winners = (s: Awaited<ReturnType<typeof scenario>>) => prisma.lotteryEntry.findMany({ where: { Lottery: { TopicLottery: { activityId: s.activityId } } }, orderBy: { userId: 'asc' } })
    await t.test('one approved screenshot grants exactly one eligibility; fees still independent', async () => {
      const s = await scenario(); const made = await submit(s); await approve(made.submission.id)
      assert.equal(await prisma.topicActivityLotteryEligibility.count({ where: { activityId: s.activityId, valid: true } }), 1)
      assert.equal((await core.getTopicLotteryView(s.activityId, users[0], at)).myEligibility?.count, 1)
      assert.equal((await prisma.pointLog.findMany({ where: { activityId: s.activityId } }))[0].points, 96)
    })
    await t.test('three platforms and concurrent approvals still create one chance, not three', async () => {
      const s = await scenario(); const submitted = await Promise.all([0, 1, 2].map((index) => submit(s, users[0], index)))
      await Promise.all(submitted.flatMap((row) => [approve(row.submission.id), approve(row.submission.id)]))
      assert.equal(await prisma.topicActivityLotteryEligibility.count({ where: { activityId: s.activityId } }), 1)
      assert.equal((await prisma.pointLog.findMany({ where: { activityId: s.activityId } })).reduce((sum, log) => sum + log.points, 0), 288)
    })
    await t.test('rejection/resubmission and paid replay do not create a second eligibility', async () => {
      const s = await scenario(); const first = await submit(s); await reject(first.submission.id)
      assert.equal(await prisma.topicActivityLotteryEligibility.count({ where: { activityId: s.activityId } }), 0)
      const second = await submit(s); await approve(second.submission.id)
      const third = await submit(s); await approve(third.submission.id)
      assert.equal(await prisma.topicActivityLotteryEligibility.count({ where: { activityId: s.activityId } }), 1)
      assert.equal(await prisma.pointLog.count({ where: { activityId: s.activityId } }), 1)
    })
    await t.test('after-cutoff submission has no eligibility; before-cutoff late review can qualify', async () => {
      const s = await scenario()
      const tooLate = await submit(s, users[0], 0, new Date(cutoff.getTime() + 1)); await approve(tooLate.submission.id, drawAt)
      assert.equal(await prisma.topicActivityLotteryEligibility.count({ where: { activityId: s.activityId, userId: users[0] } }), 0)
      const timely = await submit(s, users[1], 0, cutoff); await approve(timely.submission.id, drawAt)
      assert.equal(await prisma.topicActivityLotteryEligibility.count({ where: { activityId: s.activityId, userId: users[1], valid: true } }), 1)
    })
    await t.test('valid pending submission blocks freezing; rejecting it permits draw', async () => {
      const s = await scenario(); const pending = await submit(s)
      await assert.rejects(draw(s), { code: 'LOTTERY_PENDING_SUBMISSIONS' })
      assert.equal(await prisma.topicActivityLotteryDraw.count({ where: { activityId: s.activityId } }), 0)
      await reject(pending.submission.id); assert.equal((await draw(s)).winnerCount, 0)
    })
    await t.test('manual draw never runs before scheduled server time', async () => {
      const s = await scenario(); await assert.rejects(draw(s, new Date(drawAt.getTime() - 1)), { code: 'LOTTERY_NOT_DUE' })
      assert.equal(await prisma.topicActivityLotteryDraw.count({ where: { activityId: s.activityId } }), 0)
    })
    await t.test('12 concurrent administrators draw once, stock bounded and unique users', async () => {
      const s = await scenario({ quantity: 2 })
      for (const user of users) { const made = await submit(s, user); await approve(made.submission.id) }
      const results = await Promise.all(Array.from({ length: 12 }, () => draw(s)))
      assert.equal(results.filter((result) => result.changed).length, 1)
      const won = await winners(s); assert.equal(won.length, 2); assert.equal(new Set(won.map((row) => row.userId)).size, 2)
      assert.equal(await prisma.topicActivityLotteryDraw.count({ where: { activityId: s.activityId } }), 1)
      assert.equal((await prisma.lotteryPrize.findUniqueOrThrow({ where: { id: s.config.prizes[0].id } })).remaining, 0)
      const before = await winners(s); await draw(s); assert.deepEqual(await winners(s), before)
      const loser = users.find((user) => !won.some((row) => row.userId === user))!
      assert.equal((await core.getTopicLotteryView(s.activityId, loser, drawAt)).myStatus, 'NOT_WON')
    })
    await t.test('automatic draw concurrent ticks execute once; manual-mode activities excluded', async () => {
      const automatic = await scenario({ mode: 'AUTO' }), manual = await scenario()
      const made = await submit(automatic); await approve(made.submission.id)
      await Promise.all([1, 2, 3].map(() => core.drawDueTopicLotteries({ activityId: automatic.activityId, now: drawAt })))
      assert.equal((await winners(automatic)).length, 1)
      // Manual rows must not consume a bounded automatic-job batch or starve
      // later automatic draws, even though their scheduled time is due.
      assert.equal((await core.drawDueTopicLotteries({ activityId: manual.activityId, now: drawAt, batchSize: 1 })).scanned, 0)
      assert.equal(await prisma.topicActivityLotteryDraw.count({ where: { activityId: manual.activityId } }), 0)
    })
    await t.test('late automatic tick can finish valid pre-end submissions without dropping users', async () => {
      const s = await scenario({ mode: 'AUTO' }); const made = await submit(s); await approve(made.submission.id)
      await prisma.activity.update({ where: { id: s.activityId }, data: { endsAt: cutoff } })
      await core.drawDueTopicLotteries({ activityId: s.activityId, now: drawAt })
      assert.equal((await winners(s)).length, 1)
    })
    await t.test('participants preserve rules and existing stock while prize presentation/additions remain editable until draw freeze', async () => {
      const s = await scenario(); const pending = await submit(s)
      const original = await prisma.lotteryPrize.findUniqueOrThrow({ where: { id: s.config.prizes[0].id } })
      const originalSlots = await prisma.topicActivityLotterySlot.findMany({ where: { prizeId: original.id }, orderBy: { slotNumber: 'asc' }, select: { id: true, slotNumber: true } })
      const addedPrize = { id: id('prize-added'), name: 'added test prize', description: 'added after participation without changing existing stock', imageUrl: '/images/og-default.png', quantity: 2, sortOrder: 1 }
      const updatedConfig = { ...s.config, title: 'updated display title', prizes: [{ ...s.config.prizes[0], name: 'updated prize name', description: 'presentation update only', imageUrl: '/images/og-default.png' }, addedPrize] }
      const updatedAt = new Date(drawAt.getTime() + 1)

      await core.saveTopicLotteryConfig(s.activityId, admin, updatedConfig, updatedAt)
      const savedView = await core.getAdminTopicLotteryView(s.activityId, updatedAt)
      assert.deepEqual(savedView.config, updatedConfig, 'a fresh admin read returns the persisted configuration')
      assert.equal(savedView.configLocked, true)
      const updatedPrize = await prisma.lotteryPrize.findUniqueOrThrow({ where: { id: original.id } })
      assert.equal(updatedPrize.id, original.id, 'the prize identity remains stable for existing references')
      assert.equal(updatedPrize.name, 'updated prize name')
      assert.equal(updatedPrize.quantity, original.quantity)
      assert.equal(updatedPrize.remaining, original.remaining)
      assert.equal(updatedPrize.sortOrder, original.sortOrder)
      assert.deepEqual(await prisma.topicActivityLotterySlot.findMany({ where: { prizeId: original.id }, orderBy: { slotNumber: 'asc' }, select: { id: true, slotNumber: true } }), originalSlots, 'existing slot ids and numbering remain unchanged')
      assert.equal(await prisma.topicActivitySubmission.count({ where: { activityId: s.activityId } }), 1, 'participant evidence is retained')

      const changedBeforeDraw = structuredClone(s.program)
      changedBeforeDraw.entries[0].minImages = 0; changedBeforeDraw.entries[0].maxImages = 0
      await assert.rejects(v2.saveTopicActivityV2Program(s.activityId, admin, changedBeforeDraw), { code: 'LOTTERY_SOURCE_RULES_LOCKED' })
      assert.deepEqual((await prisma.activity.findUniqueOrThrow({ where: { id: s.activityId }, select: { topicProgram: true } })).topicProgram, s.program,
        'source-rule rejection before draw preserves the saved V2 program')

      const newPrize = await prisma.lotteryPrize.findUniqueOrThrow({ where: { id: addedPrize.id } })
      assert.equal(newPrize.quantity, 2)
      assert.equal(await prisma.topicActivityLotterySlot.count({ where: { prizeId: addedPrize.id } }), 2)

      await assert.rejects(core.saveTopicLotteryConfig(s.activityId, admin, { ...updatedConfig, prizes: [{ ...updatedConfig.prizes[0], quantity: 5 }, addedPrize] }, updatedAt), { code: 'LOTTERY_RULES_LOCKED' })
      await assert.rejects(core.saveTopicLotteryConfig(s.activityId, admin, { ...updatedConfig, prizes: [addedPrize] }, updatedAt), { code: 'LOTTERY_RULES_LOCKED' })
      await assert.rejects(core.saveTopicLotteryConfig(s.activityId, admin, { ...updatedConfig, sourceEntryIds: [id('different-source')] }, updatedAt), { code: 'LOTTERY_RULES_LOCKED' })
      assert.deepEqual((await core.getAdminTopicLotteryView(s.activityId, updatedAt)).config, updatedConfig, 'rejected updates leave the saved config unchanged')
      assert.equal(await prisma.topicActivitySubmission.count({ where: { activityId: s.activityId } }), 1, 'rejected updates retain participation evidence')
      assert.deepEqual(await prisma.topicActivityLotterySlot.findMany({ where: { prizeId: original.id }, orderBy: { slotNumber: 'asc' }, select: { id: true, slotNumber: true } }), originalSlots)

      await approve(pending.submission.id, updatedAt)
      await draw(s, updatedAt)

      await assert.rejects(core.saveTopicLotteryConfig(s.activityId, admin, { ...updatedConfig, prizes: [{ ...updatedConfig.prizes[0], name: 'immutable after draw' }, addedPrize] }, updatedAt), { code: 'LOTTERY_DRAW_FROZEN' })
      assert.equal((await prisma.lotteryPrize.findUniqueOrThrow({ where: { id: original.id } })).name, 'updated prize name', 'frozen winner-facing prize data stays at the snapshot value')
      assert.equal(await prisma.topicActivitySubmission.count({ where: { activityId: s.activityId } }), 1)
      const persistedProgram = (await prisma.activity.findUniqueOrThrow({ where: { id: s.activityId }, select: { topicProgram: true } })).topicProgram
      const afterDrawMutations: Array<(program: typeof s.program) => void> = [
        (program) => { program.entries[0].maxImages = 0; program.entries[0].minImages = 0 },
        (program) => { program.entries[0].enabled = false },
        (program) => { program.entries[0].allowResubmit = false },
        (program) => { program.entries[0].startsAt = '2026-10-20T00:00:00.000Z' },
        (program) => { program.entries[0].platformKey = 'different-platform' },
      ]
      for (const mutate of afterDrawMutations) {
        const changed = structuredClone(s.program)
        mutate(changed)
        await assert.rejects(v2.saveTopicActivityV2Program(s.activityId, admin, changed), { code: 'LOTTERY_SOURCE_RULES_LOCKED' })
        assert.deepEqual((await prisma.activity.findUniqueOrThrow({ where: { id: s.activityId }, select: { topicProgram: true } })).topicProgram, persistedProgram,
          'rejected post-draw source-rule changes preserve the saved V2 program')
      }
      const activity = await prisma.activity.findUniqueOrThrow({ where: { id: s.activityId } })
      const window = { startsAt: activity.startsAt, endsAt: activity.endsAt, type: activity.type }
      const editWindow = (next: typeof window) => v2.withTopicV2Transaction(async (tx) => {
        await v2.lockTopicV2Activity(tx, s.activityId)
        await core.assertTopicLotteryActivityWindow(tx, s.activityId, next)
        await tx.activity.update({ where: { id: s.activityId }, data: next })
      })
      await editWindow(window) // unchanged generic saves remain valid
      await assert.rejects(editWindow({ ...window, startsAt: new Date(at.getTime() + 1) }), { code: 'LOTTERY_ACTIVITY_WINDOW_LOCKED' })
      await assert.rejects(editWindow({ ...window, endsAt: new Date(at.getTime() - 1) }), { code: 'LOTTERY_ACTIVITY_WINDOW_LOCKED' })
      await assert.rejects(editWindow({ ...window, endsAt: new Date('2026-11-30T00:00:00Z') }), { code: 'LOTTERY_ACTIVITY_WINDOW_LOCKED' })
      // The standard admin activity PATCH uses this same guard for activity-level eligibility rules.
      for (const rule of [{ allowImageAttachments: false }, { participationMode: 'FORM' as const }, { formSchema: { fields: [{ id: 'new-required-field', required: true }] } }]) {
        await assert.rejects(v2.withTopicV2Transaction(async (tx) => {
          await v2.lockTopicV2Activity(tx, s.activityId)
          await core.assertTopicLotteryActivityWindow(tx, s.activityId, { ...window, ...rule })
        }), { code: 'LOTTERY_ACTIVITY_WINDOW_LOCKED' })
      }
      assert.deepEqual((await prisma.activity.findUniqueOrThrow({ where: { id: s.activityId } })).endsAt, activity.endsAt)
    })
    await t.test('an entry outside the frozen lottery source remains editable', async () => {
      const s = await scenario({ sourceCount: 1 })
      const made = await submit(s, users[0], 0); await approve(made.submission.id)
      const changed = structuredClone(s.program)
      changed.entries[1].maxImages = 5
      await v2.saveTopicActivityV2Program(s.activityId, admin, changed)
      const saved = await prisma.activity.findUniqueOrThrow({ where: { id: s.activityId }, select: { topicProgram: true } })
      assert.equal((saved.topicProgram as typeof s.program).entries[0].maxImages, s.program.entries[0].maxImages)
      assert.equal((saved.topicProgram as typeof s.program).entries[1].maxImages, 5)
    })
    await t.test('database unique qualification and prize slot constraints enforce invariants', async () => {
      const s = await scenario(); const made = await submit(s); await approve(made.submission.id)
      const eligible = await prisma.topicActivityLotteryEligibility.findFirstOrThrow({ where: { activityId: s.activityId } })
      await assert.rejects(prisma.topicActivityLotteryEligibility.create({ data: { activityId: s.activityId, lotteryConfigId: eligible.lotteryConfigId, userId: users[0], sourceSnapshot: {} } }), { code: 'P2002' })
      await assert.rejects(prisma.topicActivityLotterySlot.create({ data: { prizeId: s.config.prizes[0].id, slotNumber: 0 } }), { code: 'P2002' })
    })
    await t.test('failed finalization retains exact committed allocation and safely recovers', async () => {
      const s = await scenario({ quantity: 2 })
      for (const user of users) { const made = await submit(s, user); await approve(made.submission.id) }
      // MySQL forbids CHECK on a cascading-FK column. Use a unique test-only
      // wonAt instant instead; existing winners do not violate this constraint.
      const failureAt = new Date(drawAt.getTime() + 1234)
      const sqlInstant = failureAt.toISOString().replace('T', ' ').replace('Z', '')
      await prisma.$executeRawUnsafe("ALTER TABLE LotteryEntry ADD CONSTRAINT lotqa_draw_failure CHECK (wonAt <> '" + sqlInstant + "')")
      try { await assert.rejects(draw(s, failureAt), { code: 'LOTTERY_DRAW_FAILED' }) }
      finally { await prisma.$executeRawUnsafe('ALTER TABLE LotteryEntry DROP CHECK lotqa_draw_failure') }
      const failed = await prisma.topicActivityLotteryDraw.findUniqueOrThrow({ where: { activityId: s.activityId } })
      assert.equal(failed.state, 'FAILED'); assert.ok(failed.allocationHash); assert.equal((await winners(s)).length, 0)
      assert.equal((await prisma.lotteryPrize.findUniqueOrThrow({ where: { id: s.config.prizes[0].id } })).remaining, 2)
      await Promise.all([draw(s, failureAt), draw(s, failureAt)])
      const finished = await prisma.topicActivityLotteryDraw.findUniqueOrThrow({ where: { activityId: s.activityId } })
      assert.deepEqual(finished.allocation, failed.allocation); assert.equal(finished.allocationHash, failed.allocationHash)
      assert.equal((await winners(s)).length, 2)
    })
    await t.test('comment deletion before freeze excludes user; completed draw never rerandomizes', async () => {
      const s = await scenario(); const deleted = await submit(s); await approve(deleted.submission.id)
      await prisma.reply.update({ where: { id: deleted.commentId }, data: { isDeleted: true } })
      const valid = await submit(s, users[1]); await approve(valid.submission.id); await draw(s)
      assert.equal((await winners(s))[0].userId, users[1])
      await prisma.reply.update({ where: { id: valid.commentId }, data: { isDeleted: true } })
      const unchanged = await winners(s); await draw(s); assert.deepEqual(await winners(s), unchanged)
    })
    await t.test('cancelled activity cannot draw and keeps eligibility history', async () => {
      const s = await scenario({ mode: 'AUTO' }); const made = await submit(s); await approve(made.submission.id)
      await prisma.activity.update({ where: { id: s.activityId }, data: { status: 'CANCELLED' } })
      await assert.rejects(draw(s), { code: 'LOTTERY_ACTIVITY_CLOSED' })
      await core.drawDueTopicLotteries({ activityId: s.activityId, now: drawAt })
      assert.equal((await winners(s)).length, 0); assert.equal(await prisma.topicActivityLotteryEligibility.count({ where: { activityId: s.activityId } }), 1)
    })
    await t.test('old lottery engine cannot draw or expose Topic wrapper as registration lottery', async () => {
      const s = await scenario(); const wrapper = await prisma.topicActivityLottery.findUniqueOrThrow({ where: { activityId: s.activityId } })
      await assert.rejects(drawActivityLottery(wrapper.lotteryId, { trigger: 'ADMIN_MANUAL', actorId: admin, now: drawAt }), { code: 'LOTTERY_LOCKED' })
      assert.deepEqual(await getPublicActivityLotteries(s.activityId, users[0]), [])
    })
    await t.test('disabled lottery does not affect existing V2 fee award or create eligibility', async () => {
      const s = await scenario({ enabled: false }); const made = await submit(s); await approve(made.submission.id)
      assert.equal(await prisma.topicActivityLotteryEligibility.count({ where: { activityId: s.activityId } }), 0)
      assert.equal((await core.getTopicLotteryView(s.activityId, users[0], at)).enabled, false)
      assert.equal((await prisma.pointLog.findMany({ where: { activityId: s.activityId } }))[0].points, 96)
    })
    await t.test('only real winner owner may access/save address, cross-user and cross-activity denied', async () => {
      const s = await scenario(); const made = await submit(s); await approve(made.submission.id); await draw(s)
      const winner = (await winners(s))[0]
      await assert.rejects(delivery.getTopicLotteryAddress(s.activityId, winner.id, users[1], at), { status: 403 })
      await assert.rejects(delivery.saveTopicLotteryAddress({ activityId: s.activityId, winnerId: winner.id, userId: users[1], address: fixtureAddress, consent: true, now: at }), { status: 403 })
      const unrelated = await scenario()
      await assert.rejects(delivery.getTopicLotteryAddress(unrelated.activityId, winner.id, users[0], at))
      await assert.rejects(delivery.saveTopicLotteryAddress({ activityId: s.activityId, winnerId: 'not-a-winner', userId: users[0], address: fixtureAddress, consent: true, now: at }), { status: 404 })
    })
    await t.test('encrypted address changes are audited without PII; public and notifications never leak it', async () => {
      const s = await scenario(); const made = await submit(s); await approve(made.submission.id); await draw(s)
      const winner = (await winners(s))[0]
      await assert.rejects(delivery.saveTopicLotteryAddress({ activityId: s.activityId, winnerId: winner.id, userId: users[0], address: fixtureAddress, consent: false, now: drawAt }), { code: 'TOPIC_LOTTERY_ADDRESS_CONSENT_REQUIRED' })
      await delivery.saveTopicLotteryAddress({ activityId: s.activityId, winnerId: winner.id, userId: users[0], address: fixtureAddress, consent: true, now: drawAt })
      const changed = { ...fixtureAddress, address: '仅本地测试路 2 号' }
      await delivery.saveTopicLotteryAddress({ activityId: s.activityId, winnerId: winner.id, userId: users[0], address: changed, consent: true, now: drawAt })
      assert.deepEqual((await delivery.getTopicLotteryAddress(s.activityId, winner.id, users[0], drawAt)).address, changed)
      const stored = await prisma.topicActivityLotteryShipping.findUniqueOrThrow({ where: { winnerId: winner.id } })
      assert.ok(stored.addressCiphertext); assert.ok(!stored.addressCiphertext.includes(changed.phone)); assert.ok(!stored.addressCiphertext.includes(changed.address))
      const logs = await prisma.topicActivityLotteryAudit.findMany({ where: { activityId: s.activityId } })
      const publicly = await core.getTopicLotteryView(s.activityId, users[1], drawAt)
      for (const serialized of [JSON.stringify(logs), JSON.stringify(publicly)]) { assert.ok(!serialized.includes(changed.phone)); assert.ok(!serialized.includes(changed.address)) }
      assert.equal(logs.filter((log) => log.action === 'ADDRESS_SAVE').length, 2)
      await delivery.deliverTopicLotteryNotices({ activityId: s.activityId })
      const notices = await prisma.notification.findMany({ where: { key: 'topic-v2-lottery-win:' + winner.id } })
      assert.equal(notices.length, 1); assert.ok(!JSON.stringify(notices).includes(changed.phone)); assert.ok(!JSON.stringify(notices).includes(changed.address))
      const points = await prisma.pointLog.findMany({ where: { activityId: s.activityId } }); assert.ok(!JSON.stringify(points).includes(changed.phone))
    })
    await t.test('concurrent winner notification delivery is idempotent', async () => {
      const s = await scenario(); const made = await submit(s); await approve(made.submission.id); await draw(s)
      const winner = (await winners(s))[0]
      await Promise.all(Array.from({ length: 6 }, () => delivery.deliverTopicLotteryNotices({ activityId: s.activityId })))
      assert.equal(await prisma.notification.count({ where: { recipientId: winner.userId, key: 'topic-v2-lottery-win:' + winner.id } }), 1)
      assert.equal((await prisma.topicActivityLotteryNotice.findUniqueOrThrow({ where: { winnerId: winner.id } })).state, 'SENT')
    })
    await t.test('notification failure preserves winner and can be independently retried', async () => {
      const s = await scenario(); const made = await submit(s); await approve(made.submission.id); await draw(s)
      const winner = (await winners(s))[0]
      await prisma.$executeRawUnsafe("ALTER TABLE Notification ADD CONSTRAINT lotqa_notice_failure CHECK (`key` <> 'topic-v2-lottery-win:" + winner.id + "')")
      try { assert.equal((await delivery.deliverTopicLotteryNotices({ activityId: s.activityId })).failed, 1) }
      finally { await prisma.$executeRawUnsafe('ALTER TABLE Notification DROP CHECK lotqa_notice_failure') }
      assert.equal((await winners(s)).length, 1); assert.equal((await prisma.topicActivityLotteryDraw.findUniqueOrThrow({ where: { activityId: s.activityId } })).state, 'DRAWN')
      await delivery.deliverTopicLotteryNotices({ activityId: s.activityId }); assert.equal(await prisma.notification.count({ where: { key: 'topic-v2-lottery-win:' + winner.id } }), 1)
    })
    await t.test('deadline enforced; overdue winner never automatically replaced or redrawn', async () => {
      const s = await scenario(); const made = await submit(s); await approve(made.submission.id); await draw(s)
      const winner = (await winners(s))[0]
      await assert.rejects(delivery.saveTopicLotteryAddress({ activityId: s.activityId, winnerId: winner.id, userId: winner.userId, address: fixtureAddress, consent: true, now: new Date(deadline.getTime() + 1) }), { code: 'TOPIC_LOTTERY_ADDRESS_DEADLINE_PASSED' })
      const before = await winners(s); await draw(s, new Date(deadline.getTime() + 1)); assert.deepEqual(await winners(s), before)
    })
    await t.test('shipping/completion explicit; shipped address locked, PII cleanup preserves winner', async () => {
      const s = await scenario(); const made = await submit(s); await approve(made.submission.id); await draw(s)
      const winner = (await winners(s))[0]
      await delivery.saveTopicLotteryAddress({ activityId: s.activityId, winnerId: winner.id, userId: winner.userId, address: fixtureAddress, consent: true, now: drawAt })
      await delivery.getAdminTopicLotteryAddress(s.activityId, winner.id, admin, drawAt)
      await delivery.updateTopicLotteryShipment({ activityId: s.activityId, winnerId: winner.id, actorId: admin, action: 'SHIP', carrier: '测试物流', trackingNumber: 'QA0001', now: drawAt })
      await assert.rejects(delivery.saveTopicLotteryAddress({ activityId: s.activityId, winnerId: winner.id, userId: winner.userId, address: fixtureAddress, consent: true, now: drawAt }), { code: 'TOPIC_LOTTERY_ADDRESS_LOCKED' })
      await delivery.updateTopicLotteryShipment({ activityId: s.activityId, winnerId: winner.id, actorId: admin, action: 'DELIVER', now: drawAt })
      await delivery.updateTopicLotteryShipment({ activityId: s.activityId, winnerId: winner.id, actorId: admin, action: 'DELETE_PII', now: drawAt })
      const stored = await prisma.topicActivityLotteryShipping.findUniqueOrThrow({ where: { winnerId: winner.id } })
      assert.equal(stored.addressCiphertext, null); assert.equal(stored.shipmentCiphertext, null); assert.ok(stored.deletedAt)
      assert.equal((await winners(s)).length, 1); assert.equal((await prisma.topicActivityLotteryDraw.findUniqueOrThrow({ where: { activityId: s.activityId } })).state, 'DRAWN')
    })
    await t.test('retention purge clears ciphertext without reassigning prize', async () => {
      const s = await scenario(); const made = await submit(s); await approve(made.submission.id); await draw(s)
      const winner = (await winners(s))[0]
      await delivery.saveTopicLotteryAddress({ activityId: s.activityId, winnerId: winner.id, userId: winner.userId, address: fixtureAddress, consent: true, now: drawAt })
      await delivery.purgeExpiredTopicLotteryPII({ now: new Date('2027-10-20T04:00:00Z'), batchSize: 200 })
      const stored = await prisma.topicActivityLotteryShipping.findUniqueOrThrow({ where: { winnerId: winner.id } })
      assert.equal(stored.addressCiphertext, null); assert.ok(stored.deletedAt); assert.equal((await winners(s)).length, 1)
    })
    await t.test('missing encryption key fails closed without changing default-disabled behavior', async () => {
      const s = await scenario({ enabled: false })
      delete process.env.TOPIC_LOTTERY_ADDRESS_KEYS; delete process.env.TOPIC_LOTTERY_ADDRESS_ACTIVE_KEY_ID
      try {
        await assert.rejects(core.saveTopicLotteryConfig(s.activityId, admin, { ...s.config, enabled: true }, at), { code: 'LOTTERY_ADDRESS_KEY_UNAVAILABLE' })
        assert.equal((await core.getTopicLotteryView(s.activityId, users[0], at)).enabled, false)
      } finally { process.env.TOPIC_LOTTERY_ADDRESS_KEYS = JSON.stringify({ qa: Buffer.alloc(32, 7).toString('base64') }); process.env.TOPIC_LOTTERY_ADDRESS_ACTIVE_KEY_ID = 'qa' }
    })
    await t.test('all local fee balances still equal PointLog totals; raffle produces no point cost', async () => {
      for (const userId of users) {
        const points = (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).points
        const logs = await prisma.pointLog.findMany({ where: { userId } })
        assert.equal(points, logs.reduce((sum, log) => sum + log.points, 0))
      }
      assert.equal(await prisma.lottery.count({ where: { TopicLottery: { isNot: null }, pointsCost: { not: 0 } } }), 0)
    })
  } finally {
    await prisma.$disconnect()
    if (oldKeys === undefined) delete process.env.TOPIC_LOTTERY_ADDRESS_KEYS; else process.env.TOPIC_LOTTERY_ADDRESS_KEYS = oldKeys
    if (oldActive === undefined) delete process.env.TOPIC_LOTTERY_ADDRESS_ACTIVE_KEY_ID; else process.env.TOPIC_LOTTERY_ADDRESS_ACTIVE_KEY_ID = oldActive
  }
})
