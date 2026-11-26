import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { prisma } from '../lib/prisma'
import { getDashboardRankings } from '../lib/admin-dashboard-rankings'
import { removeClinicConsultation } from '../lib/clinic-service'

/**
 * Isolated-MySQL acceptance for moderator consultation deletion.
 *
 * Runs only when CLINIC_DELETE_MYSQL_QA=1 and DATABASE_URL points at the local
 * QA fixture database — never staging or production. Proves the parts source
 * tests cannot: the real soft-delete + counter decrement, idempotency under a
 * repeated request, the leaderboard recalculation (dedup by case author), and
 * the audit row. Only rows created by this suite are touched.
 */

const qa = process.env.CLINIC_DELETE_MYSQL_QA === '1'

function assertIsolatedFixture() {
  const url = new URL(process.env.DATABASE_URL || '')
  assert.equal(url.protocol, 'mysql:')
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname))
  assert.ok(
    ['/ecfc_clinic_qa', '/ecfc_leaderboard_qa'].includes(url.pathname),
    `必须指向隔离 QA 库，当前=${url.pathname}`,
  )
}

const LONG = '这是一条足够长的有效会诊内容用于满足二十一个字的要求'
const PREFIX = 'cm-qa-'
const createdRecords: string[] = []
const createdUsers: string[] = []

async function createUser() {
  const name = PREFIX + randomUUID()
  const user = await prisma.user.create({ data: {
    id: name, username: name, usernameNormalized: name, nickname: name,
    email: `${name}@example.invalid`, emailVerifiedAt: new Date(), points: 0,
    passwordHash: 'fixture', status: 'ACTIVE', isDeleted: false,
    Profile: { create: { displayName: name } },
  } })
  createdUsers.push(user.id)
  return user
}

async function createRecord(authorId: string, category: 'ASK_DOCTORS' | 'TREE_HOLE' = 'ASK_DOCTORS') {
  const record = await prisma.clinicRecord.create({ data: {
    authorId, content: '病例正文，用于会诊测试。', category,
    needType: 'GIVE_ADVICE', identityMode: 'PUBLIC', anonymousNumber: 1, status: 'ACTIVE',
  } })
  createdRecords.push(record.id)
  return record
}

async function createConsultation(input: {
  recordId: string; authorId: string; content?: string; createdAt?: Date
}) {
  return prisma.clinicConsultation.create({ data: {
    recordId: input.recordId,
    authorId: input.authorId,
    content: input.content ?? LONG,
    identityMode: 'PUBLIC',
    anonymousNumber: 1,
    status: 'ACTIVE',
    ...(input.createdAt ? { createdAt: input.createdAt } : {}),
  } })
}

/** A window that contains the fixtures (and nothing time-sensitive). */
const RANGE = { startDate: '2026-11-16', endDate: '2026-11-22' }
const RANGE_NOW = new Date('2026-11-23T06:00:00+08:00')
const FIXTURE_AT = new Date('2026-11-18T10:00:00+08:00')

/**
 * Read the consultation board for the fixture window using the exact production
 * entry point the settlement engine uses.
 */
async function rankCounts() {
  const result = await getDashboardRankings({
    period: 'custom',
    startDate: RANGE.startDate,
    endDate: RANGE.endDate,
    now: RANGE_NOW,
  })
  return result.consultationRanking
}

async function cleanup() {
  if (createdRecords.length) {
    await prisma.clinicConsultation.deleteMany({ where: { recordId: { in: createdRecords } } })
    await prisma.clinicReport.deleteMany({ where: { recordId: { in: createdRecords } } })
    await prisma.clinicRecord.deleteMany({ where: { id: { in: createdRecords } } })
    createdRecords.length = 0
  }
  if (createdUsers.length) {
    await prisma.userOperationLog.deleteMany({ where: { operatorUserId: { in: createdUsers } } })
    await prisma.userOperationLog.deleteMany({ where: { userId: { in: createdUsers } } })
    await prisma.profile.deleteMany({ where: { userId: { in: createdUsers } } })
    await prisma.user.deleteMany({ where: { id: { in: createdUsers } } })
    createdUsers.length = 0
  }
}

const qaTest = (name: string, fn: () => Promise<void>) =>
  test(name, { skip: !qa, timeout: 180_000 }, async () => {
    assertIsolatedFixture()
    try { await fn() } finally { await cleanup() }
  })

qaTest('管理员删除唯一有效会诊：榜单 -1，病例计数 -1，写审计', async () => {
  const [admin, author, patientA, patientB] = await Promise.all([createUser(), createUser(), createUser(), createUser()])
  const recA = await createRecord(patientA.id)
  const recB = await createRecord(patientB.id)
  const c1 = await createConsultation({ recordId: recA.id, authorId: author.id, createdAt: FIXTURE_AT })
  await createConsultation({ recordId: recB.id, authorId: author.id, createdAt: FIXTURE_AT })

  const before = await rankCounts()
  assert.equal(before.find((r) => r.userId === author.id)?.count, 2, '两周不同病例作者应计 2')

  const result = await removeClinicConsultation(c1.id, admin.id, true, { reason: '违规内容' })
  assert.equal(result?.changed, true)

  const after = await rankCounts()
  assert.equal(after.find((r) => r.userId === author.id)?.count, 1, '删除唯一有效会诊应减 1')

  const stored = await prisma.clinicConsultation.findUniqueOrThrow({ where: { id: c1.id }, select: { status: true, deletedAt: true } })
  assert.equal(stored.status, 'REMOVED')
  assert.ok(stored.deletedAt)

  const recordAfter = await prisma.clinicRecord.findUniqueOrThrow({ where: { id: recA.id }, select: { consultationCount: true, status: true } })
  assert.equal(recordAfter.status, 'ACTIVE', '不得删除整篇病例')
  assert.equal(recordAfter.consultationCount, 0)

  const audit = await prisma.userOperationLog.findFirst({
    where: { category: 'CLINIC', action: 'CONSULTATION_DELETE', targetId: c1.id },
    select: { operatorUserId: true, userId: true, metadata: true, operatorType: true, source: true },
  })
  assert.ok(audit, '必须写审计')
  assert.equal(audit?.operatorUserId, admin.id)
  assert.equal(audit?.userId, author.id)
  assert.equal(audit?.operatorType, 'ADMIN')
  assert.equal(audit?.source, 'WEB')
  const meta = audit?.metadata as Record<string, unknown>
  assert.equal(meta.consultationId, c1.id)
  assert.equal(meta.recordId, recA.id)
  assert.equal(meta.authorId, author.id)
  assert.equal(meta.reason, '违规内容')
})

qaTest('同一病例作者多条会诊：删除一条后贡献不变（不 count-1）', async () => {
  const [admin, author, patient] = await Promise.all([createUser(), createUser(), createUser()])
  const rec = await createRecord(patient.id)
  const first = await createConsultation({ recordId: rec.id, authorId: author.id, createdAt: FIXTURE_AT })
  await createConsultation({ recordId: rec.id, authorId: author.id, createdAt: FIXTURE_AT })

  const before = await rankCounts()
  assert.equal(before.find((r) => r.userId === author.id)?.count, 1, '同病例作者只计 1')

  await removeClinicConsultation(first.id, admin.id, true)

  const after = await rankCounts()
  assert.equal(after.find((r) => r.userId === author.id)?.count, 1, '删除重复项后贡献必须保持 1')
})

qaTest('重复删除同一会诊：幂等，计数只扣一次', async () => {
  const [admin, author, patient] = await Promise.all([createUser(), createUser(), createUser()])
  const rec = await createRecord(patient.id)
  const c = await createConsultation({ recordId: rec.id, authorId: author.id, createdAt: FIXTURE_AT })

  const first = await removeClinicConsultation(c.id, admin.id, true)
  assert.equal(first?.changed, true)
  const second = await removeClinicConsultation(c.id, admin.id, true)
  assert.equal(second?.changed, false, '第二次删除不得再次扣减')

  const recordAfter = await prisma.clinicRecord.findUniqueOrThrow({ where: { id: rec.id }, select: { consultationCount: true } })
  assert.equal(recordAfter.consultationCount, 0, '计数不得变为负数或重复扣减')

  const audits = await prisma.userOperationLog.count({
    where: { category: 'CLINIC', action: 'CONSULTATION_DELETE', targetId: c.id },
  })
  assert.equal(audits, 1, '幂等删除只应产生一条审计')
})

qaTest('删除无效会诊（字数不足 / 自己病例 / 非问诊类）不改变榜单', async () => {
  const [admin, author, patient, otherPatient] = await Promise.all([createUser(), createUser(), createUser(), createUser()])
  const askRecord = await createRecord(patient.id)
  const emotionRecord = await createRecord(otherPatient.id, 'TREE_HOLE')
  await createConsultation({ recordId: askRecord.id, authorId: author.id, createdAt: FIXTURE_AT })
  const short = await createConsultation({ recordId: askRecord.id, authorId: author.id, content: '太短了', createdAt: FIXTURE_AT })
  const ownCase = await createConsultation({ recordId: emotionRecord.id, authorId: otherPatient.id, createdAt: FIXTURE_AT })
  const wrongCategory = await createConsultation({ recordId: emotionRecord.id, authorId: author.id, createdAt: FIXTURE_AT })

  // author has exactly 1 qualifying consultation (askRecord by patient).
  const before = await rankCounts()
  assert.equal(before.find((r) => r.userId === author.id)?.count, 1)

  await removeClinicConsultation(short.id, admin.id, true)
  await removeClinicConsultation(wrongCategory.id, admin.id, true)
  // otherPatient's own case never counted anyway.
  const afterFirst = await rankCounts()
  assert.equal(afterFirst.find((r) => r.userId === author.id)?.count, 1, '删除无效会诊不得改变贡献')

  await removeClinicConsultation(ownCase.id, admin.id, true)
  const afterSecond = await rankCounts()
  assert.equal(afterSecond.find((r) => r.userId === author.id)?.count, 1)

  assert.ok(short.id && wrongCategory.id)
})

qaTest('其他周期的会诊不受影响；跨周期删除互不干扰', async () => {
  const [admin, author, patient] = await Promise.all([createUser(), createUser(), createUser()])
  const rec = await createRecord(patient.id)
  const inWindow = await createConsultation({ recordId: rec.id, authorId: author.id, createdAt: FIXTURE_AT })
  const outOfWindow = await createConsultation({
    recordId: rec.id, authorId: author.id, createdAt: new Date('2026-12-10T10:00:00+08:00'),
  })

  const before = await rankCounts()
  const beforeCount = before.find((r) => r.userId === author.id)?.count ?? 0
  assert.ok(beforeCount >= 1)

  // Deleting the row OUTSIDE the window must not change this window's figure.
  await removeClinicConsultation(outOfWindow.id, admin.id, true)
  const after = await rankCounts()
  assert.equal(after.find((r) => r.userId === author.id)?.count ?? 0, beforeCount, '跨周期删除不影响当前周期')

  await removeClinicConsultation(inWindow.id, admin.id, true)
  const final = await rankCounts()
  assert.equal((final.find((r) => r.userId === author.id)?.count ?? 0), beforeCount - 1)
})

qaTest('删除会诊不影响其他评论、病例、钱包与其他用户', async () => {
  const [admin, author, otherAuthor, patient] = await Promise.all([createUser(), createUser(), createUser(), createUser()])
  const rec = await createRecord(patient.id)
  const target = await createConsultation({ recordId: rec.id, authorId: author.id, createdAt: FIXTURE_AT })
  const survivor = await createConsultation({ recordId: rec.id, authorId: otherAuthor.id, createdAt: FIXTURE_AT })

  const pointsBefore = await prisma.user.aggregate({ where: { id: { in: createdUsers } }, _sum: { points: true } })
  await removeClinicConsultation(target.id, admin.id, true)

  const survivorAfter = await prisma.clinicConsultation.findUniqueOrThrow({ where: { id: survivor.id }, select: { status: true } })
  assert.equal(survivorAfter.status, 'ACTIVE', '其他会诊必须保持原状')
  const recordAfter = await prisma.clinicRecord.findUniqueOrThrow({ where: { id: rec.id }, select: { status: true } })
  assert.equal(recordAfter.status, 'ACTIVE', '病例必须保持原状')
  const pointsAfter = await prisma.user.aggregate({ where: { id: { in: createdUsers } }, _sum: { points: true } })
  assert.equal(pointsAfter._sum.points, pointsBefore._sum.points, '不得改动任何钱包余额')
  // Scoped to this suite's fixtures: the shared QA database may hold leaderboard
  // rows from other suites, so a global count would be meaningless.
  const leaderboardLogs = await prisma.pointLog.count({
    where: {
      userId: { in: createdUsers },
      action: { in: ['LEADERBOARD_WEEKLY_REWARD', 'LEADERBOARD_MONTHLY_REWARD'] },
    },
  })
  assert.equal(leaderboardLogs, 0, '删除会诊不得产生排行榜奖励流水')
})

qaTest('普通用户不能删除他人会诊（服务层 403）', async () => {
  const [attacker, victim, patient] = await Promise.all([createUser(), createUser(), createUser()])
  const rec = await createRecord(patient.id)
  const c = await createConsultation({ recordId: rec.id, authorId: victim.id, createdAt: FIXTURE_AT })

  await assert.rejects(
    () => removeClinicConsultation(c.id, attacker.id, false),
    (error: unknown) => {
      const e = error as { code?: string; status?: number }
      assert.equal(e.code, 'FORBIDDEN')
      assert.equal(e.status, 403)
      return true
    },
  )
  const still = await prisma.clinicConsultation.findUniqueOrThrow({ where: { id: c.id }, select: { status: true } })
  assert.equal(still.status, 'ACTIVE', '越权请求不得改变数据')
})

qaTest('不存在的会诊返回明确安全状态（404）', async () => {
  const admin = await createUser()
  await assert.rejects(
    () => removeClinicConsultation('does-not-exist-' + randomUUID(), admin.id, true),
    (error: unknown) => {
      const e = error as { code?: string; status?: number }
      assert.equal(e.code, 'CONSULTATION_NOT_FOUND')
      assert.equal(e.status, 404)
      return true
    },
  )
})
