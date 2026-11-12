import assert from 'node:assert/strict'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { releaseInstagramSyncLease } from '../lib/instagram/sync-state'
import { createMySqlAdvisoryLockName } from '../lib/mysql-advisory-lock'

type ChildEvent = Record<string, unknown> & { event: string }
type ChildHandle = { process: ChildProcess; events: ChildEvent[]; pending: Array<{ event: string; resolve: (value: ChildEvent) => void; reject: (error: Error) => void }> }

const root = process.cwd()
const fixture = resolve(root, 'tests/fixtures/instagram-lease-child.ts')
const tsx = resolve(root, 'node_modules/tsx/dist/cli.mjs')

function startChild(operation: string, target: string, extra: Record<string, string> = {}): ChildHandle {
  const child = spawn(process.execPath, [tsx, fixture, operation], {
    cwd: root,
    env: { ...process.env, RC14_TEST_TARGET: target, ...extra },
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  })
  const handle: ChildHandle = { process: child, events: [], pending: [] }
  let stdout = ''
  child.stdout?.on('data', (chunk: Buffer | string) => {
    stdout += String(chunk)
    const lines = stdout.split(/\r?\n/)
    stdout = lines.pop() || ''
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const event = JSON.parse(line) as ChildEvent
        const waiting = handle.pending.findIndex((entry) => entry.event === event.event)
        if (waiting >= 0) handle.pending.splice(waiting, 1)[0].resolve(event)
        else handle.events.push(event)
      } catch {
        handle.events.push({ event: 'non-json-output', line })
      }
    }
  })
  child.stderr?.on('data', (chunk: Buffer | string) => {
    handle.events.push({ event: 'stderr', line: String(chunk) })
  })
  child.once('error', (error) => {
    for (const entry of handle.pending.splice(0)) entry.reject(error)
  })
  child.once('exit', (code, signal) => {
    for (const entry of handle.pending.splice(0)) entry.reject(new Error(`CHILD_EXIT:${code}:${signal}`))
  })
  return handle
}

function event(child: ChildHandle, name: string, timeoutMs = 15_000): Promise<ChildEvent> {
  const index = child.events.findIndex((item) => item.event === name)
  if (index >= 0) return Promise.resolve(child.events.splice(index, 1)[0])
  return new Promise((resolveEvent, reject) => {
    const timer = setTimeout(() => {
      const index = child.pending.findIndex((item) => item.resolve === finish)
      if (index >= 0) child.pending.splice(index, 1)
      reject(new Error(`TIMEOUT_WAITING_FOR_${name}`))
    }, timeoutMs)
    const finish = (value: ChildEvent) => {
      clearTimeout(timer)
      resolveEvent(value)
    }
    child.pending.push({ event: name, resolve: finish, reject })
  })
}

function send(child: ChildHandle, line: string) {
  if (!child.process.stdin?.writable) throw new Error('CHILD_STDIN_CLOSED')
  child.process.stdin.write(`${line}\n`)
}

function wait(ms: number) {
  return new Promise((resolveWait) => setTimeout(resolveWait, ms))
}

async function killTree(child: ChildHandle) {
  const pid = child.process.pid
  if (!pid || child.process.exitCode !== null || child.process.signalCode !== null) return
  if (process.platform === 'win32') {
    try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', timeout: 10_000 }) }
    catch { try { child.process.kill('SIGKILL') } catch { /* already stopped */ } }
  } else {
    try { process.kill(-pid, 'SIGKILL') }
    catch { try { child.process.kill('SIGKILL') } catch { /* already stopped */ } }
  }
  await new Promise<void>((resolveExit) => {
    if (child.process.exitCode !== null || child.process.signalCode !== null) return resolveExit()
    const timer = setTimeout(resolveExit, 5_000)
    child.process.once('exit', () => { clearTimeout(timer); resolveExit() })
  })
}

async function dispose(child: ChildHandle | undefined) {
  if (!child) return
  await killTree(child)
  child.process.stdout?.destroy()
  child.process.stderr?.destroy()
  child.process.stdin?.destroy()
}

function requireIsolatedUrl(raw: string) {
  let url: URL
  try { url = new URL(raw) } catch { throw new Error('RC14_ISOLATED_MYSQL_URL_REQUIRED') }
  if (url.protocol !== 'mysql:' || url.hostname !== '127.0.0.1' || !url.port || url.pathname !== '/ecfc_rc14_worker_qa') {
    throw new Error('REFUSING_NON_ISOLATED_DATABASE')
  }
  return url
}

async function main() {
  const raw = process.env.RC14_ISOLATED_MYSQL_URL || ''
  requireIsolatedUrl(raw)
  const db = new PrismaClient({ datasources: { db: { url: raw } } })
  const target = `rc14-process-${randomUUID().replaceAll('-', '').slice(0, 20)}`
  const running: ChildHandle[] = []
  let createdStateTable = false
  let createdSettingTable = false

  try {
    const tables = await db.$queryRaw<Array<{ TABLE_NAME: string }>>`SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE()`
    if (tables.length) throw new Error('REFUSING_NONEMPTY_DATABASE')
    await db.$executeRawUnsafe(`CREATE TABLE SocialSyncState (
      id VARCHAR(191) NOT NULL,
      platform ENUM('INSTAGRAM') NOT NULL DEFAULT 'INSTAGRAM',
      target VARCHAR(191) NOT NULL,
      lastCheckedAt DATETIME(3) NULL, lastSuccessfulSyncAt DATETIME(3) NULL, lastChangedAt DATETIME(3) NULL,
      lastExternalId VARCHAR(191) NULL, consecutiveFailures INT NOT NULL DEFAULT 0, nextAllowedSyncAt DATETIME(3) NULL,
      lastErrorCode VARCHAR(64) NULL, lastErrorAt DATETIME(3) NULL, baselineCompletedAt DATETIME(3) NULL,
      syncRequestedAt DATETIME(3) NULL, lockToken VARCHAR(64) NULL, lockUntil DATETIME(3) NULL,
      leaseGeneration BIGINT NOT NULL DEFAULT 0, createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updatedAt DATETIME(3) NOT NULL,
      PRIMARY KEY (id), UNIQUE KEY SocialSyncState_platform_target_key (platform, target)
    ) ENGINE=InnoDB`)
    createdStateTable = true
    await db.$executeRawUnsafe(`CREATE TABLE SiteSetting (
      id VARCHAR(191) NOT NULL,
      \`key\` VARCHAR(191) NOT NULL,
      \`value\` TEXT NOT NULL,
      valueType VARCHAR(32) NOT NULL DEFAULT 'TEXT',
      \`group\` VARCHAR(191) NOT NULL DEFAULT 'general',
      label VARCHAR(191) NULL,
      updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (id), UNIQUE KEY SiteSetting_key_key (\`key\`)
    ) ENGINE=InnoDB`)
    createdSettingTable = true

    // First and second independent Node/tsx processes compete on the actual
    // MySQL row. Exactly one process may receive the initial generation.
    const first = startChild('hold-lease', target, { RC14_TEST_TOKEN: 'process-owner-a', RC14_TEST_LEASE_MS: '30000' })
    running.push(first)
    const firstLease = await event(first, 'acquired')
    assert.equal(firstLease.acquired, true)
    assert.equal(String(firstLease.generation), '1')

    const contender = startChild('acquire', target, { RC14_TEST_TOKEN: 'process-owner-b', RC14_TEST_LEASE_MS: '30000' })
    running.push(contender)
    const secondLease = await event(contender, 'acquired')
    assert.equal(secondLease.acquired, false, 'a competing real process cannot own the live lease')

    send(first, 'RENEW')
    assert.equal((await event(first, 'renewed')).renewed, true, 'renewal keeps the current owner active')
    send(first, 'WRITE')
    assert.equal((await event(first, 'write')).accepted, true, 'the current token and generation may write')
    send(first, 'RELEASE')
    assert.equal((await event(first, 'released')).released, true)

    // A crashed process drops its MySQL session lock but leaves the lease row.
    // The drain must wait for TTL, fence the orphan, then admit maintenance.
    const crashing = startChild('hold-worker', target, { RC14_TEST_TOKEN: 'crashed-owner', RC14_TEST_LEASE_MS: '1200' })
    running.push(crashing)
    const crashedLease = await event(crashing, 'worker-active')
    assert.equal(crashedLease.acquired, true)
    const crashedGeneration = BigInt(String(crashedLease.generation))
    await killTree(crashing)

    const maintenance = startChild('hold-maintenance', target, { RC14_TEST_TIMEOUT_MS: '8000' })
    running.push(maintenance)
    const maintenanceHeld = await event(maintenance, 'maintenance-acquired', 12_000)
    assert.equal(maintenanceHeld.event, 'maintenance-acquired')
    const fenced = await db.socialSyncState.findUniqueOrThrow({ where: { platform_target: { platform: 'INSTAGRAM', target } } })
    assert.equal(fenced.lockToken, null, 'crash recovery clears the expired lease')
    assert.ok(fenced.leaseGeneration > crashedGeneration, 'crash recovery fences the abandoned generation')

    // A delayed write from the crashed generation is rejected even after a new
    // process obtains a higher generation.
    send(maintenance, 'RELEASE')
    await event(maintenance, 'maintenance-released')
    const recovered = startChild('acquire', target, { RC14_TEST_TOKEN: 'recovered-owner', RC14_TEST_LEASE_MS: '30000' })
    running.push(recovered)
    const recoveredLease = await event(recovered, 'acquired')
    assert.equal(recoveredLease.acquired, true)
    assert.ok(BigInt(String(recoveredLease.generation)) > crashedGeneration)
    const stale = startChild('stale-write', target, { RC14_TEST_TOKEN: 'crashed-owner', RC14_TEST_GENERATION: String(crashedGeneration) })
    running.push(stale)
    const staleWrite = await event(stale, 'stale-write')
    assert.equal(staleWrite.accepted, false)
    assert.equal(staleWrite.error, 'INSTAGRAM_LEASE_LOST')
    const afterStale = await db.socialSyncState.findUniqueOrThrow({ where: { platform_target: { platform: 'INSTAGRAM', target } } })
    assert.notEqual(afterStale.lastErrorCode, 'stale-child-write')

    // Drop the actual MySQL session holding the worker admission lock. The
    // maintenance drain reclaims only after the lease has expired and bumps
    // generation; a surviving process that resumes cannot write.
    assert.equal(await releaseInstagramSyncLease(target, 'recovered-owner', BigInt(String(recoveredLease.generation)), db), true)
    const interrupted = startChild('hold-worker', target, { RC14_TEST_TOKEN: 'interrupted-owner', RC14_TEST_LEASE_MS: '30000' })
    running.push(interrupted)
    const interruptedLease = await event(interrupted, 'worker-active')
    assert.equal(interruptedLease.acquired, true)
    const activeLock = createMySqlAdvisoryLockName('instagram-active-task', target)
    const lockOwner = await db.$queryRaw<Array<{ connectionId: bigint | number | null }>>`SELECT IS_USED_LOCK(${activeLock}) AS connectionId`
    const connectionId = Number(lockOwner[0]?.connectionId)
    assert.ok(Number.isSafeInteger(connectionId) && connectionId > 0, 'worker admission owns a real MySQL session lock')
    await db.$executeRawUnsafe(`KILL CONNECTION ${connectionId}`)
    const interruptionDrain = startChild('hold-maintenance', target, { RC14_TEST_TIMEOUT_MS: '8000' })
    running.push(interruptionDrain)
    await wait(150)
    await db.socialSyncState.updateMany({
      where: { platform: 'INSTAGRAM', target, lockToken: 'interrupted-owner' },
      data: { lockUntil: new Date(Date.now() - 1_000) },
    })
    await event(interruptionDrain, 'maintenance-acquired', 10_000)
    const afterInterruption = await db.socialSyncState.findUniqueOrThrow({ where: { platform_target: { platform: 'INSTAGRAM', target } } })
    assert.equal(afterInterruption.lockToken, null)
    assert.ok(afterInterruption.leaseGeneration > BigInt(String(interruptedLease.generation)))
    send(interrupted, 'WRITE')
    const interruptedWrite = await event(interrupted, 'worker-write', 5_000)
    assert.equal(interruptedWrite.accepted, false)
    assert.equal(interruptedWrite.error, 'INSTAGRAM_LEASE_LOST')
    send(interrupted, 'EXIT')
    send(interruptionDrain, 'RELEASE')
    await event(interruptionDrain, 'maintenance-released', 5_000)

    // Hold active admission and lease together; a drain must not claim the
    // maintenance window until this independent process really leaves.
    const worker = startChild('hold-worker', target, { RC14_TEST_TOKEN: 'drain-owner', RC14_TEST_LEASE_MS: '30000' })
    running.push(worker)
    assert.equal((await event(worker, 'worker-active')).acquired, true)
    const draining = startChild('hold-maintenance', target, { RC14_TEST_TIMEOUT_MS: '8000' })
    running.push(draining)
    await wait(400)
    assert.equal(draining.events.some((item) => item.event === 'maintenance-acquired'), false, 'maintenance waits while a real worker process is active')
    send(worker, 'RELEASE')
    await event(worker, 'worker-drained')
    await event(draining, 'maintenance-acquired', 8_000)

    // Maintenance is held. A new independent process must not enter until it
    // is released. The lock attempt may be rejected or remain blocked; either
    // outcome is safe so long as admission does not happen.
    const blocked = startChild('hold-worker', target, { RC14_TEST_TOKEN: 'during-maintenance', RC14_TEST_LEASE_MS: '30000' })
    running.push(blocked)
    await wait(500)
    assert.equal(blocked.events.some((item) => item.event === 'worker-active'), false, 'maintenance excludes a new admission')
    send(draining, 'RELEASE')
    await event(draining, 'maintenance-released')
    const resumed = startChild('hold-worker', target, { RC14_TEST_TOKEN: 'after-maintenance', RC14_TEST_LEASE_MS: '30000' })
    running.push(resumed)
    const admittedAfter = await event(resumed, 'worker-active', 8_000)
    assert.equal(admittedAfter.acquired, true, 'admission resumes after maintenance release')
    const timedDrain = startChild('hold-maintenance', target, { RC14_TEST_TIMEOUT_MS: '1000' })
    running.push(timedDrain)
    const drainFailure = await event(timedDrain, 'error', 5_000)
    assert.match(String(drainFailure.message), /did not drain/i, 'maintenance timeout fails closed while a worker is active')
    const persistentHold = await db.siteSetting.findUnique({ where: { key: `instagram_worker_maintenance_hold:${target}` } })
    assert.equal(persistentHold?.value, 'HELD', 'a timed out maintenance attempt leaves a persistent fail-closed hold')
    send(resumed, 'RELEASE')
    await event(resumed, 'worker-drained')
    const heldAttempt = startChild('hold-worker', target, { RC14_TEST_TOKEN: 'while-hold-persisted', RC14_TEST_LEASE_MS: '30000' })
    running.push(heldAttempt)
    const heldError = await event(heldAttempt, 'error', 5_000)
    assert.match(String(heldError.message), /admission is held/i)
    assert.equal(heldAttempt.events.some((item) => item.event === 'worker-active'), false)
    const recoveredMaintenance = startChild('hold-maintenance', target, { RC14_TEST_TIMEOUT_MS: '8000' })
    running.push(recoveredMaintenance)
    await event(recoveredMaintenance, 'maintenance-acquired', 10_000)
    send(recoveredMaintenance, 'RELEASE')
    await event(recoveredMaintenance, 'maintenance-released', 5_000)

    // An unreachable database must fail closed rather than admit a worker.
    const unavailable = startChild('hold-admission', target, { RC14_ISOLATED_MYSQL_URL: 'mysql://invalid:invalid@127.0.0.1:1/ecfc_rc14_worker_qa' })
    running.push(unavailable)
    const dbFailure = await event(unavailable, 'error', 8_000)
    assert.match(String(dbFailure.message), /connect|ECONNREFUSED|Can't reach/i)
    assert.equal(unavailable.events.some((item) => item.event === 'admitted'), false)

    console.log('REAL_TWO_PROCESS_MYSQL_WORKER_FENCING=PASS')
    console.log('REAL_MYSQL_LEASE_RENEWAL_STALE_WRITE_MAINTENANCE_DRAIN_CRASH_RECOVERY=PASS')
    console.log('DATABASE_UNAVAILABLE_FAIL_CLOSED=PASS')
  } finally {
    await Promise.all(running.map((child) => dispose(child)))
    if (createdSettingTable) await db.$executeRawUnsafe('DROP TABLE IF EXISTS SiteSetting')
    if (createdStateTable) await db.$executeRawUnsafe('DROP TABLE IF EXISTS SocialSyncState')
    await db.$disconnect()
  }
}

main().catch((error: Error) => {
  console.error(error.message)
  process.exitCode = 1
})
