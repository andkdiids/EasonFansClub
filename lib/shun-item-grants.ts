import { prisma } from '@/lib/prisma'
import { getGlobalPointsGrantRecipientWhere } from '@/lib/global-points-grant'
import { createNotificationWithDb } from '@/lib/notification-write'
import { shunItemsFeatureEnabled, validateShunItemDraft } from '@/lib/shun-item-config'
import { SHUN_ITEM_CATALOG, type ShunItemCode } from '@/lib/shun-item-rules'
import { lockShunItemUsers, postShunItemMovement } from '@/lib/shun-item-inventory'
import { shunDay } from '@/lib/shun-master-rules'
import { shunTransaction } from '@/lib/shun-master'

/** 与「全站挂号费发放」同一套后台权限，站内奖励发放归口一致。 */
export const SHUN_ITEM_GRANT_PERMISSION = 'user_reward_manage'
export const SHUN_ITEM_GRANT_BATCH = 200
export const SHUN_ITEM_GRANT_MAX_QUANTITY = 99
export const SHUN_ITEM_GRANT_MAX_TOTAL_ITEMS = 200_000
const reasonMax = 60
const idempotencyPattern = /^[A-Za-z0-9:_-]{16,64}$/

export type ShunItemGrantTaskStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'PARTIAL_FAILED' | 'CANCELLED'

export class ShunItemGrantError extends Error {
  constructor(readonly code: 'INVALID_INPUT' | 'DISABLED' | 'NOT_FOUND' | 'TOTAL_TOO_LARGE' | 'TASK_STATE', message: string, readonly status = 400) {
    super(message)
    this.name = 'ShunItemGrantError'
  }
}

export type ShunItemGrantInput = {
  items: { code: ShunItemCode; quantity: number }[]
  reason: string
  notify: boolean
  idempotencyKey: string
}

function isShunItemCode(value: unknown): value is ShunItemCode {
  return typeof value === 'string' && Object.hasOwn(SHUN_ITEM_CATALOG, value)
}

/** 服务端统一校验：只接受七种道具、正整数数量、必填原因与幂等键。 */
export function normalizeShunItemGrantInput(body: unknown): ShunItemGrantInput {
  const record = body && typeof body === 'object' ? body as Record<string, unknown> : {}
  const rawItems = Array.isArray(record.items) ? record.items : []
  if (!rawItems.length) throw new ShunItemGrantError('INVALID_INPUT', '请至少选择一种道具。')
  if (rawItems.length > 7) throw new ShunItemGrantError('INVALID_INPUT', '道具种类超出范围。')
  const seen = new Set<string>()
  const items: { code: ShunItemCode; quantity: number }[] = []
  for (const row of rawItems) {
    const item = row && typeof row === 'object' ? row as Record<string, unknown> : {}
    if (!isShunItemCode(item.code)) throw new ShunItemGrantError('INVALID_INPUT', '道具代码无效。')
    if (seen.has(item.code)) throw new ShunItemGrantError('INVALID_INPUT', '同一种道具不能重复配置。')
    seen.add(item.code)
    const quantity = typeof item.quantity === 'number' ? item.quantity : Number(item.quantity)
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > SHUN_ITEM_GRANT_MAX_QUANTITY) {
      throw new ShunItemGrantError('INVALID_INPUT', `每位用户的数量必须是 1–${SHUN_ITEM_GRANT_MAX_QUANTITY} 的整数。`)
    }
    items.push({ code: item.code, quantity })
  }
  const reason = typeof record.reason === 'string' ? record.reason.trim() : ''
  if (!reason) throw new ShunItemGrantError('INVALID_INPUT', '发放原因不能为空。')
  if ([...reason].length > reasonMax) throw new ShunItemGrantError('INVALID_INPUT', `发放原因不能超过 ${reasonMax} 个字。`)
  const idempotencyKey = typeof record.idempotencyKey === 'string' ? record.idempotencyKey.trim() : ''
  if (!idempotencyPattern.test(idempotencyKey)) throw new ShunItemGrantError('INVALID_INPUT', '幂等键无效。')
  return { items, reason, notify: record.notify !== false, idempotencyKey }
}

async function activeDraft() {
  const active = await prisma.shunItemConfigVersion.findFirst({ orderBy: { version: 'desc' }, include: { definitions: true } })
  const draft = validateShunItemDraft(active)
  if (!active || !draft?.enabled) throw new ShunItemGrantError('DISABLED', '顺大师道具暂未开放。', 404)
  return { active, draft }
}

function nameOf(code: ShunItemCode, draft: { definitions: { code: string; name: string }[] }) {
  return draft.definitions.find((item) => item.code === code)?.name ?? SHUN_ITEM_CATALOG[code].name
}

/** 预览：用户数与发放总量都由服务端实时计算，前台不得写死示例数据。 */
export async function shunItemGrantPreview() {
  if (!shunItemsFeatureEnabled()) return { enabled: false as const }
  const { active, draft } = await activeDraft()
  const users = await prisma.user.count({ where: getGlobalPointsGrantRecipientWhere() })
  const items = (Object.keys(SHUN_ITEM_CATALOG) as ShunItemCode[]).map((code) => ({
    code, name: nameOf(code, draft),
    rarity: draft.definitions.find((item) => item.code === code)?.rarity ?? SHUN_ITEM_CATALOG[code].rarity,
    enabled: draft.definitions.some((item) => item.code === code && item.enabled),
  }))
  return { enabled: true as const, version: active.version, users, items }
}

export type ShunItemGrantTaskSummary = {
  id: string
  status: ShunItemGrantTaskStatus
  reason: string
  notify: boolean
  createdBy: string
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  cancelledAt: string | null
  totalUsers: number
  totalItems: number
  succeededUsers: number
  failedUsers: number
  skippedUsers: number
  grantedItems: number
  items: { code: string; name: string; quantity: number }[]
}

async function toSummary(task: {
  id: string; status: string; reason: string; notify: boolean; createdBy: string
  createdAt: Date; startedAt: Date | null; finishedAt: Date | null; cancelledAt: Date | null
  totalUsers: number; totalItems: number; succeededUsers: number; failedUsers: number
  skippedUsers: number; grantedItems: number
  items: { code: string; quantity: number }[]
}, draft: { definitions: { code: string; name: string }[] }): Promise<ShunItemGrantTaskSummary> {
  return {
    id: task.id, status: task.status as ShunItemGrantTaskStatus, reason: task.reason, notify: task.notify,
    createdBy: task.createdBy, createdAt: task.createdAt.toISOString(),
    startedAt: task.startedAt?.toISOString() ?? null, finishedAt: task.finishedAt?.toISOString() ?? null,
    cancelledAt: task.cancelledAt?.toISOString() ?? null,
    totalUsers: task.totalUsers, totalItems: task.totalItems, succeededUsers: task.succeededUsers,
    failedUsers: task.failedUsers, skippedUsers: task.skippedUsers, grantedItems: task.grantedItems,
    items: task.items.map((item) => ({ code: item.code, name: nameOf(item.code as ShunItemCode, draft), quantity: item.quantity })),
  }
}

export async function listShunItemGrants(limit = 20) {
  const { draft } = await activeDraft()
  const tasks = await prisma.shunItemGrantTask.findMany({
    orderBy: { createdAt: 'desc' }, take: Math.min(Math.max(limit, 1), 50), include: { items: true },
  })
  return { enabled: true as const, tasks: await Promise.all(tasks.map((task) => toSummary(task, draft))) }
}

/**
 * 创建发放任务：同一幂等键重复提交返回原任务，不重复创建。
 * 用户范围在创建时固化为快照（PENDING 行），因此预览与执行使用同一份名单。
 */
export async function createShunItemGrantTask(operatorId: string, body: unknown) {
  if (!shunItemsFeatureEnabled()) throw new ShunItemGrantError('DISABLED', '顺大师道具暂未开放。', 404)
  const input = normalizeShunItemGrantInput(body)
  const { active, draft } = await activeDraft()
  const perUser = input.items.reduce((sum, item) => sum + item.quantity, 0)
  const users = await prisma.user.count({ where: getGlobalPointsGrantRecipientWhere() })
  if (!users) throw new ShunItemGrantError('INVALID_INPUT', '当前没有符合条件的发放用户。')
  const totalItems = users * perUser
  if (totalItems > SHUN_ITEM_GRANT_MAX_TOTAL_ITEMS) {
    throw new ShunItemGrantError('TOTAL_TOO_LARGE', '本次发放总量超过上限，请减少数量或种类。')
  }

  const existing = await prisma.shunItemGrantTask.findUnique({ where: { idempotencyKey: input.idempotencyKey } })
  if (existing) {
    const full = await prisma.shunItemGrantTask.findUniqueOrThrow({ where: { id: existing.id }, include: { items: true } })
    return { task: await toSummary(full, draft), reused: true }
  }

  const task = await shunTransaction(async (tx) => {
    const created = await tx.shunItemGrantTask.create({
      data: {
        createdBy: operatorId, idempotencyKey: input.idempotencyKey, reason: input.reason, notify: input.notify,
        configVersion: active.version, totalUsers: users, totalItems,
        items: { create: input.items },
      },
    })
    // 快照名单：分批写入，避免单条 SQL 过大。
    const recipients = await tx.user.findMany({ where: getGlobalPointsGrantRecipientWhere(), select: { id: true }, orderBy: { id: 'asc' } })
    for (let index = 0; index < recipients.length; index += 500) {
      await tx.shunItemGrant.createMany({
        data: recipients.slice(index, index + 500).map((user) => ({ taskId: created.id, userId: user.id })),
        skipDuplicates: true,
      })
    }
    await tx.userOperationLog.create({ data: {
      userId: operatorId, operatorUserId: operatorId, operatorType: 'ADMIN',
      category: 'SHUN_MASTER', action: 'ITEM_GRANT_CREATE', source: 'WEB',
      summary: '创建顺大师道具发放任务',
      targetType: 'ShunItemGrantTask', targetId: created.id,
      metadata: { reason: input.reason, notify: input.notify, items: input.items, users, totalItems, configVersion: active.version },
    } })
    return created
  })
  const full = await prisma.shunItemGrantTask.findUniqueOrThrow({ where: { id: task.id }, include: { items: true } })
  return { task: await toSummary(full, draft), reused: false }
}

function notificationContent(items: { code: ShunItemCode; quantity: number }[], draft: { definitions: { code: string; name: string }[] }) {
  const list = items.map((item) => `${nameOf(item.code, draft)}×${item.quantity}`).join('、')
  return `E院为你送来了一份惊喜！快去顺大师的百宝箱看看吧。你获得了 ${list}。`
}

async function grantOneUser(task: {
  id: string; configVersion: number; notify: boolean
  items: { code: ShunItemCode; quantity: number }[]
}, userId: string, draft: { definitions: { code: string; name: string }[] }) {
  const day = shunDay(new Date())
  await shunTransaction(async (tx) => {
    await lockShunItemUsers(tx, [userId])
    const eligible = await tx.user.findFirst({ where: { id: userId, ...getGlobalPointsGrantRecipientWhere() }, select: { id: true } })
    if (!eligible) {
      await tx.shunItemGrant.updateMany({ where: { taskId: task.id, userId, status: 'PENDING' }, data: { status: 'SKIPPED', failureReason: '账号已不符合发放资格', finishedAt: new Date() } })
      return
    }
    let granted = 0
    for (const item of task.items) {
      for (let unit = 1; unit <= item.quantity; unit += 1) {
        // requestKey 同时承担幂等键：同一任务、同一用户、同一道具的第 n 件只发一次。
        await postShunItemMovement(tx, {
          userId, code: item.code, type: 'ADMIN_GRANT', day, configVersion: task.configVersion,
          requestKey: `grant:${task.id}:${item.code}:${unit}`,
        })
        granted += 1
      }
    }
    await tx.shunItemGrant.updateMany({ where: { taskId: task.id, userId, status: 'PENDING' },
      data: { status: 'SENT', finishedAt: new Date(), failureReason: null } })
    await tx.shunItemGrantTask.update({ where: { id: task.id }, data: { grantedItems: { increment: granted } } })
    if (task.notify) {
      await createNotificationWithDb(tx, { data: {
        type: 'SYSTEM', recipientId: userId, title: 'E院赠礼',
        content: notificationContent(task.items, draft), link: '/shun-master?items=1',
        key: `shun:item-grant:${task.id}`,
      } })
    }
  })
}

let sweeping = false

/**
 * 分批执行发放：每次处理 BATCH 条 PENDING，单用户一个事务。
 * 进程重启后 PENDING 行仍在，下一轮继续，不依赖管理员保持页面打开。
 */
export async function runShunItemGrantSweep() {
  if (sweeping || !shunItemsFeatureEnabled()) return
  sweeping = true
  try {
    const pending = await prisma.shunItemGrantTask.findFirst({
      where: { status: { in: ['PENDING', 'RUNNING'] } }, orderBy: { createdAt: 'asc' }, include: { items: true },
    })
    if (!pending) return
    if (pending.status === 'PENDING') {
      await prisma.shunItemGrantTask.update({ where: { id: pending.id }, data: { status: 'RUNNING', startedAt: new Date() } })
    }
    const { draft } = await activeDraft()
    const task = { id: pending.id, configVersion: pending.configVersion, notify: pending.notify,
      items: pending.items.map((item) => ({ code: item.code, quantity: item.quantity })) }

    const batch = await prisma.shunItemGrant.findMany({
      where: { taskId: task.id, status: 'PENDING' }, orderBy: { userId: 'asc' }, take: SHUN_ITEM_GRANT_BATCH,
    })
    for (const row of batch) {
      const cancelled = await prisma.shunItemGrantTask.findUnique({ where: { id: task.id }, select: { status: true } })
      if (cancelled?.status === 'CANCELLED') break
      try {
        await grantOneUser(task, row.userId, draft)
      } catch (error) {
        await prisma.shunItemGrant.updateMany({
          where: { taskId: task.id, userId: row.userId, status: 'PENDING' },
          data: { status: 'FAILED', failureReason: (error instanceof Error ? error.message : '发放失败').slice(0, 200), finishedAt: new Date() },
        })
      }
    }

    const [counts, remaining] = await Promise.all([
      prisma.shunItemGrant.groupBy({ by: ['status'], where: { taskId: task.id }, _count: { _all: true } }),
      prisma.shunItemGrant.count({ where: { taskId: task.id, status: 'PENDING' } }),
    ])
    const count = (status: string) => counts.find((row) => row.status === status)?._count._all ?? 0
    const failed = count('FAILED')
    await prisma.shunItemGrantTask.update({ where: { id: task.id }, data: {
      succeededUsers: count('SENT'), failedUsers: failed, skippedUsers: count('SKIPPED'),
      ...(remaining === 0 ? {
        status: failed > 0 ? 'PARTIAL_FAILED' : 'COMPLETED',
        finishedAt: new Date(),
      } : {}),
    } })
  } finally {
    sweeping = false
  }
}

export async function cancelShunItemGrantTask(operatorId: string, taskId: string) {
  const task = await prisma.shunItemGrantTask.findUnique({ where: { id: taskId }, include: { items: true } })
  if (!task) throw new ShunItemGrantError('NOT_FOUND', '发放任务不存在。', 404)
  if (task.status === 'COMPLETED' || task.status === 'CANCELLED') {
    throw new ShunItemGrantError('TASK_STATE', '该任务已结束，无法取消。', 409)
  }
  await shunTransaction(async (tx) => {
    // 只取消未处理部分，已成功发放的道具不撤回。
    await tx.shunItemGrant.updateMany({ where: { taskId, status: 'PENDING' },
      data: { status: 'SKIPPED', failureReason: '任务已取消', finishedAt: new Date() } })
    await tx.shunItemGrantTask.update({ where: { id: taskId }, data: { status: 'CANCELLED', cancelledAt: new Date(), finishedAt: new Date() } })
    await tx.userOperationLog.create({ data: {
      userId: operatorId, operatorUserId: operatorId, operatorType: 'ADMIN',
      category: 'SHUN_MASTER', action: 'ITEM_GRANT_CANCEL', source: 'WEB',
      summary: '取消顺大师道具发放任务', targetType: 'ShunItemGrantTask', targetId: taskId,
      metadata: { reason: task.reason },
    } })
  })
  const { draft } = await activeDraft()
  const full = await prisma.shunItemGrantTask.findUniqueOrThrow({ where: { id: taskId }, include: { items: true } })
  return toSummary(full, draft)
}

export async function retryFailedShunItemGrants(operatorId: string, taskId: string) {
  const task = await prisma.shunItemGrantTask.findUnique({ where: { id: taskId } })
  if (!task) throw new ShunItemGrantError('NOT_FOUND', '发放任务不存在。', 404)
  if (task.status === 'CANCELLED') throw new ShunItemGrantError('TASK_STATE', '已取消的任务无法重试。', 409)
  // 只把失败行放回队列，已成功的用户不会重新发放。
  const reset = await prisma.shunItemGrant.updateMany({ where: { taskId, status: 'FAILED' },
    data: { status: 'PENDING', failureReason: null, finishedAt: null } })
  await shunTransaction(async (tx) => {
    await tx.shunItemGrantTask.update({ where: { id: taskId },
      data: { status: 'PENDING', failedUsers: 0, finishedAt: null } })
    await tx.userOperationLog.create({ data: {
      userId: operatorId, operatorUserId: operatorId, operatorType: 'ADMIN',
      category: 'SHUN_MASTER', action: 'ITEM_GRANT_RETRY', source: 'WEB',
      summary: '重试顺大师道具发放失败部分', targetType: 'ShunItemGrantTask', targetId: taskId,
      metadata: { retriedUsers: reset.count },
    } })
  })
  const { draft } = await activeDraft()
  const full = await prisma.shunItemGrantTask.findUniqueOrThrow({ where: { id: taskId }, include: { items: true } })
  return { task: await toSummary(full, draft), retried: reset.count }
}

export async function shunItemGrantDetail(taskId: string) {
  const task = await prisma.shunItemGrantTask.findUnique({ where: { id: taskId }, include: { items: true } })
  if (!task) throw new ShunItemGrantError('NOT_FOUND', '发放任务不存在。', 404)
  const { draft } = await activeDraft()
  const [failures, audits] = await Promise.all([
    prisma.shunItemGrant.findMany({ where: { taskId, status: { in: ['FAILED', 'SKIPPED'] } },
      orderBy: { finishedAt: 'desc' }, take: 50 }),
    prisma.userOperationLog.findMany({ where: { category: 'SHUN_MASTER', action: { startsWith: 'ITEM_GRANT' }, targetId: taskId },
      orderBy: { occurredAt: 'desc' }, take: 20 }),
  ])
  return { task: await toSummary(task, draft), failures, audits }
}
