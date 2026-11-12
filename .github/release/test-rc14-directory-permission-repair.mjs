import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import { repairPermissions, TARGETS } from './rc14-directory-permission-repair.mjs'
const sha = 'a'.repeat(40)
function fixture() {
  const modes = new Map(TARGETS.map(name => [name, 0o775]))
  const changed = []
  return { modes, changed, io: {
    lstatSync: name => ({ uid: 1000, gid: 1001, mode: modes.get(name), isDirectory: () => modes.has(name), isSymbolicLink: () => name.endsWith('/current') }),
    readlinkSync: () => 'releases/test', readFileSync: () => sha,
    chmodSync(name, mode) { changed.push([name, mode]); modes.set(name, mode) },
  } }
}
test('changes only the two observed directory modes after full original-state CAS', () => {
  const f = fixture()
  assert.equal(repairPermissions(sha, f.io).result, 'DIRECTORY_PERMISSIONS_REPAIRED')
  assert.deepEqual(f.changed, TARGETS.map(name => [name, 0o755]))
})
test('SHA or metadata changes reject before any chmod', () => {
  for (const mismatch of ['sha', 'mode']) {
    const f = fixture()
    if (mismatch === 'sha') f.io.readFileSync = () => 'b'.repeat(40)
    else f.modes.set(TARGETS[1], 0o777)
    assert.throws(() => repairPermissions(sha, f.io), /CAS_MISMATCH/)
    assert.equal(f.changed.length, 0)
  }
})
test('a second-directory failure restores only owned changed metadata', () => {
  const f = fixture(), apply = f.io.chmodSync
  f.io.chmodSync = (name, mode) => { if (name === TARGETS[1]) throw Error('INJECTED'); apply(name, mode) }
  assert.throws(() => repairPermissions(sha, f.io), /INJECTED/)
  assert.equal(f.modes.get(TARGETS[0]), 0o775)
})
test('workflow requires main CAS, Production authorization and the shared deployment lock', () => {
  const body = fs.readFileSync(new URL('../workflows/production-rc14-permission-repair.yml', import.meta.url), 'utf8')
  for (const text of ['workflow_dispatch:', 'environment: Production', 'group: production-deploy', 'cancel-in-progress: false', 'git/ref/heads/main', 'flock --exclusive --nonblock', 'StrictHostKeyChecking=yes', 'expected_production_sha']) assert.ok(body.includes(text), text)
  assert.doesNotMatch(body, /chmod -R|sudo|pm2|prisma|migrate deploy|contents: write/)
})
