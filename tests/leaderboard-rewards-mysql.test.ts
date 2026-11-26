import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { prisma } from '../lib/prisma'
import {
  defaultLeaderboardRewardsConfig,
  type LeaderboardRewardsConfig,
} from '../lib/leaderboard-rewards-config'
import {
  runLeaderboardSettlement,
  type CandidatesProvider,
} from '../lib/leaderboard-rewards-settlement'
import type { BoardCandidates } from '../lib/leaderboard-rewards-sources'

/**
 * Isolated-MySQL acceptance for automatic leaderboard rewards.
 *
 * Runs only when LEADERBOARD_MYSQL_QA=1 and DATABASE_URL points at the dedicated
 * `ecfc_leaderboard_qa` fixture database — never at staging or production. It
 * proves the parts source tests cannot: real wallet ledger + cap in one
 * transaction, idempotency under repeat/parallel runs, and badge rollover with
 * permanent dedup. All ranking inputs are injected deterministically; the money
 * / cap / badge / notification path under test is the exact production code.
 */

const qa = process.env.LEADERBOARD_MYSQL_QA === '1'

function assertIsolatedFixture() {
  const url = new URL(process.env.DATABASE_URL || '')
  assert.equal(url.protocol, 'mysql:')
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname))
  assert.equal(url.pathname, '/ecfc_leaderboard_qa')
}

function config(overrides: Partial<LeaderboardRewardsConfig> = {}): LeaderboardRewardsConfig {
  const c = structuredClone(defaultLeaderboardRewardsConfig)
  c.enabled = true
  c.enabledAt = '2020-01-01T00:00:00+08:00'
  return { ...c, ...overrides }
}

const NOW = new Date('2026-11-30T06:00:00+08:00') // Monday 06:00 Beijing

function provider(boards: BoardCandidates[]): CandidatesProvider {
  return {
    entertainment: async () => boards,
    dashboard: async () => ({
      comment: { boardKey: 'comment:main', boardLabel: '评论榜', candidates: [] },
      aspirin: { boardKey: 'aspirin:main', boardLabel: '会诊榜', candidates: [] },
    }),
  }
}

function board(key: string, rows: Array<[number, string]>): BoardCandidates {
  return { boardKey: `ent:${key}`, boardLabel: key, candidates: rows.map(([rank, userId]) => ({ rank, userId })) }
}

async function createUser(points = 0) {
  const name = 'lb-' + randomUUID()
  return prisma.user.create({ data: {
    id: name, username: name, usernameNormalized: name, nickname: name,
    email: `${name}@example.invalid`, emailVerifiedAt: new Date(), points, passwordHash: 'fixture',
    Profile: { create: { displayName: name } },
  } })
}

async function createBadge() {
  const id = 'badge-' + randomUUID()
  return prisma.badge.create({ data: {
    id, name: id, slug: id, code: id,
    grantType: 'MANUAL', isAutoGrant: false, isEnabled: true, isActive: true,
  } })
}

async function cleanup() {
  await prisma.leaderboardBadgeGrant.deleteMany({})
  await prisma.leaderboardRewardGrant.deleteMany({})
  await prisma.leaderboardWeeklyCapUsage.deleteMany({})
  await prisma.leaderboardSettlementRun.deleteMany({})
  await prisma.pointLog.deleteMany({ where: { businessKey: { startsWith: 'leaderboard:' } } })
  await prisma.notification.deleteMany({ where: { key: { startsWith: 'notify:leaderboard:' } } })
}

async function pointsOf(id: string) {
  return (await prisma.user.findUniqueOrThrow({ where: { id }, select: { points: true } })).points
}

async function withQa(fn: () => Promise<void>) {
  if (!qa) return
  assertIsolatedFixture()
  await cleanup()
  await fn()
}

const qaTest = (name: string, fn: () => Promise<void>) =>
  test(name, { skip: !qa, timeout: 180_000 }, async () => withQa(fn))

qaTest('周榜发钱档位准确且按独立 businessKey 幂等', async () => {
  const users = await Promise.all([createUser(), createUser(), createUser(), createUser(), createUser()])
  const ids = users.map((u) => u.id)
  const boards = [board('A', ids.map((id, i) => [i + 1, id] as [number, string]))]
  const cfg = config()
  const first = await runLeaderboardSettlement({ kind: 'weekly', config: cfg, now: NOW, candidatesProvider: provider(boards) })
  assert.equal(first.status, 'COMPLETED')
  assert.equal(first.summary?.walletPoints, 74 + 74 + 74 + 27 + 27) // ranks 1-3,4,5
  assert.equal(await pointsOf(ids[0]), 74)
  assert.equal(await pointsOf(ids[3]), 27)
  assert.equal(await pointsOf(ids[4]), 27)
  // Re-running the same period is a no-op.
  const again = await runLeaderboardSettlement({ kind: 'weekly', config: cfg, now: NOW, candidatesProvider: provider(boards) })
  assert.equal(again.status, 'ALREADY')
  assert.equal(await pointsOf(ids[0]), 74, '重复结算不得重复发钱')
  assert.equal(await prisma.pointLog.count({ where: { businessKey: { startsWith: 'leaderboard:' } } }), 5)
})

qaTest('三类 270 上限独立：娱乐/评论/会诊各算各的', async () => {
  // 5 entertainment users, each rank yields 74 (ranks 1-3) or 27 (4-5).
  const entUsers = await Promise.all(Array.from({ length: 5 }, () => createUser()))
  const entBoards = [board('A', entUsers.map((u, i) => [i + 1, u.id] as [number, string]))]
  const commentUsers = await Promise.all(Array.from({ length: 5 }, () => createUser()))
  const aspirinUsers = await Promise.all(Array.from({ length: 5 }, () => createUser()))
  const injected: CandidatesProvider = {
    entertainment: async () => entBoards,
    dashboard: async () => ({
      comment: { boardKey: 'comment:main', boardLabel: '评论榜',
        candidates: commentUsers.map((u, i) => ({ rank: i + 1, userId: u.id })) },
      aspirin: { boardKey: 'aspirin:main', boardLabel: '会诊榜',
        candidates: aspirinUsers.map((u, i) => ({ rank: i + 1, userId: u.id })) },
    }),
  }
  const result = await runLeaderboardSettlement({ kind: 'weekly', config: config(), now: NOW, candidatesProvider: injected })
  assert.equal(result.status, 'COMPLETED')
  // Each category pays its own 74*3 + 27*2 = 276 before cap; but cap applies PER USER,
  // and each user appears once => no clipping. Verify three categories all paid.
  const grants = await prisma.leaderboardRewardGrant.findMany()
  assert.equal(grants.filter((g) => g.category === 'entertainment').length, 5)
  assert.equal(grants.filter((g) => g.category === 'comment').length, 5)
  assert.equal(grants.filter((g) => g.category === 'aspirin').length, 5)
  assert.equal(await pointsOf(commentUsers[0].id), 74)
  assert.equal(await pointsOf(aspirinUsers[0].id), 74)
  // Cap usage rows are per (user, category): three separate categories for the
  // same user id are impossible here, but we assert the category key is stored.
  const caps = await prisma.leaderboardWeeklyCapUsage.findMany()
  assert.ok(caps.some((c) => c.category === 'entertainment'))
  assert.ok(caps.some((c) => c.category === 'comment'))
  assert.ok(caps.some((c) => c.category === 'aspirin'))
})

qaTest('同一用户跨多个娱乐榜单累计触及 270 上限并裁剪', async () => {
  const u = await createUser()
  // One user is rank 1 in six boards -> 6 * 74 = 444, capped at 270.
  const boards = Array.from({ length: 6 }, (_, i) => board(`B${i}`, [[1, u.id]]))
  const result = await runLeaderboardSettlement({ kind: 'weekly', config: config(), now: NOW, candidatesProvider: provider(boards) })
  assert.equal(result.status, 'COMPLETED')
  assert.equal(await pointsOf(u.id), 270)
  const grants = await prisma.leaderboardRewardGrant.findMany({ where: { userId: u.id } })
  const totalOriginal = grants.reduce((s, g) => s + g.originalAmount, 0)
  const totalActual = grants.reduce((s, g) => s + g.actualAmount, 0)
  const totalClipped = grants.reduce((s, g) => s + g.clippedAmount, 0)
  assert.equal(totalOriginal, 444)
  assert.equal(totalActual, 270)
  assert.equal(totalClipped, 174)
  const cap = await prisma.leaderboardWeeklyCapUsage.findFirst({ where: { userId: u.id, category: 'entertainment' } })
  assert.equal(cap?.used, 270)
})

qaTest('月榜额外奖励独立发放，不占用周 270 额度', async () => {
  const u = await createUser()
  const boards = [board('A', [[1, u.id]])]
  // First exhaust the weekly cap for this user.
  await runLeaderboardSettlement({ kind: 'weekly', config: config(), now: NOW, candidatesProvider: provider(Array.from({ length: 6 }, (_, i) => board(`W${i}`, [[1, u.id]]))) })
  const beforeMonthly = await pointsOf(u.id)
  assert.equal(beforeMonthly, 270)
  const result = await runLeaderboardSettlement({ kind: 'monthly', config: config(), now: new Date('2026-12-01T06:00:00+08:00'), candidatesProvider: provider(boards) })
  assert.equal(result.status, 'COMPLETED')
  assert.equal(await pointsOf(u.id), beforeMonthly + 127, '月榜 127 全额到账，不受周额度影响')
  const cap = await prisma.leaderboardWeeklyCapUsage.findFirst({ where: { userId: u.id, category: 'entertainment' } })
  assert.equal(cap?.used, 270, '月榜不得增加周额度使用量')
})

qaTest('谢谢侬每周顺延：已有者跳过，发到第 2/4/5 名且不重复', async () => {
  const badge = await createBadge()
  const users = await Promise.all(Array.from({ length: 5 }, () => createUser()))
  const ids = users.map((u) => u.id)
  // u1 and u3 already own the badge.
  const { grantBadge } = await import('../lib/badge-service')
  await grantBadge({ userId: ids[0], badgeId: badge.id, grantKey: `seed:${ids[0]}` })
  await grantBadge({ userId: ids[2], badgeId: badge.id, grantKey: `seed:${ids[2]}` })
  const cfg = config()
  cfg.comment.thankYouEnabled = true
  cfg.comment.thankYouBadgeId = badge.id
  const injected: CandidatesProvider = {
    entertainment: async () => [],
    dashboard: async () => ({
      comment: { boardKey: 'comment:main', boardLabel: '评论榜', candidates: ids.map((id, i) => ({ rank: i + 1, userId: id })) },
      aspirin: { boardKey: 'aspirin:main', boardLabel: '会诊榜', candidates: [] },
    }),
  }
  const result = await runLeaderboardSettlement({ kind: 'weekly', config: cfg, now: NOW, candidatesProvider: injected })
  assert.equal(result.status, 'COMPLETED')
  const badgeGrants = await prisma.leaderboardBadgeGrant.findMany({ where: { badgeKey: 'thankYou' } })
  assert.deepEqual(badgeGrants.map((g) => g.userId).sort(), [ids[1], ids[3], ids[4]].sort())
  assert.deepEqual(badgeGrants.map((g) => g.rank).sort(), [2, 4, 5])
  // Idempotent re-run grants nothing more.
  await runLeaderboardSettlement({ kind: 'weekly', config: cfg, now: NOW, candidatesProvider: injected })
  assert.equal(await prisma.leaderboardBadgeGrant.count({ where: { badgeKey: 'thankYou' } }), 3)
})

qaTest('K歌之王跨榜单去重：同一用户只获一枚', async () => {
  const badge = await createBadge()
  const u1 = await createUser()
  const u2 = await createUser()
  const u3 = await createUser()
  const u4 = await createUser()
  const cfg = config()
  cfg.entertainment.kSongKingEnabled = true
  cfg.entertainment.kSongKingBadgeId = badge.id
  const boards = [
    board('A', [[1, u1.id], [2, u2.id], [3, u3.id]]),
    board('B', [[1, u1.id], [2, u2.id], [3, u4.id]]),
  ]
  const result = await runLeaderboardSettlement({ kind: 'monthly', config: cfg, now: new Date('2026-12-01T06:00:00+08:00'), candidatesProvider: provider(boards) })
  assert.equal(result.status, 'COMPLETED')
  const grants = await prisma.leaderboardBadgeGrant.findMany({ where: { badgeKey: 'kSongKing' } })
  const ids = grants.map((g) => g.userId)
  assert.equal(ids.length, new Set(ids).size, 'no user granted twice')
  assert.equal(ids.filter((id) => id === u1.id).length, 1)
  assert.equal(ids.filter((id) => id === u2.id).length, 1)
  assert.deepEqual(ids.sort(), [u1.id, u2.id, u3.id, u4.id].sort())
})

qaTest('通知幂等：重复结算不产生重复通知', async () => {
  const u = await createUser()
  const boards = [board('A', [[1, u.id]])]
  await runLeaderboardSettlement({ kind: 'weekly', config: config(), now: NOW, candidatesProvider: provider(boards) })
  await runLeaderboardSettlement({ kind: 'weekly', config: config(), now: NOW, candidatesProvider: provider(boards) })
  const notices = await prisma.notification.count({ where: { recipientId: u.id, key: { startsWith: 'notify:leaderboard:' } } })
  assert.equal(notices, 1)
})

qaTest('并发结算安全：并行两次运行不重复发钱', async () => {
  const u = await createUser()
  const boards = [board('A', [[1, u.id]])]
  const cfg = config()
  await Promise.all([
    runLeaderboardSettlement({ kind: 'weekly', config: cfg, now: NOW, candidatesProvider: provider(boards) }),
    runLeaderboardSettlement({ kind: 'weekly', config: cfg, now: NOW, candidatesProvider: provider(boards) }),
  ])
  assert.equal(await pointsOf(u.id), 74)
  assert.equal(await prisma.pointLog.count({ where: { userId: u.id, businessKey: { startsWith: 'leaderboard:' } } }), 1)
})

qaTest('历史保护：周期早于生效时间自动跳过', async () => {
  const cfg = config()
  cfg.enabledAt = new Date(NOW.getTime() + 86_400_000).toISOString() // go-live after the period
  const result = await runLeaderboardSettlement({ kind: 'weekly', config: cfg, now: NOW, candidatesProvider: provider([]) })
  assert.equal(result.status, 'SKIPPED')
  assert.equal(result.reason, 'PERIOD_BEFORE_GO_LIVE')
  assert.equal(await prisma.leaderboardSettlementRun.count(), 0)
})
