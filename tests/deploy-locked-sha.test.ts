import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

const deploy = readFileSync('scripts/deploy-production-git.sh', 'utf8').replaceAll('\r\n', '\n')
const lockStart = deploy.indexOf('exec 9<>')
const gateEnd = deploy.indexOf('echo "LOCKED_PRODUCTION_SHA=${EXPECTED_PRODUCTION_SHA}"', lockStart)
assert.ok(lockStart > 0 && gateEnd > lockStart)
const lockedGate = deploy.slice(lockStart, gateEnd) + 'echo "LOCKED_PRODUCTION_SHA=${EXPECTED_PRODUCTION_SHA}"'
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash'
const base = '635ae4a0e1d8eae9d93420517a17f4b29794896f'
const newer = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'ecfc-locked-sha-'))
  const releases = path.join(root, 'releases')
  for (const name of ['base', 'newer']) mkdirSync(path.join(releases, name), { recursive: true })
  writeFileSync(path.join(releases, 'base/.deployed-sha'), base + '\n')
  writeFileSync(path.join(releases, 'newer/.deployed-sha'), newer + '\n')
  writeFileSync(path.join(root, '.deploy.lock'), '')
  writeFileSync(path.join(root, 'current-target'), path.join(releases, 'base').replaceAll('\\', '/') + '\n')
  return { root, releases, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

function script(f: ReturnType<typeof fixture>, afterLock = '', afterGuard = '') {
  // Only flock and Windows directory-symlink primitives are simulated. The
  // actual script's lock/gate ordering and production SHA helper run unchanged.
  return `set -Eeuo pipefail
source ${quote(path.resolve('scripts/deploy-safety.sh').replaceAll('\\', '/'))}
APP_DIR=${quote(f.root.replaceAll('\\', '/'))}
releases_dir="$APP_DIR/releases"
current_link="$APP_DIR/current"
EXPECTED_PRODUCTION_SHA=${quote(base)}
die() { echo "ERROR: $*" >&2; exit 1; }
test() { if [ "$1" = -L ] && [ "$2" = "$current_link" ]; then return 0; else command test "$@"; fi; }
readlink() {
  if [ "\${3:-}" = "$current_link" ]; then cat "$APP_DIR/current-target"; else command readlink "$@"; fi
}
flock() {
  mkdir "$APP_DIR/exclusive-lock" 2>/dev/null || return 1
  trap 'rmdir "$APP_DIR/exclusive-lock"' EXIT
  echo LOCK_ACQUIRED
  ${afterLock}
}
${lockedGate}
printf guarded > "$APP_DIR/mutation"
${afterGuard}
`
}

test('locked production SHA gate precedes every production-changing phase and keeps descriptor 9 open', () => {
  for (const marker of ['prune_worktrees\nrecover_abandoned_releases', 'fetch_exact_deploy_commit || die', 'pnpm_run build', 'pnpm_run prisma migrate deploy', 'atomic_switch "${release_dir}"']) {
    assert.ok(deploy.indexOf(marker) > gateEnd, marker)
  }
  assert.match(deploy, /\[ "\$#" -lt 6 \] \|\| \[ "\$#" -gt 7 \]/)
  assert.match(deploy, /EXPECTED_PRODUCTION_SHA="\$6"/)
  assert.doesNotMatch(deploy.slice(lockStart), /flock -u|exec 9>&-/)
})

test('correct locked SHA permits the first mutation', () => {
  const f = fixture()
  try {
    const result = spawnSync(bash, ['-c', script(f)], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    assert.ok(existsSync(path.join(f.root, 'mutation')))
  } finally { f.cleanup() }
})

test('current advances between preflight and lock acquisition: reject without any mutation', () => {
  const f = fixture()
  try {
    const result = spawnSync(bash, ['-c', script(f, 'printf "%s\\n" "$releases_dir/newer" > "$APP_DIR/current-target"')], { encoding: 'utf8' })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /PRODUCTION_SHA_CHANGED/)
    assert.equal(existsSync(path.join(f.root, 'mutation')), false)
    assert.match(readFileSync(path.join(f.root, 'current-target'), 'utf8'), /newer/)
  } finally { f.cleanup() }
})

for (const marker of ['', 'not-a-sha', base.slice(0, 20) + ' ' + base.slice(20)]) {
  test(`invalid current marker fails closed (${marker.length} characters)`, () => {
    const f = fixture()
    try {
      writeFileSync(path.join(f.releases, 'base/.deployed-sha'), marker)
      const result = spawnSync(bash, ['-c', script(f)], { encoding: 'utf8' })
      assert.notEqual(result.status, 0)
      assert.equal(existsSync(path.join(f.root, 'mutation')), false)
    } finally { f.cleanup() }
  })
}

test('a competitor cannot acquire the lock during check/switch; once released stale expected SHA is rejected', async () => {
  const f = fixture()
  try {
    const holder = spawn(bash, ['-c', script(f, '', 'echo GUARD_PASSED; while [ ! -f "$APP_DIR/continue" ]; do sleep 0.05; done; printf "%s\\n" "$releases_dir/newer" > "$APP_DIR/current-target"')], { stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    const finished = new Promise<number | null>((resolve, reject) => { holder.on('error', reject); holder.on('close', resolve) })
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('holder did not reach guard')), 10000)
        holder.stdout.on('data', chunk => { output += chunk.toString(); if (output.includes('GUARD_PASSED')) { clearTimeout(timer); resolve() } })
        holder.on('exit', code => { clearTimeout(timer); if (!output.includes('GUARD_PASSED')) reject(new Error('early holder exit ' + code)) })
      })
      const competitor = spawnSync(bash, ['-c', script(f)], { encoding: 'utf8' })
      assert.notEqual(competitor.status, 0)
      assert.match(competitor.stderr, /Another production deployment/)
    } finally { writeFileSync(path.join(f.root, 'continue'), '') }
    assert.equal(await finished, 0)
    rmSync(path.join(f.root, 'mutation'))
    const stale = spawnSync(bash, ['-c', script(f)], { encoding: 'utf8' })
    assert.notEqual(stale.status, 0)
    assert.match(stale.stderr, /PRODUCTION_SHA_CHANGED/)
    assert.equal(existsSync(path.join(f.root, 'mutation')), false)
  } finally { f.cleanup() }
})
