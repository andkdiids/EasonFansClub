import 'dotenv/config'
import { runInstagramSyncWorkerOnce } from '@/lib/instagram/worker'
import { prisma } from '@/lib/prisma'
import { isDeploymentDbMaintenanceHeld } from '@/lib/deployment-db-maintenance-hold'
import { runUnlessDeploymentHeld } from '@/lib/instagram/worker-hold'

/**
 * Independent one-shot worker entrypoint. PM2 or a scheduler may invoke this
 * file against the atomic `current` release; it is never called by a page
 * request and is intentionally not started by the Phase 5.1 code gate.
 */
let stopping = false
let wakeCurrentWait: (() => void) | null = null
function requestStop() {
  stopping = true
  wakeCurrentWait?.()
}
process.once('SIGTERM', requestStop)
process.once('SIGINT', requestStop)

function waitOrStop(milliseconds: number) {
  if (stopping) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      wakeCurrentWait = null
      resolve()
    }, milliseconds)
    wakeCurrentWait = () => {
      clearTimeout(timer)
      wakeCurrentWait = null
      resolve()
    }
  })
}

async function main() {
  try {
    while (!stopping) {
      const attempt = await runUnlessDeploymentHeld(isDeploymentDbMaintenanceHeld, () => runInstagramSyncWorkerOnce())
      if (attempt.held) {
        console.info('[instagram-sync-worker]', { status: 'DEPLOYMENT_MAINTENANCE_HOLD' })
        await waitOrStop(5000)
        continue
      }
      const result = attempt.result
      console.info('[instagram-sync-worker]', { status: result.status, errorCode: result.errorCode || null })
      const waitMs = result.status === 'SYNC_DISABLED' ? 15 * 60 * 1000 : 60 * 1000
      await waitOrStop(waitMs)
    }
  } finally {
    await prisma.$disconnect()
  }
}

void main().catch((error) => {
  console.error('[instagram-sync-worker.fatal]', error)
  process.exitCode = 1
})
