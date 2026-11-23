import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { prisma } from '../lib/prisma'
import { shunAttempt, shunCapture, shunJoin, shunRecords, shunStatus, shunTransaction, updateShunConfig } from '../lib/shun-master'
import { defaultShunConfig } from '../lib/shun-master-rules'

test('isolated MySQL enforces limits, privacy, idempotency and balanced recovery', {
  skip: process.env.SHUN_MASTER_MYSQL_QA !== '1', timeout: 120000,
}, async () => {
  const url = new URL(process.env.DATABASE_URL || '')
  assert.equal(url.protocol, 'mysql:')
  assert.equal(url.hostname, '127.0.0.1')
  assert.equal(url.port, process.env.GITHUB_ACTIONS === 'true' ? '3306' : '33326')
  assert.equal(url.pathname, '/ecfc_shun_qa')
  assert.equal(await prisma.shunMasterRound.count(), 0, 'requires an empty isolated fixture')
  const approve = async (userId: string) => shunJoin(userId, true, (await shunStatus(userId)).rulesVersion)
  const createUser = async (points = 0, contact?: string, age = 9) => {
    const name = 'shun-qa-' + randomUUID()
    return prisma.user.create({ data: { username: name, usernameNormalized: name, nickname: name,
      email: contact ?? name + '@example.invalid', emailVerifiedAt: new Date(), points, passwordHash: 'fixture',
      createdAt: new Date(Date.now() - age * 86400000), Profile: { create: { displayName: name } } } })
  }
  try {
    const [operator, victim, ...actors] = await Promise.all([
      createUser(), createUser(40), ...Array.from({ length: 8 }, () => createUser()),
    ])
    const config = { ...defaultShunConfig, enabled: true, budget: 500 }
    await updateShunConfig(operator.id, config)
    const fresh = await createUser(0, undefined, 0)
    await prisma.user.update({ where: { id: fresh.id }, data: { email: null, emailVerifiedAt: null } })
    await assert.rejects(shunJoin(fresh.id, true), { code: 'CONSENT_REQUIRED' })
    await Promise.all([approve(fresh.id), approve(fresh.id)])
    assert.equal(await prisma.shunMasterConsent.count({ where: { userId: fresh.id } }), 1)
    assert.equal((await shunStatus(fresh.id)).joined, true)
    await shunJoin(fresh.id, false)
    await shunJoin(fresh.id, true)
    assert.equal((await shunStatus(fresh.id)).hasAcceptedRules, true)
    const originalVersion = (await shunStatus(fresh.id)).rulesVersion
    await updateShunConfig(operator.id, { ...config, budget: config.budget + 1 })
    assert.equal((await shunStatus(fresh.id)).rulesVersion, originalVersion)
    assert.equal((await shunStatus(fresh.id)).hasAcceptedRules, true)
    await updateShunConfig(operator.id, config)
    await shunJoin(fresh.id, false)
    await prisma.user.update({ where: { id: fresh.id }, data: { status: 'BANNED' } })
    await assert.rejects(shunJoin(fresh.id, true), { code: 'ACCOUNT' })
    for (const user of [victim, ...actors]) await approve(user.id)
    const ids = actors.map(() => randomUUID())
    // Exclude every actor from the other actors' target pools even after their winnings are credited.
    await prisma.block.createMany({ data: actors.flatMap((actor, index) => actors.slice(index + 1).map((other) =>
      ({ blockerId: actor.id, blockedId: other.id }))) })
    const outcomes = await Promise.allSettled(actors.map((actor, index) => shunAttempt(actor.id, ids[index])))
    assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 4)
    const rounds = await prisma.shunMasterRound.findMany({ orderBy: { createdAt: 'asc' } })
    assert.ok(rounds.every((round) => round.victimId === victim.id && round.actorId !== victim.id))
    const [first, failed, expired, compensated] = rounds
    const owner = actors.find(({ id }) => id === first.actorId)!
    await assert.rejects(shunAttempt(owner.id, randomUUID()), { code: 'NO_TARGET' })
    assert.equal((await shunStatus(owner.id)).remaining, 6)
    assert.equal((await shunAttempt(owner.id, first.requestId)).id, first.id)
    assert.equal(await prisma.shunMasterRound.count(), 4)
    assert.equal(await prisma.pointLog.count({ where: { action: 'SHUN_STEAL' } }), 8)
    assert.equal(await prisma.notification.count({ where: { recipientId: victim.id, actorId: null } }), 4)
    assert.ok((await shunRecords(victim.id, 'in')).records.every((row) => row.person === null && !('actorId' in row)))
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
    for (const log of earlierLogs) assert.equal(log.after - log.before, log.points)
    assert.equal(earlierLogs.reduce((sum, log) => sum + log.points, 0), compensated.amount)
    const state = await prisma.shunMasterSettings.findUniqueOrThrow({ where: { id: 1 } })
    assert.equal(state.reserved, expired.amount)
    assert.equal(state.compensated, compensated.amount)
    assert.ok(await prisma.user.count({ where: { points: { lt: 0 } } }) === 0)
    await assert.rejects(updateShunConfig(operator.id, { ...config, budget: 0 }), { code: 'BUDGET' })
    await prisma.shunMasterRound.update({ where: { id: expired.id }, data: { createdAt: new Date(Date.now() - 90 * 86400000) } })
    await updateShunConfig(operator.id, { ...config, budget: state.reserved + state.compensated })
    await assert.rejects(shunAttempt(owner.id, randomUUID()), { code: 'BUDGET' })
    assert.equal((await prisma.shunMasterSettings.findUniqueOrThrow({ where: { id: 1 } })).reserved, expired.amount)
    await updateShunConfig(operator.id, { ...config, enabled: false, budget: state.reserved + state.compensated })
    await assert.rejects(shunAttempt(owner.id, randomUUID()), { code: 'DISABLED' })
    assert.equal((await shunCapture(victim.id, expired.id, { mode: 3, uid: expiredOwner.uid })).record?.result, 'SUCCESS')
    assert.equal((await prisma.shunMasterSettings.findUniqueOrThrow({ where: { id: 1 } })).reserved, 0)

    const [limitActor, ...targets] = await Promise.all([createUser(), ...Array.from({ length: 10 }, () => createUser(1))])
    await updateShunConfig(operator.id, { ...config, victimCap: 5 })
    const revised = await shunStatus(owner.id)
    assert.equal(revised.hasAcceptedRules, false)
    assert.equal(revised.joined, false)
    await assert.rejects(shunJoin(owner.id, true, revised.rulesVersion - 1), { code: 'CONSENT_REQUIRED' })
    await assert.rejects(shunAttempt(owner.id, randomUUID()), { code: 'MEMBERSHIP' })
    for (const user of [limitActor, ...targets]) await approve(user.id)
    const dayResults = await Promise.allSettled(Array.from({ length: 10 }, () => shunAttempt(limitActor.id, randomUUID())))
    const won = dayResults.flatMap((outcome) => outcome.status === 'fulfilled' ? [outcome.value] : [])
    assert.equal(won.length, 7)
    assert.equal(new Set(won.map((round) => round.person?.uid)).size, 7)
    assert.ok(won.every((round) => round.amount === 1))
    assert.equal((await shunStatus(limitActor.id)).remaining, 0)
    const overflow = await createUser(2147483647)
    await approve(overflow.id)
    const before = await prisma.shunMasterRound.count()
    await assert.rejects(shunAttempt(overflow.id, randomUUID()), { code: 'BALANCE' })
    assert.equal(await prisma.shunMasterRound.count(), before)
    assert.equal((await shunStatus(overflow.id)).remaining, 7)

    const invalidLegacyBalance = await createUser(-1)
    await approve(invalidLegacyBalance.id)
    await assert.rejects(shunAttempt(invalidLegacyBalance.id, randomUUID()), { code: 'BALANCE' })
    assert.equal(await prisma.shunMasterRound.count(), before)
    assert.equal((await shunStatus(invalidLegacyBalance.id)).remaining, 7)

    // Expose only one funded target and its linked account for a hot-account wave.
    await updateShunConfig(operator.id, config)
    const contact = randomUUID() + '@example.invalid'
    const [hot, related, ...crowd] = await Promise.all([
      createUser(500, contact), createUser(0, contact), ...Array.from({ length: 32 }, () => createUser()),
    ])
    await approve(hot.id)
    await approve(related.id)
    await assert.rejects(shunAttempt(related.id, randomUUID()), { code: 'NO_TARGET' })
    for (const player of crowd) await approve(player.id)
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
  } finally { await prisma.$disconnect() }
})
