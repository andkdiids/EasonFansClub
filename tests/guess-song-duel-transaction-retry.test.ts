import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { Prisma } from '@prisma/client'
import {
  DUEL_TRANSACTION_MAX_ATTEMPTS,
  isDuelTransactionConflict,
  retryDuelTransaction,
} from '../lib/guess-song-duel-service'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

function prismaError(code: string) {
  return new Prisma.PrismaClientKnownRequestError(`test ${code}`, { code, clientVersion: 'test' })
}

test('Duel retries one transient P2034 and then returns the committed result', async () => {
  let attempts = 0
  const delays: number[] = []
  const result = await retryDuelTransaction(async () => {
    attempts += 1
    if (attempts === 1) throw prismaError('P2034')
    return 'ok'
  }, async (delayMs) => {
    delays.push(delayMs)
  })

  assert.equal(result, 'ok')
  assert.equal(attempts, 2)
  assert.equal(delays.length, 1)
  assert.ok(delays[0] >= 25 && delays[0] < 41)
})

test('Duel stops after the bounded P2034 retry budget', async () => {
  let attempts = 0
  const conflict = prismaError('P2034')

  await assert.rejects(
    retryDuelTransaction(async () => {
      attempts += 1
      throw conflict
    }, async () => undefined),
    (error) => error === conflict,
  )

  assert.equal(attempts, DUEL_TRANSACTION_MAX_ATTEMPTS)
})

test('Duel does not retry non-P2034 errors', async () => {
  let attempts = 0
  const error = prismaError('P2028')

  assert.equal(isDuelTransactionConflict(error), false)
  await assert.rejects(
    retryDuelTransaction(async () => {
      attempts += 1
      throw error
    }, async () => undefined),
    (received) => received === error,
  )
  assert.equal(attempts, 1)
})

test('production start binds Next to loopback while development remains unchanged', () => {
  const packageJson = JSON.parse(source('package.json')) as { scripts: Record<string, string> }
  const deployWorkflow = source('.github/workflows/deploy.yml')
  const configureWorkflow = source('.github/workflows/configure-production-entry.yml')
  const client = source('components/games/GuessSongDuel.tsx')

  assert.equal(packageJson.scripts.start, 'next start -H 127.0.0.1 -p 3000')
  assert.equal(packageJson.scripts.dev, 'next dev')
  assert.match(deployWorkflow, /releases_dir=.*\/releases/)
  assert.match(deployWorkflow, /mv -Tf -- "\$\{temporary_link\}" "\$\{current_link\}"/)
  assert.match(deployWorkflow, /pm2 (reload|restart) "\$\{PM2_APP_NAME\}" --update-env/)
  assert.match(deployWorkflow, /\/api\/health\/live/)
  assert.match(deployWorkflow, /scripts\/run-birthday-daily-job\.sh/)
  assert.match(deployWorkflow, /Application port must be bound to localhost behind Nginx\./)
  assert.match(configureWorkflow, /Application port must be bound to localhost behind Nginx\./)
  assert.match(client, /const createRoomInFlightRef = useRef\(false\)/)
  assert.match(client, /if \(createRoomInFlightRef\.current\) return/)
  assert.match(client, /createRoomInFlightRef\.current = false/)
})
