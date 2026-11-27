import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { prisma } from '../lib/prisma'
import { defaultShunItemDefinitions, defaultShunItemRules } from '../lib/shun-item-config'
import { lockShunItemUsers, postShunItemMovement, reconcileShunItemInventory } from '../lib/shun-item-inventory'
import { sendShunItemGift, setShunEnabled, shunStatus, shunTransaction, updateShunConfig, applyShunExtraAttempt, shunAttempt, shunCapture, shunItemBox, setShunItemPending, retryShunCapture, settleShunRevenge } from '../lib/shun-master'
import { defaultShunConfig, shunDay } from '../lib/shun-master-rules'
import { runShunItemRewardSweep } from '../lib/shun-item-rewards'
import { getTodayTasks } from '../lib/growth-tasks/registry'

test('V4.2 isolated MySQL inventory, retry idempotency and randomized friend gift caps', {
  skip: process.env.SHUN_ITEMS_MYSQL_QA !== '1',
  timeout: 120_000,
}, async () => {
  const url = new URL(process.env.DATABASE_URL ?? '')
  assert.equal(url.protocol, 'mysql:')
  assert.equal(url.hostname, '127.0.0.1')
  assert.equal(url.pathname, '/ecfc_shun_items_fixture_qa')
  assert.equal(await prisma.shunMasterRound.count(), 0, 'run on a freshly migrated isolated fixture')
  assert.equal(await prisma.shunItemConfigVersion.count(), 0)
  const previous = process.env.SHUN_ITEMS_ENABLED
  process.env.SHUN_ITEMS_ENABLED = 'true'
  const now = new Date()
  const day = shunDay(now)
  const fixture = async (points = 0) => {
    const name = 'shun-item-' + randomUUID()
    return prisma.user.create({ data: {
      username: name, usernameNormalized: name, nickname: name, passwordHash: 'fixture', points,
      Profile: { create: { displayName: name } },
    } })
  }
  try {
    const [sender, receiver, blocked, unrelated] = await Promise.all([fixture(10), fixture(), fixture(), fixture()])
    const config = await prisma.shunItemConfigVersion.create({ data: {
      createdBy: sender.id, enabled: true, rules: {
        ...defaultShunItemRules,
        drops: { ...defaultShunItemRules.drops, CHECK_IN: { chance: 100, dailyChecks: 1 } },
      },
      definitions: { create: defaultShunItemDefinitions },
    } })
    await prisma.shunMasterSettings.upsert({
      where: { id: 1 }, create: { id: 1, config: defaultShunConfig }, update: {},
    })
    await updateShunConfig(sender.id, { ...defaultShunConfig, enabled: false, openHoursEnabled: false })
    await setShunEnabled(sender.id, true)
    for (const friend of [receiver, blocked]) {
      const [userAId, userBId] = [sender.id, friend.id].sort()
      await prisma.friendship.create({ data: { userAId, userBId } })
    }
    await prisma.block.create({ data: { blockerId: blocked.id, blockedId: sender.id } })

    await shunTransaction(async (tx) => {
      await lockShunItemUsers(tx, [sender.id])
      for (const code of ['FRIEND_GIFT', 'EXTRA_ATTEMPT'] as const) {
        for (let i = 0; i < 3; i++) {
          await postShunItemMovement(tx, {
            userId: sender.id, code, day, type: 'WEEKLY_REWARD', configVersion: config.version, requestKey: code + i,
          })
        }
      }
    })
    await assert.rejects(prisma.shunItemInventory.update({
      where: { userId_code: { userId: sender.id, code: 'EXTRA_ATTEMPT' } }, data: { available: -1 },
    }))

    const firstGift = randomUUID()
    const [one, replay] = await Promise.all([
      sendShunItemGift(sender.id, firstGift, () => now), sendShunItemGift(sender.id, firstGift, () => now),
    ])
    assert.equal(one.receiver?.uid, receiver.uid)
    assert.deepEqual(replay, one)
    const remainingGiftCalls = await Promise.allSettled(Array.from({ length: 3 }, () =>
      sendShunItemGift(sender.id, randomUUID(), () => now)))
    assert.equal(remainingGiftCalls.filter((result) => result.status === 'fulfilled').length, 1)
    assert.equal(await prisma.shunItemGift.count({ where: { senderId: sender.id, receiverId: receiver.id } }), 2)
    assert.equal(await prisma.shunItemDaily.findUnique({
      where: { userId_day: { userId: receiver.id, day } },
    }).then((row) => row?.giftsReceived), 2)
    assert.equal(await prisma.shunItemInventory.count({ where: { userId: { in: [blocked.id, unrelated.id] } } }), 0)

    const extraRequest = randomUUID()
    const applied = await Promise.all(Array.from({ length: 3 }, () =>
      applyShunExtraAttempt(sender.id, extraRequest, () => now)))
    assert.deepEqual(applied, Array.from({ length: 3 }, () => ({ applied: true, day })))
    const more = await Promise.allSettled(Array.from({ length: 3 }, () =>
      applyShunExtraAttempt(sender.id, randomUUID(), () => now)))
    assert.equal(more.filter((result) => result.status === 'fulfilled').length, 1)
    assert.equal((await shunStatus(sender.id)).remaining, 9)
    assert.equal(await prisma.shunItemEntry.count({ where: { userId: sender.id, type: 'USED' } }), 2)

    assert.deepEqual(await shunTransaction((tx) => reconcileShunItemInventory(tx, receiver.id)), [])
    assert.deepEqual(await shunTransaction((tx) => reconcileShunItemInventory(tx, sender.id)), [])
    assert.equal(await prisma.pointLog.count({ where: { userId: { in: [sender.id, receiver.id, blocked.id, unrelated.id] } } }), 0)

    const earnedAt = new Date()
    const earnedDay = shunDay(earnedAt)
    await prisma.growthTaskCompletion.create({ data: {
      userId: unrelated.id, taskCode: 'DAILY_CHECKIN', periodKey: earnedDay, sourceEventId: 'test-checkin', completedAt: earnedAt,
    } })
    await Promise.all([runShunItemRewardSweep(), runShunItemRewardSweep()])
    await runShunItemRewardSweep()
    assert.equal(await prisma.shunItemEntry.count({ where: { userId: unrelated.id, type: 'COMMUNITY_DROP' } }), 1)
    assert.equal(await prisma.shunItemEntry.count({ where: { userId: unrelated.id, type: 'DAILY_MAIN' } }), 0)
    const completedAt = new Date()
    await prisma.growthTaskCompletion.createMany({ data: getTodayTasks().filter(({ code }) => code !== 'DAILY_CHECKIN')
      .flatMap((task) => Array.from({ length: task.dailyCap ?? task.completionThreshold ?? 1 }, (_, index) => ({
        userId: unrelated.id, taskCode: task.code, periodKey: earnedDay, completedAt,
        sourceEventId: `synthetic:${task.code}:${index}`,
      }))) })
    await prisma.pointLog.createMany({ data: Array.from({ length: 10 }, (_, index) => ({
      userId: unrelated.id, action: 'COMMENT_POST' as const, points: 1, before: index, after: index + 1,
      dateKey: earnedDay, businessKey: 'shun-test-comment:' + unrelated.id + ':' + index, createdAt: completedAt,
    })) })
    await prisma.user.update({ where: { id: unrelated.id }, data: { points: 10 } })
    for (let pass = 0; pass < 3; pass++) await runShunItemRewardSweep()
    assert.deepEqual(await prisma.shunItemDaily.findUnique({
      where: { userId_day: { userId: unrelated.id, day: earnedDay } },
      select: { mainGranted: true, behaviorGranted: true },
    }), { mainGranted: true, behaviorGranted: true })
    assert.equal(await prisma.shunItemEntry.count({ where: { userId: unrelated.id, type: 'DAILY_MAIN' } }), 1)
    assert.deepEqual(await shunTransaction((tx) => reconcileShunItemInventory(tx, unrelated.id)), [])

    await prisma.block.create({ data: { blockerId: sender.id, blockedId: unrelated.id } })
    const target = await fixture(60)
    const [userAId, userBId] = [sender.id, target.id].sort()
    await prisma.friendship.create({ data: { userAId, userBId } })
    await shunTransaction(async (tx) => {
      await lockShunItemUsers(tx, [sender.id, target.id])
      for (const code of ['DOUBLE_AMOUNT', 'EXTRA_SUSPECT', 'TARGET_FRIEND'] as const) {
        await postShunItemMovement(tx, {
          userId: sender.id, code, day, type: 'WEEKLY_REWARD', configVersion: config.version, requestKey: 'seed:' + code,
        })
      }
      for (const code of ['RETRY_CAPTURE', 'REVENGE'] as const) {
        await postShunItemMovement(tx, {
          userId: target.id, code, day, type: 'WEEKLY_REWARD', configVersion: config.version, requestKey: 'seed:' + code,
        })
      }
    })
    await setShunItemPending(sender.id, 'DOUBLE_AMOUNT', randomUUID(), false)
    await assert.rejects(shunAttempt(sender.id, randomUUID(), undefined, target.id), { code: 'ITEM_PENDING' })
    const takeId = randomUUID()
    const doubled = await shunAttempt(sender.id, takeId)
    assert.equal((await shunAttempt(sender.id, takeId)).id, doubled.id)
    const actual = await prisma.shunMasterRound.findUniqueOrThrow({ where: { id: doubled.id } })
    assert.equal(actual.victimId, target.id)
    assert.equal(actual.amount, Math.min(actual.rolled * 2, 14))
    assert.equal(await prisma.shunItemPending.count({ where: { userId: sender.id } }), 0)
    const options = await shunCapture(target.id, doubled.id)
    assert.ok('candidates' in options && options.candidates)
    const wrong = options.candidates.find((candidate) => candidate.uid !== sender.uid)
    assert.ok(wrong)
    const failed = await shunCapture(target.id, doubled.id, { mode: options.mode, uid: wrong.uid })
    assert.ok('record' in failed)
    assert.equal(failed.record?.result, 'FAILED')
    const recovery = await Promise.all([retryShunCapture(target.id, doubled.id), retryShunCapture(target.id, doubled.id)])
    assert.deepEqual(recovery, [{ recovered: actual.amount }, { recovered: actual.amount }])
    assert.equal((await prisma.shunMasterRound.findUniqueOrThrow({ where: { id: doubled.id } })).result, 'FAILED')
    const revenge = await Promise.all([settleShunRevenge(target.id, doubled.id), settleShunRevenge(target.id, doubled.id)])
    assert.deepEqual(revenge[0], revenge[1])
    assert.equal(await prisma.shunItemRoundEffect.count({ where: { roundId: doubled.id } }), 3)
    const wallets = await prisma.user.findMany({ where: { id: { in: [sender.id, target.id] } }, select: { points: true } })
    assert.equal(wallets.reduce((total, row) => total + row.points, 0), 60)
    assert.equal(await prisma.pointLog.count({ where: { businessKey: { startsWith: 'shun:' + doubled.id + ':' } } }), 6)
    assert.deepEqual(await shunTransaction((tx) => reconcileShunItemInventory(tx, sender.id)), [])
    assert.deepEqual(await shunTransaction((tx) => reconcileShunItemInventory(tx, target.id)), [])

    await setShunItemPending(sender.id, 'EXTRA_SUSPECT', randomUUID(), false)
    await prisma.shunItemPending.update({ where: { userId: sender.id }, data: { day: shunDay(new Date(now.getTime() - 86_400_000)) } })
    const restored = await shunItemBox(sender.id)
    assert.ok(restored.enabled && restored.items)
    assert.equal(restored.items.find(({ code }) => code === 'EXTRA_SUSPECT')?.available, 1)

    const trapVictim = await fixture(40)
    await setShunItemPending(sender.id, 'EXTRA_SUSPECT', randomUUID(), false)
    const trapped = await shunAttempt(sender.id, randomUUID())
    const golden = await shunCapture(trapVictim.id, trapped.id)
    assert.equal(golden.mode, 3)
    assert.equal(golden.candidates?.length, 3)
    const reread = await shunCapture(trapVictim.id, trapped.id)
    assert.deepEqual(reread.candidates, golden.candidates)
    await prisma.shunMasterRound.update({ where: { id: trapped.id }, data: { goldenUntil: new Date(Date.now() - 1000) } })
    await assert.rejects(shunCapture(trapVictim.id, trapped.id, { mode: 3, uid: sender.uid }), { code: 'MODE_CHANGED' })
    const normal = await shunCapture(trapVictim.id, trapped.id)
    assert.equal(normal.mode, 4)
    assert.equal(normal.candidates?.length, 4)

    const chosen = await fixture(30)
    const [left, right] = [sender.id, chosen.id].sort()
    await prisma.friendship.create({ data: { userAId: left, userBId: right } })
    await prisma.friendship.delete({ where: { userAId_userBId: { userAId: left, userBId: right } } })
    await assert.rejects(shunAttempt(sender.id, randomUUID(), undefined, chosen.id), { code: 'FRIEND_UNAVAILABLE' })
    await prisma.friendship.create({ data: { userAId: left, userBId: right } })
    const directed = await shunAttempt(sender.id, randomUUID(), undefined, chosen.id)
    assert.equal(directed.person?.uid, chosen.uid)
    assert.equal(await prisma.shunItemRoundEffect.count({ where: { roundId: directed.id, code: 'TARGET_FRIEND' } }), 1)
    assert.deepEqual(await shunTransaction((tx) => reconcileShunItemInventory(tx, sender.id)), [])
  } finally {
    if (previous === undefined) delete process.env.SHUN_ITEMS_ENABLED
    else process.env.SHUN_ITEMS_ENABLED = previous
    await prisma.$disconnect()
  }
})
