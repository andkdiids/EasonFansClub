import assert from 'node:assert/strict'
import { test } from 'node:test'
import { withTimeoutAndDrain } from '../lib/instagram/sync-policy'

test('timeout does not finish the caller while underlying work is still active', async () => {
  let finish!: () => void
  let finished = false
  const work = new Promise<void>((resolve) => { finish = resolve })
  const operation = withTimeoutAndDrain(work, 10).finally(() => { finished = true })
  const outcome = operation.then(() => 'resolved', (error: Error) => error.message)
  await new Promise((resolve) => setTimeout(resolve, 40))
  assert.equal(finished, false)
  finish()
  assert.equal(await outcome, 'SYNC_TIMEOUT')
  assert.equal(finished, true)
})

test('underlying rejection after timeout is drained without hiding timeout', async () => {
  let rejectWork!: (error: Error) => void
  const work = new Promise<void>((_, reject) => { rejectWork = reject })
  const outcome = withTimeoutAndDrain(work, 10).then(() => 'resolved', (error: Error) => error.message)
  await new Promise((resolve) => setTimeout(resolve, 40))
  rejectWork(new Error('late failure'))
  assert.equal(await outcome, 'SYNC_TIMEOUT')
})
