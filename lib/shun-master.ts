import { Prisma } from '@prisma/client'
import { createHmac, randomBytes, randomInt } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { createNotificationWithDb } from '@/lib/notification-write'
import { awardRegistrationFee, consumeRegistrationFee, getRegistrationFeeHistoryWindow, type RegistrationFeeHistoryRange } from '@/lib/registration-fee'
import { activityTier, captureMode, defaultShunConfig, friendPoolDraw, pickStratified, shunDay, shunRulesChanged, shuffle, validateShunConfig, weightedIndex, SHUN_CAPTURE_NOTIFY_STATUS, SHUN_CAPTURE_NOTIFY_WINDOW_MS, SHUN_NOTIFY_STATUS, SHUN_NOTIFY_WINDOW_MS, type ShunConfig } from './shun-master-rules'
import { ANONYMOUS_LETTER_NOTIFICATION, anonymousLetterNotificationLink, readAnonymousMessageField, type AnonymousMessageField } from './shun-anonymous-letter'
import { CAPTURE_RESULT_NOTIFICATION, captureInvestigationLink, captureLetterLink, readCaptureMessageField } from './shun-capture-letter'
import { shunInvestigationLink } from './shun-letter-notification'
import { shunPerson } from './shun-person'
import { pickDecoys, type DecoyCandidate } from './shun-decoys'
import { triggerBadgeEvaluation } from './badge-rule-engine'
import { shunClosedMessage, shunOpenHoursState } from './shun-open-hours'
import { defaultShunItemRules, shunItemsFeatureEnabled, validateShunItemDraft } from './shun-item-config'
import { drawShunItem, SHUN_GIFT_WEIGHTS, SHUN_ITEM_CATALOG } from './shun-item-rules'
import { lockShunItemUsers, postShunItemMovement, ShunItemInventoryError } from './shun-item-inventory'

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
const hasSpendableBalance = Prisma.sql`u.points > 0`

export async function getShunCandidateSummary(tx: Tx, day: string, victimCap: number) {
  const rows = await tx.$queryRaw<{ reason: string; count: bigint }[]>`
    SELECT pool.reason, COUNT(*) AS count FROM (
      SELECT CASE
        WHEN NOT (${candidateAccount}) THEN 'account'
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
    excluded: { account: counts.get('account') ?? 0,
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
    WHERE ${candidateAccount} AND ${hasSpendableBalance}`
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

/**
 * Admin-only, read-only eligibility diagnosis for one target (and optionally one
 * initiating actor's friend-pool view). Mirrors `loadTargetPopulation` and the
 * per-actor exclusions inside `shunAttempt` field by field, so the diagnosis can
 * never disagree with the actual draw. Returns booleans + exclusion reasons
 * only — no email, phone or any other PII ever leaves this function.
 */
export async function diagnoseShunTarget(uid: number, actorUid?: number) {
  const user = await prisma.user.findFirst({
    where: { uid },
    select: { id: true, uid: true, status: true, isDeleted: true, permanentlyOptedOutAt: true,
      points: true, lastActiveAt: true, lastLoginAt: true, Profile: { select: { userId: true } } },
  })
  if (!user) return { found: false as const }
  const now = new Date()
  const day = shunDay(now)
  const rangeStart = new Date(now.getTime() - 6 * 86400000)
  const settingsRow = await prisma.shunMasterSettings.findUnique({ where: { id: 1 }, select: { config: true } })
  const config = settingsRow?.config ?? null
  const parsedConfig = validateShunConfig(config)

  const [receivedToday, receivedEver, checkins] = await Promise.all([
    prisma.shunMasterRound.count({ where: { victimId: user.id, day } }),
    prisma.shunMasterRound.count({ where: { victimId: user.id } }),
    prisma.checkIn.findMany({ where: { userId: user.id, checkinDateKey: { gte: shunDay(rangeStart), lte: day }, isMakeUp: false },
      select: { checkinDateKey: true } }),
  ])
  const activeDays = new Set(checkins.map((row) => row.checkinDateKey))
  for (const date of [user.lastActiveAt, user.lastLoginAt]) if (date && date >= rangeStart && date <= now) activeDays.add(shunDay(date))
  const tier = activityTier(activeDays.size)
  const effectiveConfig = parsedConfig || defaultShunConfig
  const configFellBack = !parsedConfig

  const victimCap = effectiveConfig.victimCap
  const reasons: string[] = []
  if (user.status !== 'ACTIVE') reasons.push('ACCOUNT_NOT_ACTIVE')
  if (user.isDeleted) reasons.push('ACCOUNT_DELETED')
  if (user.permanentlyOptedOutAt) reasons.push('PERMANENT_OPT_OUT')
  if (!user.Profile) reasons.push('NO_PROFILE')
  if (user.points <= 0) reasons.push('ZERO_BALANCE')
  if (receivedToday >= victimCap) reasons.push('DAILY_VICTIM_CAP_REACHED')
  const staticEligible = reasons.length === 0
  const inGlobalPool = staticEligible

  // Optional actor view: friendship recognition + this actor's friend-pool size.
  let actor: {
    found: boolean
    friendRecognized: boolean
    friendshipCreatedAt?: string
    actorBlockedByTarget?: boolean
    relatedAccountsExcluded?: boolean
    matchedToday?: number
    friendPoolSize: number
    friendChance: number
    fallbackReason: string | null
  } | null = null

  if (actorUid !== undefined) {
    const actorUser = await prisma.user.findFirst({ where: { uid: actorUid }, select: { id: true, uid: true } })
    if (!actorUser) {
      actor = { found: false, friendRecognized: false, friendPoolSize: 0,
        friendChance: effectiveConfig.friendChance, fallbackReason: 'ACTOR_NOT_FOUND' }
    } else {
      const link = await prisma.friendship.findFirst({
        where: { OR: [{ userAId: actorUser.id, userBId: user.id }, { userAId: user.id, userBId: actorUser.id }] },
        select: { createdAt: true },
      })
      const [blockRow, actorEmail, targetContact] = await Promise.all([
        prisma.block.findFirst({ where: { OR: [{ blockerId: actorUser.id, blockedId: user.id }, { blockerId: user.id, blockedId: actorUser.id }] }, select: { id: true } }),
        prisma.user.findUnique({ where: { id: actorUser.id }, select: { email: true, emailVerifiedAt: true, phone: true, phoneVerifiedAt: true } }),
        prisma.user.findUnique({ where: { id: user.id }, select: { email: true, emailVerifiedAt: true, phone: true, phoneVerifiedAt: true } }),
      ])
      let related = false
      if (actorEmail && targetContact) {
        related = Boolean(
          (actorEmail.emailVerifiedAt && targetContact.emailVerifiedAt && actorEmail.email && actorEmail.email === targetContact.email)
          || (actorEmail.phoneVerifiedAt && targetContact.phoneVerifiedAt && actorEmail.phone && actorEmail.phone === targetContact.phone),
        )
      }
      const matchedToday = await prisma.shunMasterRound.count({
        where: { actorId: actorUser.id, victimId: user.id, day } })
      // Friend-pool size as `shunAttempt` would compute it: every OTHER accepted
      // friend of the actor that currently passes the static eligibility gate.
      let friendPoolSize = 0
      if (effectiveConfig.friendChance > 0) {
        const friendIds = await loadFriendIds(actorUser.id)
        if (friendIds.size) {
          const rows = await prisma.$queryRaw<{ id: string }[]>`
            SELECT u.id FROM User u
            WHERE ${candidateAccount} AND ${hasSpendableBalance}
              AND u.id IN (${Prisma.join([...friendIds])})`
          friendPoolSize = rows.length
        }
      }
      actor = {
        found: true,
        friendRecognized: Boolean(link),
        ...(link ? { friendshipCreatedAt: link.createdAt.toISOString() } : {}),
        actorBlockedByTarget: Boolean(blockRow),
        relatedAccountsExcluded: related,
        matchedToday,
        friendPoolSize,
        friendChance: effectiveConfig.friendChance,
        // Why a 100% friendChance could still draw a stranger: the friend pool
        // the draw would have used, and the reason it would fall back.
        fallbackReason: friendPoolSize > 0 ? null
          : effectiveConfig.friendChance <= 0 ? 'FRIEND_CHANCE_OFF'
            : link ? 'POOL_EMPTY_AFTER_FILTERS' : 'NO_FRIENDS',
      }
    }
  }

  return {
    found: true as const,
    uid: user.uid,
    eligible: staticEligible,
    inGlobalPool,
    exclusionReasons: reasons,
    victimCap,
    receivedToday,
    receivedEver,
    permanentlyOptedOut: Boolean(user.permanentlyOptedOutAt),
    hasSpendableBalance: user.points > 0,
    activityTier: tier,
    activeDays: activeDays.size,
    configFellBack,
    actor,
  }
}

export class ShunError extends Error {
  /**
   * `details` carries machine-readable context for a few business rejections —
   * notably `SHUN_CLOSED`, where the page needs the live window and the next
   * opening instant even though the status request it holds may be stale.
   */
  constructor(public code: string, message: string, public status = 409,
    public details?: Record<string, unknown>) { super(message) }
}

async function settings(tx: Tx) {
  await tx.$queryRaw`SELECT id FROM ShunMasterSettings WHERE id = 1 FOR UPDATE`
  const state = await tx.shunMasterSettings.findUniqueOrThrow({ where: { id: 1 } })
  const config = validateShunConfig(state.config)
  if (!config) {
    // A stored config that fails validation silently falling back to the
    // defaults once caused "friendChance=100 did not work": the UI showed 100
    // from a stale request while every draw actually used the default 20.
    // Surface it loudly; the operator can then fix the stored JSON instead of
    // chasing random-number bugs that do not exist.
    console.error('[shun-master] stored settings failed validation; falling back to defaults',
      { rulesVersion: state.rulesVersion, config: state.config })
  }
  return { state, config: config || defaultShunConfig }
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
  kind: 'take' | 'recover' | 'compensate' | 'bonus', reversal?: string) {
  if (!delta) return
  const after = before + delta
  if (after < 0 || after > 2147483647) throw new ShunError('BALANCE', '目前无法完成挂号费结算，请稍后重试。')
  const action = kind === 'take' ? 'SHUN_STEAL' : kind === 'recover' ? 'SHUN_RECOVERY'
    : kind === 'bonus' ? 'SHUN_BONUS' : 'SHUN_COMPENSATION'
  const entry = {
    userId, action, businessKey: `shun:${id}:${kind}:${userId}`,
    // Point history is user-visible. Keep opponent identifiers out of the description.
    reason: kind === 'take' ? '顺大师 · 顺取' : kind === 'recover' ? '顺大师 · 追回'
      : kind === 'bonus' ? '顺大师 · 额外奖励' : '顺大师 · 平台补偿',
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
async function present(tx: Tx, round: Round, side: 'out' | 'in', hasLetter = false, hasCaptureLetter = false) {
  const visible = side === 'out' || round.result !== null
  const outcomes = round.result && shunItemsFeatureEnabled() ? await tx.shunItemRoundEffect.findMany({
    where: { roundId: round.id, code: { in: ['RETRY_CAPTURE', 'REVENGE'] } },
    select: { code: true, amount: true },
  }) : []
  return {
    id: round.id, amount: round.amount, recovered: round.recovered, result: round.result,
    createdAt: round.createdAt, goldenUntil: round.goldenUntil, canCapture: [3, 4].includes((round.candidates as string[]).length),
    // The platform bonus is part of the capturer's own settlement view. It is
    // never shown to anybody else and never leaks into the caught player's copy.
    bonusAwarded: round.bonusAwarded,
    ...(outcomes.length ? { itemOutcomes: outcomes } : {}),
    person: visible ? await shunPerson(tx, side === 'out' ? round.victimId : round.actorId) : null,
    // Recipient-side flag only: the sender never learns whether a letter exists
    // from anybody else's view, and it is derived from an ownership-scoped query.
    ...(side === 'in' ? { hasLetter } : {}),
    // Capturer-side flag on both projections: on 「我顺了谁」 it is the actor's
    // own note, and on 「谁顺了我」 it is the viewer's own note about the failed
    // attempt they just caught. It is always computed from `senderId = viewer`,
    // so it can never reveal anybody else's note.
    hasCaptureLetter,
  }
}

export async function shunStatus(userId: string) {
  const serverNow = new Date()
  const day = shunDay(serverNow)
  const [state, account, attempts, received, itemDaily, revengesReceived] = await Promise.all([
    prisma.shunMasterSettings.findUnique({ where: { id: 1 } }),
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { points: true, permanentlyOptedOutAt: true } }),
    prisma.shunMasterRound.count({ where: { actorId: userId, day } }),
    prisma.shunMasterRound.count({ where: { victimId: userId, day } }),
    shunItemsFeatureEnabled() ? prisma.shunItemDaily.findUnique({ where: { userId_day: { userId, day } } }) : null,
    shunItemsFeatureEnabled() ? prisma.shunItemRoundEffect.count({ where: revengeReceivedWhere(day, userId) }) : 0,
  ])
  const config = validateShunConfig(state?.config) || defaultShunConfig
  const optedOut = account.permanentlyOptedOutAt !== null
  return { enabled: config.enabled, optedOut,
    balance: account.points,
    remaining: Math.max(0, config.attempts + (itemDaily?.extraAttemptsGranted ?? 0) - attempts), received: received + revengesReceived, attempts: config.attempts,
    victimCap: config.victimCap, goldenMinutes: config.goldenMinutes,
    // The page renders the closed state and its copy from this snapshot alone,
    // so a window changed in the admin panel shows up without a redeploy.
    openHours: shunOpenHoursState(config, serverNow),
    serverNow }
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
  actorId: string; victimId: string; actorHasAvatar: boolean; actorTier: number; count?: number
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
        ${rows} WHERE u.id IN (${Prisma.join(friendIds)}) AND ${candidateAccount} LIMIT 200`
    : []
  const active = await tx.$queryRaw<Array<{ id: string; avatarUrl: string | null; lastActiveAt: Date | null }>>`
    ${rows} WHERE ${candidateAccount} AND u.id NOT IN (${Prisma.join(excluded)})
    ORDER BY u.lastActiveAt DESC LIMIT 60`
  const fallback = await tx.$queryRaw<Array<{ id: string; avatarUrl: string | null; lastActiveAt: Date | null }>>`
    ${rows} WHERE ${candidateAccount} AND u.id NOT IN (${Prisma.join(excluded)})
    ORDER BY SHA2(CONCAT(${randomBytes(16).toString('hex')}, u.id), 256) LIMIT 12`
  return pickDecoys({
    friends: friends.map(decoyCandidate),
    active: active.map(decoyCandidate),
    fallback: fallback.map(decoyCandidate),
  }, { id: input.actorId, hasAvatar: input.actorHasAvatar, tier: input.actorTier }, input.count ?? 2, randomInt, [input.victimId])
}

/**
 * Settles one take.
 *
 * `clock` is the single source of the server's authoritative time and is read
 * again *inside* the settlement transaction: a request that was accepted at
 * 22:59:59 but reaches the settlement section after 23:00:00 is judged against
 * the instant the qualification checks actually run. Tests inject a frozen
 * clock here instead of relying on the machine's real time.
 */
export async function shunAttempt(actorId: string, requestId: string, clock: () => Date = () => new Date(), targetFriendId?: string) {
  const now = clock()
  const day = shunDay(now)
  // Captured for the post-commit badge refresh of both sides of the transfer.
  let victimId: string | null = null
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
    if (previous && targetFriendId && (previous.victimId !== targetFriendId || !await tx.shunItemRoundEffect.findUnique({
      where: { roundId_code: { roundId: previous.id, code: 'TARGET_FRIEND' } },
    }))) throw new ShunError('FRIEND_UNAVAILABLE', '暂不可顺取。')
    if (previous) return present(tx, previous, 'out')
    if (targetFriendId && !shunItemsFeatureEnabled()) throw new ShunError('FRIEND_UNAVAILABLE', '暂不可顺取。')
    if (!config.enabled) throw new ShunError('DISABLED', '顺大师暂未开放。')
    // Authoritative opening-hours gate. Re-read inside the transaction (not the
    // pre-transaction snapshot) so a boundary crossing cannot be bypassed, and
    // placed before any other work so a closed request touches nothing: no
    // round, no ledger entry, no daily attempt, no notification, no bonus roll.
    const settledAt = clock()
    const openHours = shunOpenHoursState(config, settledAt)
    if (!openHours.open) {
      throw new ShunError('SHUN_CLOSED', shunClosedMessage(config), 409, { openHours })
    }
    // Authoritative server-side gate: a permanently opted-out actor can never
    // start a new take, even by replaying an old request id or calling the API
    // directly with the button hidden in the UI.
    const optedOut = await tx.user.findFirst({ where: { id: actorId, permanentlyOptedOutAt: { not: null } }, select: { id: true } })
    if (optedOut) throw new ShunError('OPTED_OUT', '你已永久退出顺大师，无法继续顺取。', 403)
    const actor = await tx.user.findFirst({ where: { id: actorId, ...transactionAccount },
      select: { email: true, phone: true, emailVerifiedAt: true, phoneVerifiedAt: true, avatarUrl: true, lastActiveAt: true } })
    if (!actor) throw new ShunError('ACCOUNT', '当前账号无法参与顺大师。', 403)
    const played = await tx.shunMasterRound.findMany({ where: { actorId, day }, select: { victimId: true } })
    const itemDaily = shunItemsFeatureEnabled()
      ? await tx.shunItemDaily.findUnique({ where: { userId_day: { userId: actorId, day } } })
      : null
    if (played.length >= config.attempts + (itemDaily?.extraAttemptsGranted ?? 0)) {
      throw new ShunError('LIMIT', '今日收工，明天继续！')
    }
    const blocks = await tx.block.findMany({ where: { OR: [{ blockerId: actorId }, { blockedId: actorId }] },
      select: { blockerId: true, blockedId: true } })
    const capped = await tx.shunMasterRound.groupBy({ by: ['victimId'], where: { day }, _count: { _all: true } })
    const hitsByUser = new Map(capped.map((row) => [row.victimId, row._count._all]))
    if (shunItemsFeatureEnabled()) {
      const revenges = await tx.shunItemRoundEffect.findMany({
        where: revengeReceivedWhere(day), select: { round: { select: { actorId: true } } },
      })
      for (const { round } of revenges) hitsByUser.set(round.actorId, (hitsByUser.get(round.actorId) ?? 0) + 1)
    }
    const excluded = new Set([actorId, ...played.map((round) => round.victimId),
      ...[...hitsByUser].filter(([, count]) => count >= config.victimCap).map(([id]) => id),
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
    const targeted = targetFriendId ? eligibleTargets.find((target) => target.id === targetFriendId && friendIds.has(target.id)) : undefined
    if (targetFriendId && !targeted) throw new ShunError('FRIEND_UNAVAILABLE', '暂不可顺取。')
    if (!eligibleTargets.length) {
      const funded = await tx.user.count({ where: { ...transactionAccount, points: { gt: 0 } } })
      await tx.userOperationLog.create({ data: { userId: actorId, category: 'SHUN_MASTER', action: 'NO_TARGET',
        summary: '没有符合条件的顺取目标', source: 'WEB', operatorType: 'USER',
        metadata: { funded, capped: capped.filter(row => row._count._all >= config.victimCap).length,
          blocked: blocks.length, linked: relatedAccounts.length, previouslyMatched: played.length } } })
      return null
    }
    // Friend-first pool: a subset of the very same eligible set, so balance,
    // daily cap, blocks, related accounts, already-hit targets and every other
    // existing rule keep applying. Only the draw order changes; when it holds
    // nobody the attempt falls back to the global pool and the exact reason is
    // recorded on the round so "100% friendChance drew a stranger" is always
    // diagnosable from data instead of guesswork.
    const friendPool = config.friendChance > 0 && friendIds.size
      ? eligibleTargets.filter((target) => friendIds.has(target.id))
      : []
    const friendPoolUsed = friendPool.length > 0 && friendPoolDraw(config.friendChance, randomInt)
    const friendPoolFallback = friendPoolUsed ? null : friendPool.length > 0
      ? 'DICE_LOSS'
      : config.friendChance <= 0 ? 'FRIEND_CHANCE_OFF'
        : friendIds.size === 0 ? 'NO_FRIENDS' : 'POOL_EMPTY_AFTER_FILTERS'
    const victim = targeted ?? pickStratified(friendPoolUsed ? friendPool : eligibleTargets, config.weights, randomInt)
    if (!victim) {
      await tx.userOperationLog.create({ data: { userId: actorId, category: 'SHUN_MASTER', action: 'NO_TARGET',
        summary: '没有符合条件的顺取目标', source: 'WEB', operatorType: 'USER',
        metadata: { reason: 'NO_ELIGIBLE_TIER', eligible: eligibleTargets.length,
          friendPoolSize: friendPool.length, friendPoolFallback } } })
      return null
    }
    const accounts = await lockAccounts(tx, [actorId, victim.id])
    victimId = victim.id
    const actorBalance = accounts.get(actorId)
    const victimBalance = accounts.get(victim.id)
    if (actorBalance === undefined || actorBalance < 0 || victimBalance === undefined || victimBalance <= 0 || shunDay(settledAt) !== day
      || await tx.user.count({ where: { ...transactionAccount, id: { in: [actorId, victim.id] } } }) !== 2) {
      if (targeted) throw new ShunError('FRIEND_UNAVAILABLE', '暂不可顺取。')
      throw new ShunError('BALANCE', '账户状态或结算日期已变化，顺取次数未扣除。')
    }
    if (targeted) {
      const [userAId, userBId] = [actorId, victim.id].sort()
      const friendship = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM Friendship WHERE userAId = ${userAId} AND userBId = ${userBId} FOR UPDATE`
      const blocked = await tx.block.findFirst({
        where: { OR: [{ blockerId: actorId, blockedId: victim.id }, { blockerId: victim.id, blockedId: actorId }] },
        select: { blockerId: true },
      })
      if (!friendship.length || blocked) throw new ShunError('FRIEND_UNAVAILABLE', '暂不可顺取。')
    }
    const rolled = weightedIndex(config.probabilities) + 1
    const pending = shunItemsFeatureEnabled() ? await currentShunPending(tx, actorId, day) : null
    if (targeted && pending) throw new ShunError('ITEM_PENDING', '请先取消待生效道具。')
    const itemCode = targeted ? 'TARGET_FRIEND' : pending?.code
    const activeItems = itemCode && await tx.shunItemConfigVersion.findFirst({
      orderBy: { version: 'desc' }, include: { definitions: { where: { code: itemCode, enabled: true } } },
    })
    const effect = activeItems && activeItems.enabled && activeItems.definitions.length ? itemCode : null
    if (targeted) {
      const inventory = await tx.shunItemInventory.findUnique({ where: { userId_code: { userId: actorId, code: 'TARGET_FRIEND' } } })
      if (!effect || !inventory?.available) throw new ShunError('ITEM_STOCK', '任我顺暂不可使用。')
    }
    const additionalSuspect = effect === 'EXTRA_SUSPECT'
    const amount = Math.min(effect === 'DOUBLE_AMOUNT' ? Math.min(rolled * 2, 14) : rolled, victimBalance)
    // Decoys are chosen from the victim's friends first, then from recently
    // active accounts, always preferring the same public look as the real actor
    // so the true answer cannot be spotted by avatar or activity alone.
    const selectedDecoys = await selectDecoys(tx, {
      actorId, victimId: victim.id, actorHasAvatar: !!actor.avatarUrl,
      actorTier: recencyTier(actor.lastActiveAt), count: additionalSuspect ? 3 : 2,
    })
    if (selectedDecoys.length !== (additionalSuspect ? 3 : 2)) {
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
      friendHit: !!targeted || friendPoolUsed, victimTier: victim.tier,
      friendPoolSize: friendPool.length,
      friendPoolFallback,
      // The transfer is settled now; the victim is told once the actor decides
      // whether to write, or when this window expires (server-side sweep).
      notifyStatus: SHUN_NOTIFY_STATUS.pending,
      notifyDueAt: new Date(now.getTime() + SHUN_NOTIFY_WINDOW_MS),
    } })
    await tx.shunMasterSettings.update({ where: { id: 1 }, data: { reserved: { increment: amount } } })
    await ledger(tx, round.id, actorId, actorBalance, amount, 'take')
    await ledger(tx, round.id, victim.id, victimBalance, -amount, 'take')
    if (effect && activeItems) {
      const { entry } = await postShunItemMovement(tx, {
        userId: actorId, code: effect, type: 'USED', requestKey: `round:${round.id}`, day, configVersion: activeItems.version,
      }, { consumePending: !!pending })
      if (pending) await tx.shunItemPending.delete({ where: { userId: actorId } })
      await tx.shunItemRoundEffect.create({ data: { roundId: round.id, code: effect, entryId: entry.id, amount } })
    }
    if (itemDaily && played.length >= config.attempts && itemDaily.extraAttemptsUsed < itemDaily.extraAttemptsGranted) {
      await tx.shunItemDaily.update({
        where: { userId_day: { userId: actorId, day } },
        data: { extraAttemptsUsed: { increment: 1 } },
      })
    }
    return present(tx, round, 'out')
  })
  if (!result) throw new ShunError('NO_TARGET', '暂时没有可顺取的 EF，今日次数不会扣除。')
  // Best effort, after commit: the take moved cumulative progress for both
  // accounts. A failed refresh never fails a settled transfer.
  for (const account of [actorId, victimId]) {
    if (account) void triggerBadgeEvaluation(account, 'SHUN_MASTER_SETTLED').catch(() => false)
  }
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
    const ambush = (round.candidates as string[]).length === 4 ? ' 十面埋伏已生效，调查时多一位候选人。' : ''
    if (letter.provided && letter.content) {
      await tx.shunMasterAnonymousLetter.create({ data: {
        roundId: round.id, senderId: round.actorId, recipientId: round.victimId, content: letter.content,
      } })
      await notify(tx, round.id, round.victimId, ANONYMOUS_LETTER_NOTIFICATION.title,
        ANONYMOUS_LETTER_NOTIFICATION.content + ambush, 'taken-letter', anonymousLetterNotificationLink(round.id))
    } else {
      await notify(tx, round.id, round.victimId, SHUN_PLAIN_NOTIFICATION_TITLE,
        shunPlainNotificationContent(round.amount) + ambush, 'taken', shunInvestigationLink(round.id))
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
  // Capturer-side counterpart: `senderId` is always the viewer (on 「我顺了谁」
  // they caught this take, on 「谁顺了我」 they caught the person who took from
  // them), so one ownership-scoped query covers both tabs and can never leak.
  const captureLetterRoundIds = (pageRows.length || focused)
    ? new Set((await prisma.shunMasterCaptureLetter.findMany({
        where: { senderId: userId, hiddenAt: null,
          roundId: { in: [...pageRows.map((row) => row.id), ...(focused ? [focused.id] : [])] } },
        select: { roundId: true },
      })).map((row) => row.roundId))
    : new Set<string>()
  return { records: await Promise.all(pageRows.map((row) => present(prisma, row, side,
      letterRoundIds.has(row.id), captureLetterRoundIds.has(row.id)))),
    focused: focused && await present(prisma, focused, side,
      letterRoundIds.has(focused.id), captureLetterRoundIds.has(focused.id)),
    nextCursor: rows.length > 20 ? rows[19].id : null, windowAt: now.toISOString() }
}

export function shunCapture(userId: string, id: string, guess?: { mode: number; uid: number }) {
  // Captured for the post-commit badge refresh: both sides gained cumulative
  // progress (the victim recovered, the actor's take becomes a real loss).
  let actorId: string | null = null
  return shunTransaction(async (tx) => {
    const { config } = await settings(tx)
    if (!await tx.user.findFirst({ where: { id: userId, ...eligible }, select: { id: true } })) {
      throw new ShunError('ACCOUNT', '当前账号无法参与顺大师。', 403)
    }
    const round = await tx.shunMasterRound.findFirst({ where: { id, victimId: userId } })
    if (!round) throw new ShunError('NOT_FOUND', '未找到这条记录。', 404)
    actorId = round.actorId
    if (round.result) return { record: await present(tx, round, 'in') }
    const candidates = round.candidates as string[]
    if (candidates.length !== 3 && candidates.length !== 4) throw new ShunError('UNAVAILABLE', '可用嫌疑人不足，本次不可抓捕。')
    const accounts = guess ? await lockAccounts(tx, [round.actorId, userId]) : null
    const now = new Date()
    const golden = captureMode(now, round.goldenUntil) === 2
    const mode = golden ? candidates.length - 1 : candidates.length
    if (guess && guess.mode !== mode) throw new ShunError('MODE_CHANGED', '抓捕模式已变化，请重新查看候选人。')
    const hidden = golden ? [...candidates].reverse().find((candidate) => candidate !== round.actorId && candidate !== round.goldenDecoyId) : undefined
    const visible = candidates.filter((candidate) => candidate !== hidden)
    const people = await Promise.all(visible.map((candidate) => shunPerson(tx, candidate)))
    if (people.some((person) => person === null)) throw new ShunError('UNAVAILABLE', '候选账号不可展示，本次不可抓捕。')
    const options = people.filter((person) => person !== null)
    if (!guess || !accounts) return { mode, golden, candidates: options, goldenUntil: round.goldenUntil, serverNow: now }
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
    }
    const final = await tx.shunMasterRound.update({ where: { id }, data: { mode, selectedId,
      result: correct ? 'SUCCESS' : 'FAILED', recovered: correct ? round.amount : 0, compensation, capturedAt: now,
      // Only a successful capture opens the deferred notice window: the caught
      // actor is told once the capturer decides about a counter note, or when
      // the 120-second sweep expires. A failed capture has nobody to tell.
      ...(correct ? {
        captureNotifyStatus: SHUN_CAPTURE_NOTIFY_STATUS.pending,
        captureNotifyDueAt: new Date(now.getTime() + SHUN_CAPTURE_NOTIFY_WINDOW_MS),
      } : {}) } })
    // V5 recovery bonus: platform-funded, equal to the amount actually
    // recovered, decided at most once per capture. The guarded update is the
    // idempotency gate — a replay or a concurrent guess can never re-roll or
    // pay twice, and it shares the round row lock already held by settle.
    if (correct) {
      const won = config.bonusChance > 0 && randomInt(100) < config.bonusChance
      const claimed = await tx.shunMasterRound.updateMany({
        where: { id, bonusRolled: false },
        data: { bonusRolled: true, bonusAwarded: won ? round.amount : 0 },
      })
      if (claimed.count === 1 && won) {
        await ledger(tx, id, userId, receiver + debit + compensation, round.amount, 'bonus')
        await tx.userOperationLog.create({ data: {
          userId, category: 'SHUN_MASTER', action: 'RECOVERY_BONUS', summary: '抓捕成功触发额外奖励',
          source: 'WEB', operatorType: 'SYSTEM', targetType: 'ShunMasterRound', targetId: id,
          metadata: { bonus: round.amount, recovered: round.amount, roundId: id, chance: config.bonusChance },
        } })
      }
    }
    const actor = options[visible.indexOf(round.actorId)]
    await notify(tx, id, userId, correct ? '抓到你啦！' : '让 TA 溜了！',
      correct ? `你成功追回了 ${round.amount} 挂号费！` : `真正顺走你挂号费的是「${actor?.nickname}」，这次没能追回。`, 'capture')
    // Re-read so the capturer's own result carries the persisted bonus amount
    // instead of the pre-roll snapshot.
    const settled = correct ? await tx.shunMasterRound.findUniqueOrThrow({ where: { id } }) : final
    return { record: await present(tx, settled, 'in') }
  }).then((outcome) => {
    // Best effort, after commit: a failed badge refresh must never fail a
    // settled capture, and every metric is re-derivable from the rounds anyway.
    for (const account of [userId, actorId]) {
      if (account) void triggerBadgeEvaluation(account, 'SHUN_MASTER_SETTLED').catch(() => false)
    }
    return outcome
  })
}

/** Capture-result notification copy for the caught actor. */
function notifyCapture(tx: Tx, round: Round, withLetter: boolean) {
  const title = CAPTURE_RESULT_NOTIFICATION.title
  const content = withLetter
    ? CAPTURE_RESULT_NOTIFICATION.letter(round.amount)
    : CAPTURE_RESULT_NOTIFICATION.plain(round.amount)
  return notify(tx, round.id, round.actorId, title, content,
    withLetter ? 'captured-letter' : 'captured',
    withLetter ? captureLetterLink(round.id) : captureInvestigationLink(round.id))
}

/**
 * Turns one successful capture into a delivered capture-result notice.
 *
 * The recovery (and the optional bonus) were settled when the capture was
 * accepted, so this only decides *how* the caught actor learns about it:
 * - the capturer choosing "no note" (`auto = false`, plain),
 * - the capturer sending a counter note (`auto = false`, letter),
 * - the server sweep when the capturer walked away (`auto = true`, plain).
 *
 * Everything runs under the settings row lock, exactly like the take flow, so
 * the sweep and a late "send note" can never both win and a second notice is
 * impossible. A note can never be appended once the plain notice went out.
 */
export async function shunCaptureNotifyRound(roundId: string, letter: AnonymousMessageField, options: {
  capturerId?: string; auto?: boolean
} = {}) {
  const withLetter = letter.provided && !!letter.content
  const outcome = await shunTransaction(async (tx) => {
    await settings(tx)
    const round = await tx.shunMasterRound.findFirst({
      where: { id: roundId, ...(options.capturerId ? { victimId: options.capturerId } : {}) },
    })
    if (!round) throw new ShunError('NOT_FOUND', '未找到这条记录。', 404)
    // A failed capture never exposes the actor and never accepts a note.
    if (round.result !== 'SUCCESS') throw new ShunError('NOT_CAPTURED', '本次抓捕未成功，无法留言。', 409)
    if (round.captureNotifyStatus === SHUN_CAPTURE_NOTIFY_STATUS.letter) {
      return { status: SHUN_CAPTURE_NOTIFY_STATUS.letter, roundId: round.id }
    }
    if (round.captureNotifyStatus !== SHUN_CAPTURE_NOTIFY_STATUS.pending) {
      if (letter.provided) throw new ShunError('ALREADY_NOTIFIED', '抓捕通知已发送，无法再补充留言。')
      return { status: round.captureNotifyStatus, roundId: round.id }
    }
    if (letter.provided && letter.error) throw new ShunError('LETTER_INVALID', letter.error, 400)
    const now = new Date()
    if (withLetter) {
      // `roundId` is unique, so this can never grow a second note; the status
      // check above already guarantees the plain notice did not win.
      await tx.shunMasterCaptureLetter.create({ data: {
        roundId: round.id, senderId: round.victimId, recipientId: round.actorId, content: letter.content as string,
      } })
    }
    await notifyCapture(tx, round, withLetter)
    const status = withLetter ? SHUN_CAPTURE_NOTIFY_STATUS.letter : SHUN_CAPTURE_NOTIFY_STATUS.plain
    await tx.shunMasterRound.update({ where: { id: round.id }, data: {
      captureNotifyStatus: status, captureNotifiedAt: now, captureNotifyAuto: options.auto === true,
    } })
    return { status, roundId: round.id }
  })
  return outcome
}

/** Capturer-driven choice: `null` means "no note", a string means "send this note". */
export function shunSendCaptureNotification(capturerId: string, roundId: string, message: string | null) {
  return shunCaptureNotifyRound(roundId, readCaptureMessageField(message), { capturerId })
}

/** Sweeper entry point for an abandoned capture result. */
export function shunSendDueCaptureNotification(roundId: string) {
  return shunCaptureNotifyRound(roundId, { provided: false }, { auto: true })
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

export async function useShunExtraAttempt(userId: string, requestId: string, clock = () => new Date()) {
  if (!shunItemsFeatureEnabled()) throw new ShunError('DISABLED', '顺大师道具暂未开放。', 404)
  try {
    return await shunTransaction(async (tx) => {
      const { config } = await settings(tx)
      await lockShunItemUsers(tx, [userId])
      const requestKey = `extra-attempt:${requestId}`
      const existing = await tx.shunItemEntry.findUnique({
        where: { userId_type_requestKey: { userId, type: 'USED', requestKey } },
      })
      if (existing) return { applied: true, day: existing.day }
      const active = await tx.shunItemConfigVersion.findFirst({
        orderBy: { version: 'desc' },
        include: { definitions: true },
      })
      if (!config.enabled || !active?.enabled || !active.definitions.some((item) => item.code === 'EXTRA_ATTEMPT' && item.enabled)) {
        throw new ShunError('DISABLED', '顺手牵羊暂不可使用。')
      }
      const account = await tx.user.findFirst({ where: { id: userId, ...transactionAccount }, select: { id: true } })
      if (!account) throw new ShunError('ACCOUNT', '当前账号无法参与顺大师。', 403)
      const day = shunDay(clock())
      const where = { userId_day: { userId, day } }
      const daily = await tx.shunItemDaily.findUnique({ where })
      const limit = (validateShunItemDraft(active)?.rules ?? defaultShunItemRules).extraAttempts
      if ((daily?.extraAttemptsGranted ?? 0) >= limit) {
        throw new ShunError('LIMIT', '今天已达到顺手牵羊使用上限。')
      }
      await postShunItemMovement(tx, { userId, code: 'EXTRA_ATTEMPT', type: 'USED', requestKey, day, configVersion: active.version })
      await tx.shunItemDaily.upsert({
        where,
        create: { userId, day, extraAttemptsGranted: 1 },
        update: { extraAttemptsGranted: { increment: 1 } },
      })
      return { applied: true, day }
    })
  } catch (error) {
    if (error instanceof ShunItemInventoryError && error.code === 'INSUFFICIENT_ITEMS') {
      throw new ShunError('ITEM_STOCK', '顺手牵羊库存不足。', 409)
    }
    throw error
  }
}

export async function shunItemBox(userId: string) {
  if (!shunItemsFeatureEnabled()) return { enabled: false }
  return shunTransaction(async (tx) => {
    await lockShunItemUsers(tx, [userId])
    const active = await tx.shunItemConfigVersion.findFirst({
      orderBy: { version: 'desc' },
      include: { definitions: { select: { code: true, name: true, description: true, icon: true, rarity: true, enabled: true } } },
    })
    if (!active?.enabled) return { enabled: false }
    await currentShunPending(tx, userId, shunDay(new Date()))
    const inventory = await tx.shunItemInventory.findMany({ where: { userId }, select: { code: true, available: true, pending: true } })
    const history = await tx.shunItemEntry.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 50,
      select: { id: true, code: true, type: true, availableDelta: true, pendingDelta: true, createdAt: true },
    })
    const items = active.definitions.map((definition) => {
      const balance = inventory.find((row) => row.code === definition.code)
      return { ...definition, available: balance?.available ?? 0, pending: balance?.pending ?? 0 }
    })
    return { enabled: true, items, history, total: inventory.reduce((sum, row) => sum + row.available + row.pending, 0) }
  })
}

export async function sendShunItemGift(senderId: string, requestId: string, clock = () => new Date()) {
  if (!shunItemsFeatureEnabled()) throw new ShunError('DISABLED', '顺大师道具暂未开放。', 404)
  const matchSeed = randomBytes(32)
  const itemRoll = randomInt(100)
  try {
    return await shunTransaction(async (tx) => {
      await settings(tx)
      const requestKey = `gift:${requestId}`
      const prior = await tx.shunItemEntry.findUnique({
        where: { userId_type_requestKey: { userId: senderId, type: 'GIFT_SENT', requestKey } },
        include: { sentGift: { include: { receivedEntry: { include: { config: { include: { definitions: true } } } } } } },
      })
      if (prior?.sentGift) {
        const { id, receiverId, receivedEntry } = prior.sentGift
        const name = receivedEntry.config.definitions.find(({ code }) => code === receivedEntry.code)?.name
        return { id, code: receivedEntry.code, name, receiver: await shunPerson(tx, receiverId) }
      }

      const active = await tx.shunItemConfigVersion.findFirst({ orderBy: { version: 'desc' }, include: { definitions: true } })
      const draft = validateShunItemDraft(active)
      if (!active || !draft?.enabled || !draft.definitions.some((item) => item.code === 'FRIEND_GIFT' && item.enabled)) {
        throw new ShunError('DISABLED', '天使的礼物暂不可使用。')
      }
      const links = await tx.$queryRaw<Array<{ userAId: string; userBId: string }>>`
        SELECT userAId, userBId FROM Friendship WHERE userAId = ${senderId} OR userBId = ${senderId} FOR UPDATE`
      const friends = [...new Set(links.map(({ userAId, userBId }) => userAId === senderId ? userBId : userAId))]
        .filter((id) => id !== senderId)
      await lockShunItemUsers(tx, [senderId, ...friends])
      const sender = await tx.user.findFirst({ where: { ...transactionAccount, id: senderId }, select: { id: true } })
      if (!sender) throw new ShunError('ACCOUNT', '当前账号无法参与顺大师。', 403)
      const inventory = await tx.shunItemInventory.findUnique({ where: { userId_code: { userId: senderId, code: 'FRIEND_GIFT' } } })
      if (!inventory?.available) throw new ShunError('ITEM_STOCK', '天使的礼物库存不足。', 409)

      const day = shunDay(clock())
      const rules = draft.rules
      const [eligibleFriends, blocks, full] = await Promise.all([
        tx.user.findMany({ where: { ...transactionAccount, id: { in: friends } }, select: { id: true } }),
        tx.block.findMany({
          where: { OR: [{ blockerId: senderId, blockedId: { in: friends } }, { blockedId: senderId, blockerId: { in: friends } }] },
          select: { blockerId: true, blockedId: true },
        }),
        tx.shunItemDaily.findMany({
          where: { day, userId: { in: friends }, giftsReceived: { gte: rules.giftsReceived } },
          select: { userId: true },
        }),
      ])
      const excluded = new Set([...full.map(({ userId }) => userId),
        ...blocks.map(({ blockerId, blockedId }) => blockerId === senderId ? blockedId : blockerId)])
      // A fresh seed per request gives each eligible friend the same chance.
      // Reusing it inside a transaction retry preserves the same random order.
      const candidates = eligibleFriends.filter(({ id }) => !excluded.has(id)).map(({ id }) => ({
        id, rank: createHmac('sha256', matchSeed).update(id).digest('hex'),
      })).sort((a, b) => a.rank.localeCompare(b.rank))
      const receiverId = rules.giftsReceived > 0 ? candidates[0]?.id : undefined
      if (!receiverId) throw new ShunError('NO_GIFT_FRIEND', '暂无符合条件的通讯录好友。')

      const pool = (Object.keys(SHUN_GIFT_WEIGHTS) as Array<keyof typeof SHUN_GIFT_WEIGHTS>)
        .map((code) => [code, rules.gifts[code]] as const)
      const code = drawShunItem(pool, () => itemRoll)
      const name = draft.definitions.find((item) => item.code === code)?.name ?? SHUN_ITEM_CATALOG[code].name
      const configVersion = active.version
      const { entry: sent } = await postShunItemMovement(tx, {
        userId: senderId, code: 'FRIEND_GIFT', type: 'GIFT_SENT', requestKey, day, configVersion,
      })
      const { entry: received } = await postShunItemMovement(tx, {
        userId: receiverId, code, type: 'GIFT_RECEIVED', requestKey: sent.id, day, configVersion,
      })
      const gift = await tx.shunItemGift.create({
        data: { senderId, receiverId, sentEntryId: sent.id, receivedEntryId: received.id },
      })
      await tx.shunItemDaily.upsert({
        where: { userId_day: { userId: receiverId, day } },
        create: { userId: receiverId, day, giftsReceived: 1 },
        update: { giftsReceived: { increment: 1 } },
      })
      const [senderPerson, receiver] = await Promise.all([shunPerson(tx, senderId), shunPerson(tx, receiverId)])
      await notify(tx, gift.id, receiverId, '天使的礼物',
        `你的好友 ${senderPerson?.nickname ?? 'EF'} 为你送来了一份天使的礼物，你获得了道具『${name}』！`,
        'item-gift', '/shun-master?items=1')
      return { id: gift.id, code, name, receiver }
    })
  } catch (error) {
    if (error instanceof ShunItemInventoryError && error.code === 'INSUFFICIENT_ITEMS') {
      throw new ShunError('ITEM_STOCK', '天使的礼物库存不足。', 409)
    }
    throw error
  }
}
type PendingShunCode = 'DOUBLE_AMOUNT' | 'EXTRA_SUSPECT'

async function releaseShunPending(
  tx: Tx,
  pending: { userId: string; code: import('@prisma/client').ShunItemCode; reservationId: string },
  day: string,
  requestKey: string,
) {
  const reservation = await tx.shunItemEntry.findUniqueOrThrow({ where: { id: pending.reservationId } })
  await postShunItemMovement(tx, {
    userId: pending.userId, code: pending.code, type: 'RELEASED', requestKey, day, configVersion: reservation.configVersion,
  })
  await tx.shunItemPending.delete({ where: { userId: pending.userId } })
}

async function currentShunPending(tx: Tx, userId: string, day: string) {
  const pending = await tx.shunItemPending.findUnique({ where: { userId } })
  if (!pending || pending.day === day) return pending
  await releaseShunPending(tx, pending, day, `expire:${pending.reservationId}`)
  return null
}

export async function setShunItemPending(userId: string, code: PendingShunCode, requestId: string, cancel: boolean) {
  if (!shunItemsFeatureEnabled()) throw new ShunError('DISABLED', '顺大师道具暂未开放。', 404)
  try {
    return await shunTransaction(async (tx) => {
      await lockShunItemUsers(tx, [userId])
      const type = cancel ? 'RELEASED' : 'RESERVED'
      const requestKey = `pending:${requestId}`
      const prior = await tx.shunItemEntry.findUnique({
        where: { userId_type_requestKey: { userId, type, requestKey } },
      })
      if (prior) {
        if (prior.code !== code) throw new ShunError('REQUEST_CONFLICT', '该请求已用于另一件道具。')
        return { applied: true }
      }

      const day = shunDay(new Date())
      const pending = await currentShunPending(tx, userId, day)
      if (cancel) {
        if (!pending || pending.code !== code) throw new ShunError('ITEM_PENDING', '该道具当前没有待生效效果。')
        await releaseShunPending(tx, pending, day, requestKey)
        return { applied: true }
      }

      if (pending) throw new ShunError('ITEM_PENDING', '已有一件道具待生效，请先取消。')
      const active = await tx.shunItemConfigVersion.findFirst({
        orderBy: { version: 'desc' }, include: { definitions: { where: { code, enabled: true } } },
      })
      if (!active?.enabled || !active.definitions.length) throw new ShunError('DISABLED', '该道具暂不可使用。')
      const account = await tx.user.findFirst({ where: { id: userId, ...transactionAccount }, select: { id: true } })
      if (!account) throw new ShunError('ACCOUNT', '当前账号无法参与顺大师。', 403)
      const { entry } = await postShunItemMovement(tx, { userId, code, type, requestKey, day, configVersion: active.version })
      await tx.shunItemPending.create({ data: { userId, code, day, reservationId: entry.id } })
      return { applied: true }
    })
  } catch (error) {
    if (error instanceof ShunItemInventoryError && error.code === 'INSUFFICIENT_ITEMS') {
      throw new ShunError('ITEM_STOCK', '道具库存不足。', 409)
    }
    throw error
  }
}

export async function retryShunCapture(userId: string, roundId: string) {
  if (!shunItemsFeatureEnabled()) throw new ShunError('DISABLED', '顺大师道具暂未开放。', 404)
  try {
    return await shunTransaction(async (tx) => {
      await settings(tx)
      const round = await tx.shunMasterRound.findFirst({ where: { id: roundId, victimId: userId } })
      if (!round) throw new ShunError('NOT_FOUND', '未找到这条记录。', 404)
      const prior = await tx.shunItemRoundEffect.findUnique({
        where: { roundId_code: { roundId, code: 'RETRY_CAPTURE' } },
      })
      if (prior) return { recovered: prior.amount }
      if (round.result !== 'FAILED' || round.recovered !== 0) {
        throw new ShunError('INVALID_RESULT', '只有抓捕失败且尚未追回的记录可使用时光倒流。')
      }
      const active = await tx.shunItemConfigVersion.findFirst({
        orderBy: { version: 'desc' },
        include: { definitions: { where: { code: 'RETRY_CAPTURE', enabled: true } } },
      })
      if (!active?.enabled || !active.definitions.length) throw new ShunError('DISABLED', '时光倒流暂不可使用。')
      const accounts = await lockAccounts(tx, [round.actorId, userId])
      const actorBalance = accounts.get(round.actorId)
      const receiver = accounts.get(userId)
      if (actorBalance === undefined || receiver === undefined) throw new ShunError('BALANCE', '目前无法完成挂号费结算。')
      const account = await tx.user.findFirst({ where: { id: userId, ...eligible }, select: { id: true } })
      if (!account) throw new ShunError('ACCOUNT', '当前账号无法参与顺大师。', 403)

      const day = shunDay(new Date())
      const { entry } = await postShunItemMovement(tx, {
        userId, code: 'RETRY_CAPTURE', type: 'USED', requestKey: `round:${roundId}`, day, configVersion: active.version,
      })
      const debit = Math.min(Math.max(0, actorBalance), round.amount)
      const compensation = round.amount - debit
      const recoveryId = `${roundId}:retry`
      await ledger(tx, recoveryId, round.actorId, actorBalance, -debit, 'recover', `shun:${roundId}:take:${round.actorId}`)
      await ledger(tx, recoveryId, userId, receiver, debit, 'recover', `shun:${roundId}:take:${userId}`)
      await ledger(tx, recoveryId, userId, receiver + debit, compensation, 'compensate', `shun:${roundId}:take:${userId}`)
      // The failed capture already released the original reserve.
      await tx.shunMasterSettings.update({ where: { id: 1 }, data: { compensated: { increment: compensation } } })
      await tx.shunItemRoundEffect.create({
        data: { roundId, code: 'RETRY_CAPTURE', entryId: entry.id, amount: round.amount, compensation },
      })
      if (compensation) await tx.userOperationLog.create({ data: {
        userId, category: 'SHUN_MASTER', action: 'COMPENSATION', summary: '时光倒流触发挂号费补偿',
        source: 'WEB', operatorType: 'SYSTEM', targetType: 'ShunMasterRound', targetId: roundId, riskLevel: 'MEDIUM',
        metadata: { compensation, roundId, item: 'RETRY_CAPTURE' },
      } })
      await notify(tx, roundId, userId, '时光倒流', `你成功追回了 ${round.amount} 挂号费！`, 'retry-capture')
      await notify(tx, roundId, round.actorId, '时光倒流', `此前顺取的 ${round.amount} 挂号费已被追回。`,
        'retry-capture-actor', `/shun-master?record=${roundId}&side=out`)
      return { recovered: round.amount }
    })
  } catch (error) {
    if (error instanceof ShunItemInventoryError && error.code === 'INSUFFICIENT_ITEMS') {
      throw new ShunError('ITEM_STOCK', '时光倒流库存不足。', 409)
    }
    throw error
  }
}

function revengeReceivedWhere(day: string, actorId?: string): Prisma.ShunItemRoundEffectWhereInput {
  return { code: 'REVENGE', entry: { day }, ...(actorId ? { round: { actorId } } : {}) }
}

export async function useShunRevenge(userId: string, roundId: string, clock = () => new Date()) {
  if (!shunItemsFeatureEnabled()) throw new ShunError('DISABLED', '顺大师道具暂未开放。', 404)
  const roll = randomInt(100)
  const rolled = roll < 40 ? 1 : roll < 75 ? 2 : 3
  try {
    return await shunTransaction(async (tx) => {
      const { config } = await settings(tx)
      const round = await tx.shunMasterRound.findFirst({ where: { id: roundId, victimId: userId } })
      if (!round) throw new ShunError('NOT_FOUND', '未找到这条记录。', 404)
      const effects = await tx.shunItemRoundEffect.findMany({
        where: { roundId, code: { in: ['REVENGE', 'RETRY_CAPTURE'] } },
      })
      const prior = effects.find(({ code }) => code === 'REVENGE')
      if (prior) return { amount: prior.amount }
      if (round.result !== 'SUCCESS' && !effects.some(({ code }) => code === 'RETRY_CAPTURE')) {
        throw new ShunError('INVALID_RESULT', '抓捕成功后才可以使用最佳损友。')
      }
      const active = await tx.shunItemConfigVersion.findFirst({
        orderBy: { version: 'desc' }, include: { definitions: { where: { code: 'REVENGE', enabled: true } } },
      })
      if (!config.enabled || !active?.enabled || !active.definitions.length) {
        throw new ShunError('DISABLED', '最佳损友暂不可使用。')
      }
      const accounts = await lockAccounts(tx, [round.actorId, userId])
      const target = accounts.get(round.actorId)
      const receiver = accounts.get(userId)
      if (!target || target < 0 || receiver === undefined) throw new ShunError('REVENGE_UNAVAILABLE', '暂不可反击。')
      const eligibility = await tx.user.count({ where: { ...transactionAccount, id: { in: [round.actorId, userId] } } })
      if (eligibility !== 2) throw new ShunError('REVENGE_UNAVAILABLE', '暂不可反击。')
      const day = shunDay(clock())
      const pending = await currentShunPending(tx, userId, day)
      if (pending) throw new ShunError('ITEM_PENDING', '请先取消待生效道具。')
      const takes = await tx.shunMasterRound.count({ where: { day, victimId: round.actorId } })
      const revenges = await tx.shunItemRoundEffect.count({ where: revengeReceivedWhere(day, round.actorId) })
      if (takes + revenges >= config.victimCap) throw new ShunError('REVENGE_UNAVAILABLE', '暂不可反击。')

      const amount = Math.min(rolled, target)
      const { entry } = await postShunItemMovement(tx, {
        userId, code: 'REVENGE', type: 'USED', requestKey: `round:${roundId}`, day, configVersion: active.version,
      })
      await ledger(tx, `${roundId}:revenge`, userId, receiver, amount, 'take')
      await ledger(tx, `${roundId}:revenge`, round.actorId, target, -amount, 'take')
      await tx.shunItemRoundEffect.create({ data: { roundId, code: 'REVENGE', entryId: entry.id, amount } })
      const person = await shunPerson(tx, userId)
      await notify(tx, roundId, round.actorId, '最佳损友', `「${person?.nickname ?? 'EF'}」反击，顺走了 ${amount} 挂号费。`,
        'item-revenge', `/shun-master?record=${roundId}&side=out`)
      return { amount }
    })
  } catch (error) {
    if (error instanceof ShunItemInventoryError && error.code === 'INSUFFICIENT_ITEMS') {
      throw new ShunError('ITEM_STOCK', '最佳损友库存不足。', 409)
    }
    throw error
  }
}

export async function recentShunItemDrop(userId: string) {
  if (!shunItemsFeatureEnabled()) return { drop: null }
  const active = await prisma.shunItemConfigVersion.findFirst({ orderBy: { version: 'desc' }, select: { enabled: true } })
  if (!active?.enabled) return { drop: null }
  const entry = await prisma.shunItemEntry.findFirst({
    where: { userId, type: 'COMMUNITY_DROP', createdAt: { gte: new Date(Date.now() - 120_000) } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { id: true, code: true, config: { select: { definitions: { select: { code: true, name: true } } } } },
  })
  return { drop: entry ? {
    id: entry.id, name: entry.config.definitions.find((item) => item.code === entry.code)?.name ?? SHUN_ITEM_CATALOG[entry.code].name,
  } : null }
}
