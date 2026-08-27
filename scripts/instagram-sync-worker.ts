import 'dotenv/config'
import { runInstagramSyncWorkerOnce } from '@/lib/instagram/worker'

/**
 * Independent one-shot worker entrypoint. PM2 or a scheduler may invoke this
 * file against the atomic `current` release; it is never called by a page
 * request and is intentionally not started by the Phase 5.1 code gate.
 */
let stopping = false
process.once('SIGTERM', () => { stopping = true })
process.once('SIGINT', () => { stopping = true })

while (!stopping) {
  const result = await runInstagramSyncWorkerOnce()
  console.info('[instagram-sync-worker]', { status: result.status, errorCode: result.errorCode || null })
  const waitMs = result.status === 'SYNC_DISABLED' ? 15 * 60 * 1000 : 60 * 1000
  await new Promise<void>((resolve) => setTimeout(resolve, waitMs))
}
