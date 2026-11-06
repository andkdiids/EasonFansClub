import assert from 'node:assert/strict'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import * as ts from 'typescript'

const root = process.cwd()
const entrypoint = resolve(root, 'scripts/instagram-sync-worker.ts')

function hasTopLevelAwait(source: string) {
  const file = ts.createSourceFile(entrypoint, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  let found = false

  const visit = (node: ts.Node, insideFunction: boolean) => {
    if (found) return
    if (node.kind === ts.SyntaxKind.AwaitExpression && !insideFunction) {
      found = true
      return
    }
    const nextInsideFunction = insideFunction || ts.isFunctionLike(node)
    node.forEachChild((child) => visit(child, nextInsideFunction))
  }

  visit(file, false)
  return found
}

/**
 * tsx starts a worker process and esbuild keeps a long-lived service process.
 * Killing only the direct child leaves those grandchildren holding the stdout /
 * stderr pipe write-ends open, so node:test never sees the pipes close and the
 * whole suite hangs forever after this subtest. On POSIX the child is started
 * in its own process group (detached), which lets us signal the entire group;
 * on Windows taskkill /T walks the process tree instead.
 */
function killProcessTree(child: ChildProcess): void {
  const pid = child.pid
  if (!pid) return

  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        timeout: 10_000,
      })
    } catch {
      try { child.kill('SIGKILL') } catch { /* already gone */ }
    }
    return
  }

  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    try { child.kill('SIGKILL') } catch { /* already gone */ }
  }
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  return new Promise((resolveExit) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolveExit()
      return
    }

    const timer = setTimeout(() => {
      child.removeListener('exit', onExit)
      resolveExit()
    }, timeoutMs)
    const onExit = () => {
      clearTimeout(timer)
      resolveExit()
    }
    child.once('exit', onExit)
  })
}

/**
 * Release every resource the spawned runtime could keep alive. This is
 * idempotent so it is safe both as normal teardown and as a test-level `after`
 * hook. We deliberately do not signal an already-exited child: that avoids
 * signalling a recycled process-group id.
 */
async function disposeChild(child: ChildProcess): Promise<void> {
  if (child.exitCode === null && child.signalCode === null) {
    killProcessTree(child)
    await waitForExit(child, 5_000)
  }
  child.stdout?.destroy()
  child.stderr?.destroy()
  child.stdin?.destroy()
}

test('worker entrypoint keeps await inside main and has a fatal catch', () => {
  const source = readFileSync(entrypoint, 'utf8')

  assert.equal(hasTopLevelAwait(source), false)
  assert.match(source, /async function main\(\)/)
  assert.match(source, /void main\(\)\.catch\(/)
  assert.match(source, /process\.once\('SIGTERM', requestStop\)/)
  assert.match(source, /wakeCurrentWait\?\.\(\)/)
  assert.match(source, /if \(stopping\) return Promise\.resolve\(\)/)
  assert.match(source, /finally\s*\{\s*await prisma\.\$disconnect\(\)/)
})

test('worker entrypoint loads through the tsx runtime with sync disabled', { timeout: 90_000 }, async (t) => {
  const child = spawn(process.execPath, [resolve(root, 'node_modules/tsx/dist/cli.mjs'), 'scripts/instagram-sync-worker.ts'], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      ANYWHERE_DOOR_ENABLED: 'false',
      ANYWHERE_DOOR_SYNC_ENABLED: 'false',
      ANYWHERE_DOOR_NOTIFICATION_ENABLED: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    // POSIX: become a process-group leader so grandchildren can be signalled.
    detached: process.platform !== 'win32',
  })

  // Safety net: even an assertion failure must not leak a live process tree.
  t.after(() => disposeChild(child))

  let settled = false
  const loaded = await new Promise<boolean>((resolveResult) => {
    const timer = setTimeout(() => finish(false), 60_000)
    const finish = (result: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolveResult(result)
    }

    child.stdout?.on('data', (chunk: Buffer | string) => {
      if (String(chunk).includes('SYNC_DISABLED')) finish(true)
    })
    child.stderr?.on('data', () => undefined)
    child.once('error', () => finish(false))
    child.once('exit', () => finish(false))
  })

  await disposeChild(child)
  assert.equal(loaded, true)
})
