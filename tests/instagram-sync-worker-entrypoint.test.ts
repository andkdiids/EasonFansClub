import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
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

test('worker entrypoint keeps await inside main and has a fatal catch', () => {
  const source = readFileSync(entrypoint, 'utf8')

  assert.equal(hasTopLevelAwait(source), false)
  assert.match(source, /async function main\(\)/)
  assert.match(source, /void main\(\)\.catch\(/)
})

test('worker entrypoint loads through the tsx runtime with sync disabled', async () => {
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
  })

  let settled = false
  const loaded = await new Promise<boolean>((resolveResult) => {
    const timer = setTimeout(() => finish(false), 60_000)

    const finish = (result: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolveResult(result)
    }

    child.stdout.on('data', (chunk: Buffer | string) => {
      if (String(chunk).includes('SYNC_DISABLED')) finish(true)
    })
    child.stderr.on('data', () => undefined)
    child.once('error', () => finish(false))
    child.once('exit', () => finish(false))
  })

  child.kill('SIGKILL')
  assert.equal(loaded, true)
})
