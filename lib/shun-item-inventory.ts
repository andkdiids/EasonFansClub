import { Prisma, type ShunItemCode, type ShunItemEventType } from '@prisma/client'

type Tx = Prisma.TransactionClient

export class ShunItemInventoryError extends Error {
  constructor(readonly code: 'MISSING_USER' | 'INSUFFICIENT_ITEMS' | 'REQUEST_CONFLICT') {
    super(code)
  }
}

// Acquire all participant locks together before reading inventory, quotas or
// idempotency records. The same User locks are used by Shun fee settlements.
export async function lockShunItemUsers(tx: Tx, userIds: readonly string[]) {
  const ids = [...new Set(userIds)]
  if (!ids.length) return
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM User WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`
  if (rows.length !== ids.length) throw new ShunItemInventoryError('MISSING_USER')
}

const changes: Record<ShunItemEventType, readonly [number, number]> = {
  DAILY_MAIN: [1, 0],
  COMMUNITY_DROP: [1, 0],
  WEEKLY_REWARD: [1, 0],
  GIFT_RECEIVED: [1, 0],
  GIFT_SENT: [-1, 0],
  // V4.2.1 赠送者回礼：与主线/社区掉落一样是一件真实入账的道具。
  GIFT_REWARD: [1, 0],
  // V4.2.3 管理员发放：直接入库，独立于所有日常额度。
  ADMIN_GRANT: [1, 0],
  USED: [-1, 0],
  RESERVED: [-1, 1],
  RELEASED: [1, -1],
}

type ItemMovement = {
  userId: string
  code: ShunItemCode
  type: ShunItemEventType
  requestKey: string
  day: string
  configVersion: number
}

// The caller holds the participant locks and owns the enclosing transaction.
// Business writes must only run for a non-duplicate movement.
export async function postShunItemMovement(
  tx: Tx,
  movement: ItemMovement,
  options: { consumePending?: boolean } = {},
) {
  const { userId, code, type, requestKey } = movement
  if (options.consumePending && type !== 'USED') throw new Error('INVALID_SHUN_ITEM_MOVEMENT')
  const [availableDelta, pendingDelta] = options.consumePending ? [0, -1] : changes[type]
  const prior = await tx.shunItemEntry.findUnique({
    where: { userId_type_requestKey: { userId, type, requestKey } },
  })
  if (prior) {
    if (prior.code !== code || prior.availableDelta !== availableDelta || prior.pendingDelta !== pendingDelta) {
      throw new ShunItemInventoryError('REQUEST_CONFLICT')
    }
    return { entry: prior, duplicate: true }
  }

  const where = { userId_code: { userId, code } }
  const balance = await tx.shunItemInventory.findUnique({ where })
  const available = (balance?.available ?? 0) + availableDelta
  const pending = (balance?.pending ?? 0) + pendingDelta
  if (available < 0 || pending < 0) throw new ShunItemInventoryError('INSUFFICIENT_ITEMS')

  await tx.shunItemInventory.upsert({
    where,
    create: { userId, code, available, pending },
    update: { available: { increment: availableDelta }, pending: { increment: pendingDelta } },
  })
  const entry = await tx.shunItemEntry.create({ data: { ...movement, availableDelta, pendingDelta } })
  return { entry, duplicate: false }
}

export async function reconcileShunItemInventory(tx: Tx, userId: string) {
  await lockShunItemUsers(tx, [userId])
  const balances = await tx.shunItemInventory.findMany({ where: { userId } })
  const sums = await tx.shunItemEntry.groupBy({
    by: ['code'],
    where: { userId },
    _sum: { availableDelta: true, pendingDelta: true },
  })
  const codes = new Set([...balances.map((balance) => balance.code), ...sums.map((sum) => sum.code)])
  return [...codes].flatMap((code) => {
    const balance = balances.find((row) => row.code === code)
    const sum = sums.find((row) => row.code === code)
    const available = balance?.available ?? 0
    const pending = balance?.pending ?? 0
    const ledgerAvailable = sum?._sum.availableDelta ?? 0
    const ledgerPending = sum?._sum.pendingDelta ?? 0
    return available === ledgerAvailable && pending === ledgerPending
      ? []
      : [{ code, available, pending, ledgerAvailable, ledgerPending }]
  })
}
