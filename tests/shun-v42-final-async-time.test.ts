import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { prisma } from '../lib/prisma'
import { createNotification } from '../lib/notification-write'
import { runMobilePushSweepOnce, type ExpoPushClient } from '../lib/mobile-push-sender'
import { lockShunItemUsers, postShunItemMovement } from '../lib/shun-item-inventory'
import { shunTransaction } from '../lib/shun-master'
import { shunDay } from '../lib/shun-master-rules'
import { runShunItemRewardSweep } from '../lib/shun-item-rewards'
import { getTodayTasks } from '../lib/growth-tasks/registry'

/**
 * V4.2 final acceptance — TIME-REWARD-REPLAY + NOTIFY-ASYNC-ACK.
 * Real isolated MySQL, real notification/push queues, injected async ACK
 * failures and frozen clock boundaries; no real push network calls.
 */
const OUTPUT = 'E:/Eason/build-cache/shun-items-mysql-5ccb45b9e9c64f89a994917e2540ad47'
const MYSQL = 'E:/Eason/build-cache/shun-items-mysql-5ccb45b9e9c64f89a994917e2540ad47/engine/bin/mysql.exe'
type User = { id: string }

async function evidence(id: string, scenario: string, before: unknown, after: unknown) {
  await appendFile(join(OUTPUT, 'async-time-verified.jsonl'), JSON.stringify({
    id, scenario, method: 'real MySQL + injected Expo push client + frozen day boundaries',
    before, after, result: 'PASS', logPath: join(OUTPUT, 'async-time-matrix.log'),
  }) + '\n')
  console.log(`PASS ${id}`)
}
const okClient: ExpoPushClient = async (endpoint, body) => {
  const messages = (body as { messages?: unknown[] }).messages ?? []
  return { data: endpoint.includes('receipt') ? {} : messages.map((_, index) => ({ status: 'ok', id: `ticket-${index}-${randomUUID()}` })) }
}
const failSend: ExpoPushClient = async () => { throw new Error('QA_SEND_ACK_LOST') }
const failReceipt: ExpoPushClient = async (endpoint, body) => {
  const messages = (body as { messages?: unknown[] }).messages ?? []
  if (/receipt/i.test(endpoint)) throw new Error('QA_RECEIPT_ACK_LOST')
  return { data: messages.map((_, index) => ({ status: 'ok', id: `ticket-${index}-${randomUUID()}` })) }
}
const unregisteredReceipt: ExpoPushClient = async (endpoint, body) => {
  const messages = (body as { messages?: unknown[] }).messages ?? []
  if (/receipt/i.test(endpoint)) {
    const ids = (body as { ids: string[] }).ids
    return { data: Object.fromEntries(ids.map((id) => [id, { status: 'error', details: { error: 'DeviceNotRegistered' } }])) }
  }
  return { data: messages.map((_, index) => ({ status: 'ok', id: `ticket-${index}-${randomUUID()}` })) }
}

test('V4.2 TIME-REWARD-REPLAY + NOTIFY-ASYNC-ACK matrix', {
  skip: process.env.SHUN_V42_ASYNC_TIME_QA !== '1',
  timeout: 600_000,
}, async () => {
  await mkdir(OUTPUT, { recursive: true })
  const url = new URL(process.env.DATABASE_URL ?? '')
  assert.equal(url.pathname, '/ecfc_shun_items_fixture_qa')
  const previousGate = process.env.SHUN_ITEMS_ENABLED
  const previousToken = process.env.EXPO_ACCESS_TOKEN
  process.env.SHUN_ITEMS_ENABLED = 'true'
  process.env.EXPO_ACCESS_TOKEN = 'qa-local-token'
  const mysqlClient = (sql: string) => execFileSync(MYSQL, [
    '--no-defaults', '--host=127.0.0.1', '--protocol=TCP', '--port=' + url.port,
    '--user=' + decodeURIComponent(url.username), 'ecfc_shun_items_fixture_qa',
  ], { input: sql, env: { ...process.env, MYSQL_PWD: decodeURIComponent(url.password) } })
  const fixture = async (points = 100) => {
    const nickname = 'V42Async-' + randomUUID().slice(0, 8)
    return prisma.user.create({ data: {
      username: nickname, usernameNormalized: nickname.toLowerCase(), nickname, passwordHash: 'fixture', points,
      Profile: { create: { displayName: nickname } },
    } })
  }
  const dueNow = async (key: string) => {
    // Isolate this fixture from earlier PENDING queues in the shared QA schema.
    await prisma.mobilePushDelivery.updateMany({
      where: { status: 'PENDING', dedupeKey: { not: `notif:${key}` } },
      data: { nextAttemptAt: new Date(Date.now() + 10 * 365 * 86_400_000) },
    })
    await prisma.mobilePushDelivery.update({
      where: { dedupeKey: `notif:${key}` }, data: { nextAttemptAt: new Date(0) },
    })
  }
  const queuePush = async (userId: string, key = 'shun:qa:' + randomUUID()) => {
    await createNotification({ data: { type: 'SYSTEM', recipientId: userId, title: 'QA 推送', content: 'QA 推送正文', key, link: '/shun-master' } })
    // Put this fixture at the head of the due queue (sweep batch is capped).
    await dueNow(key)
    return key
  }
  const addToken = async (user: User) => prisma.mobilePushToken.create({ data: {
    userId: user.id, expoPushToken: 'ExponentPushToken[' + randomUUID() + ']', platform: 'IOS',
  } })
  try {
    // TIME-01..04: exact Sunday/Monday boundary with notification write failure.
    {
      const user = await fixture()
      const tasks = getTodayTasks()
      const sundayAt = new Date('2026-11-22T15:59:59.999Z') // 2026-11-22 23:59:59.999 CST
      const mondayAt = new Date('2026-11-22T16:00:00.000Z') // 2026-11-23 00:00:00.000 CST
      assert.equal(shunDay(sundayAt), '2026-11-22')
      assert.equal(shunDay(mondayAt), '2026-11-23')
      const days = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22']
      // A day counts as completed only when every registered task is satisfied;
      // COMMENT_POST also needs positive point facts (mirrors existing fixtures).
      const completionsFor = (day: string, at: Date) => tasks.flatMap((task) =>
        Array.from({ length: task.dailyCap ?? task.completionThreshold ?? 1 }, (_, event) => ({
          userId: user.id, taskCode: task.code, periodKey: day, completedAt: at, createdAt: at,
          sourceEventId: `time-${user.id}-${day}-${task.code}-${event}`,
        })))
      const commentFactsFor = (day: string, at: Date, index: number) => Array.from({ length: 10 }, (_, event) => ({
        userId: user.id, action: 'COMMENT_POST' as const, points: 1,
        before: index * 10 + event, after: index * 10 + event + 1,
        dateKey: day, createdAt: at, businessKey: `time-comment-${user.id}-${day}-${event}`,
      }))
      await prisma.growthTaskCompletion.createMany({ data: [
        ...days.flatMap((day, index) => completionsFor(day, index === 6 ? sundayAt : new Date(day + 'T06:00:00.000Z'))),
        ...completionsFor('2026-11-23', mondayAt),
      ] })
      await prisma.pointLog.createMany({ data: [
        ...days.flatMap((day, index) => commentFactsFor(day, index === 6 ? sundayAt : new Date(day + 'T06:00:00.000Z'), index)),
        ...commentFactsFor('2026-11-23', mondayAt, 7),
      ] })
      const trigger = 'shun_time_ack_' + randomUUID().replaceAll('-', '')
      mysqlClient(`CREATE TRIGGER ${trigger} BEFORE INSERT ON Notification FOR EACH ROW SET NEW.id = IF(NEW.recipientId = '${user.id}', NULL, NEW.id)`)
      try {
        for (let sweep = 0; sweep < 3; sweep++) await runShunItemRewardSweep()
      } finally {
        mysqlClient(`DROP TRIGGER ${trigger}`)
      }
      const failed = await prisma.shunItemRewardEvent.findMany({ where: { userId: user.id, processedAt: null }, select: { attempts: true } })
      assert.ok(failed.length > 0 && failed.some(({ attempts }) => attempts > 0), 'notification failure must keep the reward event retryable')
      assert.equal(await prisma.shunItemEntry.count({ where: { userId: user.id } }), 0)
      await evidence('TIME-01', 'notification ACK failure leaves reward event retryable with no half-accounting', { entries: 0 }, { retryableEvents: failed.length })
      await prisma.shunItemRewardEvent.updateMany({ where: { userId: user.id, processedAt: null }, data: { retryAt: new Date(0) } })
      for (let sweep = 0; sweep < 12; sweep++) await runShunItemRewardSweep()
      const granted = await prisma.shunItemWeeklyGrant.findMany({ where: { userId: user.id }, orderBy: { milestone: 'asc' }, select: { weekStart: true, milestone: true } })
      assert.deepEqual(granted.map(({ milestone }) => milestone), [3, 5, 7])
      assert.ok(granted.every(({ weekStart }) => weekStart === '2026-11-16'))
      const dailies = await prisma.shunItemDaily.findMany({ where: { userId: user.id }, orderBy: { day: 'asc' }, select: { day: true, mainGranted: true } })
      assert.ok(dailies.some(({ day, mainGranted }) => day === '2026-11-22' && mainGranted), 'Sunday boundary day must grant')
      assert.ok(dailies.some(({ day, mainGranted }) => day === '2026-11-23' && mainGranted), 'Monday boundary day must grant')
      const entries = await prisma.shunItemEntry.count({ where: { userId: user.id } })
      assert.ok(entries >= dailies.filter(({ mainGranted }) => mainGranted).length + granted.length)
      await evidence('TIME-02', 'Sunday 23:59:59.999 and Monday 00:00:00.000 rewards settle in their own periods', { entries: 0 }, { entries, boundaryDays: dailies.filter(({ day }) => day === '2026-11-22' || day === '2026-11-23'), milestones: granted.map((g) => g.milestone) })
      // Drain all due events first (daily/community/weekly), then replay.
      for (let sweep = 0; sweep < 12; sweep++) await runShunItemRewardSweep()
      const stableEntries = await prisma.shunItemEntry.count({ where: { userId: user.id } })
      const stableWeekly = await prisma.shunItemWeeklyGrant.count({ where: { userId: user.id } })
      for (let sweep = 0; sweep < 6; sweep++) await runShunItemRewardSweep()
      assert.equal(await prisma.shunItemEntry.count({ where: { userId: user.id } }), stableEntries)
      assert.equal(await prisma.shunItemWeeklyGrant.count({ where: { userId: user.id } }), stableWeekly)
      assert.equal(stableWeekly, 3)
      await evidence('TIME-03', 'replay of committed daily, community and weekly rewards never double-grants', { entries }, { entries: stableEntries, weekly: stableWeekly })
      const config = await prisma.shunItemConfigVersion.findFirstOrThrow({ orderBy: { version: 'desc' } })
      await shunTransaction(async (tx) => {
        await lockShunItemUsers(tx, [user.id])
        for (const code of ['EXTRA_ATTEMPT'] as const) await postShunItemMovement(tx, {
          userId: user.id, code, type: 'DAILY_MAIN', day: shunDay(new Date()), requestKey: 'time-boundary-' + user.id, configVersion: config.version,
        })
      })
      const boundaryDays = await prisma.shunItemDaily.findMany({ where: { userId: user.id }, select: { day: true } })
      assert.ok(boundaryDays.some(({ day }) => day === '2026-11-22') && boundaryDays.some(({ day }) => day === '2026-11-23'))
      await evidence('TIME-04', 'daily quota rows remain separated across the exact midnight boundary', { days: 2 }, { days: boundaryDays.map((d) => d.day) })
    }
    // NOTIFY-01: send ACK failure keeps the delivery retryable, then recovers.
    {
      const user = await fixture()
      await addToken(user)
      const key = await queuePush(user.id)
      const before = await prisma.mobilePushDelivery.findUniqueOrThrow({ where: { dedupeKey: `notif:${key}` } })
      const first = await runMobilePushSweepOnce(new Date(), failSend)
      assert.equal(first.sent, 0)
      const pending = await prisma.mobilePushDelivery.findUniqueOrThrow({ where: { dedupeKey: `notif:${key}` } })
      assert.equal(pending.status, 'PENDING')
      assert.equal(pending.attempts, 1)
      assert.ok(pending.nextAttemptAt.getTime() > before.nextAttemptAt.getTime())
      await dueNow(key)
      const recovered = await runMobilePushSweepOnce(new Date(Date.now() + 3 * 86_400_000), okClient)
      assert.equal(recovered.sent, 1)
      const after = await prisma.mobilePushDelivery.findUniqueOrThrow({ where: { dedupeKey: `notif:${key}` } })
      assert.equal(after.status, 'SENT')
      assert.equal(await prisma.notification.count({ where: { recipientId: user.id } }), 1)
      await evidence('NOTIFY-01', 'async send ACK failure retries then recovers as SENT exactly once', before, { status: after.status, attempts: after.attempts })
    }
    // NOTIFY-02: receipt ACK lost is non-fatal and never re-sends.
    {
      const user = await fixture()
      await addToken(user)
      const key = await queuePush(user.id)
      const result = await runMobilePushSweepOnce(new Date(), failReceipt)
      assert.ok(result.sent >= 1)
      const delivery = await prisma.mobilePushDelivery.findUniqueOrThrow({ where: { dedupeKey: `notif:${key}` } })
      assert.equal(delivery.status, 'SENT')
      await dueNow(key)
      const replay = await runMobilePushSweepOnce(new Date(Date.now() + 86_400_000), okClient)
      const afterReplay = await prisma.mobilePushDelivery.findUniqueOrThrow({ where: { dedupeKey: `notif:${key}` } })
      assert.equal(afterReplay.status, 'SENT')
      assert.equal(afterReplay.attempts, delivery.attempts, 'replay must not resend an ACKed delivery')
      assert.equal(await prisma.mobilePushDelivery.count({ where: { dedupeKey: `notif:${key}` } }), 1)
      await evidence('NOTIFY-02', 'lost async receipt ACK leaves delivery SENT with no duplicate send', { status: 'PENDING' }, { status: delivery.status, replaySent: replay.sent })
    }
    // NOTIFY-03: ACK lost then process restart equivalent — delivery row is
    // reset to PENDING, the next sweep updates the same dedupe row only.
    {
      const user = await fixture()
      await addToken(user)
      const key = await queuePush(user.id)
      await runMobilePushSweepOnce(new Date(), okClient)
      const original = await prisma.mobilePushDelivery.findUniqueOrThrow({ where: { dedupeKey: `notif:${key}` } })
      await prisma.mobilePushDelivery.update({ where: { id: original.id }, data: { status: 'PENDING', nextAttemptAt: new Date(0) } })
      await dueNow(key)
      await runMobilePushSweepOnce(new Date(), okClient)
      const after = await prisma.mobilePushDelivery.findUniqueOrThrow({ where: { dedupeKey: `notif:${key}` } })
      assert.equal(after.id, original.id)
      assert.equal(after.status, 'SENT')
      assert.equal(await prisma.mobilePushDelivery.count({ where: { userId: user.id } }), 1)
      await evidence('NOTIFY-03', 'ACK lost across process restart requeues same dedupe row, no second notification', { deliveryId: original.id }, { deliveryId: after.id, status: after.status })
    }
    // NOTIFY-04: no active token yields SKIPPED without burning attempts.
    {
      const user = await fixture()
      const key = await queuePush(user.id)
      const result = await runMobilePushSweepOnce(new Date(), okClient)
      assert.ok(result.skipped >= 1)
      const delivery = await prisma.mobilePushDelivery.findUniqueOrThrow({ where: { dedupeKey: `notif:${key}` } })
      assert.equal(delivery.status, 'SKIPPED')
      assert.equal(delivery.attempts, 0)
      await evidence('NOTIFY-04', 'missing device token skips push without consuming retry attempts', { status: 'PENDING' }, { status: delivery.status, attempts: delivery.attempts })
    }
    // NOTIFY-05: DeviceNotRegistered receipt disables the token, delivery SENT.
    {
      const user = await fixture()
      const token = await addToken(user)
      const key = await queuePush(user.id)
      const result = await runMobilePushSweepOnce(new Date(), unregisteredReceipt)
      assert.ok(result.sent >= 1)
      assert.equal((await prisma.mobilePushToken.findUniqueOrThrow({ where: { id: token.id } })).status, 'DISABLED')
      assert.equal((await prisma.mobilePushDelivery.findUniqueOrThrow({ where: { dedupeKey: `notif:${key}` } })).status, 'SENT')
      await evidence('NOTIFY-05', 'DeviceNotRegistered async receipt disables token without failing business settlement', { token: 'ACTIVE' }, { token: 'DISABLED', delivery: 'SENT' })
    }
    // NOTIFY-06: repeated ACK failures end FAILED after the retry ceiling.
    {
      const user = await fixture()
      await addToken(user)
      const key = await queuePush(user.id)
      for (let attempt = 0; attempt < 5; attempt++) {
        await dueNow(key)
        await runMobilePushSweepOnce(new Date(Date.now() + (attempt + 1) * 86_400_000), failSend)
      }
      const delivery = await prisma.mobilePushDelivery.findUniqueOrThrow({ where: { dedupeKey: `notif:${key}` } })
      assert.equal(delivery.status, 'FAILED')
      assert.equal(delivery.attempts, 5)
      await evidence('NOTIFY-06', 'five consecutive async ACK failures terminate at FAILED', { status: 'PENDING' }, { status: delivery.status, attempts: delivery.attempts })
    }
    // NOTIFY-07: duplicate notification key cannot queue a second push.
    {
      const user = await fixture()
      await addToken(user)
      const key = 'shun:qa:dedupe:' + randomUUID()
      await queuePush(user.id, key)
      await assert.rejects(queuePush(user.id, key))
      await runMobilePushSweepOnce(new Date(), okClient)
      assert.equal(await prisma.notification.count({ where: { recipientId: user.id } }), 1)
      assert.equal(await prisma.mobilePushDelivery.count({ where: { userId: user.id } }), 1)
      await evidence('NOTIFY-07', 'same notification key replays through async ACK with one queued delivery', { attempts: 2 }, { notifications: 1, deliveries: 1 })
    }
  } finally {
    if (previousGate === undefined) delete process.env.SHUN_ITEMS_ENABLED
    else process.env.SHUN_ITEMS_ENABLED = previousGate
    if (previousToken === undefined) delete process.env.EXPO_ACCESS_TOKEN
    else process.env.EXPO_ACCESS_TOKEN = previousToken
    await prisma.$disconnect()
  }
})
