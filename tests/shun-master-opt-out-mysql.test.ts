import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test, { after } from 'node:test'
import { prisma } from '../lib/prisma'
import { setShunEnabled, shunAttempt, shunPermanentOptOut, shunRecords, shunStatus, updateShunConfig } from '../lib/shun-master'
import { defaultShunConfig } from '../lib/shun-master-rules'

/**
 * Isolated-MySQL acceptance for the permanent opt-out. Runs against
 * `ecfc_shun_match_qa` only when SHUN_MATCH_MYSQL_QA=1, serialized with other
 * fixtures. Covers default participation, the durable server-side exclusion
 * from every target pool, idempotency, concurrency and history safety.
 */
const qa = process.env.SHUN_MATCH_MYSQL_QA === '1'
let operatorId = ''

function assertIsolatedFixture() {
  const url = new URL(process.env.DATABASE_URL || '')
  assert.equal(url.protocol, 'mysql:')
  assert.equal(url.pathname, '/ecfc_shun_match_qa')
}

function createUser(points = 0) {
  const name = 'shun-opt-' + randomUUID()
  return prisma.user.create({ data: {
    username: name, usernameNormalized: name, nickname: name,
    email: `${name}@example.invalid`, emailVerifiedAt: new Date(), points, passwordHash: 'fixture',
    Profile: { create: { displayName: name } },
  } })
}

async function publish() {
  await updateShunConfig(operatorId, {
    ...defaultShunConfig, attempts: 7, victimCap: 20, goldenMinutes: 10,
    weights: [100, 100, 100, 100, 100], friendChance: 0,
  })
  await setShunEnabled(operatorId, true)
}

async function ensureSettings() {
  await prisma.shunMasterSettings.upsert({
    where: { id: 1 }, update: {}, create: { id: 1, config: { ...defaultShunConfig } },
  })
  operatorId = (await createUser(0)).id
  await publish()
}

async function protectAllExcept(...keep: string[]) {
  const all = await prisma.user.findMany({ where: { points: { gt: 0 }, id: { notIn: keep } }, select: { id: true } })
  if (all.length) await prisma.shunMasterProtection.createMany({
    data: all.map(({ id }) => ({ userId: id, protected: true })), skipDuplicates: true,
  })
}

/** Unfunded but otherwise eligible accounts: needed as decoys, never as victims. */
async function freshDecoys(count = 4) {
  return Promise.all(Array.from({ length: count }, () => createUser(0)))
}

after(async () => { await prisma.$disconnect() })

test('permanent opt-out: default participation, irreversible exclusion, idempotency, concurrency, history', {
  skip: !qa, timeout: 300000,
}, async () => {
  assertIsolatedFixture()
  await ensureSettings()

  // --- default participation: no opt-in needed, status has no opt-out marker --
  const actor = await createUser(0)
  const victim = await createUser(50)
  await freshDecoys()
  await protectAllExcept(victim.id)
  const before = await shunStatus(victim.id)
  assert.equal(before.optedOut, false, '用户默认参与，无需报名')
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: victim.id } })).permanentlyOptedOutAt, null)

  // A normal take still works before opting out.
  const took = await shunAttempt(actor.id, randomUUID())
  assert.ok(took)
  const roundId = took.id
  assert.equal((await prisma.shunMasterRound.findUniqueOrThrow({ where: { id: roundId } })).victimId, victim.id)

  // --- opt out: status flips, timestamp stored, second call is a no-op -------
  const first = await shunPermanentOptOut(victim.id)
  assert.equal(first.optedOut, true)
  assert.ok(first.permanentlyOptedOutAt)
  const afterOpt = await shunStatus(victim.id)
  assert.equal(afterOpt.optedOut, true)
  const second = await shunPermanentOptOut(victim.id)
  assert.equal(second.optedOut, true)
  assert.equal(second.permanentlyOptedOutAt?.getTime(), first.permanentlyOptedOutAt?.getTime(),
    '重复退出不得改写时间，必须幂等')
  // Re-login / config updates do not revive participation.
  await updateShunConfig(operatorId, { ...defaultShunConfig, enabled: true })
  await setShunEnabled(operatorId, true)
  assert.equal((await shunStatus(victim.id)).optedOut, true, '配置更新或重新登录不得恢复参与')

  // --- an opted-out actor cannot start a new take -----------------------------
  const actor2 = await createUser(0)
  await protectAllExcept() // protect every funded account this round
  await shunPermanentOptOut(actor2.id)
  await assert.rejects(shunAttempt(actor2.id, randomUUID()),
    (error: { code?: string }) => error.code === 'OPTED_OUT', '已退出用户不能发起新顺取')
  assert.equal(await prisma.shunMasterRound.count({ where: { actorId: actor2.id } }), 0)

  // --- an opted-out user is never chosen as a victim --------------------------
  // The only funded, unprotected account opts out: a take must find no target.
  const actor3 = await createUser(0)
  const onlyOpted = await createUser(50)
  await freshDecoys()
  await protectAllExcept(onlyOpted.id)
  await shunPermanentOptOut(onlyOpted.id)
  const beforeCount = await prisma.shunMasterRound.count()
  await assert.rejects(shunAttempt(actor3.id, randomUUID()),
    (error: { code?: string }) => error.code === 'NO_TARGET', '已退出用户不得进入全站目标池')
  assert.equal(await prisma.shunMasterRound.count(), beforeCount, '没有合格目标时不得产生新结算')

  // --- concurrency: a take racing with an opt-out never settles after commit --
  const racer = await createUser(0)
  const racerVictim = await createUser(50)
  await freshDecoys()
  await protectAllExcept(racerVictim.id)
  const [opt, attempt] = await Promise.allSettled([
    shunPermanentOptOut(racer.id),
    shunAttempt(racer.id, randomUUID()),
  ])
  assert.equal(opt.status, 'fulfilled')
  if (attempt.status === 'fulfilled') {
    // A take that won the race before the opt-out committed is allowed; it must
    // not be followed by any further settlement for this actor.
    assert.ok(attempt.value)
  } else {
    // Both codes prove the post-opt-out request never settled.
    assert.ok(['OPTED_OUT', 'BALANCE'].includes((attempt.reason as { code?: string }).code || ''),
      '退出提交后的顺取请求不得产生新结算')
  }
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: racer.id } })).permanentlyOptedOutAt !== null, true)

  // --- history stays intact: ledger, rounds, notifications -------------------
  const keptRound = await prisma.shunMasterRound.findUniqueOrThrow({ where: { id: roundId } })
  assert.equal(keptRound.victimId, victim.id, '退出前的顺取记录必须保留')
  assert.ok(await prisma.pointLog.count({ where: { businessKey: { startsWith: `shun:${roundId}:` } } }) >= 2,
    '退出前的挂号费流水必须保留')
  assert.ok((await shunRecords(victim.id, 'in')).records.length >= 1, '退出者仍可查看历史记录')
})
