import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { prisma } from '../lib/prisma'
import { defaultShunItemDefinitions, defaultShunItemRules } from '../lib/shun-item-config'
import { lockShunItemUsers, postShunItemMovement, reconcileShunItemInventory } from '../lib/shun-item-inventory'
import { sendShunItemGift, setShunEnabled, shunStatus, shunTransaction, updateShunConfig, useShunExtraAttempt } from '../lib/shun-master'
import { defaultShunConfig, shunDay } from '../lib/shun-master-rules'

test('V4.2 isolated MySQL inventory, retry idempotency and randomized friend gift caps', {
  skip: process.env.SHUN_ITEMS_MYSQL_QA !== '1',
  timeout: 120_000,
}, async () => {
  const url = new URL(process.env.DATABASE_URL ?? '')
  assert.equal(url.protocol, 'mysql:')
  assert.equal(url.hostname, '127.0.0.1')
  assert.equal(url.pathname, '/ecfc_shun_items_qa')
  assert.equal(await prisma.shunMasterRound.count(), 0, 'run on a freshly migrated isolated fixture')
  assert.equal(await prisma.shunItemConfigVersion.count(), 0)
  const previous = process.env.SHUN_ITEMS_ENABLED
  process.env.SHUN_ITEMS_ENABLED = 'true'
  const now = new Date()
  const day = shunDay(now)
  const fixture = async () => {
    const name = 'shun-item-' + randomUUID()
    return prisma.user.create({ data: {
      username: name, usernameNormalized: name, nickname: name, passwordHash: 'fixture',
      Profile: { create: { displayName: name } },
    } })
  }
  try {
    const [sender, receiver, blocked, unrelated] = await Promise.all([fixture(), fixture(), fixture(), fixture()])
    const config = await prisma.shunItemConfigVersion.create({ data: {
      createdBy: sender.id, enabled: true, rules: defaultShunItemRules,
      definitions: { create: defaultShunItemDefinitions },
    } })
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
      useShunExtraAttempt(sender.id, extraRequest, () => now)))
    assert.deepEqual(applied, Array.from({ length: 3 }, () => ({ applied: true, day })))
    const more = await Promise.allSettled(Array.from({ length: 3 }, () =>
      useShunExtraAttempt(sender.id, randomUUID(), () => now)))
    assert.equal(more.filter((result) => result.status === 'fulfilled').length, 1)
    assert.equal((await shunStatus(sender.id)).remaining, 9)
    assert.equal(await prisma.shunItemEntry.count({ where: { userId: sender.id, type: 'USED' } }), 2)

    assert.deepEqual(await shunTransaction((tx) => reconcileShunItemInventory(tx, receiver.id)), [])
    assert.deepEqual(await shunTransaction((tx) => reconcileShunItemInventory(tx, sender.id)), [])
    assert.equal(await prisma.pointLog.count({ where: { userId: { in: [sender.id, receiver.id, blocked.id, unrelated.id] } } }), 0)
  } finally {
    if (previous === undefined) delete process.env.SHUN_ITEMS_ENABLED
    else process.env.SHUN_ITEMS_ENABLED = previous
    await prisma.$disconnect()
  }
})
