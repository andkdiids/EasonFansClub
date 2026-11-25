import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { prisma } from '../lib/prisma'
import {
  ShunError, setShunEnabled, shunAttempt, shunCapture, shunSendCaptureNotification, updateShunConfig,
} from '../lib/shun-master'
import { runShunNotifySweepOnce } from '../lib/shun-notify-worker'
import { defaultShunConfig } from '../lib/shun-master-rules'
import { getUserBadgeMetric } from '../lib/badge-metrics'
import { backfillBadgeRule, evaluateUserAutoBadges } from '../lib/badge-rule-engine'
import { CAPTURE_RESULT_NOTIFICATION, captureInvestigationLink, captureNotifyKey } from '../lib/shun-capture-letter'

/**
 * Isolated-MySQL acceptance for V5.
 *
 * Covers the parts that cannot be proven from source: the recovery-bonus roll
 * and its idempotency, the deferred capture notice (plain / note / expired
 * sweep), the one-note-per-capture rule and the three cumulative badge rules
 * through the real rule engine (auto grant, idempotency, historical backfill).
 *
 * Runs against its own fixture database and is skipped unless
 * `SHUN_V5_MYSQL_QA=1` is set explicitly — CI stays green without a database.
 */

const qa = process.env.SHUN_V5_MYSQL_QA === '1'

const baseConfig = {
  ...defaultShunConfig,
  attempts: 7, victimCap: 20, goldenMinutes: 10,
  weights: [100, 100, 100, 100, 100], friendChance: 0, bonusChance: 0,
}

function assertIsolatedFixture() {
  const url = new URL(process.env.DATABASE_URL || '')
  assert.equal(url.protocol, 'mysql:')
  assert.equal(url.hostname, '127.0.0.1')
  assert.equal(url.pathname, '/ecfc_shun_match_qa')
}

let operatorId = ''

function createUser(points = 0) {
  const name = 'shun-v5-' + randomUUID()
  return prisma.user.create({ data: {
    username: name, usernameNormalized: name, nickname: name,
    email: `${name}@example.invalid`, emailVerifiedAt: new Date(), points, passwordHash: 'fixture',
    Profile: { create: { displayName: name } },
  } })
}

async function bulkUsers(count: number) {
  const ids = Array.from({ length: count }, () => 'shun-v5-' + randomUUID())
  await prisma.user.createMany({ data: ids.map((id) => ({
    id, username: id, usernameNormalized: id, nickname: id, passwordHash: 'fixture', points: 0,
  })) })
  await prisma.profile.createMany({ data: ids.map((id) => ({ userId: id, displayName: id })) })
  return ids
}

async function publish(overrides: Partial<typeof baseConfig> = {}) {
  await updateShunConfig(operatorId, { ...baseConfig, ...overrides })
  await setShunEnabled(operatorId, true)
}

/**
 * Deterministic take + capture fixture.
 *
 * Only the victim is funded, so the two-stage lottery has exactly one possible
 * target; decoys are funded-neutral and stay usable for the suspect list. Every
 * other pre-existing account is protected so it can never be drawn.
 */
async function stageTake(overrides: Partial<typeof baseConfig> = {}) {
  await prisma.shunMasterProtection.deleteMany({})
  await publish(overrides)
  const [actor, victim] = [await createUser(0), await createUser(60)]
  // Decoy pool: unfunded (so never a target) and unprotected (so they can appear
  // in the suspect list). Protecting them instead would starve `selectDecoys`.
  const fillers = await bulkUsers(6)
  const keep = [actor.id, victim.id, ...fillers]
  const outsiders = await prisma.user.findMany({ where: { id: { notIn: keep } }, select: { id: true } })
  await prisma.shunMasterProtection.createMany({
    data: outsiders.map(({ id }) => ({ userId: id, protected: true })), skipDuplicates: true,
  })
  const round = await shunAttempt(actor.id, randomUUID())
  // Every funded fixture starts from the same baseline, so wallet assertions can
  // compare against the pre-take balance instead of the post-take one.
  return { actor, victim, round, baseline: 60 }
}

/** Settlement projection the assertions in this file rely on. */
type SettledCapture = {
  record: { id: string; amount: number; recovered: number; result: string | null; bonusAwarded: number }
}
type SuspectList = { mode: number; candidates: Array<{ uid: number; nickname: string; avatarUrl: string | null }> }

/** Captures the round with the true actor (golden window: two suspects). */
async function captureCorrect(fx: { actor: { id: string; uid: number }; victim: { id: string }; round: { id: string } }) {
  // `shunCapture` is overloaded at the type level (suspect list vs settlement),
  // so the settled shape is asserted here once for every call site.
  const outcome = await shunCapture(fx.victim.id, fx.round.id, { mode: 2, uid: fx.actor.uid }) as unknown as SettledCapture
  assert.ok(outcome.record, 'EXPECTED_SETTLED_CAPTURE')
  return outcome
}

/** Suspect list of a capture that has not been answered yet. */
async function captureSuspects(victimId: string, roundId: string) {
  const detail = await shunCapture(victimId, roundId) as unknown as SuspectList
  assert.ok(Array.isArray(detail.candidates), 'EXPECTED_SUSPECT_LIST')
  return detail
}

async function ensureSettings() {
  await prisma.shunMasterSettings.upsert({
    where: { id: 1 }, update: {}, create: { id: 1, config: { ...defaultShunConfig } },
  })
  const operator = await createUser(0)
  operatorId = operator.id
  await publish()
}

async function pointsOf(userId: string) {
  return (await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { points: true } })).points
}

const shunTests = qa ? test : test.skip

test('V5 MySQL fixture is isolated', { skip: !qa }, async () => {
  assertIsolatedFixture()
  await prisma.shunMasterProtection.deleteMany({})
  await prisma.shunMasterCaptureLetter.deleteMany({})
  await ensureSettings()
})

// ------------------------------------------------------------ bonus roll

shunTests('0% never pays a bonus and keeps the settlement unchanged', async () => {
  const fx = await stageTake({ bonusChance: 0 })
  const outcome = await captureCorrect(fx)
  assert.equal(outcome.record.result, 'SUCCESS')
  assert.equal(outcome.record.bonusAwarded, 0)
  // Recovered in full, no extra leg.
  assert.equal(await pointsOf(fx.victim.id), fx.baseline)
  assert.equal(await prisma.pointLog.count({ where: { action: 'SHUN_BONUS' } }), 0)
})

shunTests('100% pays exactly the recovered amount from the platform', async () => {
  const fx = await stageTake({ bonusChance: 100 })
  const outcome = await captureCorrect(fx)
  const amount = outcome.record.amount
  assert.equal(outcome.record.result, 'SUCCESS')
  assert.equal(outcome.record.recovered, amount)
  assert.equal(outcome.record.bonusAwarded, amount, '奖励必须等于实际追回金额')
  // Recovered (back to the baseline) + the platform bonus on top.
  assert.equal(await pointsOf(fx.victim.id), fx.baseline + amount)
  const bonusLogs = await prisma.pointLog.findMany({ where: { action: 'SHUN_BONUS' } })
  assert.equal(bonusLogs.length, 1)
  assert.equal(bonusLogs[0].businessKey, `shun:${fx.round.id}:bonus:${fx.victim.id}`)
  assert.equal(bonusLogs[0].points, amount)
  // The caught actor is never charged for the bonus, and the recovery leg keeps
  // its own business key.
  assert.equal(await prisma.pointLog.count({ where: { action: 'SHUN_BONUS', userId: fx.actor.id } }), 0)
  const recoverLogs = await prisma.pointLog.findMany({ where: { action: 'SHUN_RECOVERY', businessKey: { contains: `shun:${fx.round.id}:recover` } } })
  assert.equal(recoverLogs.length, 2, '原额追回仍只有两条腿')
  assert.notEqual(recoverLogs[0].businessKey, bonusLogs[0].businessKey, '奖励必须使用独立业务键')
})

shunTests('a replay can never re-roll or pay a second bonus', async () => {
  const fx = await stageTake({ bonusChance: 100 })
  await captureCorrect(fx)
  const afterFirst = await pointsOf(fx.victim.id)
  const bonusCount = await prisma.pointLog.count({ where: { action: 'SHUN_BONUS' } })
  // Same guess twice more.
  await captureCorrect(fx)
  await captureCorrect(fx)
  assert.equal(await pointsOf(fx.victim.id), afterFirst, '重复抓捕不得再次发放奖励')
  assert.equal(await prisma.pointLog.count({ where: { action: 'SHUN_BONUS' } }), bonusCount, '不得重复写奖励流水')
  const round = await prisma.shunMasterRound.findUniqueOrThrow({ where: { id: fx.round.id } })
  assert.equal(round.bonusRolled, true)
  assert.equal(round.bonusAwarded, round.recovered)
  assert.ok(afterFirst > fx.baseline, '追回与奖励都必须真实入账')
})

shunTests('a failed capture never rolls the bonus', async () => {
  const fx = await stageTake({ bonusChance: 100 })
  const detail = await captureSuspects(fx.victim.id, fx.round.id)
  // Golden window: two suspects — pick the decoy.
  const decoy = detail.candidates.find((person) => person.uid !== fx.actor.uid)!
  const outcome = await shunCapture(fx.victim.id, fx.round.id, { mode: 2, uid: decoy.uid }) as unknown as SettledCapture
  assert.equal(outcome.record.result, 'FAILED')
  assert.equal(outcome.record.bonusAwarded, 0)
  assert.equal(outcome.record.recovered, 0)
  assert.equal(await prisma.pointLog.count({ where: { action: 'SHUN_BONUS', businessKey: { contains: fx.round.id } } }), 0)
  assert.ok((await pointsOf(fx.victim.id)) < fx.baseline, '抓捕失败不追回')
})

// -------------------------------------------------- capture notification

shunTests('the plain arrest notice uses its own key and lands on 「我顺了谁」', async () => {
  const fx = await stageTake({ bonusChance: 0 })
  await captureCorrect(fx)
  const outcome = await shunSendCaptureNotification(fx.victim.id, fx.round.id, null)
  assert.equal(outcome.status, 'SENT_PLAIN')
  const notice = await prisma.notification.findFirstOrThrow({ where: { key: captureNotifyKey(fx.round.id, false) } })
  assert.equal(notice.recipientId, fx.actor.id, '被通知的是被抓到的顺取者')
  assert.equal(notice.title, CAPTURE_RESULT_NOTIFICATION.title)
  assert.equal(notice.content, CAPTURE_RESULT_NOTIFICATION.plain(fx.round.amount))
  assert.equal(notice.link, captureInvestigationLink(fx.round.id))
  const round = await prisma.shunMasterRound.findUniqueOrThrow({ where: { id: fx.round.id } })
  assert.equal(round.captureNotifyStatus, 'SENT_PLAIN')
  assert.ok(round.captureNotifiedAt)
})

shunTests('a counter note is stored once and switches the notice to the letter copy', async () => {
  const fx = await stageTake({ bonusChance: 0 })
  await captureCorrect(fx)
  const content = '抓到你啦！下次别顺我。'
  const outcome = await shunSendCaptureNotification(fx.victim.id, fx.round.id, content)
  assert.equal(outcome.status, 'SENT_LETTER')
  const letters = await prisma.shunMasterCaptureLetter.findMany({ where: { roundId: fx.round.id } })
  assert.equal(letters.length, 1, '一次抓捕最多一条留言')
  assert.equal(letters[0].content, content)
  assert.equal(letters[0].senderId, fx.victim.id, '留言者是被顺的用户（抓捕者）')
  assert.equal(letters[0].recipientId, fx.actor.id)
  const notice = await prisma.notification.findFirstOrThrow({ where: { key: captureNotifyKey(fx.round.id, true) } })
  assert.equal(notice.content, CAPTURE_RESULT_NOTIFICATION.letter(fx.round.amount))
  assert.match(notice.link ?? '', /captureLetter=1$/)
  // A second note can never be stored: the letter status is idempotent (a
  // retried request still reports success) but the row and its content stay put.
  const again = await shunSendCaptureNotification(fx.victim.id, fx.round.id, '再说一句')
  assert.equal(again.status, 'SENT_LETTER')
  const after = await prisma.shunMasterCaptureLetter.findMany({ where: { roundId: fx.round.id } })
  assert.equal(after.length, 1, '重复请求不得新增第二条留言')
  assert.equal(after[0].content, content, '重复请求不得改写已存留言')
  const replay = await shunSendCaptureNotification(fx.victim.id, fx.round.id, null)
  assert.equal(replay.status, 'SENT_LETTER')
  assert.equal(await prisma.notification.count({ where: { key: { startsWith: `shun:${fx.round.id}:captured` } } }), 1,
    '不得产生第二条抓捕通知')
})

shunTests('a note cannot be added after the plain notice went out', async () => {
  const fx = await stageTake({ bonusChance: 0 })
  await captureCorrect(fx)
  await shunSendCaptureNotification(fx.victim.id, fx.round.id, null)
  await assert.rejects(() => shunSendCaptureNotification(fx.victim.id, fx.round.id, '迟到的留言'),
    (error: unknown) => error instanceof ShunError && error.code === 'ALREADY_NOTIFIED')
  assert.equal(await prisma.shunMasterCaptureLetter.count({ where: { roundId: fx.round.id } }), 0)
})

shunTests('a failed capture accepts no note at all', async () => {
  const fx = await stageTake({ bonusChance: 0 })
  const detail = await captureSuspects(fx.victim.id, fx.round.id)
  const decoy = detail.candidates.find((person) => person.uid !== fx.actor.uid)!
  await shunCapture(fx.victim.id, fx.round.id, { mode: 2, uid: decoy.uid })
  await assert.rejects(() => shunSendCaptureNotification(fx.victim.id, fx.round.id, '不可能发出的留言'),
    (error: unknown) => error instanceof ShunError && error.code === 'NOT_CAPTURED')
})

shunTests('the 120-second sweep delivers an abandoned capture result', async () => {
  const fx = await stageTake({ bonusChance: 0 })
  await captureCorrect(fx)
  await prisma.shunMasterRound.update({
    where: { id: fx.round.id }, data: { captureNotifyDueAt: new Date(Date.now() - 1000) },
  })
  await runShunNotifySweepOnce()
  const notice = await prisma.notification.findFirst({ where: { key: captureNotifyKey(fx.round.id, false) } })
  assert.ok(notice, '超时兜底必须送出普通抓捕通知')
  assert.equal(notice?.recipientId, fx.actor.id)
  const round = await prisma.shunMasterRound.findUniqueOrThrow({ where: { id: fx.round.id } })
  assert.equal(round.captureNotifyStatus, 'SENT_PLAIN')
  assert.equal(round.captureNotifyAuto, true)
  // Re-running the sweep can never produce a second notice.
  await runShunNotifySweepOnce()
  assert.equal(await prisma.notification.count({ where: { key: captureNotifyKey(fx.round.id, false) } }), 1)
})

// ------------------------------------------------------------- badges

shunTests('cumulative metrics match the authoritative rounds and exclude the bonus', async () => {
  const fx = await stageTake({ bonusChance: 100 })
  const outcome = await captureCorrect(fx)
  const amount = outcome.record.amount
  // The actor took `amount`, then lost it back; both sides keep their history.
  assert.equal(await getUserBadgeMetric(fx.actor.id, 'SHUN_STOLEN_TOTAL'), amount)
  assert.equal(await getUserBadgeMetric(fx.victim.id, 'SHUN_VICTIM_TOTAL'), amount)
  assert.equal(await getUserBadgeMetric(fx.victim.id, 'SHUN_RECOVERED_TOTAL'), amount,
    '额外奖励不得计入累计追回')
  assert.equal(outcome.record.bonusAwarded, amount, '本夹具确实触发了奖励，因此上一条才有意义')
})

shunTests('a bound badge is granted once and only when the threshold is met', async () => {
  const fx = await stageTake({ bonusChance: 0 })
  const outcome = await captureCorrect(fx)
  const recovered = outcome.record.recovered
  assert.ok(recovered > 0)
  const code = 'shun-v5-' + randomUUID()
  const badge = await prisma.badge.create({ data: {
    name: code, slug: code, code, grantType: 'AUTO', isActive: true, isEnabled: true,
    BadgeRule: { create: { ruleType: 'SHUN_RECOVERED_TOTAL', threshold: recovered, isEnabled: true } },
  } })
  const first = await evaluateUserAutoBadges(fx.victim.id, ['SHUN_RECOVERED_TOTAL'])
  assert.equal(first.granted, 1, '达标必须自动发放')
  assert.equal(await prisma.userBadge.count({ where: { userId: fx.victim.id, badgeId: badge.id } }), 1)
  const second = await evaluateUserAutoBadges(fx.victim.id, ['SHUN_RECOVERED_TOTAL'])
  assert.equal(second.granted, 0, '重复评估不得重复发放')
  assert.equal(await prisma.userBadge.count({ where: { userId: fx.victim.id, badgeId: badge.id } }), 1)
  // Below the threshold nobody is granted.
  const outsider = await createUser(0)
  const below = await evaluateUserAutoBadges(outsider.id, ['SHUN_RECOVERED_TOTAL'])
  assert.equal(below.granted, 0)
  assert.equal(await prisma.userBadge.count({ where: { userId: outsider.id, badgeId: badge.id } }), 0)
})

shunTests('an unbound rule grants nothing', async () => {
  const user = await createUser(0)
  // No BadgeRule of this Shun type is bound in the fixture.
  const summary = await evaluateUserAutoBadges(user.id, ['SHUN_VICTIM_TOTAL'])
  assert.equal(summary.granted, 0)
  assert.equal(summary.evaluated, 0, '未绑定时不得评估出任何可发放规则')
})

shunTests('historical progress is granted by the batched backfill', async () => {
  const { actor: historical } = await stageTake({ bonusChance: 0 })
  const historicalAmount = (await prisma.shunMasterRound.aggregate({ where: { actorId: historical.id }, _sum: { amount: true } }))._sum.amount ?? 0
  assert.ok(historicalAmount > 0, '历史顺取必须已存在')
  const code = 'shun-v5-hist-' + randomUUID()
  const badge = await prisma.badge.create({ data: {
    name: code, slug: code, code, grantType: 'AUTO', isActive: true, isEnabled: true,
    BadgeRule: { create: { ruleType: 'SHUN_STOLEN_TOTAL', threshold: historicalAmount, isEnabled: true } },
  } })
  // Nothing is granted until an administrator triggers the backfill.
  assert.equal(await prisma.userBadge.count({ where: { userId: historical.id, badgeId: badge.id } }), 0)
  // Drive the cursor to the end exactly like the admin backfill button does:
  // batched, restartable and resumable.
  const runBackfill = async (batchSize: number) => {
    let cursor: string | null = null
    let granted = 0
    let scanned = 0
    for (let page = 0; page < 50; page++) {
      const summary = await backfillBadgeRule({ badgeId: badge.id, cursor, batchSize })
      granted += summary.granted
      scanned += summary.scanned
      cursor = summary.nextCursor
      if (summary.done || !summary.nextCursor) break
    }
    return { granted, scanned }
  }
  const first = await runBackfill(100)
  console.log('V5_BACKFILL', JSON.stringify({ threshold: historicalAmount,
    metric: await getUserBadgeMetric(historical.id, 'SHUN_STOLEN_TOTAL'), ...first }))
  assert.ok(first.granted >= 1, '历史达标用户必须被补发')
  assert.equal(await prisma.userBadge.count({ where: { userId: historical.id, badgeId: badge.id } }), 1)
  // The grant count reported by the engine must match what actually landed.
  assert.equal(await prisma.userBadge.count({ where: { badgeId: badge.id } }), first.granted,
    '补发统计必须与实际发放一致')
  // A second full pass is idempotent and grants nothing new.
  const again = await runBackfill(100)
  assert.equal(again.granted, 0, '重复补发不得重复发放')
  assert.equal(await prisma.userBadge.count({ where: { userId: historical.id, badgeId: badge.id } }), 1)
})

shunTests('a permanent opt-out keeps the cumulative progress', async () => {
  const fx = await stageTake({ bonusChance: 0 })
  const before = await getUserBadgeMetric(fx.victim.id, 'SHUN_VICTIM_TOTAL')
  assert.ok(before > 0)
  await prisma.user.update({ where: { id: fx.victim.id }, data: { permanentlyOptedOutAt: new Date() } })
  assert.equal(await getUserBadgeMetric(fx.victim.id, 'SHUN_VICTIM_TOTAL'), before, '退出不得清零历史累计')
  // A settled capture still completes for an opted-out capturer.
  const outcome = await captureCorrect(fx)
  assert.equal(outcome.record.result, 'SUCCESS')
  assert.equal(await getUserBadgeMetric(fx.victim.id, 'SHUN_RECOVERED_TOTAL'), outcome.record.recovered)
})
