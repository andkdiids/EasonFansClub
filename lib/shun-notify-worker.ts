import { prisma } from '@/lib/prisma'
import { shunSendDueCaptureNotification, shunSendDueNotification } from '@/lib/shun-master'
import { SHUN_CAPTURE_NOTIFY_STATUS, SHUN_NOTIFY_STATUS } from '@/lib/shun-config'
import { isDbMaintenanceAllowed, isDeploymentDbMaintenanceHeld } from '@/lib/deployment-db-maintenance-hold'

/**
 * Deadline sweep for takes whose actor never chose a notification.
 *
 * A take settles immediately, so a victim could otherwise stay unnotified for
 * ever if the actor closes the tab, loses the network, kills the app or simply
 * walks away from the letter editor. Browser-side hooks (`beforeunload`,
 * `sendBeacon`) are best effort only and cannot be trusted for money movement,
 * so the decision is taken over by the server: any round still `PENDING` after
 * `notifyDueAt` is delivered as an ordinary notification inside the same
 * serialised transaction a player request would use.
 *
 * The sweep is idempotent: it re-reads the status under the settings row lock,
 * so a player who sends the letter a millisecond earlier still wins, and a
 * repeated run can never create a second notification.
 */

export const SHUN_NOTIFY_WORKER_INTERVAL_MS = 15_000
const SWEEP_BATCH = 25

export type ShunNotifySweepResult = {
  scanned: number
  delivered: number
  failed: number
  /** Capture-result notices delivered by the same pass (V5). */
  captureDelivered: number
  captureFailed: number
}

let sweeping = false

export async function runShunNotifySweepOnce(now = new Date()): Promise<ShunNotifySweepResult> {
  if (sweeping) return { scanned: 0, delivered: 0, failed: 0, captureDelivered: 0, captureFailed: 0 }
  sweeping = true
  try {
    const due = await prisma.shunMasterRound.findMany({
      where: { notifyStatus: SHUN_NOTIFY_STATUS.pending, notifyDueAt: { lte: now } },
      orderBy: { notifyDueAt: 'asc' },
      take: SWEEP_BATCH,
      select: { id: true },
    })
    let delivered = 0
    let failed = 0
    for (const { id } of due) {
      try {
        const outcome = await shunSendDueNotification(id)
        if (outcome.status === SHUN_NOTIFY_STATUS.plain) delivered += 1
      } catch (error) {
        failed += 1
        // The failed attempt is recorded outside the rolled-back transaction so
        // administrators can see the retry pressure even while the retry loop
        // is still running.
        await prisma.shunMasterRound.update({ where: { id }, data: { notifyAttempts: { increment: 1 } } })
          .catch(() => undefined)
        console.error('[shun-notify.worker.round-failed]', {
          roundId: id, errorName: error instanceof Error ? error.name : 'UNKNOWN',
        })
      }
    }
    // Capture results share the same window and the same serialised service, so
    // a capturer who closes the page can never leave the caught actor unaware.
    const dueCaptures = await prisma.shunMasterRound.findMany({
      where: { captureNotifyStatus: SHUN_CAPTURE_NOTIFY_STATUS.pending, captureNotifyDueAt: { lte: now } },
      orderBy: { captureNotifyDueAt: 'asc' },
      take: SWEEP_BATCH,
      select: { id: true },
    })
    let captureDelivered = 0
    let captureFailed = 0
    for (const { id } of dueCaptures) {
      try {
        const outcome = await shunSendDueCaptureNotification(id)
        if (outcome.status === SHUN_CAPTURE_NOTIFY_STATUS.plain) captureDelivered += 1
      } catch (error) {
        captureFailed += 1
        console.error('[shun-notify.worker.capture-failed]', {
          roundId: id, errorName: error instanceof Error ? error.name : 'UNKNOWN',
        })
      }
    }
    if (due.length || dueCaptures.length) {
      console.info('[shun-notify.worker.sweep]', {
        scanned: due.length, delivered, failed, captureScanned: dueCaptures.length, captureDelivered, captureFailed,
      })
    }
    return { scanned: due.length, delivered, failed, captureDelivered, captureFailed }
  } finally {
    sweeping = false
  }
}

export function startShunNotifyWorker(isMaintenanceHeld = isDeploymentDbMaintenanceHeld) {
  let stopped = false
  const tick = () => {
    if (stopped) return
    if (!isDbMaintenanceAllowed(isMaintenanceHeld)) return
    void runShunNotifySweepOnce().catch((error) => {
      console.error('[shun-notify.worker.failed]', {
        errorName: error instanceof Error ? error.name : 'UNKNOWN',
      })
    })
  }
  const heartbeat = setInterval(tick, SHUN_NOTIFY_WORKER_INTERVAL_MS)
  tick()
  return () => {
    stopped = true
    clearInterval(heartbeat)
  }
}
