import { Prisma } from '@prisma/client'
import { randomBytes } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { createNotificationWithDb } from '@/lib/notification-write'
import { getPublicUserDisplayName } from '@/lib/friend-display'
import { awardRegistrationFee, consumeRegistrationFee, getRegistrationFeeHistoryWindow, type RegistrationFeeHistoryRange } from '@/lib/registration-fee'
import { effectiveSystemNotificationWhere } from '@/lib/system-notifications'
import { captureMode, defaultShunConfig, shunDay, shunRulesChanged, shuffle, validateShunConfig, weightedIndex, type ShunConfig } from './shun-master-rules'

type Tx = Prisma.TransactionClient
type Round = Prisma.ShunMasterRoundGetPayload<Record<string, never>>
const eligible = { isDeleted: false, status: 'ACTIVE' } as const
const personFields = { uid: true, nickname: true, avatarUrl: true, nicknameModerationStatus: true, nicknameViolationDisplay: true } as const

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
      return await prisma.$transaction(callback, { isolationLevel: 'ReadCommitted', timeout: 15000 })
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

function notify(tx: Tx, id: string, recipientId: string, title: string, content: string, kind: string) {
  return createNotificationWithDb(tx, { data: {
    type: 'SYSTEM', recipientId, title, content,
    link: `/shun-master?record=${id}${kind === 'recover-actor' ? '&side=out' : ''}`, key: `shun:${id}:${kind}`,
  } })
}

export async function shunPerson(tx: Tx, id: string) {
  const user = await tx.user.findFirst({ where: { id, isDeleted: false, status: 'ACTIVE' }, select: personFields })
  return user && { uid: user.uid, nickname: getPublicUserDisplayName(user), avatarUrl: user.avatarUrl }
}

async function present(tx: Tx, round: Round, side: 'out' | 'in') {
  const visible = side === 'out' || round.result !== null
  return {
    id: round.id, amount: round.amount, recovered: round.recovered, result: round.result,
    createdAt: round.createdAt, goldenUntil: round.goldenUntil, canCapture: (round.candidates as string[]).length === 3,
    person: visible ? await shunPerson(tx, side === 'out' ? round.victimId : round.actorId) : null,
  }
}

async function validLaunchNotice(tx: Tx, id: string | null | undefined) {
  return !!id && !!await tx.systemNotification.findFirst({ where: { id, ...effectiveSystemNotificationWhere(),
    title: { contains: '顺大师' }, AND: [{ content: { contains: '挂号费' } }, { content: { contains: '保护' } }] }, select: { id: true } })
}

export async function shunStatus(userId: string) {
  const serverNow = new Date()
  const day = shunDay(serverNow)
  const [state, account, protection, attempts, received] = await Promise.all([
    prisma.shunMasterSettings.findUnique({ where: { id: 1 } }),
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { points: true } }),
    prisma.shunMasterProtection.findUnique({ where: { userId } }),
    prisma.shunMasterRound.count({ where: { actorId: userId, day } }),
    prisma.shunMasterRound.count({ where: { victimId: userId, day } }),
  ])
  const config = validateShunConfig(state?.config) || defaultShunConfig
  return { enabled: config.enabled && await validLaunchNotice(prisma, state?.launchNoticeId), protected: protection?.protected ?? false,
    balance: account.points,
    remaining: Math.max(0, config.attempts - attempts), received, attempts: config.attempts,
    victimCap: config.victimCap, goldenMinutes: config.goldenMinutes, serverNow }
}

export function setShunProtection(userId: string, protect: boolean) {
  return shunTransaction(async (tx) => {
    await settings(tx)
    const prior = await tx.shunMasterProtection.findUnique({ where: { userId } })
    if ((prior?.protected ?? false) !== protect) {
      await tx.shunMasterProtection.upsert({ where: { userId }, create: { userId, protected: protect }, update: { protected: protect } })
      await tx.userOperationLog.create({ data: { userId, category: 'SHUN_MASTER', action: protect ? 'PROTECT' : 'UNPROTECT',
        summary: protect ? '开启被顺取保护' : '关闭被顺取保护', source: 'WEB', operatorType: 'USER' } })
    }
    return { protected: protect }
  })
}

export async function shunAttempt(actorId: string, requestId: string) {
  const result = await shunTransaction(async (tx) => {
    const { state, config } = await settings(tx)
    const previous = await tx.shunMasterRound.findUnique({ where: { actorId_requestId: { actorId, requestId } } })
    if (previous) return present(tx, previous, 'out')
    if (!config.enabled || !await validLaunchNotice(tx, state.launchNoticeId)) throw new ShunError('DISABLED', '顺大师暂未开放。')
    const now = new Date()
    const day = shunDay(now)
    const actor = await tx.user.findFirst({ where: { id: actorId, ...eligible },
      select: { email: true, phone: true, emailVerifiedAt: true, phoneVerifiedAt: true } })
    if (!actor) throw new ShunError('ACCOUNT', '当前账号无法参与顺大师。', 403)
    if ((await tx.shunMasterProtection.findUnique({ where: { userId: actorId } }))?.protected) {
      throw new ShunError('PROTECTED', '请先关闭匹配保护，再发起顺取。')
    }
    const played = await tx.shunMasterRound.findMany({ where: { actorId, day }, select: { victimId: true } })
    if (played.length >= config.attempts) throw new ShunError('LIMIT', '今日收工，明天继续！')
    if (state.reserved + state.compensated + 7 > config.budget) {
      throw new ShunError('BUDGET', '顺大师暂时休息，已有记录仍可抓捕。')
    }
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
    const rangeStart = new Date(`${shunDay(new Date(now.getTime() - 6 * 86_400_000))}T00:00:00+08:00`)
    const seed = randomBytes(16).toString('hex')
    const candidateFilter = Prisma.sql`
      u.status = 'ACTIVE' AND u.isDeleted = false AND u.role = 'USER'
      AND EXISTS (SELECT 1 FROM Profile p WHERE p.userId = u.id)
      AND NOT EXISTS (SELECT 1 FROM ShunMasterProtection p WHERE p.userId = u.id AND p.protected = true)
    `
    const relatedAccounts = linked.length
      ? (await tx.user.findMany({ where: { OR: linked }, select: { id: true } })).map(({ id }) => id)
      : []
    const targetExclusions = [...new Set([...excluded, ...relatedAccounts])]
    // Sample after all eligibility filters so the sample cannot create a false NO_TARGET.
    const pool = await tx.$queryRaw<{ id: string; lastActiveAt: Date | null; lastLoginAt: Date | null }[]>`
      SELECT u.id, u.lastActiveAt, u.lastLoginAt FROM User u
      WHERE ${candidateFilter} AND u.points > 0 AND u.id NOT IN (${Prisma.join(targetExclusions)})
      ORDER BY SHA2(CONCAT(${seed}, u.id), 256) LIMIT 128
    `
    if (!pool.length) {
      const [funded, protectedFunded] = await Promise.all([
        tx.user.count({ where: { ...eligible, role: 'USER', points: { gt: 0 } } }),
        tx.$queryRaw<{ count: bigint }[]>`
          SELECT COUNT(*) AS count FROM ShunMasterProtection p JOIN User u ON u.id = p.userId
          WHERE p.protected = true AND u.status = 'ACTIVE' AND u.isDeleted = false AND u.role = 'USER' AND u.points > 0
        `,
      ])
      await tx.userOperationLog.create({ data: { userId: actorId, category: 'SHUN_MASTER', action: 'NO_TARGET',
        summary: '没有符合条件的顺取目标', source: 'WEB', operatorType: 'USER',
        metadata: { funded, protectedFunded: Number(protectedFunded[0].count), capped: capped.filter(row => row._count._all >= config.victimCap).length,
          blocked: blocks.length, linked: relatedAccounts.length, previouslyMatched: played.length } } })
      return null
    }
    const checkins = await tx.checkIn.findMany({ where: { userId: { in: pool.map(({ id }) => id) },
      checkinDateKey: { gte: shunDay(rangeStart), lte: day }, isMakeUp: false }, select: { userId: true, checkinDateKey: true } })
    const activeDays = new Map<string, Set<string>>()
    for (const checkin of checkins) {
      const days = activeDays.get(checkin.userId) || new Set<string>()
      days.add(checkin.checkinDateKey)
      activeDays.set(checkin.userId, days)
    }
    const victim = pool[weightedIndex(pool.map((user) => {
      const days = activeDays.get(user.id) || new Set<string>()
      for (const date of [user.lastActiveAt, user.lastLoginAt]) if (date && date >= rangeStart && date <= now) days.add(shunDay(date))
      return config.weights[Math.min(4, Math.floor(days.size * 5 / 8))]
    }))]
    const accounts = await lockAccounts(tx, [actorId, victim.id])
    const actorBalance = accounts.get(actorId)
    const victimBalance = accounts.get(victim.id)
    if (actorBalance === undefined || actorBalance < 0 || victimBalance === undefined || victimBalance <= 0 || shunDay(new Date()) !== day
      || await tx.user.count({ where: { ...eligible, id: { in: [actorId, victim.id] } } }) !== 2) {
      throw new ShunError('BALANCE', '账户状态或结算日期已变化，顺取次数未扣除。')
    }
    const rolled = weightedIndex(config.probabilities) + 1
    const amount = Math.min(rolled, victimBalance)
    const decoys = await tx.$queryRaw<{ id: string }[]>`
      SELECT u.id FROM User u WHERE ${candidateFilter} AND u.id NOT IN (${actorId}, ${victim.id})
      ORDER BY SHA2(CONCAT(${randomBytes(16).toString('hex')}, u.id), 256) LIMIT 2
    `
    const selectedDecoys = decoys.map(({ id }) => id)
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
    } })
    await tx.shunMasterSettings.update({ where: { id: 1 }, data: { reserved: { increment: amount } } })
    await ledger(tx, round.id, actorId, actorBalance, amount, 'take')
    await ledger(tx, round.id, victim.id, victimBalance, -amount, 'take')
    await notify(tx, round.id, victim.id, '挂号费被顺走啦！',
      `一位神秘 EF 顺走了你 ${amount} 挂号费！黄金抓捕期已开启，现在抓捕只需二选一！`, 'taken')
    return present(tx, round, 'out')
  })
  if (!result) throw new ShunError('NO_TARGET', '暂时没有可顺取的 EF，今日次数不会扣除。')
  return result
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
  return { records: await Promise.all(rows.slice(0, 20).map((row) => present(prisma, row, side))),
    focused: focused && await present(prisma, focused, side), nextCursor: rows.length > 20 ? rows[19].id : null,
    windowAt: now.toISOString() }
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

export async function updateShunConfig(userId: string, config: ShunConfig, launch?: { noticeId?: string; confirmed?: boolean }) {
  return shunTransaction(async (tx) => {
    const { state, config: old } = await settings(tx)
    if (config.budget < state.reserved + state.compensated) throw new ShunError('BUDGET', '预算不能低于已补偿金额与未结索赔准备金。')
    const launchNoticeId = launch?.noticeId === undefined ? state.launchNoticeId : launch.noticeId || null
    if (config.enabled && ((!old.enabled || launchNoticeId !== state.launchNoticeId) && !launch?.confirmed
      || !await validLaunchNotice(tx, launchNoticeId))) {
      throw new ShunError('NOTICE_REQUIRED', '请先发布顺大师全站公告，说明挂号费扣除和保护选项，并确认开放。')
    }
    const rulesVersion = state.rulesVersion + Number(shunRulesChanged(old, config))
    await tx.shunMasterSettings.update({ where: { id: 1 }, data: { config, rulesVersion, launchNoticeId } })
    await tx.userOperationLog.create({ data: { userId, operatorUserId: userId, category: 'SHUN_MASTER',
      action: 'CONFIG_UPDATE', summary: '发布顺大师配置', metadata: { old, config, rulesVersion, launchNoticeId }, source: 'WEB', operatorType: 'ADMIN' } })
    return { config, rulesVersion }
  })
}
