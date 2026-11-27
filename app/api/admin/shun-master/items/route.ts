import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { rejectInvalidRequestOrigin, requireAdmin } from '@/lib/security'
import { defaultShunItemDefinitions, defaultShunItemRules, shunItemsFeatureEnabled, validateShunItemDraft } from '@/lib/shun-item-config'
import { reconcileShunItemInventory } from '@/lib/shun-item-inventory'
import { shunTransaction } from '@/lib/shun-master'

export const dynamic = 'force-dynamic'

const json = (data: unknown, status = 200) => NextResponse.json(data, {
  status, headers: { 'Cache-Control': 'private, no-store' },
})

export async function GET(request: Request) {
  const guard = await requireAdmin('site_config_manage')
  if (!guard.user) return guard.response
  const userId = new URL(request.url).searchParams.get('userId')?.trim()
  if (userId && !/^[a-z0-9]{1,40}$/.test(userId)) return json({ message: '用户 ID 无效。' }, 400)
  const participants = userId ? { OR: [{ senderId: userId }, { receiverId: userId }] } : {}
  const [active, stock, entries, gifts, effects, audit, abuse, discrepancy] = await Promise.all([
    prisma.shunItemConfigVersion.findFirst({ orderBy: { version: 'desc' }, include: { definitions: true } }),
    userId ? prisma.shunItemInventory.findMany({ where: { userId } }) : [],
    prisma.shunItemEntry.findMany({ where: { userId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100 }),
    prisma.shunItemGift.findMany({ where: participants, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100 }),
    prisma.shunItemRoundEffect.groupBy({
      by: ['code'], where: userId ? { entry: { userId } } : {},
      _sum: { amount: true, compensation: true }, _count: { _all: true },
    }),
    prisma.userOperationLog.findMany({
      where: { category: 'SHUN_MASTER', action: { in: ['ITEM_CONFIG_UPDATE', 'COMPENSATION'] }, userId },
      orderBy: { occurredAt: 'desc' }, take: 30,
    }),
    prisma.accountSecurityLog.findMany({
      where: { userId, action: 'API_ABUSE_RATE_LIMIT', metadata: { path: '$.endpoint', string_starts_with: 'shun-master:' } },
      orderBy: { createdAt: 'desc' }, take: 30,
    }),
    userId ? shunTransaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true } })
      return user ? reconcileShunItemInventory(tx, userId) : null
    }) : null,
  ])
  return json({
    featureEnabled: shunItemsFeatureEnabled(), version: active?.version ?? 0,
    draft: active ? { enabled: active.enabled, definitions: active.definitions, rules: active.rules }
      : { enabled: false, definitions: defaultShunItemDefinitions, rules: defaultShunItemRules },
    stock, entries, gifts, effects, audit, abuse, discrepancy,
  })
}

export async function PATCH(request: Request) {
  const origin = rejectInvalidRequestOrigin(request)
  if (origin) return origin
  const guard = await requireAdmin('site_config_manage')
  if (!guard.user) return guard.response
  const body = await request.json().catch(() => null)
  const draft = validateShunItemDraft(body?.draft)
  if (!draft || !Number.isSafeInteger(body?.expectedVersion) || body.expectedVersion < 0) {
    return json({ message: '道具配置无效，请检查奖池概率是否合计 100%。' }, 400)
  }
  const operatorId = guard.user.id
  try {
    const version = await shunTransaction(async (tx) => {
      // Share the settings lock with all Shun settlements and config writes.
      await tx.$queryRaw`SELECT id FROM ShunMasterSettings WHERE id = 1 FOR UPDATE`
      const current = await tx.shunItemConfigVersion.findFirst({ orderBy: { version: 'desc' }, select: { version: true } })
      if ((current?.version ?? 0) !== body.expectedVersion) return null
      const record = await tx.shunItemConfigVersion.create({
        data: { createdBy: operatorId, enabled: draft.enabled, rules: draft.rules, definitions: { create: draft.definitions } },
      })
      await tx.userOperationLog.create({ data: {
        userId: operatorId, operatorUserId: operatorId, operatorType: 'ADMIN',
        category: 'SHUN_MASTER', action: 'ITEM_CONFIG_UPDATE', source: 'WEB',
        summary: '更新顺大师道具配置', targetType: 'ShunItemConfigVersion', targetId: String(record.version),
        metadata: { previousVersion: current?.version ?? 0, version: record.version, enabled: record.enabled },
      } })
      return record.version
    })
    return version === null ? json({ message: '配置已经更新，请重新加载后再保存。' }, 409) : json({ version })
  } catch {
    return json({ message: '道具配置保存失败，请重试。' }, 500)
  }
}
