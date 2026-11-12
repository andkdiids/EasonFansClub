import 'dotenv/config'
import { ANYWHERE_DOOR_TARGET } from '@/lib/anywhere-door/config'
import { prisma } from '@/lib/prisma'
import { withInstagramMaintenanceDrain } from '@/lib/instagram/maintenance-protocol'

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR'
  return message.replace(/(?:mysql|postgresql|postgres):\/\/[^\s]+/gi, '[REDACTED_DATABASE_URL]').slice(0, 300)
}

async function main() {
  const target = ANYWHERE_DOOR_TARGET
  const timeoutMs = Number(process.argv[2] || 1_800_000)
  const allowLegacyLeaseSchema = process.argv[3] === '--allow-legacy-lease-schema'
  if (process.argv.length > 4 || (process.argv[3] !== undefined && !allowLegacyLeaseSchema)) throw new Error('INVALID_INSTAGRAM_MAINTENANCE_OPTIONS')
  if (!/^[a-zA-Z0-9._-]{1,191}$/.test(target)) throw new Error('INVALID_INSTAGRAM_MAINTENANCE_TARGET')
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 60_000 || timeoutMs > 2_400_000) throw new Error('INVALID_INSTAGRAM_MAINTENANCE_TIMEOUT')

  let signalRelease!: () => void
  const released = new Promise<void>((resolve) => { signalRelease = resolve })
  process.once('SIGUSR2', signalRelease)

  await withInstagramMaintenanceDrain(prisma, target, async () => {
    process.stdout.write('INSTAGRAM_MAINTENANCE_DRAIN_READY=YES\n')
    await released
  }, { timeoutMs, allowLegacyLeaseSchema })

  process.stdout.write('INSTAGRAM_MAINTENANCE_HOLD_RELEASED=YES\n')
}

void main().catch(async (error) => {
  process.stderr.write(`INSTAGRAM_MAINTENANCE_HOLD_ERROR=${safeError(error)}\n`)
  process.exitCode = 1
}).finally(async () => {
  await prisma.$disconnect().catch(() => undefined)
})
