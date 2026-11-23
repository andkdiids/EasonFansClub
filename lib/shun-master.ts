import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { createNotificationWithDb } from '@/lib/notification-write'
import { getPublicUserDisplayName } from '@/lib/friend-display'
import { awardRegistrationFee, consumeRegistrationFee } from '@/lib/registration-fee'
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

function currentConsent(tx: Tx, userId: string, rulesVersion: number) {
  return tx.shunMasterConsent.findUnique({ where: { userId_rulesVersion: { userId, rulesVersion } } })
}

export async function shunStatus(userId: string) {
  const serverNow = new Date()
  const day = shunDay(serverNow)
  const [state, account, member, attempts, received] = await Promise.all([
    prisma.shunMasterSettings.findUnique({ where: { id: 1 } }),
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { points: true } }),
    prisma.shunMasterMember.findUnique({ where: { userId } }),
    prisma.shunMasterRound.count({ where: { actorId: userId, day } }),
    prisma.shunMasterRound.count({ where: { victimId: userId, day } }),
  ])
  const config = validateShunConfig(state?.config) || defaultShunConfig
  const rulesVersion = state?.rulesVersion ?? 1
  const consent = await currentConsent(prisma, userId, rulesVersion)
  return { enabled: config.enabled, joined: !!member?.joined && !!consent, rulesVersion, hasAcceptedRules: !!consent, balance: account.points,
    remaining: Math.max(0, config.attempts - attempts), received, attempts: config.attempts,
    victimCap: config.victimCap, goldenMinutes: config.goldenMinutes, serverNow }
}

export function shunJoin(userId: string, joined: boolean, acceptedRulesVersion?: number) {
  return shunTransaction(async (tx) => {
    const { config, state } = await settings(tx)
    if (joined && !config.enabled) throw new ShunError('DISABLED', '顺大师暂未开放，敬请期待。')
    if (joined && !await tx.user.findFirst({ where: { id: userId, ...eligible }, select: { id: true } })) {
      throw new ShunError('ACCOUNT', '当前账号无法参与顺大师。', 403)
    }
    const consent = joined && await currentConsent(tx, userId, state.rulesVersion)
    if (joined && !consent) {
      if (acceptedRulesVersion !== state.rulesVersion) throw new ShunError('CONSENT_REQUIRED', '请确认当前版本的顺大师规则。')
      await tx.shunMasterConsent.create({ data: { userId, rulesVersion: state.rulesVersion } })
    }
    const member = await tx.shunMasterMember.findUnique({ where: { userId } })
    if (member?.joined === joined && (!joined || consent)) return { joined }
    await tx.shunMasterMember.upsert({ where: { userId }, create: { userId, joined }, update: { joined } })
    await tx.userOperationLog.create({ data: { userId, category: 'SHUN_MASTER', action: !joined ? 'LEAVE' : consent ? 'REJOIN' : 'JOIN',
      summary: !joined ? '退出顺大师匹配' : consent ? '恢复顺大师参与' : '同意顺大师参与规则', source: 'WEB', operatorType: 'USER',
      metadata: { rulesVersion: state.rulesVersion, victimCap: config.victimCap, maxAmount: 7 } } })
    return { joined }
  })
}

export function shunAttempt(actorId: string, requestId: string) {
  return shunTransaction(async (tx) => {
    const { state, config } = await settings(tx)
    const previous = await tx.shunMasterRound.findUnique({ where: { actorId_requestId: { actorId, requestId } } })
    if (previous) return present(tx, previous, 'out')
    if (!config.enabled) throw new ShunError('DISABLED', '顺大师暂未开放。')
    const now = new Date()
    const day = shunDay(now)
    const actor = await tx.user.findFirst({ where: { id: actorId, ...eligible },
      select: { email: true, phone: true, emailVerifiedAt: true, phoneVerifiedAt: true } })
    if (!actor || !await tx.shunMasterMember.findFirst({ where: { userId: actorId, joined: true } })
      || !await currentConsent(tx, actorId, state.rulesVersion)) {
      throw new ShunError('MEMBERSHIP', '请先加入顺大师。')
    }
    const played = await tx.shunMasterRound.findMany({ where: { actorId, day }, select: { victimId: true } })
    if (played.length >= config.attempts) throw new ShunError('LIMIT', '今日收工，明天继续！')
    if (state.reserved + state.compensated + 7 > config.budget) {
      throw new ShunError('BUDGET', '顺大师暂时休息，已有记录仍可抓捕。')
    }
    const approvals = await tx.shunMasterConsent.findMany({ where: { rulesVersion: state.rulesVersion }, select: { userId: true } })
    const approvedIds = new Set(approvals.map(({ userId }) => userId))
    const members = (await tx.shunMasterMember.findMany({ where: { joined: true }, select: { userId: true } }))
      .filter(({ userId }) => approvedIds.has(userId))
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
    const pool = await tx.user.findMany({ where: {
      ...eligible, points: { gt: 0 }, id: { in: members.map((member) => member.userId).filter((id) => !excluded.has(id)) },
      ...(linked.length ? { NOT: { OR: linked } } : {}),
    }, select: { id: true, lastActiveAt: true, lastLoginAt: true } })
    const checkins = await tx.checkIn.findMany({ where: { userId: { in: pool.map(({ id }) => id) },
      checkinDateKey: { gte: shunDay(rangeStart), lte: day }, isMakeUp: false }, select: { userId: true, checkinDateKey: true } })
    const activeDays = new Map<string, Set<string>>()
    for (const checkin of checkins) {
      const days = activeDays.get(checkin.userId) || new Set<string>()
      days.add(checkin.checkinDateKey)
      activeDays.set(checkin.userId, days)
    }
    if (!pool.length) throw new ShunError('NO_TARGET', '暂时没有符合条件的 EF，顺取次数未扣除。')
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
    // A uniformly random ordering of real, joined participants avoids fixed answer positions.
    const decoys = await tx.user.findMany({ where: { ...eligible, id: {
      in: members.map(({ userId }) => userId).filter((id) => id !== victim.id && id !== actorId),
    } }, select: { id: true } })
    const selectedDecoys = shuffle(decoys).slice(0, 2).map(({ id }) => id)
    const candidates = selectedDecoys.length === 2 ? shuffle([actorId, ...selectedDecoys]) : []
    const round = await tx.shunMasterRound.create({ data: {
      actorId, victimId: victim.id, requestId, day, rolled, amount, createdAt: now,
      goldenUntil: new Date(now.getTime() + config.goldenMinutes * 60000), candidates,
      goldenDecoyId: selectedDecoys.length === 2 ? selectedDecoys[0] : null,
    } })
    if (candidates.length) await tx.shunMasterSettings.update({ where: { id: 1 }, data: { reserved: { increment: amount } } })
    await ledger(tx, round.id, actorId, actorBalance, amount, 'take')
    await ledger(tx, round.id, victim.id, victimBalance, -amount, 'take')
    await notify(tx, round.id, victim.id, '挂号费被顺走啦！',
      `一位神秘 EF 顺走了你 ${amount} 挂号费！${candidates.length ? '黄金抓捕期已开启，现在抓捕只需二选一！' : '本次可用嫌疑人不足，暂不可抓捕。'}`, 'taken')
    return present(tx, round, 'out')
  })
}

export async function shunRecords(userId: string, side: 'out' | 'in', cursor?: string, focus?: string) {
  const own = side === 'out' ? { actorId: userId } : { victimId: userId }
  const anchor = cursor && await prisma.shunMasterRound.findFirst({ where: { ...own, id: cursor }, select: { id: true } })
  if (cursor && !anchor) throw new ShunError('CURSOR', '记录分页已失效。', 400)
  const rows = await prisma.shunMasterRound.findMany({ where: own, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 21, ...(anchor ? { cursor: anchor, skip: 1 } : {}) })
  const focused = focus ? await prisma.shunMasterRound.findFirst({ where: { ...own, id: focus } }) : null
  return { records: await Promise.all(rows.slice(0, 20).map((row) => present(prisma, row, side))),
    focused: focused && await present(prisma, focused, side), nextCursor: rows.length > 20 ? rows[19].id : null }
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

export async function updateShunConfig(userId: string, config: ShunConfig) {
  return shunTransaction(async (tx) => {
    const { state, config: old } = await settings(tx)
    if (config.budget < state.reserved + state.compensated) throw new ShunError('BUDGET', '预算不能低于已补偿金额与未结索赔准备金。')
    const rulesVersion = state.rulesVersion + Number(shunRulesChanged(old, config))
    await tx.shunMasterSettings.update({ where: { id: 1 }, data: { config, rulesVersion } })
    await tx.userOperationLog.create({ data: { userId, operatorUserId: userId, category: 'SHUN_MASTER',
      action: 'CONFIG_UPDATE', summary: '发布顺大师配置', metadata: { old, config, rulesVersion }, source: 'WEB', operatorType: 'ADMIN' } })
    return { config, rulesVersion }
  })
}
