import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { authCookieName, createSessionToken } from '../lib/auth'
import { prisma } from '../lib/prisma'
import { shunDay } from '../lib/shun-master-rules'
import { lockShunItemUsers, postShunItemMovement } from '../lib/shun-item-inventory'
import { shunTransaction } from '../lib/shun-master'
import { runShunItemRewardSweep } from '../lib/shun-item-rewards'

/**
 * V4.2 final acceptance — RESTART-01..07.
 * Real Next.js child process, real isolated MySQL fixture, real HTTP calls.
 * Each case commits a mutation, loses the response by killing the process,
 * restarts it, replays the same request id and asserts single settlement.
 */
const DB_URL = 'mysql://root@127.0.0.1:33327/ecfc_shun_items_fixture_qa'
const WEB_BUILD = 'E:/Eason/build-cache/shun-items-mysql-5ccb45b9e9c64f89a994917e2540ad47/web-build'
const NEXT_BIN = join(WEB_BUILD, 'node_modules', 'next', 'dist', 'bin', 'next')
const OUTPUT = 'E:/Eason/build-cache/shun-items-mysql-5ccb45b9e9c64f89a994917e2540ad47'
const BASE = 'http://127.0.0.1:3128'

type User = { id: string; uid: number; nickname: string }

async function evidence(id: string, scenario: string, before: unknown, after: unknown, result: string) {
  await appendFile(join(OUTPUT, 'restart-verified.jsonl'), JSON.stringify({
    id, scenario, method: 'real Next.js process SIGTERM + restart + same requestId replay + MySQL row counts',
    before, after, result, logPath: join(OUTPUT, 'restart-matrix.log'),
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
  const child = spawn(process.execPath, [NEXT_BIN, 'start', '-p', '3128'], {
    cwd: WEB_BUILD,
    env: { ...process.env, DATABASE_URL: DB_URL, SHUN_ITEMS_ENABLED: 'true', NODE_OPTIONS: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return child
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

async function restartService(child: ChildProcess): Promise<ChildProcess> {
  child.kill('SIGTERM')
  await new Promise<void>((resolve) => {
    if (child.exitCode !== null) return resolve()
    child.once('exit', () => resolve())
    setTimeout(() => resolve(), 8000)
  })
  const next = startService()
  await waitReady(next)
  return next
}

test('V4.2 RESTART-01..07: real process restart recovery matrix', {
  skip: process.env.SHUN_V42_RESTART_QA !== '1',
  timeout: 900_000,
}, async () => {
  const url = new URL(DB_URL)
  assert.equal(new URL(process.env.DATABASE_URL ?? '').port, url.port)
  await mkdir(OUTPUT, { recursive: true })
  const db = new URL(process.env.DATABASE_URL!)
  assert.equal(db.pathname, '/ecfc_shun_items_fixture_qa')
  const previousGate = process.env.SHUN_ITEMS_ENABLED
  process.env.SHUN_ITEMS_ENABLED = 'true'
  const config = await prisma.shunItemConfigVersion.findFirstOrThrow({ orderBy: { version: 'desc' } })
  assert.equal(config.enabled, true)
  const fixture = async (points = 100) => {
    const nickname = 'V42Restart-' + randomUUID().slice(0, 8)
    return prisma.user.create({ data: {
      username: nickname, usernameNormalized: nickname.toLowerCase(), nickname, passwordHash: 'fixture', points,
      Profile: { create: { displayName: nickname } },
    } })
  }
  const grant = async (user: User, code: 'EXTRA_ATTEMPT' | 'FRIEND_GIFT' | 'TARGET_FRIEND' | 'DOUBLE_AMOUNT', requestKey: string) => {
    await shunTransaction(async (tx) => {
      await lockShunItemUsers(tx, [user.id])
      await postShunItemMovement(tx, { userId: user.id, code, type: 'DAILY_MAIN', day: shunDay(new Date()), requestKey, configVersion: config.version })
    })
  }
  const counts = async (userId: string) => Promise.all([
    prisma.shunMasterRound.count({ where: { actorId: userId } }),
    prisma.shunItemEntry.count({ where: { userId } }),
    prisma.pointLog.count({ where: { userId } }),
  ]).then(([rounds, entries, logs]) => ({ rounds, entries, logs }))
  let service = startService()
  try {
    await waitReady(service)
    // RESTART-01: request dropped before commit (service killed before the HTTP call).
    {
      const actor = await fixture()
      await fixture()
      const before = await counts(actor.id)
      const key = randomUUID()
      service.kill('SIGTERM')
      await new Promise<void>((resolve) => {
        if (service.exitCode !== null) return resolve()
        service.once('exit', () => resolve())
        setTimeout(() => resolve(), 8000)
      })
      await assert.rejects(request(actor, '/api/shun-master/attempt', { requestId: key }), /fetch failed|ECONNRESET|socket/i)
      service = await restartService(service)
      const first = await request(actor, '/api/shun-master/attempt', { requestId: key })
      assert.equal(first.status, 200)
      const replay = await request(actor, '/api/shun-master/attempt', { requestId: key })
      assert.deepEqual(replay.json, first.json)
      const after = await counts(actor.id)
      assert.equal(after.rounds - before.rounds, 1)
      assert.equal(after.logs - before.logs, 1)
      await evidence('RESTART-01', 'main attempt dropped before service start, same-key replay after restart', before, after, 'PASS')
    }
    // RESTART-02: committed main attempt loses its response to a restart.
    {
      const actor = await fixture(), victim = await fixture()
      const before = await counts(actor.id)
      const key = randomUUID()
      const committed = await request(actor, '/api/shun-master/attempt', { requestId: key })
      assert.equal(committed.status, 200)
      const mid = await counts(actor.id)
      assert.equal(mid.rounds - before.rounds, 1)
      service = await restartService(service)
      const replay = await request(actor, '/api/shun-master/attempt', { requestId: key })
      assert.deepEqual(replay.json, committed.json)
      assert.deepEqual(await counts(actor.id), mid)
      await evidence('RESTART-02', 'main attempt committed then response lost by process restart', before, mid, 'PASS')
    }
    // RESTART-03: extra-attempt grant committed, restart, same-key replay.
    {
      const actor = await fixture()
      await grant(actor, 'EXTRA_ATTEMPT', 'restart-extra-' + actor.id)
      const before = await counts(actor.id)
      const key = randomUUID()
      const committed = await request(actor, '/api/shun-master/extra-attempt', { requestId: key })
      assert.equal(committed.status, 200)
      const daily = await prisma.shunItemDaily.findUniqueOrThrow({ where: { userId_day: { userId: actor.id, day: shunDay(new Date()) } } })
      assert.equal(daily.extraAttemptsGranted, 1)
      const mid = await counts(actor.id)
      service = await restartService(service)
      const replay = await request(actor, '/api/shun-master/extra-attempt', { requestId: key })
      assert.deepEqual(replay.json, committed.json)
      assert.deepEqual(await counts(actor.id), mid)
      assert.equal((await prisma.shunItemDaily.findUniqueOrThrow({ where: { userId_day: { userId: actor.id, day: shunDay(new Date()) } } })).extraAttemptsGranted, 1)
      await evidence('RESTART-03', 'extra-attempt committed before restart, replay does not double grant', mid, mid, 'PASS')
    }
    // RESTART-04: directed attempt with item committed, restart, same-key replay.
    {
      const actor = await fixture(), victim = await fixture()
      await grant(actor, 'TARGET_FRIEND', 'restart-target-' + actor.id)
      const [userAId, userBId] = [actor.id, victim.id].sort()
      await prisma.friendship.create({ data: { userAId, userBId } })
      const before = await counts(actor.id)
      const key = randomUUID()
      const committed = await request(actor, '/api/shun-master/attempt', { requestId: key, friendId: victim.id })
      assert.equal(committed.status, 200)
      const mid = await counts(actor.id)
      assert.equal(await prisma.shunMasterRound.count({ where: { actorId: actor.id, victimId: victim.id } }), 1)
      service = await restartService(service)
      const replay = await request(actor, '/api/shun-master/attempt', { requestId: key, friendId: victim.id })
      assert.deepEqual(replay.json, committed.json)
      assert.deepEqual(await counts(actor.id), mid)
      await evidence('RESTART-04', 'directed item attempt committed before restart, replay is idempotent', before, mid, 'PASS')
    }
    // RESTART-05: friend gift intent committed, restart, same-key replay.
    {
      const sender = await fixture(), receiver = await fixture()
      await grant(sender, 'FRIEND_GIFT', 'restart-gift-' + sender.id)
      const [userAId, userBId] = [sender.id, receiver.id].sort()
      await prisma.friendship.create({ data: { userAId, userBId } })
      const before = await counts(sender.id)
      const key = randomUUID()
      const committed = await request(sender, '/api/shun-master/gift', { requestId: key })
      assert.equal(committed.status, 200)
      const mid = await counts(sender.id)
      assert.equal(await prisma.shunItemGift.count({ where: { senderId: sender.id, receiverId: receiver.id } }), 1)
      service = await restartService(service)
      const replay = await request(sender, '/api/shun-master/gift', { requestId: key })
      assert.deepEqual(replay.json, committed.json)
      assert.deepEqual(await counts(sender.id), mid)
      await evidence('RESTART-05', 'friend gift committed before restart, replay delivers once', before, mid, 'PASS')
    }
    // RESTART-06: pending-item selection committed, restart, same-key replay.
    {
      const actor = await fixture()
      await grant(actor, 'DOUBLE_AMOUNT', 'restart-pending-' + actor.id)
      const before = await counts(actor.id)
      const key = randomUUID()
      const committed = await request(actor, '/api/shun-master/pending-item', { requestId: key, code: 'DOUBLE_AMOUNT', cancel: false })
      assert.equal(committed.status, 200)
      const mid = await counts(actor.id)
      assert.equal(await prisma.shunItemPending.count({ where: { userId: actor.id, code: 'DOUBLE_AMOUNT' } }), 1)
      service = await restartService(service)
      const replay = await request(actor, '/api/shun-master/pending-item', { requestId: key, code: 'DOUBLE_AMOUNT', cancel: false })
      assert.deepEqual(replay.json, committed.json)
      assert.deepEqual(await counts(actor.id), mid)
      await evidence('RESTART-06', 'pending item selection committed before restart, replay preserves one selection', before, mid, 'PASS')
    }
    // RESTART-07: reward worker restart mid-cycle: first sweep commits grants,
    // the process restarts before the ack, the next sweep must not re-grant.
    {
      const actor = await fixture()
      const before = await counts(actor.id)
      const key = randomUUID()
      const committed = await request(actor, '/api/shun-master/attempt', { requestId: key })
      assert.equal(committed.status, 200)
      await runShunItemRewardSweep()
      const mid = await counts(actor.id)
      service = await restartService(service)
      await runShunItemRewardSweep()
      assert.deepEqual(await counts(actor.id), mid)
      assert.equal(await prisma.shunItemEntry.count({ where: { userId: actor.id, requestKey: { startsWith: 'retry:' } } }), 0)
      await evidence('RESTART-07', 'reward sweep across process restart does not replay grants', before, mid, 'PASS')
    }
  } finally {
    if (previousGate === undefined) delete process.env.SHUN_ITEMS_ENABLED
    else process.env.SHUN_ITEMS_ENABLED = previousGate
    service.kill('SIGTERM')
    await prisma.$disconnect()
  }
})
