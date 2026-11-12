import assert from 'node:assert/strict'
import test from 'node:test'
import { spawn } from 'node:child_process'
import { createMaintenanceReleaseWait } from '../lib/instagram/maintenance-release-wait'

test('release wait keeps a child alive until its deadline and exits with failure', async () => {
  const child = spawn(process.execPath, ['--import', 'tsx', '-e', `
    const { createMaintenanceReleaseWait } = require('./lib/instagram/maintenance-release-wait.ts');
    const wait = createMaintenanceReleaseWait(150);
    console.log('READY');
    wait.promise.catch(() => { console.log('TIMEOUT'); process.exitCode = 1 }).finally(() => wait.dispose());
  `], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  let errors = ''
  child.stdout.on('data', chunk => { output += chunk })
  child.stderr.on('data', chunk => { errors += chunk })
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', resolve)
  })
  assert.equal(code, 1)
  assert.match(output, /READY[\s\S]*TIMEOUT/, errors)
})

test('only normal release resolves; termination rejects and cleanup is idempotent', async () => {
  for (const signal of ['SIGUSR2', 'SIGTERM', 'SIGINT'] as const) {
    const before = process.listenerCount(signal)
    const wait = createMaintenanceReleaseWait(1_000)
    const listener = process.listeners(signal).at(-1)
    assert.ok(listener)
    listener(signal)
    if (signal === 'SIGUSR2') await wait.promise
    else await assert.rejects(wait.promise, /INSTAGRAM_MAINTENANCE_TERMINATED/)
    wait.dispose()
    wait.dispose()
    assert.equal(process.listenerCount(signal), before)
  }
})
