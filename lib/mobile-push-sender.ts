import { prisma } from '@/lib/prisma'
import { isDbMaintenanceAllowed, isDeploymentDbMaintenanceHeld } from '@/lib/deployment-db-maintenance-hold'

/**
 * Guarded dispatcher for queued mobile push deliveries.
 *
 * Deliveries are drained by an in-process sweep (same pattern as the 顺大师
 * notify worker). Sends go through the Expo push service; the server-side
 * credential lives in `EXPO_ACCESS_TOKEN` and is never exposed to clients.
 * DeviceNotRegistered receipts and send errors disable or degrade the token
 * instead of retrying forever.
 */

export const MOBILE_PUSH_WORKER_INTERVAL_MS = 15_000
const SWEEP_BATCH = 25
const MAX_ATTEMPTS = 5
const BACKOFF_MINUTES = [1, 5, 30, 120] as const

const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send'
const EXPO_RECEIPT_ENDPOINT = 'https://exp.host/--/api/v2/push/getReceipts'

export type MobilePushSweepResult = {
  scanned: number
  sent: number
  failed: number
  skipped: number
  credentialsMissing: boolean
}

export type ExpoPushMessage = {
  to: string
  title: string
  body: string
  data?: Record<string, unknown>
  channelId?: string
  sound?: 'default'
  priority?: 'high' | 'normal'
  ttl?: number
}

export type ExpoPushTicket = { status: 'ok'; id: string } | { status: 'error'; message: string; details?: { error?: string } }

export type ExpoPushClient = (endpoint: string, body: unknown) => Promise<{ data?: unknown }>

const defaultPushClient: ExpoPushClient = async (endpoint, body) => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (process.env.EXPO_ACCESS_TOKEN) headers.Authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`
  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`EXPO_PUSH_HTTP_${response.status}`)
  return response.json() as Promise<{ data?: unknown }>
}

function channelForPayload(payload: unknown): string | undefined {
  const type = (payload as { type?: string } | null)?.type
  if (type === 'MESSAGE') return 'ecfc-messages'
  if (type === 'FRIEND_REQUEST') return 'ecfc-friends'
  if (type === 'BADGE') return 'ecfc-games'
  return 'ecfc-system'
}

function nextBackoff(attempts: number): Date {
  const minutes = BACKOFF_MINUTES[Math.min(attempts - 1, BACKOFF_MINUTES.length - 1)] ?? 120
  return new Date(Date.now() + minutes * 60_000)
}

export function buildExpoPushMessages(
  delivery: { title: string; body: string; payload: unknown },
  tokens: readonly string[],
): ExpoPushMessage[] {
  const payload = (delivery.payload && typeof delivery.payload === 'object' ? delivery.payload : {}) as Record<string, unknown>
  return tokens.map((to) => ({
    to,
    title: delivery.title,
    body: delivery.body,
    data: payload,
    channelId: channelForPayload(payload),
    sound: 'default',
    priority: 'high',
    ttl: 3600,
  }))
}

export async function runMobilePushSweepOnce(now = new Date(), pushClient: ExpoPushClient = defaultPushClient): Promise<MobilePushSweepResult> {
  const result: MobilePushSweepResult = { scanned: 0, sent: 0, failed: 0, skipped: 0, credentialsMissing: false }
  const credentialsPresent = Boolean(process.env.EXPO_ACCESS_TOKEN)

  const due = await prisma.mobilePushDelivery.findMany({
    where: { status: 'PENDING', nextAttemptAt: { lte: now } },
    orderBy: { nextAttemptAt: 'asc' },
    take: SWEEP_BATCH,
  }).catch(() => [])
  result.scanned = due.length
  if (!due.length) return result

  if (!credentialsPresent) {
    // Keep rows PENDING without burning retry attempts: a missing server
    // credential is a deployment problem, not a delivery failure.
    result.credentialsMissing = true
    return result
  }

  for (const delivery of due) {
    try {
      const tokens = await prisma.mobilePushToken.findMany({
        where: { userId: delivery.userId, status: 'ACTIVE' },
        select: { id: true, expoPushToken: true },
      })
      if (!tokens.length) {
        await prisma.mobilePushDelivery.update({
          where: { id: delivery.id },
          data: { status: 'SKIPPED', tokenCount: 0, lastError: 'NO_ACTIVE_TOKEN' },
        })
        result.skipped += 1
        continue
      }

      const messages = buildExpoPushMessages(delivery, tokens.map((token) => token.expoPushToken))
      const response = await pushClient(EXPO_PUSH_ENDPOINT, { type: 'expo', messages })
      const tickets = Array.isArray(response?.data) ? response.data as ExpoPushTicket[] : []

      const unregistered: string[] = []
      let sendFailures = 0
      const receiptIds: string[] = []
      for (let index = 0; index < tickets.length; index += 1) {
        const ticket = tickets[index]
        const token = tokens[index]
        if (!ticket || !token) continue
        if (ticket.status === 'ok') {
          receiptIds.push(ticket.id)
          continue
        }
        sendFailures += 1
        const reason = ticket.details?.error || ticket.message || 'EXPO_PUSH_ERROR'
        if (ticket.details?.error === 'DeviceNotRegistered' || /DeviceNotRegistered/i.test(ticket.message)) {
          unregistered.push(token.id)
        }
        await prisma.mobilePushToken.update({
          where: { id: token.id },
          data: { failureCount: { increment: 1 }, lastFailureAt: now, lastFailureReason: reason.slice(0, 255) },
        }).catch(() => undefined)
      }

      if (unregistered.length) {
        await prisma.mobilePushToken.updateMany({
          where: { id: { in: unregistered } },
          data: { status: 'DISABLED', lastFailureAt: now, lastFailureReason: 'DeviceNotRegistered' },
        }).catch(() => undefined)
      }

      // Receipts catch async device-level failures (uninstalled apps).
      if (receiptIds.length) {
        try {
          const receiptResponse = await pushClient(EXPO_RECEIPT_ENDPOINT, { ids: receiptIds })
          const receipts = (receiptResponse?.data && typeof receiptResponse.data === 'object' ? receiptResponse.data : {}) as Record<string, { status?: string; message?: string; details?: { error?: string } }>
          const receiptUnregistered = Object.entries(receipts)
            .filter(([, receipt]) => receipt?.details?.error === 'DeviceNotRegistered')
            .map(([receiptId]) => receiptId)
          if (receiptUnregistered.length) {
            const tokenIdsByReceipt = new Map<string, string>()
            for (let index = 0; index < tickets.length; index += 1) {
              const ticket = tickets[index]
              if (ticket?.status === 'ok') tokenIdsByReceipt.set(ticket.id, tokens[index].id)
            }
            await prisma.mobilePushToken.updateMany({
              where: { id: { in: receiptUnregistered.map((receiptId) => tokenIdsByReceipt.get(receiptId)).filter((id): id is string => Boolean(id)) } },
              data: { status: 'DISABLED', lastFailureAt: now, lastFailureReason: 'DeviceNotRegistered' },
            }).catch(() => undefined)
          }
        } catch {
          // Receipt failures are non-fatal; the next pass retries deliveries by attempt count only.
        }
      }

      if (sendFailures >= tokens.length) {
        const attempts = delivery.attempts + 1
        const failed = attempts >= MAX_ATTEMPTS
        await prisma.mobilePushDelivery.update({
          where: { id: delivery.id },
          data: {
            attempts,
            status: failed ? 'FAILED' : 'PENDING',
            nextAttemptAt: failed ? now : nextBackoff(attempts),
            lastError: 'EXPO_PUSH_ERROR',
            tokenCount: tokens.length,
          },
        })
        if (failed) result.failed += 1
        continue
      }

      await prisma.mobilePushDelivery.update({
        where: { id: delivery.id },
        data: { status: 'SENT', attempts: delivery.attempts + 1, tokenCount: tokens.length, lastError: sendFailures ? 'PARTIAL_SEND' : null },
      })
      result.sent += 1
    } catch (error) {
      const attempts = delivery.attempts + 1
      const failed = attempts >= MAX_ATTEMPTS
      await prisma.mobilePushDelivery.update({
        where: { id: delivery.id },
        data: {
          attempts,
          status: failed ? 'FAILED' : 'PENDING',
          nextAttemptAt: failed ? now : nextBackoff(attempts),
          lastError: (error instanceof Error ? error.message : String(error)).slice(0, 255),
        },
      }).catch(() => undefined)
      if (failed) result.failed += 1
      console.error('[mobile-push.worker.delivery-failed]', {
        deliveryId: delivery.id,
        errorName: error instanceof Error ? error.name : 'UNKNOWN',
      })
    }
  }

  if (result.sent || result.failed || result.skipped) {
    console.info('[mobile-push.worker.sweep]', { ...result })
  }
  return result
}

export function startMobilePushWorker(isMaintenanceHeld = isDeploymentDbMaintenanceHeld) {
  let stopped = false
  const tick = () => {
    if (stopped) return
    if (!isDbMaintenanceAllowed(isMaintenanceHeld)) return
    void runMobilePushSweepOnce().catch((error) => {
      console.error('[mobile-push.worker.failed]', {
        errorName: error instanceof Error ? error.name : 'UNKNOWN',
      })
    })
  }
  const heartbeat = setInterval(tick, MOBILE_PUSH_WORKER_INTERVAL_MS)
  tick()
  return () => {
    stopped = true
    clearInterval(heartbeat)
  }
}
