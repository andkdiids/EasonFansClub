import { Prisma } from '@prisma/client'
import { randomBytes, randomInt } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { createNotificationWithDb } from '@/lib/notification-write'
import { awardRegistrationFee, consumeRegistrationFee, getRegistrationFeeHistoryWindow, type RegistrationFeeHistoryRange } from '@/lib/registration-fee'
import { activityTier, captureMode, defaultShunConfig, friendPoolDraw, pickStratified, shunDay, shunRulesChanged, shuffle, validateShunConfig, weightedIndex, SHUN_NOTIFY_STATUS, SHUN_NOTIFY_WINDOW_MS, type ShunConfig } from './shun-master-rules'
import { ANONYMOUS_LETTER_NOTIFICATION, anonymousLetterNotificationLink, readAnonymousMessageField, type AnonymousMessageField } from './shun-anonymous-letter'
import { shunInvestigationLink } from './shun-letter-notification'
import { shunPerson } from './shun-person'
import { pickDecoys, type DecoyCandidate } from './shun-decoys'

// Re-exported for callers that historically imported it from the service.
export { shunPerson } from './shun-person'

type Tx = Prisma.TransactionClient
type Round = Prisma.ShunMasterRoundGetPayload<Record<string, never>>
const eligible = { isDeleted: false, status: 'ACTIVE' } as const
// A permanent opt-out is durable and irreversible; it participates in every
// authoritative eligibility check, both in Prisma predicates and raw SQL.
const stillParticipating = { permanentlyOptedOutAt: null } as const
const transactionAccount = { ...eligible, ...stillParticipating, Profile: { isNot: null } } as const
const candidateAccount = Prisma.sql`
  u.status = 'ACTIVE' AND u.isDeleted = false
  AND u.permanentlyOptedOutAt IS NULL
  AND EXISTS (SELECT 1 FROM Profile p WHERE p.userId = u.id)
`
// Existing refusals are durable. Any future time-limited protection belongs
// in the eligibility predicate, without weakening the historical refusal.
const hasRefusedDebit = Prisma.sql`EXISTS (
  SELECT 1 FROM ShunMasterProtection p WHERE p.userId = u.id AND p.protected = true
)`
const hasSpendableBalance = Prisma.sql`u.points > 0`
const candidateFilter = Prisma.sql`${candidateAccount} AND NOT ${hasRefusedDebit}`

export async function getShunCandidateSummary(tx: Tx, day: string, victimCap: number) {
  const rows = await tx.$queryRaw<{ reason: string; count: bigint }[]>`
    SELECT pool.reason, COUNT(*) AS count FROM (
      SELECT CASE
        WHEN NOT (${candidateAccount}) THEN 'account'
        WHEN ${hasRefusedDebit} THEN 'refused'
        WHEN NOT (${hasSpendableBalance}) THEN 'balance'
        WHEN reached.victimId IS NOT NULL THEN 'dailyCap'
        ELSE 'eligible'
      END AS reason
      FROM User u
      LEFT JOIN (
        SELECT victimId FROM ShunMasterRound WHERE day = ${day}
        GROUP BY victimId HAVING COUNT(*) >= ${victimCap}
      ) reached ON reached.victimId = u.id
    ) pool GROUP BY pool.reason
  `
  const counts = new Map(rows.map(row => [row.reason, Number(row.count)]))
  return {
    day, eligible: counts.get('eligible') ?? 0,
    excluded: { account: counts.get('account') ?? 0, refused: counts.get('refused') ?? 0,
      balance: counts.get('balance') ?? 0, dailyCap: counts.get('dailyCap') ?? 0 },
  }
}
/** One eligible target, already reduced to the activity tier the lottery needs. */
type TargetCandidate = { id: string; uid: number; tier: number }

/**
 * Read-only snapshot of every account that may be drawn as a target.
 *
 * It is deliberately taken OUTSIDE the settlement transaction: the two-stage
 * lottery needs the whole eligible population (a 128-row sample would let
 * headcount dominate again), and doing that scan while holding the settings row
 * lock made concurrent transfers time out. Nothing here is authoritative — the
 * chosen victim is re-verified under `FOR UPDATE` before any amount moves.
 */
async function loadTargetPopulation(rangeStart: Date, day: string, now: Date): Promise<TargetCandidate[]> {
  const pool = await prisma.$queryRaw<{ id: string; uid: number; lastActiveAt: Date | null; lastLoginAt: Date | null }[]>`
    SELECT u.id, u.uid, u.lastActiveAt, u.lastLoginAt FROM User u
    WHERE ${candidateAccount} AND NOT ${hasRefusedDebit} AND ${hasSpendableBalance}`
  if (!pool.length) return []
  const checkins = await prisma.checkIn.findMany({ where: { userId: { in: pool.map(({ id }) => id) },
    checkinDateKey: { gte: shunDay(rangeStart), lte: day }, isMakeUp: false }, select: { userId: true, checkinDateKey: true } })
  const activeDays = new Map<string, Set<string>>()
  for (const checkin of checkins) {
    const days = activeDays.get(checkin.userId) || new Set<string>()
    days.add(checkin.checkinDateKey)
    activeDays.set(checkin.userId, days)
  }
  // Same activity definition as before: distinct days in the window, plus the
  // days of the last activity and login when they fall inside it.
  return pool.map((user) => {
    const days = activeDays.get(user.id) || new Set<string>()
    for (const date of [user.lastActiveAt, user.lastLoginAt]) if (date && date >= rangeStart && date <= now) days.add(shunDay(date))
    return { id: user.id, uid: user.uid, tier: activityTier(days.size) }
  })
}

/** Accepted, undirected friendships of one account. Pending requests and follows never appear here. */
async function loadFriendIds(actorId: string) {
  const links = await prisma.friendship.findMany({
    where: { OR: [{ userAId: actorId }, { userBId: actorId }] },
    select: { userAId: true, userBId: true },
  })
  return new Set(links.map((link) => link.userAId === actorId ? link.userBId : link.userAId))
}

export class ShunError extends Error {
  constructor(public code: string, message: string, public status = 409) { super(message) }
}

async function settings(tx: Tx) {
  await tx.$queryRaw`SELECT id FROM ShunMasterSettings WHERE id = 1 FOR UPDATE`
  const state = await tx.shunMasterSettings.findUniqueOrThrow({ where: { id: 1 } })
  return { state, config: validateShunConfig(state.config) || defaultShunConfig }
}

export async function shunTransaction<T>(callback: (tx: Tx) => Promise<T>) {
  for (let retry = 0; ; retry++) {
    try {
      return await prisma.$transaction(callback, { isolationLevel: 'ReadCommitted', maxWait: 5000, timeout: 15000 })
    } catch (error) {
      if (retry >= 2 || !(error instanceof Prisma.PrismaClientKnownRequestError)
        || (error.code !== 'P2034' && !(error.code === 'P2010' && error.meta?.code === '1213'))) throw error
    }
  }
}

async function lockAccounts(tx: Tx, ids: string[]) {
  const accounts = await tx.$queryRaw<Array<{ id: string; points: number }>>`
    SELECT id, points FROM User WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`
  return new Map(accounts.map(({ id, points }) => [id, points]))
}

async function ledger(tx: Tx, id: string, userId: string, before: number, delta: number,
  kind: 'take' | 'recover' | 'compensate', reversal?: string) {
  if (!delta) return
  const after = before + delta
  if (after < 0 || after > 2147483647) throw new ShunError('BALANCE', '目前无法完成挂号费结算，请稍后重试。')
  const action = kind === 'take' ? 'SHUN_STEAL' : kind === 'recover' ? 'SHUN_RECOVERY' : 'SHUN_COMPENSATION'
  const entry = {
    userId, action, businessKey: `shun:${id}:${kind}:${userId}`,
    // Point history is user-visible. Keep opponent identifiers out of the description.
    reason: kind === 'take' ? '顺大师 · 顺取' : kind === 'recover' ? '顺大师 · 追回' : '顺大师 · 平台补偿',
    reversalOfBusinessKey: reversal,
  } as const
  const posted = delta > 0
    ? await awardRegistrationFee(tx, { ...entry, requestedAmount: delta })
    : await consumeRegistrationFee(tx, { ...entry, amount: -delta })
  if (posted.duplicate || posted.totalPoints !== after) throw new Error('SHUN_LEDGER_CONFLICT')
}

function notify(tx: Tx, id: string, recipientId: string, title: string, content: string, kind: string, link?: string) {
  return createNotificationWithDb(tx, { data: {
    type: 'SYSTEM', recipientId, title, content,
    link: link ?? `/shun-master?record=${id}${kind === 'recover-actor' ? '&side=out' : ''}`,
    key: `shun:${id}:${kind}`,
  } })
}
async function present(tx: Tx, round: Round, side: 'out' | 'in', hasLetter = false) {
  const visible = side === 'out' || round.result !== null
  return {
    id: round.id, amount: round.amount, recovered: round.recovered, result: round.result,
    createdAt: round.createdAt, goldenUntil: round.goldenUntil, canCapture: (round.candidates as string[]).length === 3,
    person: visible ? await shunPerson(tx, side === 'out' ? round.victimId : round.actorId) : null,
    // Recipient-side flag only: the sender never learns whether a letter exists
    // from anybody else's view, and it is derived from an ownership-scoped query.
    ...(side === 'in' ? { hasLetter } : {}),
  }
}

export async function shunStatus(userId: string) {
  const serverNow = new Date()
  const day = shunDay(serverNow)
  const [state, account, attempts, received] = await Promise.all([
    prisma.shunMasterSettings.findUnique({ where: { id: 1 } }),
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { points: true, permanentlyOptedOutAt: true } }),
    prisma.shunMasterRound.count({ where: { actorId: userId, day } }),
    prisma.shunMasterRound.count({ where: { victimId: userId, day } }),
  ])
  const config = validateShunConfig(state?.config) || defaultShunConfig
  const optedOut = account.permanentlyOptedOutAt !== null
  return { enabled: config.enabled, optedOut,
    balance: account.points,
    remaining: Math.max(0, config.attempts - attempts), received, attempts: config.attempts,
    victimCap: config.victimCap, goldenMinutes: config.goldenMinutes, serverNow }
}

/**
 * Cheap recency bucket for the look-matching only.
 *
 * The authoritative activity tier still comes from `activityTier(check-in days)`
 * and is what the victim lottery uses; decoys only need a comparable signal, and
 * re-deriving tiers for every candidate would add a check-in scan to the
 * settlement transaction.
 */
function recencyTier(lastActiveAt: Date | null) {
  if (!lastActiveAt) return 0
  const days = (Date.now() - lastActiveAt.getTime()) / 86_400_000
  if (days <= 1) return 4
  if (days <= 3) return 3
  if (days <= 7) return 2
  if (days <= 30) return 1
  return 0
}

function decoyCandidate(row: { id: string; avatarUrl: string | null; lastActiveAt: Date | null }): DecoyCandidate {
  return {
    id: row.id,
    hasAvatar: typeof row.avatarUrl === 'string' && row.avatarUrl.length > 0,
    tier: recencyTier(row.lastActiveAt),
    lastActiveAt: row.lastActiveAt ? row.lastActiveAt.getTime() : 0,
  }
}

/**
 * Loads the three decoy pools with bounded, indexed queries (one friendship
 * lookup for the victim, one ordered recency scan, one random fallback) and
 * hands them to the pure selector. Never scans the whole user table and never
 * touches the ledger, so the settlement transaction stays short.
 */
async function selectDecoys(tx: Tx, input: {
  actorId: string; victimId: string; actorHasAvatar: boolean; actorTier: number
}) {
  const links = await tx.friendship.findMany({
    where: { OR: [{ userAId: input.victimId }, { userBId: input.victimId }] },
    select: { userAId: true, userBId: true }, take: 500,
  })
  const friendIds = [...new Set(links.map((link) => link.userAId === input.victimId ? link.userBId : link.userAId))]
  const excluded = [input.actorId, input.victimId]
  const rows = Prisma.sql`
    SELECT u.id, u.avatarUrl, u.lastActiveAt FROM User u
  `
  const friends = friendIds.length
    ? await tx.$queryRaw<Array<{ id: string; avatarUrl: string | null; lastActiveAt: Date | null }>>`
        ${rows} WHERE u.id IN (${Prisma.join(friendIds)}) AND ${candidateFilter} LIMIT 200`
    : []
  const active = await tx.$queryRaw<Array<{ id: string; avatarUrl: string | null; lastActiveAt: Date | null }>>`
    ${rows} WHERE ${candidateFilter} AND u.id NOT IN (${Prisma.join(excluded)})
    ORDER BY u.lastActiveAt DESC LIMIT 60`
  const fallback = await tx.$queryRaw<Array<{ id: string; avatarUrl: string | null; lastActiveAt: Date | null }>>`
    ${rows} WHERE ${candidateFilter} AND u.id NOT IN (${Prisma.join(excluded)})
    ORDER BY SHA2(CONCAT(${randomBytes(16).toString('hex')}, u.id), 256) LIMIT 12`
  return pickDecoys({
    friends: friends.map(decoyCandidate),
    active: active.map(decoyCandidate),
    fallback: fallback.map(decoyCandidate),
  }, { id: input.actorId, hasAvatar: input.actorHasAvatar, tier: input.actorTier }, 2, randomInt, [input.victimId])
}

export async function shunAttempt(actorId: string, requestId: string) {
  const now = new Date()
  const day = shunDay(now)
  const rangeStart = new Date(`${shunDay(new Date(now.getTime() - 6 * 86_400_000))}T00:00:00+08:00`)
  // Read-only snapshot, taken before the settlement transaction so that the
  // serialised section (settings lock, account locks, ledger) stays short even
  // when many players click at once.
  const [population, friendIds] = await Promise.all([
    loadTargetPopulation(rangeStart, day, now),
    loadFriendIds(actorId),
  ])
  const result = await shunTransaction(async (tx) => {
    const { config } = await settings(tx)
    const previous = await tx.shunMasterRound.findUnique({ where: { actorId_requestId: { actorId, requestId } } })
    // A replay of a completed request must never take a second fee, and must
    // never reopen the letter decision either.
    if (previous) return present(tx, previous, 'out')
    if (!config.enabled) throw new ShunError('DISABLED', '顺大师暂未开放。')
    // Authoritative server-side gate: a permanently opted-out actor can never
    // start a new take, even by replaying an old request id or calling the API
    // directly with the button hidden in the UI.
    const optedOut = await tx.user.findFirst({ where: { id: actorId, permanentlyOptedOutAt: { not: null } }, select: { id: true } })
    if (optedOut) throw new ShunError('OPTED_OUT', '你已永久退出顺大师，无法继续顺取。', 403)
    const actor = await tx.user.findFirst({ where: { id: actorId, ...transactionAccount },
      select: { email: true, phone: true, emailVerifiedAt: true, phoneVerifiedAt: true, avatarUrl: true, lastActiveAt: true } })
    if (!actor) throw new ShunError('ACCOUNT', '当前账号无法参与顺大师。', 403)
    const played = await tx.shunMasterRound.findMany({ where: { actorId, day }, select: { victimId: true } })
    if (played.length >= config.attempts) throw new ShunError('LIMIT', '今日收工，明天继续！')
    const blocks = await tx.block.findMany({ where: { OR: [{ blockerId: actorId }, { blockedId: actorId }] },
      select: { blockerId: true, blockedId: true } })
    const capped = await tx.shunMasterRound.groupBy({ by: ['victimId'], where: { day }, _count: { _all: true } })
    const excluded = new Set([actorId, ...played.map((round) => round.victimId),
      ...capped.filter((row) => row._count._all >= config.victimCap).map((row) => row.victimId),
      ...blocks.map((block) => block.blockerId === actorId ? block.blockedId : block.blockerId)])
    const linked = [
      ...(actor.email && actor.emailVerifiedAt ? [{ email: actor.email, emailVerifiedAt: { not: null } }] : []),
      ...(actor.phone && actor.phoneVerifiedAt ? [{ phone: actor.phone, phoneVerifiedAt: { not: null } }] : []),
    ]
    const relatedAccounts = linked.length
      ? (await tx.user.findMany({ where: { OR: linked }, select: { id: true } })).map(({ id }) => id)
      : []
    const targetExclusions = new Set([...excluded, ...relatedAccounts])
    // The population and its activity tiers were read before the transaction;
    // only the per-actor exclusions and the victim verification stay serialised.
    const eligibleTargets = population.filter((target) => !targetExclusions.has(target.id))
    if (!eligibleTargets.length) {
      const [funded, protectedFunded] = await Promise.all([
        tx.user.count({ where: { ...transactionAccount, points: { gt: 0 } } }),
        tx.$queryRaw<{ count: bigint }[]>`
          SELECT COUNT(*) AS count FROM ShunMasterProtection p JOIN User u ON u.id = p.userId
          WHERE p.protected = true AND ${candidateAccount} AND ${hasSpendableBalance}
        `,
      ])
      await tx.userOperationLog.create({ data: { userId: actorId, category: 'SHUN_MASTER', action: 'NO_TARGET',
        summary: '没有符合条件的顺取目标', source: 'WEB', operatorType: 'USER',
        metadata: { funded, protectedFunded: Number(protectedFunded[0].count), capped: capped.filter(row => row._count._all >= config.victimCap).length,
          blocked: blocks.length, linked: relatedAccounts.length, previouslyMatched: played.length } } })
      return null
    }
    // Friend-first pool: a subset of the very same eligible set, so balance,
    // daily cap, blocks, related accounts, already-hit targets and every other
    // existing rule keep applying. Only the draw order changes, and the pool is
    // silently abandoned when it holds nobody.
    const friendPool = config.friendChance > 0 && friendIds.size
      ? eligibleTargets.filter((target) => friendIds.has(target.id))
      : []
    const friendPoolUsed = friendPool.length > 0 && friendPoolDraw(config.friendChance, randomInt)
    const victim = pickStratified(friendPoolUsed ? friendPool : eligibleTargets, config.weights, randomInt)
    if (!victim) {
      await tx.userOperationLog.create({ data: { userId: actorId, category: 'SHUN_MASTER', action: 'NO_TARGET',
        summary: '没有符合条件的顺取目标', source: 'WEB', operatorType: 'USER',
        metadata: { reason: 'NO_ELIGIBLE_TIER', eligible: eligibleTargets.length } } })
      return null
    }
    const accounts = await lockAccounts(tx, [actorId, victim.id])
    const actorBalance = accounts.get(actorId)
    const victimBalance = accounts.get(victim.id)
    if (actorBalance === undefined || actorBalance < 0 || victimBalance === undefined || victimBalance <= 0 || shunDay(new Date()) !== day
      || await tx.user.count({ where: { ...transactionAccount, id: { in: [actorId, victim.id] } } }) !== 2) {
      throw new ShunError('BALANCE', '账户状态或结算日期已变化，顺取次数未扣除。')
    }
    const rolled = weightedIndex(config.probabilities) + 1
    const amount = Math.min(rolled, victimBalance)
    // Decoys are chosen from the victim's friends first, then from recently
    // active accounts, always preferring the same public look as the real actor
    // so the true answer cannot be spotted by avatar or activity alone.
    const selectedDecoys = await selectDecoys(tx, {
      actorId, victimId: victim.id, actorHasAvatar: !!actor.avatarUrl,
      actorTier: recencyTier(actor.lastActiveAt),
    })
    if (selectedDecoys.length !== 2) {
      await tx.userOperationLog.create({ data: { userId: actorId, category: 'SHUN_MASTER', action: 'NO_TARGET',
        summary: '候选不足，未扣除挂号费', source: 'WEB', operatorType: 'USER', metadata: { reason: 'INSUFFICIENT_DECOYS' } } })
      return null
    }
    const candidates = shuffle([actorId, ...selectedDecoys])
    const round = await tx.shunMasterRound.create({ data: {
      actorId, victimId: victim.id, requestId, day, rolled, amount, createdAt: now,
      goldenUntil: new Date(now.getTime() + config.goldenMinutes * 60000), candidates,
      goldenDecoyId: selectedDecoys[0],
      // Match-source audit for the admin-only statistics. Never exposed to a
      // player, never part of a notification or a letter.
      friendHit: friendPoolUsed, victimTier: victim.tier,
      // The transfer is settled now; the victim is told once the actor decides
      // whether to write, or when this window expires (server-side sweep).
      notifyStatus: SHUN_NOTIFY_STATUS.pending,
      notifyDueAt: new Date(now.getTime() + SHUN_NOTIFY_WINDOW_MS),
    } })
    await tx.shunMasterSettings.update({ where: { id: 1 }, data: { reserved: { increment: amount } } })
    await ledger(tx, round.id, actorId, actorBalance, amount, 'take')
    await ledger(tx, round.id, victim.id, victimBalance, -amount, 'take')
    return present(tx, round, 'out')
  })
  if (!result) throw new ShunError('NO_TARGET', '暂时没有可顺取的 EF，今日次数不会扣除。')
  return result
}

/** Copy of the ordinary (no letter) victim notification. */
export const SHUN_PLAIN_NOTIFICATION_TITLE = '你的挂号费被顺走啦！'
export function shunPlainNotificationContent(amount: number) {
  return `一位神秘 EF 顺走了你 ${amount} 挂号费，快去调查是谁！`
}

/**
 * Turns one pending round into a delivered notification.
 *
 * The transfer itself was settled when the round was created, so this only
 * decides *how* the victim learns about it. Three callers share it:
 * - the actor choosing "no letter" (`auto = false`, plain),
 * - the actor sending a letter (`auto = false`, letter),
 * - the server sweep for an abandoned round (`auto = true`, plain).
 *
 * Everything happens under the settings row lock, so the sweeper and a late
 * "send letter" can never both win, a second notification is impossible, and
 * the golden capture window is only ever set from the real delivery time.
 */
export async function shunNotifyRound(roundId: string, letter: AnonymousMessageField, options: {
  actorId?: string; auto?: boolean
} = {}) {
  return shunTransaction(async (tx) => {
    const { config } = await settings(tx)
    const round = await tx.shunMasterRound.findFirst({
      where: { id: roundId, ...(options.actorId ? { actorId: options.actorId } : {}) },
    })
    if (!round) throw new ShunError('NOT_FOUND', '未找到这条记录。', 404)
    // Already delivered: replaying a plain request is a no-op, but a letter can
    // never be appended afterwards (that would be a second notification).
    if (round.notifyStatus === SHUN_NOTIFY_STATUS.letter) {
      return { status: SHUN_NOTIFY_STATUS.letter, roundId: round.id, goldenUntil: round.goldenUntil }
    }
    if (round.notifyStatus !== SHUN_NOTIFY_STATUS.pending) {
      if (letter.provided) throw new ShunError('ALREADY_NOTIFIED', '本次通知已发送，无法再补充匿名留言。')
      return { status: round.notifyStatus, roundId: round.id, goldenUntil: round.goldenUntil }
    }
    if (letter.provided && letter.error) throw new ShunError('LETTER_INVALID', letter.error, 400)
    const now = new Date()
    // The golden capture window starts when the victim is actually told, for all
    // three paths. It is written once and never re-extended by re-notification.
    const goldenUntil = new Date(now.getTime() + config.goldenMinutes * 60000)
    if (letter.provided && letter.content) {
      await tx.shunMasterAnonymousLetter.create({ data: {
        roundId: round.id, senderId: round.actorId, recipientId: round.victimId, content: letter.content,
      } })
      await notify(tx, round.id, round.victimId, ANONYMOUS_LETTER_NOTIFICATION.title,
        ANONYMOUS_LETTER_NOTIFICATION.content, 'taken-letter', anonymousLetterNotificationLink(round.id))
    } else {
      await notify(tx, round.id, round.victimId, SHUN_PLAIN_NOTIFICATION_TITLE,
        shunPlainNotificationContent(round.amount), 'taken', shunInvestigationLink(round.id))
    }
    const status = letter.provided ? SHUN_NOTIFY_STATUS.letter : SHUN_NOTIFY_STATUS.plain
    await tx.shunMasterRound.update({ where: { id: round.id }, data: {
      notifyStatus: status, notifiedAt: now, goldenUntil, notifyAuto: options.auto === true,
    } })
    return { status, roundId: round.id, goldenUntil }
  })
}

/** Actor-driven choice: `null` means "no letter", a string means "send this letter". */
export function shunSendNotification(actorId: string, roundId: string, anonymousMessage: string | null) {
  return shunNotifyRound(roundId, readAnonymousMessageField(anonymousMessage), { actorId })
}

/** Sweeper entry point: only the expiry path, never a player request. */
export function shunSendDueNotification(roundId: string) {
  return shunNotifyRound(roundId, { provided: false }, { auto: true })
}

export async function shunRecords(userId: string, side: 'out' | 'in', cursor?: string, focus?: string,
  period?: { range: RegistrationFeeHistoryRange; dateKey?: string; now?: Date }) {
  const owner = side === 'out' ? { actorId: userId } : { victimId: userId }
  const now = period?.now ?? new Date()
  const { start, end } = getRegistrationFeeHistoryWindow({ ...period, now })
  const own = { ...owner, ...(start && end ? { createdAt: { gte: start, lt: end } } : {}) }
  const anchor = cursor && await prisma.shunMasterRound.findFirst({ where: { ...own, id: cursor }, select: { id: true } })
  if (cursor && !anchor) throw new ShunError('CURSOR', '记录分页已失效。', 400)
  const rows = await prisma.shunMasterRound.findMany({ where: own, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 21, ...(anchor ? { cursor: anchor, skip: 1 } : {}) })
  const focused = focus ? await prisma.shunMasterRound.findFirst({ where: { ...own, id: focus } }) : null
  const pageRows = rows.slice(0, 20)
  // One extra ownership-scoped query instead of one per row, and only for the
  // recipient side: this drives the "read the letter again" entry.
  const letterRoundIds = side === 'in' && (pageRows.length || focused)
    ? new Set((await prisma.shunMasterAnonymousLetter.findMany({
        where: { recipientId: userId, hiddenAt: null,
          roundId: { in: [...pageRows.map((row) => row.id), ...(focused ? [focused.id] : [])] } },
        select: { roundId: true },
      })).map((row) => row.roundId))
    : new Set<string>()
  return { records: await Promise.all(pageRows.map((row) => present(prisma, row, side, letterRoundIds.has(row.id)))),
    focused: focused && await present(prisma, focused, side, letterRoundIds.has(focused.id)),
    nextCursor: rows.length > 20 ? rows[19].id : null, windowAt: now.toISOString() }
}

export function shunCapture(userId: string, id: string, guess?: { mode: number; uid: number }) {
  return shunTransaction(async (tx) => {
    await settings(tx)
    if (!await tx.user.findFirst({ where: { id: userId, ...eligible }, select: { id: true } })) {
      throw new ShunError('ACCOUNT', '当前账号无法参与顺大师。', 403)
    }
    const round = await tx.shunMasterRound.findFirst({ where: { id, victimId: userId } })
    if (!round) throw new ShunError('NOT_FOUND', '未找到这条记录。', 404)
    if (round.result) return { record: await present(tx, round, 'in') }
    const candidates = round.candidates as string[]
    if (candidates.length !== 3) throw new ShunError('UNAVAILABLE', '可用嫌疑人不足，本次不可抓捕。')
    const accounts = guess ? await lockAccounts(tx, [round.actorId, userId]) : null
    const now = new Date()
    const mode = captureMode(now, round.goldenUntil)
    if (guess && guess.mode !== mode) throw new ShunError('MODE_CHANGED', '抓捕模式已变化，请重新查看候选人。')
    const visible = mode === 2 ? candidates.filter((candidate) => candidate === round.actorId || candidate === round.goldenDecoyId) : candidates
    const people = await Promise.all(visible.map((candidate) => shunPerson(tx, candidate)))
    if (people.some((person) => person === null)) throw new ShunError('UNAVAILABLE', '候选账号不可展示，本次不可抓捕。')
    const options = people.filter((person) => person !== null)
    if (!guess || !accounts) return { mode, candidates: options, goldenUntil: round.goldenUntil, serverNow: now }
    const chosen = options.findIndex((person) => person.uid === guess.uid)
    if (chosen < 0) throw new ShunError('INVALID_CHOICE', '请选择当前候选名单中的 EF。', 400)
    const selectedId = visible[chosen]
    const correct = selectedId === round.actorId
    const actorBalance = accounts.get(round.actorId) ?? 0
    const receiver = accounts.get(userId)
    if (receiver === undefined) throw new ShunError('BALANCE', '目前无法完成挂号费结算。')
    const debit = correct ? Math.min(Math.max(0, actorBalance), round.amount) : 0
    const compensation = correct ? round.amount - debit : 0
    // The full outstanding claim was reserved at the time of transfer.
    await tx.shunMasterSettings.update({ where: { id: 1 }, data: {
      reserved: { decrement: round.amount }, compensated: { increment: compensation },
    } })
    if (correct) {
      await ledger(tx, id, round.actorId, actorBalance, -debit, 'recover', `shun:${id}:take:${round.actorId}`)
      await ledger(tx, id, userId, receiver, debit, 'recover', `shun:${id}:take:${userId}`)
      await ledger(tx, id, userId, receiver + debit, compensation, 'compensate', `shun:${id}:take:${userId}`)
      if (compensation) await tx.userOperationLog.create({ data: {
        userId, category: 'SHUN_MASTER', action: 'COMPENSATION', summary: '触发挂号费补偿', source: 'WEB', operatorType: 'SYSTEM',
        targetType: 'ShunMasterRound', targetId: id, riskLevel: 'MEDIUM', metadata: { compensation, roundId: id },
      } })
      await notify(tx, id, round.actorId, '挂号费被追回啦！', `你之前顺走的 ${round.amount} 挂号费被对方成功追回了！`, 'recover-actor')
    }
    const final = await tx.shunMasterRound.update({ where: { id }, data: { mode, selectedId,
      result: correct ? 'SUCCESS' : 'FAILED', recovered: correct ? round.amount : 0, compensation, capturedAt: now } })
    const actor = options[visible.indexOf(round.actorId)]
    await notify(tx, id, userId, correct ? '抓到你啦！' : '让 TA 溜了！',
      correct ? `你成功追回了 ${round.amount} 挂号费！` : `真正顺走你挂号费的是「${actor?.nickname}」，这次没能追回。`, 'capture')
    return { record: await present(tx, final, 'in') }
  })
}

export async function updateShunConfig(userId: string, draft: ShunConfig) {
  return shunTransaction(async (tx) => {
    const { state, config: old } = await settings(tx)
    const config = { ...draft, enabled: old.enabled }
    const rulesVersion = state.rulesVersion + Number(shunRulesChanged(old, config))
    await tx.shunMasterSettings.update({ where: { id: 1 }, data: { config, rulesVersion } })
    await tx.userOperationLog.create({ data: { userId, operatorUserId: userId, category: 'SHUN_MASTER',
      action: 'CONFIG_UPDATE', summary: '保存顺大师配置', metadata: { old, config, rulesVersion }, source: 'WEB', operatorType: 'ADMIN' } })
    return { config, rulesVersion }
  })
}

export async function setShunEnabled(userId: string, enabled: boolean) {
  return shunTransaction(async (tx) => {
    const { state, config: old } = await settings(tx)
    const config = { ...old, enabled }
    if (old.enabled !== enabled) {
      await tx.shunMasterSettings.update({ where: { id: 1 }, data: { config } })
      await tx.userOperationLog.create({ data: { userId, operatorUserId: userId, category: 'SHUN_MASTER',
        action: 'CONFIG_UPDATE', summary: enabled ? '正式启用顺大师' : '关闭顺大师',
        metadata: { old, config }, source: 'WEB', operatorType: 'ADMIN' } })
    }
    return { config, rulesVersion: state.rulesVersion, effectiveEnabled: enabled }
  })
}

/**
 * Permanently opts a user out of Shun Master. Idempotent: the guarded update
 * only writes for a still-participating account, so repeated requests never
 * move the timestamp and there is no rejoin surface anywhere in the codebase.
 * Existing rounds, ledger entries, letters, notifications and captures are
 * left untouched; already-settled pending notices continue via the V4 sweep.
 */
export async function shunPermanentOptOut(userId: string) {
  const now = new Date()
  return shunTransaction(async (tx) => {
    const result = await tx.user.updateMany({
      where: { id: userId, permanentlyOptedOutAt: null },
      data: { permanentlyOptedOutAt: now },
    })
    if (result.count === 1) {
      await tx.userOperationLog.create({ data: { userId, category: 'SHUN_MASTER', action: 'PERMANENT_OPT_OUT',
        summary: '永久退出顺大师', source: 'WEB', operatorType: 'USER', metadata: { at: now.toISOString() } } })
    }
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { permanentlyOptedOutAt: true } })
    return { optedOut: user.permanentlyOptedOutAt !== null, permanentlyOptedOutAt: user.permanentlyOptedOutAt }
  })
}
