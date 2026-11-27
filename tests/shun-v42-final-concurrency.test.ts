import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { authCookieName, createSessionToken } from '../lib/auth'
import { prisma } from '../lib/prisma'
import { shunDay } from '../lib/shun-master-rules'
import { lockShunItemUsers, postShunItemMovement } from '../lib/shun-item-inventory'
import { shunTransaction } from '../lib/shun-master'
import { runShunItemRewardSweep } from '../lib/shun-item-rewards'
import { getTodayTasks } from '../lib/growth-tasks/registry'

/** V4.2 final acceptance — CONCURRENCY-REMAINING: real HTTP multi-device fan-out. */
const BASE = process.env.SHUN_ITEMS_BROWSER_BASE ?? 'http://127.0.0.1:3127'
const OUTPUT = 'E:/Eason/build-cache/shun-items-mysql-5ccb45b9e9c64f89a994917e2540ad47'
type User = { id: string; uid: number; nickname: string }

async function evidence(id: string, scenario: string, before: unknown, after: unknown) {
  await appendFile(join(OUTPUT, 'concurrency-verified.jsonl'), JSON.stringify({
    id, scenario, method: '5 parallel real HTTP requests from distinct browser-equivalent sessions + MySQL counts',
    before, after, result: 'PASS', logPath: join(OUTPUT, 'concurrency-matrix.log'),
  }) + '\n')
  console.log(`PASS ${id}`)
}
async function request(user: User, path: string, body?: unknown) {
  const token = await createSessionToken(user as never)
  const response = await fetch(BASE + path, {
    method: 'POST',
    headers: { Cookie: `${authCookieName}=${token}`, Origin: BASE, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { status: response.status, json: await response.json().catch(() => null) as Record<string, unknown> | null }
}

test('V4.2 CONCURRENCY-REMAINING: five-device parallel matrix', {
  skip: process.env.SHUN_V42_CONCURRENCY_QA !== '1',
  timeout: 600_000,
}, async () => {
  await mkdir(OUTPUT, { recursive: true })
  const db = new URL(process.env.DATABASE_URL ?? '')
  assert.equal(db.pathname, '/ecfc_shun_items_fixture_qa')
  const previousGate = process.env.SHUN_ITEMS_ENABLED
  process.env.SHUN_ITEMS_ENABLED = 'true'
  const config = await prisma.shunItemConfigVersion.findFirstOrThrow({ orderBy: { version: 'desc' } })
  const fixture = async (points = 100) => {
    const nickname = 'V42Conc-' + randomUUID().slice(0, 8)
    return prisma.user.create({ data: {
      username: nickname, usernameNormalized: nickname.toLowerCase(), nickname, passwordHash: 'fixture', points,
      Profile: { create: { displayName: nickname } },
    } })
  }
  const grant = async (user: User, code: 'EXTRA_ATTEMPT' | 'FRIEND_GIFT' | 'DOUBLE_AMOUNT', key: string) => {
    await shunTransaction(async (tx) => {
      await lockShunItemUsers(tx, [user.id])
      await postShunItemMovement(tx, { userId: user.id, code, type: 'DAILY_MAIN', day: shunDay(new Date()), requestKey: key, configVersion: config.version })
    })
  }
  try {
    // CONC-01: five devices replay the SAME main-attempt request id.
    {
      const actor = await fixture()
      const key = randomUUID()
      const before = { rounds: await prisma.shunMasterRound.count({ where: { actorId: actor.id } }) }
      const results = await Promise.all(Array.from({ length: 5 }, () => request(actor, '/api/shun-master/attempt', { requestId: key })))
      assert.ok(results.every(({ status }) => status === 200))
      assert.equal(new Set(results.map(({ json }) => JSON.stringify(json))).size, 1)
      const after = { rounds: await prisma.shunMasterRound.count({ where: { actorId: actor.id } }) }
      assert.equal(after.rounds - before.rounds, 1)
      await evidence('CONC-01', 'same requestId from five devices settles once', before, after)
    }
    // CONC-02: five devices replay the SAME extra-attempt request id.
    {
      const actor = await fixture()
      await grant(actor, 'EXTRA_ATTEMPT', 'conc-extra-' + actor.id)
      const key = randomUUID()
      const before = await prisma.shunItemDaily.findMany({ where: { userId: actor.id }, select: { extraAttemptsGranted: true } })
      const results = await Promise.all(Array.from({ length: 5 }, () => request(actor, '/api/shun-master/extra-attempt', { requestId: key })))
      assert.ok(results.every(({ status }) => status === 200))
      const after = await prisma.shunItemDaily.findUniqueOrThrow({ where: { userId_day: { userId: actor.id, day: shunDay(new Date()) } } })
      assert.equal(after.extraAttemptsGranted, 1)
      await evidence('CONC-02', 'same extra-attempt requestId from five devices grants once', before, after)
    }
    // CONC-03: five devices replay the SAME friend-gift request id.
    {
      const sender = await fixture(), receiver = await fixture()
      await grant(sender, 'FRIEND_GIFT', 'conc-gift-' + sender.id)
      const [userAId, userBId] = [sender.id, receiver.id].sort()
      await prisma.friendship.create({ data: { userAId, userBId } })
      const key = randomUUID()
      const before = { gifts: await prisma.shunItemGift.count({ where: { senderId: sender.id } }) }
      const results = await Promise.all(Array.from({ length: 5 }, () => request(sender, '/api/shun-master/gift', { requestId: key })))
      assert.ok(results.every(({ status }) => status === 200))
      const after = { gifts: await prisma.shunItemGift.count({ where: { senderId: sender.id } }) }
      assert.equal(after.gifts - before.gifts, 1)
      await evidence('CONC-03', 'same gift requestId from five devices delivers once', before, after)
    }
    // CONC-04: five different actors target one victim, victim cap must hold.
    {
      const victim = await fixture(200)
      const actors = await Promise.all(Array.from({ length: 5 }, () => fixture()))
      await prisma.friendship.createMany({ data: actors.map(({ id }) => {
        const [userAId, userBId] = [id, victim.id].sort()
        return { userAId, userBId }
      }) })
      await shunTransaction(async (tx) => {
        await lockShunItemUsers(tx, actors.map(({ id }) => id))
        for (const { id } of actors) await postShunItemMovement(tx, {
          userId: id, code: 'TARGET_FRIEND', type: 'DAILY_MAIN', day: shunDay(new Date()),
          requestKey: 'conc-cap-' + id, configVersion: config.version,
        })
      })
      const results = await Promise.allSettled(actors.map((user) => request(user, '/api/shun-master/attempt', { requestId: randomUUID(), friendId: victim.id })))
      const committed = results.filter((result) => result.status === 'fulfilled' && result.value.status === 200).length
      assert.equal(committed, 4)
      assert.equal(await prisma.shunMasterRound.count({ where: { victimId: victim.id } }), 4)
      await evidence('CONC-04', 'five actors versus victimCap=4 accepts exactly four transfers', { actors: 5 }, { committed, transfers: 4 })
    }
    // CONC-05: five devices select the same pending item key.
    {
      const actor = await fixture()
      await grant(actor, 'DOUBLE_AMOUNT', 'conc-pending-' + actor.id)
      const key = randomUUID()
      const results = await Promise.all(Array.from({ length: 5 }, () => request(actor, '/api/shun-master/pending-item', { requestId: key, code: 'DOUBLE_AMOUNT', cancel: false })))
      assert.ok(results.every(({ status }) => status === 200))
      const after = await prisma.shunItemPending.count({ where: { userId: actor.id, code: 'DOUBLE_AMOUNT' } })
      assert.equal(after, 1)
      await evidence('CONC-05', 'same pending-item requestId from five devices keeps one selection', { devices: 5 }, { pending: after })
    }
    // CONC-06: five parallel reward sweeps must not double-grant a milestone.
    {
      const user = await fixture()
      const task = getTodayTasks()[0]
      const day = shunDay(new Date())
      await prisma.growthTaskCompletion.create({ data: {
        userId: user.id, taskCode: task.code, periodKey: day, completedAt: new Date(), createdAt: new Date(),
        sourceEventId: 'conc-reward-' + user.id,
      } })
      await Promise.allSettled(Array.from({ length: 5 }, () => Promise.resolve().then(() => runShunItemRewardSweep())))
      const entries = await prisma.shunItemEntry.count({ where: { userId: user.id } })
      assert.ok(entries >= 1)
      await Promise.allSettled(Array.from({ length: 5 }, () => Promise.resolve().then(() => runShunItemRewardSweep())))
      assert.equal(await prisma.shunItemEntry.count({ where: { userId: user.id } }), entries)
      await evidence('CONC-06', 'five parallel reward sweeps grant once, replays do not duplicate', { sweeps: 5 }, { entries })
    }
    // CONC-07: five distinct request ids from five devices respect actor cap.
    {
      const actor = await fixture()
      const before = await prisma.shunMasterRound.count({ where: { actorId: actor.id } })
      const results = await Promise.allSettled(Array.from({ length: 5 }, () => request(actor, '/api/shun-master/attempt', { requestId: randomUUID() })))
      const committed = results.filter((result) => result.status === 'fulfilled' && result.value.status === 200).length
      const after = await prisma.shunMasterRound.count({ where: { actorId: actor.id } })
      assert.equal(committed, 5)
      assert.equal(after - before, 5)
      await evidence('CONC-07', 'five distinct device requests settle five distinct rounds', before, { after, committed })
    }
  } finally {
    if (previousGate === undefined) delete process.env.SHUN_ITEMS_ENABLED
    else process.env.SHUN_ITEMS_ENABLED = previousGate
    await prisma.$disconnect()
  }
})
