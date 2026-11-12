import assert from 'node:assert/strict'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { PrismaClient } from '@prisma/client'

const rawUrl = process.env.RC14_ISOLATED_MYSQL_URL || ''
const databaseName = 'ecfc_rc14_worker_qa'
const target = 'mreasonchan'
const children: ChildProcessWithoutNullStreams[] = []

function assertIsolatedDatabase(raw: string) {
  const url = new URL(raw)
  if (url.protocol !== 'mysql:' || url.hostname !== '127.0.0.1' || !['3306', '3307'].includes(url.port) || url.pathname !== `/${databaseName}`) {
    throw new Error('REFUSING_NON_ISOLATED_DATABASE')
  }
}

function redact(value: string) {
  return value.replace(/(?:mysql|postgresql|postgres):\/\/[^\s]+/gi, '[REDACTED_DATABASE_URL]')
}

function spawnHelper(url: string) {
  const child = spawn(process.execPath, [
    '--import',
    'tsx',
    'scripts/instagram-maintenance-hold.ts',
    '60000',
    '--allow-legacy-lease-schema',
  ], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: url, NODE_ENV: 'test' },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  children.push(child)
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
  child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
  return { child, get stdout() { return stdout }, get stderr() { return stderr } }
}

async function waitForExit(child: ChildProcessWithoutNullStreams, timeoutMs = 20_000) {
  if (child.exitCode !== null || child.signalCode !== null) return child.exitCode
  return await Promise.race([
    new Promise<number | null>((resolve) => child.once('exit', (code) => resolve(code))),
    delay(timeoutMs).then(() => { throw new Error('HELPER_EXIT_TIMEOUT') }),
  ])
}

async function waitForReady(child: ChildProcessWithoutNullStreams, output: () => string, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  while (!output().includes('INSTAGRAM_MAINTENANCE_DRAIN_READY=YES')) {
    if (child.exitCode !== null) throw new Error(`HELPER_EXITED_BEFORE_READY:${child.exitCode}`)
    if (Date.now() >= deadline) throw new Error('HELPER_READY_TIMEOUT')
    await delay(25)
  }
}

async function resetState(db: PrismaClient) {
  await db.$executeRaw`DELETE FROM SiteSetting`
  await db.$executeRaw`DELETE FROM SocialSyncState`
  await db.$executeRaw`
    INSERT INTO SocialSyncState (id, platform, target, lockToken, lockUntil, leaseGeneration, updatedAt, createdAt)
    VALUES ('helper-test-state', 'INSTAGRAM', ${target}, NULL, NULL, 0, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
  `
}

async function readHold(db: PrismaClient) {
  const rows = await db.$queryRaw<Array<{ value: string }>>`
    SELECT value FROM SiteSetting WHERE \`key\` = ${`instagram_worker_maintenance_hold:${target}`}
  `
  return rows[0]?.value || null
}

async function main() {
  assertIsolatedDatabase(rawUrl)
  const db = new PrismaClient({ datasources: { db: { url: rawUrl } } })
  let ownsTables = false
  try {
    const tables = await db.$queryRaw<Array<{ TABLE_NAME: string }>>`SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE()`
    if (tables.length) throw new Error('REFUSING_NONEMPTY_DATABASE')
    ownsTables = true
    await db.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS SocialSyncState (id VARCHAR(191) PRIMARY KEY, platform VARCHAR(32) NOT NULL, target VARCHAR(191) NOT NULL, lockToken VARCHAR(64), lockUntil DATETIME(3), leaseGeneration BIGINT NOT NULL DEFAULT 0, updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), UNIQUE KEY platform_target (platform,target))')
    await db.$executeRawUnsafe("CREATE TABLE IF NOT EXISTS SiteSetting (id VARCHAR(191) PRIMARY KEY, `key` VARCHAR(191) NOT NULL UNIQUE, `value` TEXT NOT NULL, valueType VARCHAR(32) NOT NULL DEFAULT 'TEXT', `group` VARCHAR(191) NOT NULL DEFAULT 'general', label VARCHAR(191), updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3))")

    if (process.platform === 'win32') {
      console.log('REAL_OS_SIGNAL_HELPER_TEST=SKIPPED_WINDOWS_SIGNAL_SEMANTICS')
      return
    }

    await resetState(db)
    const normal = spawnHelper(rawUrl)
    await waitForReady(normal.child, () => normal.stdout)
    await delay(250)
    assert.equal(normal.child.exitCode, null, 'helper must remain alive after READY')
    normal.child.kill('SIGUSR2')
    assert.equal(await waitForExit(normal.child), 0)
    assert.match(normal.stdout, /INSTAGRAM_MAINTENANCE_HOLD_RELEASED=YES/)
    assert.equal(await readHold(db), 'RELEASED')

    for (const signal of ['SIGTERM', 'SIGINT'] as const) {
      await resetState(db)
      const terminated = spawnHelper(rawUrl)
      await waitForReady(terminated.child, () => terminated.stdout)
      await delay(250)
      assert.equal(terminated.child.exitCode, null)
      terminated.child.kill(signal)
      const code = await waitForExit(terminated.child)
      assert.notEqual(code, 0, `${signal} must fail closed`)
      assert.doesNotMatch(terminated.stdout, /INSTAGRAM_MAINTENANCE_HOLD_RELEASED=YES/)
      assert.equal(await readHold(db), 'HELD', `${signal} must retain the maintenance hold`)
    }

    await resetState(db)
    const crashed = spawnHelper(rawUrl)
    await waitForReady(crashed.child, () => crashed.stdout)
    crashed.child.kill('SIGKILL')
    assert.notEqual(await waitForExit(crashed.child), 0)
    assert.equal(await readHold(db), 'HELD', 'unexpected helper death must retain the hold')

    const unavailable = spawnHelper('mysql://root:invalid@127.0.0.1:1/ecfc_rc14_worker_qa')
    const unavailableCode = await waitForExit(unavailable.child)
    assert.notEqual(unavailableCode, 0)
    assert.doesNotMatch(`${unavailable.stdout}\n${unavailable.stderr}`, /INSTAGRAM_MAINTENANCE_HOLD_RELEASED=YES/)
    console.log('REAL_OS_SIGNAL_HELPER=PASS')
  } catch (error) {
    throw new Error(redact(error instanceof Error ? error.message : String(error)))
  } finally {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      child.stdin.destroy()
      child.stdout.destroy()
      child.stderr.destroy()
    }
    if (ownsTables) {
      await db.$executeRawUnsafe('DROP TABLE IF EXISTS SiteSetting').catch(() => undefined)
      await db.$executeRawUnsafe('DROP TABLE IF EXISTS SocialSyncState').catch(() => undefined)
    }
    await db.$disconnect()
  }
}

main().catch((error) => {
  console.error(redact(error instanceof Error ? error.stack || error.message : String(error)))
  process.exitCode = 1
})
