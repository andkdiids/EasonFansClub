import { Prisma, type TopicActivityLottery, type TopicActivityLotteryNotice, type TopicActivityLotteryShipping } from '@prisma/client'
import { upsertNotificationWithDb } from '@/lib/notification-write'
import { formatBeijingDateTimeMinute } from '@/lib/beijing-time'
import { prisma } from '@/lib/prisma'
import { withTopicV2Transaction, TopicActivityV2Error } from '@/lib/topic-activity-v2'
import { lockTopicLottery } from '@/lib/topic-activity-v2-lottery'
import {
  decryptTopicLotteryPii,
  encryptTopicLotteryPii,
  topicLotteryPiiSummaryHash,
  type TopicLotteryPiiContext,
} from '@/lib/topic-activity-v2-lottery-private'

export type TopicLotteryAddress = {
  recipient: string
  phone: string
  province: string
  city: string
  district: string
  address: string
  remark: string
}

export type TopicLotteryShipment = {
  carrier: string | null
  trackingNumber: string | null
}

export type TopicLotteryAddressPayload = {
  winner: {
    id: string
    prizeName: string
    addressDeadline: string
    shippingStatus: string
  }
  address: TopicLotteryAddress | null
  shipment: TopicLotteryShipment | null
}

export type TopicLotteryShipmentAction = 'SHIP' | 'DELIVER' | 'EXCEPTION' | 'DELETE_PII'

export type TopicLotteryNoticeDeliverySummary = {
  scanned: number
  sent: number
  failed: number
}

export type TopicLotteryPiiPurgeSummary = {
  scanned: number
  purged: number
  skipped: number
  failed: number
}

type TopicLotteryConfigRow = TopicActivityLottery
type TopicLotteryShippingRow = TopicActivityLotteryShipping
type TopicLotteryNoticeRow = TopicActivityLotteryNotice

type TopicLotteryWinnerRow = {
  id: string
  userId: string
  lotteryId: string
  Lottery: { id: string; title: string; activityId: string | null; Activity: { title: string } | null }
  LotteryPrize: { name: string } | null
}

type TopicLotteryContext = {
  activity: { id: string; title: string }
  config: TopicLotteryConfigRow
  winner: TopicLotteryWinnerRow
  shipping: TopicLotteryShippingRow
  notice: TopicLotteryNoticeRow | null
}

function fail(code: string, message: string, status = 409): never {
  throw new TopicActivityV2Error(code, message, status)
}

function json(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function clampBatchSize(value: number | undefined, fallback = 50) {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.min(200, Math.max(1, Math.floor(value)))
}

function asDate(value: Date | string | undefined) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value || Date.now())
  if (Number.isNaN(date.getTime())) fail('TOPIC_LOTTERY_TIME_INVALID', '服务端时间无效', 500)
  return date
}

function cleanText(value: unknown, field: string, maxLength: number, required = false) {
  if (typeof value !== 'string') {
    if (!required && (value === null || value === undefined)) return ''
    fail('TOPIC_LOTTERY_ADDRESS_INVALID', `${field}格式无效`, 400)
  }
  const text = value.normalize('NFKC').replace(/[\u0000-\u001F\u007F]/g, '').trim()
  if (required && !text) fail('TOPIC_LOTTERY_ADDRESS_INVALID', `${field}不能为空`, 400)
  if (text.length > maxLength) fail('TOPIC_LOTTERY_ADDRESS_INVALID', `${field}过长`, 400)
  return text
}

function normalizeAddress(value: unknown): TopicLotteryAddress {
  const input = record(value)
  const phone = cleanText(input.phone, '手机号', 32, true)
  if (!/^[0-9+()\-\s]{6,32}$/.test(phone) || !/\d{6,}/.test(phone)) fail('TOPIC_LOTTERY_ADDRESS_INVALID', '手机号格式无效', 400)
  return {
    recipient: cleanText(input.recipient, '收件人', 80, true),
    phone,
    province: cleanText(input.province, '省份', 64, true),
    city: cleanText(input.city, '城市', 64, true),
    district: cleanText(input.district, '区县', 64, true),
    address: cleanText(input.address, '详细地址', 300, true),
    remark: cleanText(input.remark, '备注', 500),
  }
}

function normalizeShipment(value: unknown): TopicLotteryShipment {
  const input = record(value)
  const carrier = cleanText(input.carrier, '物流公司', 80) || null
  const trackingNumber = cleanText(input.trackingNumber, '物流单号', 120) || null
  return { carrier, trackingNumber }
}

function piiContext(activityId: string, winnerId: string): TopicLotteryPiiContext {
  return { activityId, winnerId }
}

function readAddress(shipping: TopicLotteryShippingRow, activityId: string): TopicLotteryAddress | null {
  if (!shipping.addressCiphertext || shipping.deletedAt) return null
  return decryptTopicLotteryPii<TopicLotteryAddress>(shipping.addressCiphertext, piiContext(activityId, shipping.winnerId))
}

function readShipment(shipping: TopicLotteryShippingRow, activityId: string): TopicLotteryShipment | null {
  if (!shipping.shipmentCiphertext || shipping.deletedAt) return null
  return decryptTopicLotteryPii<TopicLotteryShipment>(shipping.shipmentCiphertext, piiContext(activityId, shipping.winnerId))
}

function output(context: TopicLotteryContext, address: TopicLotteryAddress | null = readAddress(context.shipping, context.activity.id), shipment: TopicLotteryShipment | null = readShipment(context.shipping, context.activity.id), now?: Date): TopicLotteryAddressPayload {
  const expired = !context.shipping.deletedAt && context.shipping.shippingStatus === 'WAITING_ADDRESS' && now && now.getTime() > context.shipping.addressDeadline.getTime()
  return {
    winner: {
      id: context.winner.id,
      prizeName: context.winner.LotteryPrize?.name || '实物奖品',
      addressDeadline: context.shipping.addressDeadline.toISOString(),
      shippingStatus: expired ? 'EXPIRED' : context.shipping.shippingStatus,
    },
    address,
    shipment,
  }
}

async function loadContext(tx: Prisma.TransactionClient, activityId: string, winnerId: string, userId?: string): Promise<TopicLotteryContext> {
  const locked = await lockTopicLottery(tx, activityId)
  const activity = locked.activity
  const config: TopicLotteryConfigRow = locked.lottery
  const draw = await tx.topicActivityLotteryDraw.findUnique({ where: { activityId }, select: { state: true } })
  if (!draw || draw.state !== 'DRAWN') fail('TOPIC_LOTTERY_WINNER_NOT_FOUND', '中奖记录不存在', 404)
  await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM LotteryEntry WHERE id = ${winnerId} FOR UPDATE`
  const winner = await tx.lotteryEntry.findUnique({
    where: { id: winnerId },
    select: {
      id: true,
      userId: true,
      lotteryId: true,
      Lottery: { select: { id: true, title: true, activityId: true, Activity: { select: { title: true } } } },
      LotteryPrize: { select: { name: true } },
    },
  }) as TopicLotteryWinnerRow | null
  if (!winner || winner.lotteryId !== config.lotteryId || winner.Lottery.activityId !== activityId) fail('TOPIC_LOTTERY_WINNER_NOT_FOUND', '中奖记录不存在', 404)
  if (userId && winner.userId !== userId) fail('TOPIC_LOTTERY_FORBIDDEN', '无权访问该中奖记录', 403)
  await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM TopicActivityLotteryShipping WHERE winnerId = ${winnerId} FOR UPDATE`
  const shipping = await tx.topicActivityLotteryShipping.findUnique({ where: { winnerId } })
  if (!shipping) fail('TOPIC_LOTTERY_SHIPPING_NOT_INITIALIZED', '中奖收件记录尚未初始化', 409)
  const notice = await tx.topicActivityLotteryNotice.findUnique({ where: { winnerId } })
  return { activity: { id: activity.id, title: activity.title }, config, winner, shipping, notice }
}

async function writeAudit(tx: Prisma.TransactionClient, input: { activityId: string; configId: string; actorId?: string | null; action: string; entityId?: string | null; detail?: Record<string, unknown> }) {
  await tx.topicActivityLotteryAudit.create({ data: {
    activityId: input.activityId,
    lotteryConfigId: input.configId,
    actorId: input.actorId || null,
    action: input.action.slice(0, 64),
    entityId: input.entityId || null,
    detail: input.detail ? json(input.detail) : undefined,
  } })
}

function assertBeforeDeadline(shipping: TopicLotteryShippingRow, now: Date) {
  // The configured deadline is inclusive: exactly at the deadline is still
  // accepted; only the first instant after it is rejected.
  if (now.getTime() > shipping.addressDeadline.getTime()) fail('TOPIC_LOTTERY_ADDRESS_DEADLINE_PASSED', '收件截止时间已过', 409)
}

export async function getTopicLotteryAddress(activityId: string, winnerId: string, userId: string, now?: Date): Promise<TopicLotteryAddressPayload> {
  const effectiveNow = asDate(now)
  return withTopicV2Transaction(async (tx) => {
    const context = await loadContext(tx, activityId, winnerId, userId)
    return output(context, undefined, undefined, effectiveNow)
  })
}

export async function saveTopicLotteryAddress(input: { activityId: string; winnerId: string; userId: string; address: unknown; consent: boolean; now?: Date }): Promise<TopicLotteryAddressPayload> {
  const now = asDate(input.now)
  if (!input.consent) fail('TOPIC_LOTTERY_ADDRESS_CONSENT_REQUIRED', '保存收件信息前必须同意隐私使用说明', 400)
  const address = normalizeAddress(input.address)
  return withTopicV2Transaction(async (tx) => {
    const context = await loadContext(tx, input.activityId, input.winnerId, input.userId)
    if (context.shipping.deletedAt) fail('TOPIC_LOTTERY_ADDRESS_PURGED', '收件信息已清理，不能重新收集', 409)
    assertBeforeDeadline(context.shipping, now)
    if (!['WAITING_ADDRESS', 'TO_SHIP'].includes(context.shipping.shippingStatus)) fail('TOPIC_LOTTERY_ADDRESS_LOCKED', '当前发货状态不允许修改收件信息', 409)
    const ciphertext = encryptTopicLotteryPii(address, piiContext(input.activityId, input.winnerId))
    await tx.topicActivityLotteryShipping.update({ where: { winnerId: input.winnerId }, data: {
      addressCiphertext: ciphertext,
      addressUpdatedAt: now,
      consentAt: context.shipping.consentAt || now,
      shippingStatus: 'TO_SHIP',
    } })
    context.shipping.addressCiphertext = ciphertext
    context.shipping.addressUpdatedAt = now
    context.shipping.consentAt = context.shipping.consentAt || now
    context.shipping.shippingStatus = 'TO_SHIP'
    await writeAudit(tx, { activityId: input.activityId, configId: context.config.id, actorId: input.userId, action: 'ADDRESS_SAVE', entityId: input.winnerId, detail: {
      fields: Object.keys(address),
      addressHash: topicLotteryPiiSummaryHash(address),
    } })
    return output(context, address, readShipment(context.shipping, input.activityId))
  })
}

export async function getAdminTopicLotteryAddress(activityId: string, winnerId: string, actorId: string, now?: Date): Promise<TopicLotteryAddressPayload> {
  const effectiveNow = asDate(now)
  return withTopicV2Transaction(async (tx) => {
    const context = await loadContext(tx, activityId, winnerId)
    await writeAudit(tx, { activityId, configId: context.config.id, actorId, action: 'ADDRESS_VIEW', entityId: winnerId, detail: {
      fields: ['address', 'shipment'],
      envelopePresent: Boolean(context.shipping.addressCiphertext || context.shipping.shipmentCiphertext),
    } })
    return output(context, undefined, undefined, effectiveNow)
  })
}

async function currentShipment(context: TopicLotteryContext) {
  return readShipment(context.shipping, context.activity.id) || { carrier: null, trackingNumber: null }
}

export async function updateTopicLotteryShipment(input: { activityId: string; winnerId: string; actorId: string; action: TopicLotteryShipmentAction; carrier?: string; trackingNumber?: string; now?: Date }): Promise<TopicLotteryAddressPayload> {
  const now = asDate(input.now)
  return withTopicV2Transaction(async (tx) => {
    const context = await loadContext(tx, input.activityId, input.winnerId)
    if (input.action !== 'DELETE_PII' && context.shipping.deletedAt) fail('TOPIC_LOTTERY_ADDRESS_PURGED', '收件信息已清理，不能继续处理发货', 409)
    const current = context.shipping.shippingStatus
    if (input.action === 'SHIP') {
      if (current === 'SHIPPED' || current === 'COMPLETED') return output(context)
      if (!['TO_SHIP', 'EXCEPTION'].includes(current) || !context.shipping.addressCiphertext || !context.shipping.consentAt) fail('TOPIC_LOTTERY_SHIPMENT_NOT_READY', '中奖者尚未提交有效收件信息', 409)
      const previous = await currentShipment(context)
      const shipment = normalizeShipment({ carrier: input.carrier ?? previous.carrier, trackingNumber: input.trackingNumber ?? previous.trackingNumber })
      const shipmentCiphertext = encryptTopicLotteryPii(shipment, piiContext(input.activityId, input.winnerId))
      await tx.topicActivityLotteryShipping.update({ where: { winnerId: input.winnerId }, data: { shipmentCiphertext, shippingStatus: 'SHIPPED', shippedAt: context.shipping.shippedAt || now } })
      context.shipping.shipmentCiphertext = shipmentCiphertext
      context.shipping.shippingStatus = 'SHIPPED'
      context.shipping.shippedAt = context.shipping.shippedAt || now
      await writeAudit(tx, { activityId: input.activityId, configId: context.config.id, actorId: input.actorId, action: 'SHIP', entityId: input.winnerId, detail: { fields: ['shipment'], shipmentHash: topicLotteryPiiSummaryHash(shipment) } })
      return output(context, readAddress(context.shipping, input.activityId), shipment)
    }
    if (input.action === 'DELIVER') {
      if (current === 'COMPLETED') return output(context)
      if (current !== 'SHIPPED') fail('TOPIC_LOTTERY_SHIPMENT_INVALID_STATE', '当前状态不能标记为已送达', 409)
      await tx.topicActivityLotteryShipping.update({ where: { winnerId: input.winnerId }, data: { shippingStatus: 'COMPLETED', completedAt: context.shipping.completedAt || now } })
      context.shipping.shippingStatus = 'COMPLETED'
      context.shipping.completedAt = context.shipping.completedAt || now
      await writeAudit(tx, { activityId: input.activityId, configId: context.config.id, actorId: input.actorId, action: 'DELIVER', entityId: input.winnerId, detail: { fields: [] } })
      return output(context)
    }
    if (input.action === 'EXCEPTION') {
      if (['COMPLETED', 'EXPIRED'].includes(current)) fail('TOPIC_LOTTERY_SHIPMENT_INVALID_STATE', '当前状态不能标记为异常', 409)
      const previous = await currentShipment(context)
      const hasShipmentInput = input.carrier !== undefined || input.trackingNumber !== undefined
      const shipment = hasShipmentInput ? normalizeShipment({ carrier: input.carrier ?? previous.carrier, trackingNumber: input.trackingNumber ?? previous.trackingNumber }) : previous
      const shipmentCiphertext = hasShipmentInput ? encryptTopicLotteryPii(shipment, piiContext(input.activityId, input.winnerId)) : context.shipping.shipmentCiphertext
      await tx.topicActivityLotteryShipping.update({ where: { winnerId: input.winnerId }, data: { ...(hasShipmentInput ? { shipmentCiphertext } : {}), shippingStatus: 'EXCEPTION' } })
      context.shipping.shipmentCiphertext = shipmentCiphertext
      context.shipping.shippingStatus = 'EXCEPTION'
      await writeAudit(tx, { activityId: input.activityId, configId: context.config.id, actorId: input.actorId, action: 'EXCEPTION', entityId: input.winnerId, detail: { fields: hasShipmentInput ? ['shipment'] : [] } })
      return output(context, readAddress(context.shipping, input.activityId), shipment)
    }
    if (context.shipping.deletedAt) return output(context, null, null)
    await tx.topicActivityLotteryShipping.update({ where: { winnerId: input.winnerId }, data: { addressCiphertext: null, shipmentCiphertext: null, deletedAt: now } })
    context.shipping.addressCiphertext = null
    context.shipping.shipmentCiphertext = null
    context.shipping.deletedAt = now
    await writeAudit(tx, { activityId: input.activityId, configId: context.config.id, actorId: input.actorId, action: 'DELETE_PII', entityId: input.winnerId, detail: { fields: ['address', 'shipment'] } })
    return output(context, null, null)
  })
}

type NoticeCandidate = { winnerId: string; activityId: string }

async function findNoticeCandidates(activityId: string | undefined, batchSize: number) {
  if (activityId) {
    return prisma.$queryRaw<NoticeCandidate[]>`SELECT n.winnerId, c.activityId FROM TopicActivityLotteryNotice n INNER JOIN LotteryEntry w ON w.id = n.winnerId INNER JOIN Lottery l ON l.id = w.lotteryId INNER JOIN TopicActivityLottery c ON c.lotteryId = l.id INNER JOIN TopicActivityLotteryDraw d ON d.activityId = c.activityId AND d.state = 'DRAWN' WHERE (n.state IN ('PENDING', 'FAILED') OR (n.state = 'SENDING' AND n.updatedAt <= NOW() - INTERVAL 5 MINUTE)) AND c.activityId = ${activityId} ORDER BY n.createdAt ASC, n.id ASC LIMIT ${batchSize}`
  }
  return prisma.$queryRaw<NoticeCandidate[]>`SELECT n.winnerId, c.activityId FROM TopicActivityLotteryNotice n INNER JOIN LotteryEntry w ON w.id = n.winnerId INNER JOIN Lottery l ON l.id = w.lotteryId INNER JOIN TopicActivityLottery c ON c.lotteryId = l.id INNER JOIN TopicActivityLotteryDraw d ON d.activityId = c.activityId AND d.state = 'DRAWN' WHERE (n.state IN ('PENDING', 'FAILED') OR (n.state = 'SENDING' AND n.updatedAt <= NOW() - INTERVAL 5 MINUTE)) ORDER BY n.createdAt ASC, n.id ASC LIMIT ${batchSize}`
}

async function deliverOneNotice(candidate: NoticeCandidate) {
  return withTopicV2Transaction(async (tx) => {
    const context = await loadContext(tx, candidate.activityId, candidate.winnerId)
    // Keep the Notice row locked through the non-IGNORE Notification upsert.
    // A second worker therefore observes SENT after the first transaction
    // commits; the unique recipientId+key is an additional database guard.
    await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM TopicActivityLotteryNotice WHERE winnerId = ${candidate.winnerId} FOR UPDATE`
    const notice = await tx.topicActivityLotteryNotice.findUnique({ where: { winnerId: candidate.winnerId } })
    const staleSending = notice?.state === 'SENDING' && notice.updatedAt.getTime() <= Date.now() - 5 * 60 * 1000
    if (!notice || (!['PENDING', 'FAILED'].includes(notice.state) && !staleSending)) return 'SKIPPED' as const
    const deadline = formatBeijingDateTimeMinute(context.shipping.addressDeadline)
    try {
      const notificationKey = `topic-v2-lottery-win:${candidate.winnerId}`
      await upsertNotificationWithDb(tx, {
        where: { recipientId_key: { recipientId: context.winner.userId, key: notificationKey } },
        update: {},
        create: {
          recipientId: context.winner.userId,
          actorId: null,
          type: 'ACTIVITY',
          title: '实物抽奖中奖通知',
          content: `恭喜你在「${context.activity.title}」中获得「${context.winner.LotteryPrize?.name || '实物奖品'}」，请在 ${deadline} 前进入活动页面填写收件信息。`,
          link: `/activities/${candidate.activityId}/lottery/claims/${candidate.winnerId}`,
          key: notificationKey,
        },
      }, { operation: 'topic-v2-lottery-win-notification', userId: context.winner.userId })
      await tx.topicActivityLotteryNotice.update({ where: { winnerId: candidate.winnerId }, data: { state: 'SENT', sentAt: new Date(), errorCode: null, attempts: { increment: 1 } } })
      await writeAudit(tx, { activityId: candidate.activityId, configId: context.config.id, actorId: null, action: 'NOTICE_SENT', entityId: candidate.winnerId, detail: { state: 'SENT' } })
      return 'SENT' as const
    } catch {
      await tx.topicActivityLotteryNotice.update({ where: { winnerId: candidate.winnerId }, data: { state: 'FAILED', errorCode: 'NOTIFICATION_WRITE_FAILED', attempts: { increment: 1 } } })
      await writeAudit(tx, { activityId: candidate.activityId, configId: context.config.id, actorId: null, action: 'NOTICE_FAILED', entityId: candidate.winnerId, detail: { state: 'FAILED' } })
      return 'FAILED' as const
    }
  })
}

export async function deliverTopicLotteryNotices(options: { activityId?: string; batchSize?: number } = {}): Promise<TopicLotteryNoticeDeliverySummary> {
  const candidates = await findNoticeCandidates(options.activityId, clampBatchSize(options.batchSize))
  const summary: TopicLotteryNoticeDeliverySummary = { scanned: candidates.length, sent: 0, failed: 0 }
  for (const candidate of candidates) {
    try {
      const result = await deliverOneNotice(candidate)
      if (result === 'SENT') summary.sent += 1
      if (result === 'FAILED') summary.failed += 1
    } catch { summary.failed += 1 }
  }
  return summary
}

async function findPurgeCandidates(batchSize: number, now: Date) {
  return prisma.$queryRaw<NoticeCandidate[]>`SELECT s.winnerId, c.activityId FROM TopicActivityLotteryShipping s INNER JOIN LotteryEntry w ON w.id = s.winnerId INNER JOIN Lottery l ON l.id = w.lotteryId INNER JOIN TopicActivityLottery c ON c.lotteryId = l.id INNER JOIN TopicActivityLotteryDraw d ON d.activityId = c.activityId AND d.state = 'DRAWN' WHERE s.retainUntil <= ${now} AND s.deletedAt IS NULL ORDER BY s.retainUntil ASC, s.id ASC LIMIT ${batchSize}`
}

export async function purgeExpiredTopicLotteryPII(options: { now?: Date; batchSize?: number } = {}): Promise<TopicLotteryPiiPurgeSummary> {
  const now = asDate(options.now)
  const candidates = await findPurgeCandidates(clampBatchSize(options.batchSize), now)
  const summary: TopicLotteryPiiPurgeSummary = { scanned: candidates.length, purged: 0, skipped: 0, failed: 0 }
  for (const candidate of candidates) {
    try {
      const result = await withTopicV2Transaction(async (tx) => {
        const context = await loadContext(tx, candidate.activityId, candidate.winnerId)
        if (context.shipping.deletedAt || context.shipping.retainUntil.getTime() > now.getTime()) return 'SKIPPED' as const
        await tx.topicActivityLotteryShipping.update({ where: { winnerId: candidate.winnerId }, data: { addressCiphertext: null, shipmentCiphertext: null, deletedAt: now } })
        await writeAudit(tx, { activityId: candidate.activityId, configId: context.config.id, actorId: null, action: 'PII_PURGED', entityId: candidate.winnerId, detail: { fields: ['address', 'shipment'] } })
        return 'PURGED' as const
      })
      if (result === 'PURGED') summary.purged += 1
      else summary.skipped += 1
    } catch {
      summary.failed += 1
    }
  }
  return summary
}
