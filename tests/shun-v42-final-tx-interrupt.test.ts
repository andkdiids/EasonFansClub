import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { authCookieName, createSessionToken } from '../lib/auth'
import { prisma } from '../lib/prisma'

/**
 * V4.2 final acceptance — EXECUTION-INTERRUPT line (in-doubt transaction).
 *
 * This is DISTINCT from the two other interruption lines:
 *  - request-not-sent (before-send): server never receives the request;
 *  - after-commit response loss: transaction already committed, response lost.
 *
 * Here the request IS delivered and the transaction STARTS writing. A MySQL
 * BEFORE INSERT trigger injects SLEEP so the transaction hangs AFTER ShunMasterRound
 * is inserted but BEFORE it commits. The Next.js child process is then SIGKILLed,
 * severing the DB connection; MySQL rolls back the uncommitted transaction. We
 * assert no half-accounting, then restart and replay the same requestId, asserting
 * exactly-once settlement. This is the in-doubt (mid-execution) recovery line.
 */
const DB_URL = 'mysql://root@127.0.0.1:33327/ecfc_shun_items_fixture_qa'
const WEB_BUILD = 'E:/Eason/build-cache/shun-items-mysql-5ccb45b9e9c64f89a994917e2540ad47/web-build'
const NEXT_BIN = join(WEB_BUILD, 'node_modules', 'next', 'dist', 'bin', 'next')
const OUTPUT = 'E:/Eason/build-cache/shun-items-mysql-5ccb45b9e9c64f89a994917e2540ad47'
const MYSQL = 'E:/Eason/build-cache/shun-items-mysql-5ccb45b9e9c64f89a994917e2540ad47/engine/bin/mysql.exe'
const BASE = 'http://127.0.0.1:3129'

type User = { id: string; uid: number; nickname: string }

async function evidence(id: string, scenario: string, before: unknown, after: unknown, result: string) {
  await appendFile(join(OUTPUT, 'tx-interrupt-verified.jsonl'), JSON.stringify({
    id, scenario,
    method: 'delivered HTTP request + BEFORE INSERT SLEEP trigger holding an uncommitted MySQL transaction + SIGKILL of Next.js process + InnoDB rollback + restart + same requestId replay + row counts',
    before, after, result, logPath: join(OUTPUT, 'tx-interrupt-run.log'),
  }) + '\n')
  console.log(`PASS ${id} ${result}`)
}

async function request(user: User, path: string, body?: unknown) {
  const token = await createSessionToken(user as never)
  const response = await fetch(BASE + path, {
    method: 'POST',
    headers: {
      Cookie: `${authCookieName}=${token}`,
      Origin: BASE,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { status: response.status, json: await response.json().catch(() => null) as Record<string, unknown> | null }
}

function startService(): ChildProcess {
  return spawn(process.execPath, [NEXT_BIN, 'start', '-p', '3129'], {
    cwd: WEB_BUILD,
    env: { ...process.env, DATABASE_URL: DB_URL, SHUN_ITEMS_ENABLED: 'true', NODE_OPTIONS: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

async function waitReady(child: ChildProcess) {
  for (let attempt = 0; attempt < 300; attempt++) {
    if (child.exitCode !== null) throw new Error('service exited during startup code=' + child.exitCode)
    try {
      const response = await fetch(BASE + '/login', { signal: AbortSignal.timeout(2000) })
      await response.arrayBuffer()
      if (response.status > 0) return
    } catch { /* not listening yet */ }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error('service readiness timeout')
}

async function waitGone(child: ChildProcess) {
  await new Promise<void>((resolve) => {
    if (child.exitCode !== null) return resolve()
    child.once('exit', () => resolve())
    setTimeout(() => resolve(), 8000)
  })
}

const ddl = (sql: string) => execFileSync(MYSQL, [
  '--no-defaults', '--host=127.0.0.1', '--protocol=TCP', '--port=33327',
  '--user=root', 'ecfc_shun_items_fixture_qa',
], { input: sql })

test('V4.2 EXEC-INTERRUPT-01: in-doubt transaction rolled back by process kill, replay settles once', {
  skip: process.env.SHUN_V42_TX_INTERRUPT_QA !== '1',
  timeout: 900_000,
}, async () => {
  const url = new URL(DB_URL)
  assert.equal(new URL(process.env.DATABASE_URL ?? '').port, url.port)
  const db = new URL(process.env.DATABASE_URL!)
  assert.equal(db.pathname, '/ecfc_shun_items_fixture_qa')
  await mkdir(OUTPUT, { recursive: true })
  const previousGate = process.env.SHUN_ITEMS_ENABLED
  process.env.SHUN_ITEMS_ENABLED = 'true'

  const actor = await prisma.user.create({ data: {
    username: 'V42Intr-' + randomUUID().slice(0, 8),
    usernameNormalized: 'v42intr-' + randomUUID().slice(0, 8),
    nickname: 'V42Intr-' + randomUUID().slice(0, 8), passwordHash: 'fixture', points: 100,
    Profile: { create: { displayName: 'V42Intr' } },
  } })
  await prisma.user.create({ data: {
    username: 'V42Vic-' + randomUUID().slice(0, 8),
    usernameNormalized: 'v42vic-' + randomUUID().slice(0, 8),
    nickname: 'V42Vic-' + randomUUID().slice(0, 8), passwordHash: 'fixture', points: 100,
    Profile: { create: { displayName: 'V42Vic' } },
  } })

  const counts = async () => Promise.all([
    prisma.shunMasterRound.count({ where: { actorId: actor.id } }),
    prisma.shunItemEntry.count({ where: { userId: actor.id } }),
    prisma.pointLog.count({ where: { userId: actor.id } }),
  ]).then(([rounds, entries, logs]) => ({ rounds, entries, logs }))

  const trigger = 'shun_qa_txint_' + randomUUID().replaceAll('-', '').slice(0, 16)
  const key = randomUUID()
  let service = startService()
  try {
    await waitReady(service)
    const before = await counts()
    assert.deepEqual(before, { rounds: 0, entries: 0, logs: 0 })

    // Hold the transaction mid-execution: round INSERT succeeds, then the
    // PointLog INSERT (ledger take) sleeps inside the trigger. The HTTP handler
    // has therefore reached the server and started writing but has NOT committed.
    ddl(`CREATE TRIGGER ${trigger} BEFORE INSERT ON PointLog FOR EACH ROW
      SET NEW.reason = IF(NEW.userId = '${actor.id}' AND NEW.action = 'SHUN_STEAL', SLEEP(20), NEW.reason)`)

    // Deliver the request; do not await the response — it will hang inside the txn.
    // Attach the rejection handler synchronously: SIGKILL severs the socket and the
    // fetch rejects while we are waiting, so a late catch() triggers unhandledRejection.
    const inflight = request(actor, '/api/shun-master/attempt', { requestId: key }).catch(() => undefined)
    await new Promise((resolve) => setTimeout(resolve, 4000))

    // Confirm an uncommitted transaction exists holding the round write.
    const inflightRows = await prisma.$queryRawUnsafe<Array<{ c: bigint }>>(
      `SELECT COUNT(*) AS c FROM information_schema.INNODB_TRX`,
    )
    assert.ok(Number(inflightRows[0].c) >= 1, 'an in-flight InnoDB transaction must exist before kill')

    // Mid-execution process interruption (in-doubt): SIGKILL severs the DB link.
    service.kill('SIGKILL')
    await waitGone(service)
    await inflight

    // Allow InnoDB a moment to detect the dropped connection and roll back.
    await new Promise((resolve) => setTimeout(resolve, 2500))

    // No half-accounting: the uncommitted round/ledger must be fully rolled back.
    const afterKill = await counts()
    assert.deepEqual(afterKill, before, 'mid-execution kill must roll back all writes (no half-accounting)')

    // Remove the fault injector, restart, replay the same key.
    ddl(`DROP TRIGGER ${trigger}`)
    service = startService()
    await waitReady(service)
    const replay = await request(actor, '/api/shun-master/attempt', { requestId: key })
    assert.equal(replay.status, 200)
    const replayAgain = await request(actor, '/api/shun-master/attempt', { requestId: key })
    assert.deepEqual(replayAgain.json, replay.json)
    const after = await counts()
    assert.equal(after.rounds - before.rounds, 1)
    assert.equal(after.logs - before.logs, 1)

    await evidence(
      'EXEC-INTERRUPT-01',
      'delivered request; transaction wrote round then hung before commit; SIGKILL rolled back; replay settled exactly once',
      { before, afterKill },
      { after, replayStatus: replay.status },
      'PASS',
    )
  } finally {
    ddl(`DROP TRIGGER IF EXISTS ${trigger}`)
    if (previousGate === undefined) delete process.env.SHUN_ITEMS_ENABLED
    else process.env.SHUN_ITEMS_ENABLED = previousGate
    service.kill('SIGKILL')
    await prisma.$disconnect()
  }
})
