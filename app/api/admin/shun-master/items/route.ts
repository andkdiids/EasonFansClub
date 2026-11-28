import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
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
  const params = new URL(request.url).searchParams
  const userId = params.get('userId')?.trim()
  if (userId && !/^[a-z0-9]{1,40}$/.test(userId)) return json({ message: '用户 ID 无效。' }, 400)
  const day = params.get('day')?.trim() || ''
  if (day && !/^\d{4}-\d{2}-\d{2}$/.test(day)) return json({ message: '日期无效。' }, 400)
  const code = params.get('code')?.trim() || ''
  if (code && !defaultShunItemDefinitions.some((item) => item.code === code)) return json({ message: '道具无效。' }, 400)
  const versionRaw = params.get('version')
  const version = versionRaw === null ? null : Number(versionRaw)
  if (version !== null && (!Number.isInteger(version) || version < 0)) return json({ message: '配置版本无效。' }, 400)

  const participants = userId ? { OR: [{ senderId: userId }, { receiverId: userId }] } : {}
  const dayStart = day ? new Date(`${day}T00:00:00+08:00`) : null
  const dayRange = dayStart ? { gte: dayStart, lt: new Date(dayStart.getTime() + 86_400_000) } : null
  // 赠礼查询：参与方 / 道具 / 日期 三个条件共用一层 AND，避免 OR 互相覆盖。
  const giftAnd: Prisma.ShunItemGiftWhereInput[] = []
  if (userId) giftAnd.push({ OR: [{ senderId: userId }, { receiverId: userId }] })
  if (code) giftAnd.push({ OR: [
    { sentEntry: { code: code as never } },
    { receivedEntry: { code: code as never } },
    { rewardEntry: { code: code as never } },
  ] })
  if (dayRange) giftAnd.push({ createdAt: dayRange })
  const entryWhere: Prisma.ShunItemEntryWhereInput = {
    ...(userId ? { userId } : {}),
    ...(dayRange ? { createdAt: dayRange } : {}),
    ...(version === null ? {} : { configVersion: version }),
    ...(code ? { code: code as never } : {}),
  }
  const [active, stock, entries, gifts, giftRecords, effects, audit, abuse, discrepancy, statusCounts, entryStats] = await Promise.all([
    prisma.shunItemConfigVersion.findFirst({ orderBy: { version: 'desc' }, include: { definitions: true } }),
    userId ? prisma.shunItemInventory.findMany({ where: { userId } }) : [],
    prisma.shunItemEntry.findMany({ where: entryWhere, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100 }),
    prisma.shunItemGift.findMany({ where: participants, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100 }),
    prisma.shunItemGift.findMany({
      where: giftAnd.length ? { AND: giftAnd } : {},
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
      include: { sentEntry: true, receivedEntry: true, rewardEntry: true, intent: { select: { status: true, configVersion: true, senderCode: true } } },
    }),
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
    prisma.shunItemGiftIntent.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.shunItemEntry.groupBy({
      by: ['type'],
      where: { ...entryWhere, type: { in: ['GIFT_SENT', 'GIFT_RECEIVED', 'GIFT_REWARD'] } },
      _count: { _all: true }, _sum: { availableDelta: true },
    }),
  ])
  const rules = active ? validateShunItemDraft(active)?.rules ?? defaultShunItemRules : defaultShunItemRules
  return json({
    featureEnabled: shunItemsFeatureEnabled(), version: active?.version ?? 0,
    draft: active ? { enabled: active.enabled, definitions: active.definitions, rules: active.rules }
      : { enabled: false, definitions: defaultShunItemDefinitions, rules: defaultShunItemRules },
    stock, entries, gifts, effects, audit, abuse, discrepancy,
    // V4.2.1 赠礼规则与双向赠礼统计（回礼 / 收礼分开计数）。
    giftRules: { receiveDailyLimit: rules.giftsReceived, pool: rules.gifts },
    giftStatus: statusCounts.map((row) => ({ status: row.status, count: row._count._all })),
    giftLedger: entryStats.map((row) => ({ type: row.type, count: row._count._all, amount: row._sum.availableDelta ?? 0 })),
    giftRecords: giftRecords.map((gift) => ({
      id: gift.id, senderId: gift.senderId, receiverId: gift.receiverId, createdAt: gift.createdAt,
      status: gift.intent?.status ?? 'LEGACY', configVersion: gift.intent?.configVersion ?? null,
      sentCode: gift.sentEntry.code, receivedCode: gift.receivedEntry.code,
      rewardCode: gift.rewardEntry?.code ?? gift.intent?.senderCode ?? null,
      legacy: !gift.rewardEntryId,
    })),
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
