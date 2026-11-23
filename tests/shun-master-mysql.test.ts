import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { prisma } from '../lib/prisma'
import { shunAttempt, shunCapture, shunJoin, shunRecords, shunStatus, updateShunConfig } from '../lib/shun-master'
import { defaultShunConfig } from '../lib/shun-master-rules'

test('isolated MySQL enforces limits, privacy, idempotency and balanced recovery', {
  skip: process.env.SHUN_MASTER_MYSQL_QA !== '1', timeout: 120000,
}, async () => {
  const url = new URL(process.env.DATABASE_URL || '')
  assert.equal(url.protocol, 'mysql:')
  assert.equal(url.hostname, '127.0.0.1')
  assert.equal(url.port, '33326')
  assert.equal(url.pathname, '/ecfc_shun_qa')
  assert.equal(await prisma.shunMasterRound.count(), 0, 'requires an empty isolated fixture')
  const createUser = async (points = 0) => {
    const name = 'shun-qa-' + randomUUID()
    return prisma.user.create({ data: { username: name, usernameNormalized: name, nickname: name,
      email: name + '@example.invalid', emailVerifiedAt: new Date(), points, passwordHash: 'fixture',
      createdAt: new Date(Date.now() - 9 * 86400000), Profile: { create: { displayName: name } } } })
  }
  try {
    const [operator, victim, ...actors] = await Promise.all([
      createUser(), createUser(40), ...Array.from({ length: 8 }, () => createUser()),
    ])
    const config = { ...defaultShunConfig, enabled: true, budget: 500 }
    await updateShunConfig(operator.id, config)
    for (const user of [victim, ...actors]) await shunJoin(user.id, true, { victimCap: 4 })
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
    const compensatedResult = await shunCapture(victim.id, compensated.id, { mode: 2, uid: spentOwner.uid })
    assert.equal(compensatedResult.record?.recovered, compensated.amount)
    const compensation = await prisma.pointLog.findFirstOrThrow({ where: { userId: victim.id, action: 'SHUN_COMPENSATION' } })
    assert.equal(compensation.points, compensated.amount)
    assert.equal(compensation.reversalOfBusinessKey, `shun:${compensated.id}:take:${victim.id}`)
    const state = await prisma.shunMasterSettings.findUniqueOrThrow({ where: { id: 1 } })
    assert.equal(state.reserved, expired.amount)
    assert.equal(state.compensated, compensated.amount)
    assert.ok(await prisma.user.count({ where: { points: { lt: 0 } } }) === 0)
    await assert.rejects(updateShunConfig(operator.id, { ...config, budget: 0 }), { code: 'BUDGET' })

    const [limitActor, ...targets] = await Promise.all([createUser(), ...Array.from({ length: 10 }, () => createUser(1))])
    await updateShunConfig(operator.id, { ...config, victimCap: 5 })
    for (const user of [limitActor, ...targets]) await shunJoin(user.id, true, { victimCap: 5 })
    const dayResults = await Promise.allSettled(Array.from({ length: 10 }, () => shunAttempt(limitActor.id, randomUUID())))
    const won = dayResults.flatMap((outcome) => outcome.status === 'fulfilled' ? [outcome.value] : [])
    assert.equal(won.length, 7)
    assert.equal(new Set(won.map((round) => round.person?.uid)).size, 7)
    assert.ok(won.every((round) => round.amount === 1))
    assert.equal((await shunStatus(limitActor.id)).remaining, 0)
    const overflow = await createUser(2147483647)
    await shunJoin(overflow.id, true, { victimCap: 5 })
    const before = await prisma.shunMasterRound.count()
    await assert.rejects(shunAttempt(overflow.id, randomUUID()), { code: 'BALANCE' })
    assert.equal(await prisma.shunMasterRound.count(), before)
    assert.equal((await shunStatus(overflow.id)).remaining, 7)

    const invalidLegacyBalance = await createUser(-1)
    await shunJoin(invalidLegacyBalance.id, true, { victimCap: 5 })
    await assert.rejects(shunAttempt(invalidLegacyBalance.id, randomUUID()), { code: 'BALANCE' })
    assert.equal(await prisma.shunMasterRound.count(), before)
    assert.equal((await shunStatus(invalidLegacyBalance.id)).remaining, 7)
  } finally { await prisma.$disconnect() }
})
