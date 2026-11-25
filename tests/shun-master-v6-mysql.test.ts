import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { prisma } from '../lib/prisma'
import {
  ShunError, setShunEnabled, shunAttempt, shunCapture, shunPermanentOptOut, shunRecords,
  shunSendCaptureNotification, shunSendNotification, shunStatus, updateShunConfig,
} from '../lib/shun-master'
import { runShunNotifySweepOnce } from '../lib/shun-notify-worker'
import { defaultShunConfig, type ShunConfig } from '../lib/shun-master-rules'
import { beijingMinuteOfDay, formatShunClock, isShunOpen, type ShunOpenHoursConfig } from '../lib/shun-open-hours'

/**
 * Isolated-MySQL acceptance for V6 (daily opening hours).
 *
 * Proves the parts that source assertions cannot: the settlement gate really
 * rejects a closed request without writing anything, the four published
 * boundaries behave exactly as written, cross-midnight windows work, a disabled
 * restriction restores round-the-clock takes, and every historical right
 * (capture, recovery, counter note, notification, records, opt-out) keeps
 * working while the window is closed.
 *
 * Time is injected into `shunAttempt` — never taken from the machine clock —
 * so the boundaries are reproducible at any hour of the day.
 *
 * Skipped unless `SHUN_V6_MYSQL_QA=1` is set explicitly.
 */

const qa = process.env.SHUN_V6_MYSQL_QA === '1'
const shunTests = qa ? test : test.skip

function assertIsolatedFixture() {
  const url = new URL(process.env.DATABASE_URL || '')
  assert.equal(url.protocol, 'mysql:')
  assert.equal(url.hostname, '127.0.0.1')
  assert.equal(url.pathname, '/ecfc_shun_match_qa')
}

const baseConfig: ShunConfig = {
  ...defaultShunConfig,
  // Off by default here: the window is switched on explicitly by the cases that
  // exercise it, and every other case must not depend on the wall clock.
  openHoursEnabled: false,
  attempts: 7, victimCap: 20, goldenMinutes: 10,
  weights: [100, 100, 100, 100, 100], friendChance: 0, bonusChance: 0,
}

let operatorId = ''

/** Beijing wall clock → the UTC instant the service would see. */
const beijing = (iso: string) => new Date(iso.replace(' ', 'T') + '+08:00')
/** Frozen server clock for one call. */
const at = (iso: string) => () => beijing(iso)
const isClosedError = (error: unknown) =>
  error instanceof ShunError && error.code === 'SHUN_CLOSED'

function createUser(points = 0) {
  const name = 'shun-v6-' + randomUUID()
  return prisma.user.create({ data: {
    username: name, usernameNormalized: name, nickname: name,
    email: `${name}@example.invalid`, emailVerifiedAt: new Date(), points, passwordHash: 'fixture',
    Profile: { create: { displayName: name } },
  } })
}

async function bulkUsers(count: number) {
  const ids = Array.from({ length: count }, () => 'shun-v6-' + randomUUID())
  await prisma.user.createMany({ data: ids.map((id) => ({
    id, username: id, usernameNormalized: id, nickname: id, passwordHash: 'fixture', points: 0,
  })) })
  await prisma.profile.createMany({ data: ids.map((id) => ({ userId: id, displayName: id })) })
  return ids
}

async function publish(overrides: Partial<ShunConfig> = {}) {
  await updateShunConfig(operatorId, { ...baseConfig, ...overrides })
  await setShunEnabled(operatorId, true)
}

async function ensureSettings() {
  await prisma.shunMasterSettings.upsert({
    where: { id: 1 }, update: {}, create: { id: 1, config: { ...defaultShunConfig } },
  })
  const operator = await createUser(0)
  operatorId = operator.id
  await publish()
}

/**
 * One take fixture: a funded victim (the only possible target), an unfunded
 * actor and six unfunded fillers that can appear as decoys. Every pre-existing
 * account is protected so it can never be drawn.
 */
async function stageTake(overrides: Partial<ShunConfig> = {}, clock?: () => Date) {
  await prisma.shunMasterProtection.deleteMany({})
  await publish(overrides)
  const [actor, victim] = [await createUser(0), await createUser(60)]
  const fillers = await bulkUsers(6)
  const keep = [actor.id, victim.id, ...fillers]
  const outsiders = await prisma.user.findMany({ where: { id: { notIn: keep } }, select: { id: true } })
  await prisma.shunMasterProtection.createMany({
    data: outsiders.map(({ id }) => ({ userId: id, protected: true })), skipDuplicates: true,
  })
  const round = await shunAttempt(actor.id, randomUUID(), clock)
  return { actor, victim, round, baseline: 60 }
}

/** A window that is guaranteed closed right now, derived from the real clock. */
function closedWindowNow(): ShunOpenHoursConfig {
  const minute = beijingMinuteOfDay(new Date())
  const openTime = formatShunClock((minute + 60) % 1440)
  const closeTime = formatShunClock((minute + 120) % 1440)
  const window = { openHoursEnabled: true, openTime, closeTime }
  assert.equal(isShunOpen(window, new Date()), false, '夹具必须构造一个当前关闭的窗口')
  return window
}

async function writeCounts() {
  const [rounds, ledger, notices, logs] = await Promise.all([
    prisma.shunMasterRound.count(), prisma.pointLog.count(),
    prisma.notification.count(), prisma.userOperationLog.count(),
  ])
  const settings = await prisma.shunMasterSettings.findUniqueOrThrow({ where: { id: 1 }, select: { reserved: true } })
  return { rounds, ledger, notices, logs, reserved: settings.reserved }
}

async function pointsOf(userId: string) {
  return (await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { points: true } })).points
}

shunTests('V6 MySQL fixture is isolated', async () => {
  assertIsolatedFixture()
  await prisma.shunMasterProtection.deleteMany({})
  await prisma.shunMasterCaptureLetter.deleteMany({})
  await prisma.shunMasterAnonymousLetter.deleteMany({})
  await ensureSettings()
  // Writing the published defaults back must be accepted and stored verbatim:
  // that is exactly what a fresh installation (and a legacy row) ends up with.
  await updateShunConfig(operatorId, { ...defaultShunConfig })
  const config = (await prisma.shunMasterSettings.findUniqueOrThrow({ where: { id: 1 } })).config as ShunConfig
  assert.equal(config.openHoursEnabled, true, '默认配置必须开启开放时间限制')
  assert.equal(config.openTime, '09:00')
  assert.equal(config.closeTime, '23:00')
  assert.equal((await shunStatus(operatorId)).openHours.label, '09:00–23:00', '状态快照必须与存储配置一致')
})

shunTests('北京时间 08:59:59 拒绝顺取，且不产生任何流水、次数或准备金变化', async () => {
  // A window that contains 09:00–23:00, so only the clock decides the outcome.
  await prisma.shunMasterProtection.deleteMany({})
  await publish({ openHoursEnabled: true, openTime: '09:00', closeTime: '23:00' })
  const actor = await createUser(0)
  await createUser(60)
  const before = await writeCounts()
  const beforePoints = await pointsOf(actor.id)
  await assert.rejects(() => shunAttempt(actor.id, randomUUID(), at('2026-11-26 08:59:59')), (error: unknown) => {
    assert.ok(isClosedError(error), '必须以 SHUN_CLOSED 拒绝')
    const details = (error as ShunError).details as { openHours: Record<string, unknown> } | undefined
    assert.ok(details?.openHours, '拒绝必须携带开放时间详情')
    assert.equal(details!.openHours.open, false)
    assert.equal(details!.openHours.openHoursEnabled, true)
    assert.equal(details!.openHours.openTime, '09:00')
    assert.equal(details!.openHours.closeTime, '23:00')
    assert.equal(details!.openHours.label, '09:00–23:00')
    assert.equal(details!.openHours.nextOpenAt, beijing('2026-11-26 09:00:00').toISOString())
    assert.match((error as ShunError).message, /早睡联盟/)
    assert.match((error as ShunError).message, /请在早上 9:00 后再来/)
    return true
  })
  assert.deepEqual(await writeCounts(), before, '关闭时段不得写入对局、流水、通知或审计')
  assert.equal(await pointsOf(actor.id), beforePoints)
  const status = await shunStatus(actor.id)
  // Whatever the real hour is, the injected request left the day untouched.
  assert.equal(status.balance, beforePoints)
})

shunTests('北京时间 09:00:00 与 22:59:59 允许顺取，23:00:00 与次日之前拒绝', async () => {
  const open = { openHoursEnabled: true, openTime: '09:00', closeTime: '23:00' }

  const early = await stageTake(open, at('2026-11-26 09:00:00'))
  assert.equal(early.round.amount > 0, true, '09:00:00 必须放行并真实结算')
  assert.equal(await pointsOf(early.victim.id), 60 - early.round.amount)

  const late = await stageTake(open, at('2026-11-26 22:59:59'))
  assert.equal(late.round.amount > 0, true, '22:59:59 必须放行')

  // 23:00:00 is the first closed instant of the same day.
  await prisma.shunMasterProtection.deleteMany({})
  await publish(open)
  const actor = await createUser(0)
  await createUser(60)
  const beforeClose = await writeCounts()
  await assert.rejects(() => shunAttempt(actor.id, randomUUID(), at('2026-11-26 23:00:00')), isClosedError)
  assert.deepEqual(await writeCounts(), beforeClose)

  // 次日 09:00 恢复开放.
  const nextDay = await stageTake(open, at('2026-11-27 09:00:00'))
  assert.equal(nextDay.round.amount > 0, true, '次日 09:00:00 必须恢复开放')
})

shunTests('跨午夜时段 22:00–02:00 按北京时间正确判断', async () => {
  const overnight = { openHoursEnabled: true, openTime: '22:00', closeTime: '02:00' }
  const night = await stageTake(overnight, at('2026-11-26 23:30:00'))
  assert.equal(night.round.amount > 0, true, '23:30 属于 22:00–02:00')
  const smallHours = await stageTake(overnight, at('2026-11-27 01:30:00'))
  assert.equal(smallHours.round.amount > 0, true, '01:30 仍属于跨午夜时段')

  await prisma.shunMasterProtection.deleteMany({})
  await publish(overnight)
  const actor = await createUser(0)
  await createUser(60)
  await assert.rejects(() => shunAttempt(actor.id, randomUUID(), at('2026-11-27 02:00:00')), isClosedError)
  await assert.rejects(() => shunAttempt(actor.id, randomUUID(), at('2026-11-27 21:59:59')), isClosedError)
})

shunTests('关闭开放时间限制后 03:00 也可以顺取，原有次数限制继续有效', async () => {
  const anyHour = await stageTake({ openHoursEnabled: false, attempts: 1 }, at('2026-11-26 03:00:00'))
  assert.equal(anyHour.round.amount > 0, true, '关闭限制后必须全天可顺取')
  // The daily attempt cap is untouched by the window.
  await assert.rejects(() => shunAttempt(anyHour.actor.id, randomUUID(), at('2026-11-26 03:00:01')),
    (error: unknown) => error instanceof ShunError && error.code === 'LIMIT')
})

shunTests('关闭时段被拒绝时不消耗每日次数', async () => {
  await prisma.shunMasterProtection.deleteMany({})
  const window = { openHoursEnabled: true, openTime: '09:00', closeTime: '23:00' }
  await publish({ ...window, attempts: 1 })
  const actor = await createUser(0)
  const victim = await createUser(60)
  const fillers = await bulkUsers(6)
  const keep = [actor.id, victim.id, ...fillers]
  const outsiders = await prisma.user.findMany({ where: { id: { notIn: keep } }, select: { id: true } })
  await prisma.shunMasterProtection.createMany({
    data: outsiders.map(({ id }) => ({ userId: id, protected: true })), skipDuplicates: true,
  })
  await assert.rejects(() => shunAttempt(actor.id, randomUUID(), at('2026-11-26 07:00:00')), isClosedError)
  assert.equal(await prisma.shunMasterRound.count({ where: { actorId: actor.id } }), 0, '拒绝不得留下对局')
  // The single daily attempt is still available once the window opens.
  const allowed = await shunAttempt(actor.id, randomUUID(), at('2026-11-26 09:30:00'))
  assert.ok(allowed.amount > 0)
  await assert.rejects(() => shunAttempt(actor.id, randomUUID(), at('2026-11-26 10:30:00')),
    (error: unknown) => error instanceof ShunError && error.code === 'LIMIT')
})

shunTests('后台修改开放时间后立即生效，前台与服务端读同一份配置', async () => {
  const operatorBefore = operatorId
  await updateShunConfig(operatorBefore, { ...baseConfig, openHoursEnabled: true, openTime: '10:00', closeTime: '22:00' })
  const stored = (await prisma.shunMasterSettings.findUniqueOrThrow({ where: { id: 1 } })).config as ShunConfig
  assert.equal(stored.openTime, '10:00')
  assert.equal(stored.closeTime, '22:00')
  assert.equal(stored.openHoursEnabled, true)
  // The player status snapshot is derived from that very row.
  const actor = await createUser(0)
  const status = await shunStatus(actor.id)
  assert.equal(status.openHours.openTime, '10:00')
  assert.equal(status.openHours.closeTime, '22:00')
  assert.equal(status.openHours.label, '10:00–22:00')
  // 09:30 is inside the old window and outside the new one.
  await assert.rejects(() => shunAttempt(actor.id, randomUUID(), at('2026-11-26 09:30:00')), isClosedError)
  // ...and 10:30 is now allowed, so the change is live without a redeploy.
  const allowed = await shunAttempt(actor.id, randomUUID(), at('2026-11-26 10:30:00'))
  assert.ok(allowed.amount > 0)
  await publish()
})

shunTests('23:00 后仍可抓捕调查、追回挂号费、发送反击留言并收到通知', async () => {
  // Take while open, then close the window for everything that follows.
  const fx = await stageTake({ openHoursEnabled: false })
  await publish({ ...closedWindowNow(), bonusChance: 0 })
  assert.equal((await shunStatus(fx.victim.id)).openHours.open, false, '后续步骤必须发生在休息时段')

  // Records stay readable while closed.
  const records = await shunRecords(fx.victim.id, 'in')
  assert.ok(records.records.some((row) => row.id === fx.round.id), '休息时段必须能查看历史记录')

  // Capture (two-choice golden window) settles normally.
  const detail = await shunCapture(fx.victim.id, fx.round.id) as unknown as {
    candidates: Array<{ uid: number; nickname: string }> }
  assert.ok(Array.isArray(detail.candidates))
  const settled = await shunCapture(fx.victim.id, fx.round.id, { mode: 2, uid: fx.actor.uid }) as unknown as {
    record: { result: string; recovered: number } }
  assert.equal(settled.record.result, 'SUCCESS', '休息时段必须能完成抓捕')
  assert.equal(settled.record.recovered, fx.round.amount)
  assert.equal(await pointsOf(fx.victim.id), fx.baseline, '追回必须真实入账')

  // The counter note still sends and still notifies the caught actor.
  const note = await shunSendCaptureNotification(fx.victim.id, fx.round.id, '休息时段也可以留言')
  assert.equal(note.status, 'SENT_LETTER')
  assert.equal(await prisma.shunMasterCaptureLetter.count({ where: { roundId: fx.round.id } }), 1)
  assert.equal(await prisma.notification.count({ where: { recipientId: fx.actor.id } }), 1)

  // A second, plain take-notification path also works while closed.
  const plain = await stageTake({ openHoursEnabled: false })
  await publish({ ...closedWindowNow(), bonusChance: 0 })
  const sent = await shunSendNotification(plain.actor.id, plain.round.id, null)
  assert.equal(sent.status, 'SENT_PLAIN')
  assert.equal(await prisma.notification.count({ where: { recipientId: plain.victim.id } }), 1)
})

shunTests('休息时段的 120 秒通知兜底照常运行', async () => {
  await prisma.shunMasterProtection.deleteMany({})
  const fx = await stageTake({ openHoursEnabled: false })
  await publish({ ...closedWindowNow() })
  // The round is pending; the sweeper is due immediately in this fixture.
  await prisma.shunMasterRound.update({ where: { id: fx.round.id }, data: { notifyDueAt: new Date(0) } })
  const sweep = await runShunNotifySweepOnce(new Date())
  assert.equal(sweep.failed, 0)
  assert.ok(sweep.delivered >= 1, '休息时段通知 Worker 必须照常投递')
  const round = await prisma.shunMasterRound.findUniqueOrThrow({ where: { id: fx.round.id } })
  assert.equal(round.notifyStatus, 'SENT_PLAIN')
  assert.equal(await prisma.notification.count({ where: { recipientId: fx.victim.id } }), 1)
})

shunTests('永久退出在休息时段照常可用，历史进度保留', async () => {
  const fx = await stageTake({ openHoursEnabled: false })
  await publish({ ...closedWindowNow() })
  const optedOut = await shunPermanentOptOut(fx.actor.id)
  assert.equal(optedOut.optedOut, true)
  assert.ok(await prisma.shunMasterRound.count({ where: { actorId: fx.actor.id } }), '退出不清除历史记录')
  // The exit path is a take-blocker of its own; the window must not mask it as
  // a closed-hours rejection for an already-exited account.
  await publish({ openHoursEnabled: false })
  await assert.rejects(() => shunAttempt(fx.actor.id, randomUUID()),
    (error: unknown) => error instanceof ShunError && error.code === 'OPTED_OUT')
})

shunTests('同一 requestId 在休息时段重放不会重复结算', async () => {
  await prisma.shunMasterProtection.deleteMany({})
  await publish({ openHoursEnabled: false })
  const [actor, victim] = [await createUser(0), await createUser(60)]
  const fillers = await bulkUsers(6)
  const keep = [actor.id, victim.id, ...fillers]
  const outsiders = await prisma.user.findMany({ where: { id: { notIn: keep } }, select: { id: true } })
  await prisma.shunMasterProtection.createMany({
    data: outsiders.map(({ id }) => ({ userId: id, protected: true })), skipDuplicates: true,
  })
  const requestId = randomUUID()
  const first = await shunAttempt(actor.id, requestId)
  // Close the window: a replay of the settled request must still return the
  // original round instead of a closed-hours rejection.
  await publish({ ...closedWindowNow() })
  const replay = await shunAttempt(actor.id, requestId)
  assert.equal(replay.id, first.id)
  assert.equal(await prisma.shunMasterRound.count({ where: { actorId: actor.id, requestId } }), 1)
  assert.equal(await prisma.pointLog.count({ where: { businessKey: { contains: first.id } } }), 2)
  assert.equal(await pointsOf(victim.id), 60 - first.amount, '重放不得再次扣费')
})
