import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import { inspectPermissions, APP } from './rc14-environment-forensics.mjs'

test('permission evidence uses metadata only and confines the release path', () => {
  const seen = []
  const io = {
    lstatSync(p) { seen.push(p); return { uid: 10, gid: 10, mode: 0o40775, isDirectory: () => true, isSymbolicLink: () => p.endsWith('/current') } },
    readlinkSync: () => 'releases/test-release',
  }
  const result = inspectPermissions(io)
  assert.equal(result.envContentRead, false)
  assert.equal(result.productionWrites, 'NONE')
  assert.equal(result.rows.at(-1).path, `${APP}/releases/test-release`)
  assert.equal(result.rows[0].groupOrOtherWritable, true)
  assert.equal(seen.some(p => p.endsWith('/.env')), false)
  io.readlinkSync = () => '/etc'
  assert.equal(inspectPermissions(io).rows.at(-1).status, 'UNKNOWN')
  assert.equal(seen.includes('/etc'), false)
})

test('manual main workflow retains exact candidate and pinned host verification', () => {
  const body = fs.readFileSync(new URL('../workflows/production-rc14-environment-forensics.yml', import.meta.url), 'utf8')
  assert.match(body, /workflow_dispatch:/)
  assert.match(body, /contents: read/)
  assert.match(body, /git\/ref\/heads\/main/)
  assert.match(body, /CANDIDATE_SHA.*GITHUB_SHA/)
  assert.match(body, /StrictHostKeyChecking=yes/)
  assert.match(body, /ssh-keygen -lf/)
  assert.doesNotMatch(body, /chmod|prisma|pm2|migrate deploy|sudo|contents: write/)
})
