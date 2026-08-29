import assert from 'node:assert/strict'
import test from 'node:test'
import { Prisma } from '@prisma/client'
import { recordGuessSongLeaderboard } from '../lib/guess-song-leaderboard'
import { recordWantListenLeaderboard } from '../lib/want-listen-leaderboard'

type Row = Record<string, unknown>

type GuessSongScoreFields = {
  score: number
  correctCount: number
  maxStreak: number
  totalPlayCount: number
  completedAt: Date
}

type GuessSongTestSession = GuessSongScoreFields & {
  id: string
  userId: string
  mode: 'EASY'
  status: 'COMPLETED'
  isValid: true
  riskScore: number
  questionCount: null
}

type WantListenScoreFields = {
  score: number
  correctCount: number
  maxStreak: number
  totalQuestions: number
  completionTimeMs: number
  completedAt: Date
}

type WantListenTestSession = WantListenScoreFields & {
  id: string
  userId: string
  mode: 'WANT_LISTEN'
  status: 'COMPLETED'
  antiCheatStatus: 'CLEAN'
  excludedFromLeaderboard: false
}

function isRecord(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function compareValues(left: unknown, right: unknown) {
  if (left instanceof Date && right instanceof Date) return left.getTime() - right.getTime()
  if (typeof left === 'number' && typeof right === 'number') return left - right
  return null
}

function matchesCondition(value: unknown, condition: unknown) {
  if (condition instanceof Date) return value instanceof Date && value.getTime() === condition.getTime()
  if (!isRecord(condition)) return value === condition

  if ('lt' in condition) {
    const comparison = compareValues(value, condition.lt)
    return comparison !== null && comparison < 0
  }
  if ('gt' in condition) {
    const comparison = compareValues(value, condition.gt)
    return comparison !== null && comparison > 0
  }
  return false
}

function matchesBetterWhere(row: Row, where: Row) {
  for (const field of ['userId', 'mode', 'periodType', 'periodKey']) {
    if (row[field] !== where[field]) return false
  }
  const branches = where.OR
  if (!Array.isArray(branches)) return false
  return branches.some((branch) => isRecord(branch)
    && Object.entries(branch).every(([field, condition]) => matchesCondition(row[field], condition)))
}

class FakeLeaderboardTable {
  private readonly rows = new Map<string, Row>()

  private key(record: Row) {
    return ['userId', 'mode', 'periodType', 'periodKey'].map((field) => String(record[field])).join('|')
  }

  async updateMany(input: { where: Row; data: Row }) {
    // Yield once so Promise.all reaches the same first-create decision in both
    // writers before either one tries the unique-key insert.
    await Promise.resolve()
    const key = this.key(input.where)
    const current = this.rows.get(key)
    if (!current || !matchesBetterWhere(current, input.where)) return { count: 0 }
    this.rows.set(key, { ...current, ...input.data })
    return { count: 1 }
  }

  async create(input: { data: Row }) {
    const key = this.key(input.data)
    if (this.rows.has(key)) {
      throw new Prisma.PrismaClientKnownRequestError('duplicate leaderboard key', {
        code: 'P2002',
        clientVersion: 'test',
      })
    }
    this.rows.set(key, { ...input.data })
    return input.data
  }

  values() {
    return [...this.rows.values()]
  }
}

function createGuessSongDatabase(sessions: readonly Row[]) {
  const sessionById = new Map(sessions.map((session) => [session.id, session]))
  const table = new FakeLeaderboardTable()
  const database = {
    guessSongSession: {
      findUnique: async ({ where }: { where: { id: string } }) => sessionById.get(where.id) || null,
    },
    adminActionLog: {
      findMany: async () => [],
    },
    guessSongLeaderboardEntry: table,
  }
  return { database, table }
}

function createWantListenDatabase(sessions: readonly Row[]) {
  const sessionById = new Map(sessions.map((session) => [session.id, session]))
  const table = new FakeLeaderboardTable()
  const database = {
    wantListenSession: {
      findUnique: async ({ where }: { where: { id: string } }) => sessionById.get(where.id) || null,
    },
    wantListenLeaderboardEntry: table,
  }
  return { database, table }
}

function guessSongSession(id: string, score: GuessSongScoreFields): GuessSongTestSession {
  return {
    id,
    userId: 'user-1',
    mode: 'EASY',
    status: 'COMPLETED',
    isValid: true,
    riskScore: 0,
    questionCount: null,
    ...score,
  }
}

function wantListenSession(id: string, score: WantListenScoreFields): WantListenTestSession {
  return {
    id,
    userId: 'user-1',
    mode: 'WANT_LISTEN',
    status: 'COMPLETED',
    antiCheatStatus: 'CLEAN',
    excludedFromLeaderboard: false,
    ...score,
  }
}

test('GuessSong 并发首次写入与高低分反向执行都只保留最高成绩且整行一致', async () => {
  const high = guessSongSession('guess-high', {
    score: 1200,
    correctCount: 12,
    maxStreak: 8,
    totalPlayCount: 3,
    completedAt: new Date('2026-08-29T01:00:00.000Z'),
  })
  const low = guessSongSession('guess-low', {
    score: 1000,
    correctCount: 10,
    maxStreak: 50,
    totalPlayCount: 1,
    completedAt: new Date('2026-08-29T02:00:00.000Z'),
  })

  for (const order of [[high, low], [low, high]] as const) {
    const { database, table } = createGuessSongDatabase(order)
    await Promise.all(order.map((session) => recordGuessSongLeaderboard(session.id, database as unknown as Prisma.TransactionClient)))
    const rows = table.values()
    assert.equal(rows.length, 2, 'WEEK/MONTH 各应只有一条用户记录')
    for (const row of rows) {
      assert.equal(row.sessionId, high.id)
      assert.equal(row.score, high.score)
      assert.equal(row.correctCount, high.correctCount)
      assert.equal(row.maxStreak, high.maxStreak)
      assert.equal(row.totalPlayCount, high.totalPlayCount)
      assert.deepEqual(row.achievedAt, high.completedAt)
    }
  }
})

test('GuessSong 同分并发仍遵循已有 tie-break（更早 achievedAt），不产生重复记录', async () => {
  const earlier = guessSongSession('guess-earlier', {
    score: 1000,
    correctCount: 10,
    maxStreak: 5,
    totalPlayCount: 3,
    completedAt: new Date('2026-08-29T01:00:00.000Z'),
  })
  const later = guessSongSession('guess-later', {
    score: 1000,
    correctCount: 10,
    maxStreak: 5,
    totalPlayCount: 3,
    completedAt: new Date('2026-08-29T02:00:00.000Z'),
  })
  const { database, table } = createGuessSongDatabase([later, earlier])

  await Promise.all([
    recordGuessSongLeaderboard(later.id, database as unknown as Prisma.TransactionClient),
    recordGuessSongLeaderboard(earlier.id, database as unknown as Prisma.TransactionClient),
  ])

  assert.equal(table.values().length, 2)
  for (const row of table.values()) {
    assert.equal(row.sessionId, earlier.id)
    assert.deepEqual(row.achievedAt, earlier.completedAt)
  }
})

test('WantListen 并发首次写入、高低分反向执行及 DAY/WEEK/ALL 周期都安全', async () => {
  const high = wantListenSession('want-high', {
    score: 1200,
    correctCount: 12,
    maxStreak: 9,
    totalQuestions: 20,
    completionTimeMs: 900,
    completedAt: new Date('2026-08-29T01:00:00.000Z'),
  })
  const low = wantListenSession('want-low', {
    score: 1000,
    correctCount: 10,
    maxStreak: 99,
    totalQuestions: 7,
    completionTimeMs: 100,
    completedAt: new Date('2026-08-29T02:00:00.000Z'),
  })

  for (const order of [[high, low], [low, high]] as const) {
    const { database, table } = createWantListenDatabase(order)
    await Promise.all(order.map((session) => recordWantListenLeaderboard(session.id, database as unknown as Prisma.TransactionClient)))
    const rows = table.values()
    assert.equal(rows.length, 3, 'DAY/WEEK/ALL 各应只有一条用户记录')
    assert.deepEqual(new Set(rows.map((row) => row.periodType)), new Set(['DAY', 'WEEK', 'ALL']))
    for (const row of rows) {
      assert.equal(row.sessionId, high.id)
      assert.equal(row.score, high.score)
      assert.equal(row.correctCount, high.correctCount)
      assert.equal(row.maxStreak, high.maxStreak)
      assert.equal(row.totalQuestions, high.totalQuestions)
      assert.equal(row.completionTimeMs, high.completionTimeMs)
      assert.deepEqual(row.achievedAt, high.completedAt)
    }
  }
})

test('WantListen 同分并发仍遵循已有 completionTimeMs tie-break，并保持获胜 Session 的全部字段', async () => {
  const faster = wantListenSession('want-faster', {
    score: 1000,
    correctCount: 10,
    maxStreak: 5,
    totalQuestions: 20,
    completionTimeMs: 900,
    completedAt: new Date('2026-08-29T02:00:00.000Z'),
  })
  const slower = wantListenSession('want-slower', {
    score: 1000,
    correctCount: 10,
    maxStreak: 5,
    totalQuestions: 7,
    completionTimeMs: 1200,
    completedAt: new Date('2026-08-29T01:00:00.000Z'),
  })
  const { database, table } = createWantListenDatabase([slower, faster])

  await Promise.all([
    recordWantListenLeaderboard(slower.id, database as unknown as Prisma.TransactionClient),
    recordWantListenLeaderboard(faster.id, database as unknown as Prisma.TransactionClient),
  ])

  assert.equal(table.values().length, 3)
  for (const row of table.values()) {
    assert.equal(row.sessionId, faster.id)
    assert.equal(row.completionTimeMs, faster.completionTimeMs)
    assert.equal(row.totalQuestions, faster.totalQuestions)
    assert.deepEqual(row.achievedAt, faster.completedAt)
  }
})
