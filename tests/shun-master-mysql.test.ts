import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { prisma } from '../lib/prisma'
import { getShunCandidateSummary, setShunEnabled, shunAttempt, shunCapture, shunRecords, shunSendNotification, shunStatus, shunTransaction, updateShunConfig } from '../lib/shun-master'
import { runShunNotifySweepOnce } from '../lib/shun-notify-worker'
import { readAnonymousLetter } from '../lib/shun-anonymous-letter'
import { defaultShunConfig, shunDay } from '../lib/shun-master-rules'
import { getShunLedgerDisplay } from '../lib/registration-fee'

test('isolated MySQL enforces limits, privacy, idempotency and balanced recovery', {
  skip: process.env.SHUN_MASTER_MYSQL_QA !== '1', timeout: 120000,
}, async () => {
  const url = new URL(process.env.DATABASE_URL || '')
  assert.equal(url.protocol, 'mysql:')
  assert.equal(url.hostname, '127.0.0.1')
  assert.equal(url.port, process.env.GITHUB_ACTIONS === 'true' ? '3306' : '33326')
  assert.equal(url.pathname, '/ecfc_shun_qa')
  assert.equal(await prisma.shunMasterRound.count(), 0, 'requires an empty isolated fixture')
  const seedRefusal = (userId: string) => prisma.shunMasterProtection.upsert({
    where: { userId }, create: { userId, protected: true }, update: { protected: true },
  })
  const createUser = async (points = 0, contact?: string, age = 9) => {
    const name = 'shun-qa-' + randomUUID()
    return prisma.user.create({ data: { username: name, usernameNormalized: name, nickname: name,
      email: contact ?? name + '@example.invalid', emailVerifiedAt: new Date(), points, passwordHash: 'fixture',
      createdAt: new Date(Date.now() - age * 86400000), Profile: { create: { displayName: name } } } })
  }
  try {
    const [operator, victim, ...actors] = await Promise.all([
      createUser(), createUser(40, undefined, 0), ...Array.from({ length: 8 }, () => createUser()),
    ])
    const config = { ...defaultShunConfig, enabled: false, openHoursEnabled: false, bonusChance: 0 }
    await updateShunConfig(operator.id, config)
    assert.equal((await shunStatus(operator.id)).enabled, false)
    const beforeNoticeId = (await prisma.shunMasterSettings.findUniqueOrThrow({ where: { id: 1 } })).launchNoticeId
    assert.equal(await prisma.systemNotification.count({ where: { title: { contains: '顺大师' } } }), 0)
    const beforeToggleLogs = await prisma.userOperationLog.count({ where: { category: 'SHUN_MASTER', action: 'CONFIG_UPDATE' } })
    const toggles = await Promise.all(Array.from({ length: 8 }, () => setShunEnabled(operator.id, true)))
    assert.ok(toggles.every((result) => result.effectiveEnabled))
    assert.equal(await prisma.userOperationLog.count({ where: { category: 'SHUN_MASTER', action: 'CONFIG_UPDATE' } }), beforeToggleLogs + 1)
    await setShunEnabled(operator.id, true)
    assert.equal(await prisma.userOperationLog.count({ where: { category: 'SHUN_MASTER', action: 'CONFIG_UPDATE' } }), beforeToggleLogs + 1)
    assert.equal((await prisma.shunMasterSettings.findUniqueOrThrow({ where: { id: 1 } })).launchNoticeId, beforeNoticeId)
    const publish = async (settings: typeof config) => { await updateShunConfig(operator.id, settings); await setShunEnabled(operator.id, true) }
    await publish(config)
    const [protectedUser, banned, deleted, protectedAdmin] = await Promise.all(Array.from({ length: 4 }, () => createUser(100)))
    await seedRefusal(protectedUser.id)
    await seedRefusal(victim.id)
    await seedRefusal(protectedAdmin.id)
    await prisma.user.update({ where: { id: victim.id }, data: { email: null, emailVerifiedAt: null, role: 'ADMIN' } })
    await prisma.user.update({ where: { id: actors[0].id }, data: { role: 'MODERATOR' } })
    await prisma.user.update({ where: { id: banned.id }, data: { status: 'BANNED' } })
    await prisma.user.update({ where: { id: deleted.id }, data: { isDeleted: true } })
    await prisma.user.update({ where: { id: protectedAdmin.id }, data: { role: 'SUPER_ADMIN' } })
    await assert.rejects(shunAttempt(banned.id, randomUUID()), { code: 'ACCOUNT' })
    const pool = await getShunCandidateSummary(prisma, shunDay(new Date()), 4)
    assert.equal(pool.eligible, 3)
    assert.equal('refused' in pool.excluded, false)
    assert.equal(pool.excluded.account, 2)
    assert.ok(pool.excluded.balance >= 9)
    assert.equal(await prisma.shunMasterMember.count({ where: { userId: victim.id } }), 0)
    assert.equal(await prisma.shunMasterConsent.count({ where: { userId: victim.id } }), 0)
    const ids = actors.map(() => randomUUID())
    // Exclude every actor from the other actors' target pools even after their winnings are credited.
    await prisma.block.createMany({ data: actors.flatMap((actor, index) => actors.slice(index + 1).map((other) =>
      ({ blockerId: actor.id, blockedId: other.id }))) })
    await prisma.block.createMany({ data: actors.flatMap((actor) => [protectedUser, protectedAdmin].map((target) => ({ blockerId: actor.id, blockedId: target.id }))) })
    const outcomes = await Promise.allSettled(actors.map((actor, index) => shunAttempt(actor.id, ids[index])))
    assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 4)
    const rounds = await prisma.shunMasterRound.findMany({ orderBy: { createdAt: 'asc' } })
    assert.ok(rounds.every((round) => round.victimId === victim.id && round.actorId !== victim.id))
    assert.equal((await getShunCandidateSummary(prisma, shunDay(rounds[0].createdAt), 4)).excluded.dailyCap, 1)
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: protectedUser.id }, select: { points: true } })).points, 100)
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: protectedAdmin.id }, select: { points: true } })).points, 100)
    const [first, failed, expired, compensated] = rounds
    const owner = actors.find(({ id }) => id === first.actorId)!
    await assert.rejects(shunAttempt(owner.id, randomUUID()), { code: 'NO_TARGET' })
    assert.equal((await shunStatus(owner.id)).remaining, 6)
    assert.equal((await shunAttempt(owner.id, first.requestId)).id, first.id)
    assert.equal(await prisma.shunMasterRound.count(), 4)
    assert.equal(await prisma.pointLog.count({ where: { action: 'SHUN_STEAL' } }), 8)
    // A take no longer notifies anybody by itself: the victim is told once the
    // actor decides, or when the server sweep expires the round.
    assert.equal(await prisma.notification.count({ where: { recipientId: victim.id, actorId: null } }), 0,
      '顺取只结算，通知必须等玩家的选择')
    assert.ok(rounds.every((round) => round.notifyStatus === 'PENDING'))
    for (const round of rounds) await shunSendNotification(round.actorId, round.id, null)
    assert.equal(await prisma.notification.count({ where: { recipientId: victim.id, actorId: null } }), 4,
      '四个发起者选择不留言后，被顺者必须收到四条普通通知')
    assert.ok((await shunRecords(victim.id, 'in')).records.every((row) => row.person === null && !('actorId' in row)))
    const localDay = shunDay(first.createdAt)
    assert.equal((await shunRecords(victim.id, 'in', undefined, undefined, { range: 'date', dateKey: localDay })).records.length, 4)
    assert.equal((await shunRecords(victim.id, 'in', undefined, undefined, { range: 'yesterday', now: first.createdAt })).records.length, 0)
    await assert.rejects(shunCapture(owner.id, first.id), { code: 'NOT_FOUND' })

    const golden = await shunCapture(victim.id, first.id)
    assert.ok('candidates' in golden)
    assert.equal(golden.mode, 2)
    assert.equal(new Set(golden.candidates?.map((candidate) => candidate.uid)).size, 2)
    assert.ok(golden.candidates?.some((candidate) => candidate.uid === owner.uid))
    const refresh = await shunCapture(victim.id, first.id)
    assert.deepEqual(refresh.candidates, golden.candidates)
    await assert.rejects(shunCapture(victim.id, first.id, { mode: 2, uid: victim.uid }), { code: 'INVALID_CHOICE' })
    const successes = await Promise.all(Array.from({ length: 6 }, () => shunCapture(victim.id, first.id, { mode: 2, uid: owner.uid })))
    assert.ok(successes.every((outcome) => outcome.record?.result === 'SUCCESS' && outcome.record.person?.uid === owner.uid))
    assert.equal(await prisma.pointLog.count({ where: { action: 'SHUN_RECOVERY' } }), 2)

    const failureOwner = actors.find(({ id }) => id === failed.actorId)!
    const failureCandidates = await shunCapture(victim.id, failed.id)
    const decoy = failureCandidates.candidates?.find((candidate) => candidate.uid !== failureOwner.uid)
    assert.ok(decoy)
    const wrong = await shunCapture(victim.id, failed.id, { mode: 2, uid: decoy.uid })
    assert.equal(wrong.record?.result, 'FAILED')
    assert.equal(wrong.record?.recovered, 0)
    assert.equal(wrong.record?.person?.uid, failureOwner.uid)

    const expiredOwner = actors.find(({ id }) => id === expired.actorId)!
    await prisma.shunMasterRound.update({ where: { id: expired.id }, data: { goldenUntil: new Date(0) } })
    await assert.rejects(shunCapture(victim.id, expired.id, { mode: 2, uid: expiredOwner.uid }), { code: 'MODE_CHANGED' })
    const ordinary = await shunCapture(victim.id, expired.id)
    assert.equal(ordinary.mode, 3)
    assert.equal(new Set(ordinary.candidates?.map((candidate) => candidate.uid)).size, 3)

    const spentOwner = actors.find(({ id }) => id === compensated.actorId)!
    await prisma.user.update({ where: { id: spentOwner.id }, data: { points: 0 } })
    const compensationRace = await Promise.all(Array.from({ length: 8 }, () =>
      shunCapture(victim.id, compensated.id, { mode: 2, uid: spentOwner.uid })))
    assert.ok(compensationRace.every((result) => result.record?.recovered === compensated.amount))
    const [compensatedResult] = compensationRace
    assert.equal(compensatedResult.record?.recovered, compensated.amount)
    const compensation = await prisma.pointLog.findFirstOrThrow({ where: { userId: victim.id, action: 'SHUN_COMPENSATION' } })
    assert.equal(compensation.points, compensated.amount)
    assert.equal(compensation.reversalOfBusinessKey, `shun:${compensated.id}:take:${victim.id}`)
    assert.equal(await prisma.pointLog.count({ where: { action: 'SHUN_COMPENSATION' } }), 1)
    const victimBalance = 40 - rounds.reduce((sum, row) => sum + row.amount, 0) + first.amount + compensated.amount
    assert.equal((await shunStatus(victim.id)).balance, victimBalance)
    const earlierLogs = await prisma.pointLog.findMany({ where: { action: { in: ['SHUN_STEAL', 'SHUN_RECOVERY', 'SHUN_COMPENSATION'] } } })
    assert.deepEqual(new Set(earlierLogs.map(row => getShunLedgerDisplay(row)?.label)),
      new Set(['顺大师 · 顺走', '顺大师 · 被顺', '顺大师 · 抓捕追回', '顺大师 · 被追回', '顺大师 · 平台补偿']))
    for (const log of earlierLogs) assert.equal(log.after - log.before, log.points)
    assert.equal(earlierLogs.reduce((sum, log) => sum + log.points, 0), compensated.amount)
    const state = await prisma.shunMasterSettings.findUniqueOrThrow({ where: { id: 1 } })
    assert.equal(state.reserved, expired.amount)
    assert.equal(state.compensated, compensated.amount)
    assert.ok(await prisma.user.count({ where: { points: { lt: 0 } } }) === 0)
    // Legacy stored configs may still carry a tiny budget. It is ignored on
    // read and must never stop a new take; saving writes a budget-free config.
    await prisma.shunMasterSettings.update({ where: { id: 1 }, data: {
      config: { ...config, enabled: true, budget: 0 },
    } })
    assert.equal((await shunStatus(owner.id)).enabled, true)
    const lowBudgetTarget = await createUser(20)
    const lowBudgetAttempt = await shunAttempt(owner.id, randomUUID())
    assert.ok(lowBudgetAttempt.amount >= 1 && lowBudgetAttempt.amount <= 7)
    assert.equal(lowBudgetAttempt.person?.uid, lowBudgetTarget.uid)
    assert.equal((await prisma.shunMasterSettings.findUniqueOrThrow({ where: { id: 1 } })).reserved,
      expired.amount + lowBudgetAttempt.amount)
    await updateShunConfig(operator.id, config)
    assert.deepEqual((await prisma.shunMasterSettings.findUniqueOrThrow({ where: { id: 1 } })).config, { ...config, enabled: true })
    assert.equal((await shunStatus(owner.id)).enabled, true)
    const reopened = await setShunEnabled(operator.id, true)
    assert.equal(reopened.effectiveEnabled, true)
    const beforeClose = await prisma.userOperationLog.count({ where: { category: 'SHUN_MASTER', action: 'CONFIG_UPDATE' } })
    const closes = await Promise.all(Array.from({ length: 8 }, () => setShunEnabled(operator.id, false)))
    assert.ok(closes.every((result) => !result.effectiveEnabled))
    assert.equal((await shunStatus(operator.id)).enabled, false)
    assert.equal(await prisma.userOperationLog.count({ where: { category: 'SHUN_MASTER', action: 'CONFIG_UPDATE' } }), beforeClose + 1)
    await assert.rejects(shunAttempt(owner.id, randomUUID()), { code: 'DISABLED' })
    assert.equal((await shunCapture(victim.id, expired.id, { mode: 3, uid: expiredOwner.uid })).record?.result, 'SUCCESS')
    const afterCapture = await prisma.shunMasterSettings.findUniqueOrThrow({ where: { id: 1 } })
    assert.equal(afterCapture.reserved, lowBudgetAttempt.amount)
    assert.equal(afterCapture.compensated, compensated.amount)

    const [limitActor, ...targets] = await Promise.all([createUser(), ...Array.from({ length: 10 }, () => createUser(1))])
    await publish(config)
    // Reset balances in this disposable fixture to isolate the one-point targets.
    await prisma.user.updateMany({ where: { id: { notIn: targets.map(({ id }) => id) } }, data: { points: 0 } })
    const dayResults = await Promise.allSettled(Array.from({ length: 10 }, () => shunAttempt(limitActor.id, randomUUID())))
    const won = dayResults.flatMap((outcome) => outcome.status === 'fulfilled' ? [outcome.value] : [])
    assert.equal(won.length, 7)
    assert.equal(new Set(won.map((round) => round.person?.uid)).size, 7)
    assert.ok(won.every((round) => round.amount === 1))
    assert.equal((await shunStatus(limitActor.id)).remaining, 0)
    const overflow = await createUser(2147483647)
    const before = await prisma.shunMasterRound.count()
    await assert.rejects(shunAttempt(overflow.id, randomUUID()), { code: 'BALANCE' })
    assert.equal(await prisma.shunMasterRound.count(), before)
    assert.equal((await shunStatus(overflow.id)).remaining, 7)

    const invalidLegacyBalance = await createUser(-1)
    await assert.rejects(shunAttempt(invalidLegacyBalance.id, randomUUID()), { code: 'BALANCE' })
    assert.equal(await prisma.shunMasterRound.count(), before)
    assert.equal((await shunStatus(invalidLegacyBalance.id)).remaining, 7)

    // Expose only one funded target and its linked account for a hot-account wave.
    await prisma.user.updateMany({ data: { points: 0 } })
    const contact = randomUUID() + '@example.invalid'
    const scaleUsers = Array.from({ length: 1500 }, (_, index) => {
      const id = 'shun-scale-' + index
      return { id, username: id, usernameNormalized: id, nickname: id, passwordHash: 'fixture', points: 0 }
    })
    await prisma.user.createMany({ data: scaleUsers })
    await prisma.profile.createMany({ data: scaleUsers.map(({ id }) => ({ userId: id, displayName: id })) })
    const [hot, related, ...crowd] = await Promise.all([
      createUser(500, contact), createUser(0, contact), ...Array.from({ length: 32 }, () => createUser()),
    ])
    await assert.rejects(shunAttempt(related.id, randomUUID()), { code: 'NO_TARGET' })
    await prisma.block.createMany({ data: crowd.flatMap((actor, index) => crowd.slice(index + 1)
      .map((other) => ({ blockerId: actor.id, blockedId: other.id }))) })

    const deadlocks = async () => Number((await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT AS count FROM information_schema.INNODB_METRICS WHERE NAME = 'lock_deadlocks'
    `)[0].count)
    const lockWaits = async () => Number((await prisma.$queryRawUnsafe<{ Value: string }[]>(
      "SHOW GLOBAL STATUS LIKE 'Innodb_row_lock_waits'"))[0].Value)
    const beforeWaits = await lockWaits()
    const beforeDeadlocks = await deadlocks()
    const locked = Promise.withResolvers<void>()
    const hold = shunTransaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM ShunMasterSettings WHERE id=1 FOR UPDATE`
      locked.resolve()
      await new Promise((resolve) => setTimeout(resolve, 350))
    })
    await locked.promise
    const timings: number[] = []
    const wave = await Promise.allSettled(crowd.map(async (player) => {
      const start = performance.now()
      try { return await shunAttempt(player.id, randomUUID()) } finally { timings.push(performance.now() - start) }
    }))
    await hold
    assert.equal(wave.filter((result) => result.status === 'fulfilled').length, 4)
    assert.ok(wave.every((result) => result.status === 'fulfilled' || result.reason?.code === 'NO_TARGET'))
    const hotRounds = await prisma.shunMasterRound.findMany({ where: { victimId: hot.id } })
    assert.equal(hotRounds.length, 4)
    assert.equal((await shunStatus(hot.id)).balance, 500 - hotRounds.reduce((sum, row) => sum + row.amount, 0))
    assert.ok(Math.max(...timings) >= 250)
    timings.sort((a, b) => a - b)
    console.log('SHUN_PRESSURE', JSON.stringify({ simultaneous: crowd.length, committed: hotRounds.length,
      p95Ms: Math.round(timings[Math.ceil(timings.length * 0.95) - 1]), maxMs: Math.round(timings.at(-1)!),
      rowLockWaits: (await lockWaits()) - beforeWaits, deadlocks: (await deadlocks()) - beforeDeadlocks }))

    // Create a cycle with a synthetic legacy writer to exercise actual InnoDB deadlock recovery.
    const accountLocked = Promise.withResolvers<void>()
    const settingsLocked = Promise.withResolvers<void>()
    const beforeCycle = await deadlocks()
    let invocations = 0
    const retried = shunTransaction(async (tx) => {
      invocations++
      await tx.$queryRaw`SELECT id FROM User WHERE id = ${hot.id} FOR UPDATE`
      if (invocations === 1) {
        accountLocked.resolve()
        await settingsLocked.promise
      }
      await tx.$queryRaw`SELECT id FROM ShunMasterSettings WHERE id = 1 FOR UPDATE`
    })
    const competitor = prisma.$transaction(async (tx) => {
      await accountLocked.promise
      await tx.$queryRaw`SELECT id FROM ShunMasterSettings WHERE id = 1 FOR UPDATE`
      // Give the competitor more rollback work so InnoDB selects the read-only transaction as victim.
      for (const { id } of crowd.slice(0, 4)) {
        await tx.user.update({ where: { id }, data: { updatedAt: new Date() } })
      }
      settingsLocked.resolve()
      await tx.$queryRaw`SELECT id FROM User WHERE id = ${hot.id} FOR UPDATE`
    }, { isolationLevel: 'ReadCommitted', timeout: 10000 })
    await Promise.all([retried, competitor])
    assert.equal((await deadlocks()) - beforeCycle, 1)
    assert.equal(invocations, 2)
    assert.equal(await prisma.shunMasterRound.count({ where: { victimId: hot.id } }), 4)
    console.log('SHUN_DEADLOCK', JSON.stringify({ detected: 1, boundedAttempts: invocations, extraSettlements: 0 }))

    // Same-millisecond rows straddling Beijing midnight exercise the stable filtered cursor.
    const midnight = new Date('2026-10-04T16:00:00Z')
    const previous = new Date(midnight.getTime() - 1)
    await prisma.shunMasterRound.createMany({ data: crowd.slice(0, 22).map((target, index) => {
      const createdAt = index === 21 ? previous : midnight
      return { actorId: operator.id, victimId: target.id, requestId: randomUUID(), day: shunDay(createdAt),
        rolled: 1, amount: 1, createdAt, goldenUntil: createdAt, candidates: [] }
    }) })
    const today = { range: 'today' as const, now: new Date(midnight.getTime() + 100) }
    const firstPage = await shunRecords(operator.id, 'out', undefined, undefined, today)
    assert.equal(firstPage.records.length, 20)
    assert.ok(firstPage.nextCursor)
    const nextPage = await shunRecords(operator.id, 'out', firstPage.nextCursor, undefined, today)
    assert.equal(new Set([...firstPage.records, ...nextPage.records].map(({ id }) => id)).size, 21)
    assert.equal((await shunRecords(operator.id, 'out', undefined, undefined, { ...today, range: 'yesterday' })).records.length, 1)
    assert.equal((await shunRecords(operator.id, 'out', undefined, undefined, { ...today, range: 'week' })).records.length, 20)

    // --- deferred notification: settle first, decide the letter afterwards ---
    await publish({ ...config, enabled: true })
    const [letterActor, letterTarget, stranger] = await Promise.all([createUser(60), createUser(60), createUser(60)])
    // Pin the target pool so this fixture cannot silently skip the letter path.
    const funded = await prisma.user.findMany({
      where: { points: { gt: 0 }, id: { notIn: [letterActor.id, letterTarget.id] } }, select: { id: true },
    })
    await prisma.block.createMany({ data: funded.map(({ id }) => ({ blockerId: letterActor.id, blockedId: id })), skipDuplicates: true })
    const letterRequestId = randomUUID()
    const sent = await shunAttempt(letterActor.id, letterRequestId)
    const sentRound = await prisma.shunMasterRound.findUniqueOrThrow({ where: { id: sent.id } })
    assert.equal(sentRound.victimId, letterTarget.id)
    assert.equal(sentRound.actorId, letterActor.id)
    assert.equal(sentRound.notifyStatus, 'PENDING', '顺取后必须先进入待通知状态')
    assert.ok(sentRound.notifyDueAt && sentRound.notifyDueAt.getTime() > sentRound.createdAt.getTime(),
      '待通知必须有过期时间')
    assert.equal(await prisma.notification.count({ where: { recipientId: letterTarget.id } }), 0,
      '玩家做出选择之前不得发送任何通知')
    assert.equal(await prisma.shunMasterAnonymousLetter.count({ where: { roundId: sent.id } }), 0)

    // The actor decides to write: one letter, one letter notification, no plain one.
    const letterOutcome = await shunSendNotification(letterActor.id, sent.id, '  范范Vanessa UID:11153  ')
    assert.equal(letterOutcome.status, 'SENT_LETTER')
    const sentLetter = await prisma.shunMasterAnonymousLetter.findUniqueOrThrow({ where: { roundId: sent.id } })
    assert.equal(sentLetter.recipientId, sentRound.victimId, '收件人必须是本次被顺用户')
    assert.equal(sentLetter.senderId, sentRound.actorId, '发件人必须是本次顺取者')
    assert.equal(sentLetter.content, '范范Vanessa UID:11153', '留言必须按规整后的内容落库')
    const letterNotice = await prisma.notification.findFirstOrThrow({
      where: { recipientId: sentRound.victimId, key: `shun:${sent.id}:taken-letter` },
    })
    assert.equal(letterNotice.title, '你收到一封神秘来信 ✉️')
    assert.equal(letterNotice.link, `/shun-master?record=${sent.id}&side=in&letter=1`)
    assert.equal(await prisma.notification.count({ where: { recipientId: sentRound.victimId, key: `shun:${sent.id}:taken` } }), 0,
      '有留言时不得再生成普通被顺通知')

    // The golden window starts at delivery, not at the take itself.
    const delivered = await prisma.shunMasterRound.findUniqueOrThrow({ where: { id: sent.id } })
    assert.ok(delivered.notifiedAt, '必须记录通知发送时间')
    assert.equal(delivered.notifyAuto, false)
    assert.equal(delivered.goldenUntil.getTime() - delivered.notifiedAt!.getTime(), config.goldenMinutes * 60_000,
      '黄金抓捕期必须从通知发送时刻开始')

    // Replaying the take must not rewrite the letter, and a late plain request is refused.
    const replay = await shunAttempt(letterActor.id, letterRequestId)
    assert.equal(replay.id, sent.id)
    assert.equal((await prisma.shunMasterAnonymousLetter.findUniqueOrThrow({ where: { roundId: sent.id } })).content,
      '范范Vanessa UID:11153')
    assert.equal(await prisma.shunMasterRound.count({ where: { actorId: letterActor.id } }), 1)
    assert.equal((await shunSendNotification(letterActor.id, sent.id, null)).status, 'SENT_LETTER')
    assert.equal(await prisma.notification.count({ where: { recipientId: sentRound.victimId } }), 1,
      '一封信只能对应一条被顺通知')

    // Concurrent retries of one request create exactly one round.
    const concurrentActor = await createUser(60)
    const concurrentId = randomUUID()
    const letterOutcomes = await Promise.allSettled([
      shunAttempt(concurrentActor.id, concurrentId),
      shunAttempt(concurrentActor.id, concurrentId),
    ])
    const settled = letterOutcomes.filter((outcome) => outcome.status === 'fulfilled')
    assert.ok(settled.length >= 1, '同一 requestId 的并发请求不得全部失败')
    const concurrentRounds = await prisma.shunMasterRound.findMany({ where: { actorId: concurrentActor.id } })
    assert.equal(concurrentRounds.length, 1, '并发重放只能产生一条顺取记录')

    // Two concurrent letter sends still produce exactly one letter and one notice.
    const raceLetters = await Promise.allSettled([
      shunSendNotification(concurrentActor.id, concurrentRounds[0].id, '并发第一封'),
      shunSendNotification(concurrentActor.id, concurrentRounds[0].id, '并发第二封'),
    ])
    assert.ok(raceLetters.some((result) => result.status === 'fulfilled'))
    assert.equal(await prisma.shunMasterAnonymousLetter.count({ where: { senderId: concurrentActor.id } }), 1)

    // No letter: the actor sends the ordinary notice, then a letter is impossible.
    const plainActor = await createUser(60)
    const plain = await shunAttempt(plainActor.id, randomUUID())
    assert.ok(!('hasLetter' in plain), '无留言顺取不得带送信标记')
    assert.equal(await prisma.notification.count({ where: { key: `shun:${plain.id}:taken` } }), 0)
    const plainOutcome = await shunSendNotification(plainActor.id, plain.id, null)
    assert.equal(plainOutcome.status, 'SENT_PLAIN')
    const plainNotice = await prisma.notification.findFirstOrThrow({ where: { key: `shun:${plain.id}:taken` } })
    assert.equal(plainNotice.title, '你的挂号费被顺走啦！')
    assert.equal(plainNotice.link, `/shun-master?record=${plain.id}&side=in`, '普通通知必须直达被顺记录')
    await assert.rejects(shunSendNotification(plainActor.id, plain.id, '补发的匿名信'),
      (error: { code?: string }) => error.code === 'ALREADY_NOTIFIED', '普通通知已发送后不得补发匿名信')
    assert.equal(await prisma.shunMasterAnonymousLetter.count({ where: { roundId: plain.id } }), 0)
    assert.equal(await prisma.notification.count({ where: { recipientId: plainActor.id } }), 0)

    // --- abandoned choice: the server delivers the plain notice, exactly once ---
    const abandonedActor = await createUser(60)
    const abandoned = await shunAttempt(abandonedActor.id, randomUUID())
    await prisma.shunMasterRound.update({ where: { id: abandoned.id }, data: { notifyDueAt: new Date(Date.now() - 1000) } })
    const sweep = await runShunNotifySweepOnce()
    assert.ok(sweep.delivered >= 1)
    const abandonedRound = await prisma.shunMasterRound.findUniqueOrThrow({ where: { id: abandoned.id } })
    assert.equal(abandonedRound.notifyStatus, 'SENT_PLAIN', '超时必须自动发送普通通知')
    assert.equal(abandonedRound.notifyAuto, true, '必须标记为超时自动发送')
    assert.ok(abandonedRound.notifiedAt)
    assert.equal(abandonedRound.goldenUntil.getTime() - abandonedRound.notifiedAt!.getTime(), config.goldenMinutes * 60_000,
      '超时兜底同样从通知发送时刻开始计算黄金抓捕期')
    const abandonedNotice = await prisma.notification.findFirstOrThrow({ where: { key: `shun:${abandoned.id}:taken` } })
    assert.equal(abandonedNotice.link, `/shun-master?record=${abandoned.id}&side=in`)
    // Re-running the sweep is a no-op: no second notification, no golden rewind.
    await prisma.shunMasterRound.update({ where: { id: abandoned.id }, data: { notifyDueAt: new Date(Date.now() - 1000) } })
    await runShunNotifySweepOnce()
    assert.equal(await prisma.notification.count({ where: { key: `shun:${abandoned.id}:taken` } }), 1,
      '重复执行超时任务不得重复通知')
    const afterSecondSweep = await prisma.shunMasterRound.findUniqueOrThrow({ where: { id: abandoned.id } })
    assert.equal(afterSecondSweep.goldenUntil.getTime(), abandonedRound.goldenUntil.getTime(), '重复执行不得延长黄金期')
    await assert.rejects(shunSendNotification(abandonedActor.id, abandoned.id, '超时后补信'),
      (error: { code?: string }) => error.code === 'ALREADY_NOTIFIED', '超时兜底后不得补发匿名信')

    // A letter that wins the race against the sweep must never get a second notice.
    const raceActor = await createUser(60)
    const raced = await shunAttempt(raceActor.id, randomUUID())
    await prisma.shunMasterRound.update({ where: { id: raced.id }, data: { notifyDueAt: new Date(Date.now() - 1000) } })
    await shunSendNotification(raceActor.id, raced.id, '抢先一步的信')
    await runShunNotifySweepOnce()
    assert.equal(await prisma.notification.count({ where: { key: `shun:${raced.id}:taken` } }), 0,
      '信已送达后不得再发普通通知')
    assert.equal(await prisma.notification.count({ where: { key: `shun:${raced.id}:taken-letter` } }), 1)
    assert.equal((await prisma.shunMasterRound.findUniqueOrThrow({ where: { id: raced.id } })).notifyStatus, 'SENT_LETTER')
    assert.equal(await prisma.shunMasterAnonymousLetter.count({ where: { roundId: raced.id } }), 1)

    // Reading is recipient-only, and the projection never carries the sender.
    const recipientView = await readAnonymousLetter(sentRound.victimId, sent.id)
    assert.ok(recipientView, '收件人必须能读取自己的信')
    assert.equal(recipientView.content, '范范Vanessa UID:11153')
    assert.equal('senderId' in recipientView, false, '收件人视图不得包含发送者')
    assert.equal('actorId' in recipientView, false)
    assert.equal(await readAnonymousLetter(stranger.id, sent.id), null, '非收件人不得读取')
    assert.equal(await readAnonymousLetter(letterActor.id, sent.id), null, '发送者不得通过收件人接口回读')
    assert.equal(await readAnonymousLetter(sentRound.victimId, 'nonexistentletter0000000000001'), null, '无效 id 不得返回内容')

    // Hidden letters and duplicate roundIds are rejected by the storage layer.
    await prisma.shunMasterAnonymousLetter.update({ where: { roundId: sent.id }, data: { hiddenAt: new Date() } })
    assert.equal(await readAnonymousLetter(sentRound.victimId, sent.id), null, '被隐藏的信件不得返回内容')
    await assert.rejects(prisma.shunMasterAnonymousLetter.create({ data: {
      roundId: sent.id, senderId: letterActor.id, recipientId: sentRound.victimId, content: '重复信件',
    } }), '一次顺取最多对应一条留言')
  } finally { await prisma.$disconnect() }
})
