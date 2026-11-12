import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runUnlessDeploymentHeld } from '../lib/instagram/worker-hold'

test('worker does not sync while deployment hold exists and resumes afterward', async () => {
  let held = true
  let calls = 0
  const run = async () => { calls++; return 'ok' }
  assert.deepEqual(await runUnlessDeploymentHeld(() => held, run), { held: true })
  assert.equal(calls, 0)
  held = false
  assert.deepEqual(await runUnlessDeploymentHeld(() => held, run), { held: false, result: 'ok' })
  assert.equal(calls, 1)
})
