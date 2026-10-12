import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { APP, SELECT_MIGRATIONS, validateManifest, migrationState, lockObservation, envSubset,
  databaseTarget, mysqlArgs, migrationRead, mysqlFailure, releaseSnapshot, rollbackSnapshot,
  processStartTicks, processSnapshots, sampleConsistency, inspect } from './strict-readonly-preflight.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
// Reuse existing parser dependencies read-only; never install into the checkout.
const require = createRequire(import.meta.url)
const parserRoot = process.env.PREFLIGHT_PARSER_ROOT || path.join(root, 'node_modules/.pnpm/node_modules')
const { parseDocument } = require(path.join(parserRoot, 'yaml'))
const { parse } = require(path.join(parserRoot, 'acorn'))
const sourceFile = path.join(root, '.github/release/strict-readonly-preflight.mjs')
const workflowFile = path.join(root, '.github/workflows/production-strict-readonly-preflight.yml')
const source = fs.readFileSync(sourceFile, 'utf8')
const workflowText = fs.readFileSync(workflowFile, 'utf8')
const doc = parseDocument(workflowText, { uniqueKeys: true })
const workflow = doc.toJS()
const sha = '635ae4a0e1d8eae9d93420517a17f4b29794896f'
const rc = '47396d19842755491e9634605a7d535c163b4495'
const manifest = { app: APP, expectedSha: sha, approvedSha: rc, migrations: Array.from({ length: 171 }, (_, i) => ({
  name: String(20261001000000 + i) + '_fixture', checksum: i.toString(16).padStart(64, '0'),
})) }
const release = APP + '/releases/fixture-' + sha.slice(0, 8)
const tsv = rows => rows.map(row => [row.name, row.checksum, 1, 0, 1].join('\t')).join('\n')
const completeTsv = tsv(manifest.migrations)
const copy = value => structuredClone(value)
const normalStat = (overrides = {}) => ({ uid: 1000, mode: 0o100600, size: 16, dev: 2049, ino: 77,
  isFile: () => true, isSymbolicLink: () => false, ...overrides })
const lockStat = normalStat()
const heldLock = '1: FLOCK ADVISORY WRITE 900 08:01:77 0 EOF\n'
const procStat = (pid, ticks = '12345') => `${pid} (fixture worker (name)) S ${Array(18).fill('0').join(' ')} ${ticks} 0 0`
function fixture() {
  const calls = []
  const state = { current: release, marker: sha, locks: '', sql: completeTsv, version: 'mysql Ver 8.0.44 for Linux',
    sqlStatus: 0, login: true, binary: true, healthSha: sha, pids: ['100', '200'], readsDenied: new Set(),
    files: new Map(), cwd: { 100: release, 200: release }, startTicks: { 100: '12345', 200: '23456' }, changedCurrent: false }
  const io = {
    home: '/home/read-only', uid: 1000,
    now: () => '2026-10-12T00:00:00.000Z',
    stat(value) {
      calls.push(['stat', value])
      if (value === APP + '/current') return normalStat({ isFile: () => false, isSymbolicLink: () => true })
      if (state.files.has(value)) return state.files.get(value)
      if (value === '/usr/bin/mysql') { if (!state.binary) throw Object.assign(new Error('missing'), { code: 'ENOENT' }); return normalStat({ uid: 0, mode: 0o100755 }) }
      if (value === io.home + '/.mylogin.cnf' && !state.login) throw Object.assign(new Error('missing'), { code: 'ENOENT' })
      return normalStat()
    },
    real(value) {
      calls.push(['real', value])
      if (value === APP + '/current') return state.current
      if (value.endsWith('/.env')) return APP + '/shared/.env'
      return value
    },
    link(value) { calls.push(['link', value]); return state.cwd[value.split('/')[2]] },
    list(value) { calls.push(['list', value]); assert.equal(value, '/proc'); return state.pids },
    read(value) {
      calls.push(['read', value])
      if (state.readsDenied.has(value)) throw new Error('DENIED fakeSensitiveValue')
      if (value.endsWith('/.deployed-sha')) return state.marker
      if (value === '/proc/locks') return state.locks
      if (value.endsWith('/stat')) return procStat(value.split('/')[2], state.startTicks[value.split('/')[2]])
      if (value.endsWith('/environ')) {
        const name = value.includes('/100/') ? 'easonfansclub' : 'instagram-sync-worker'
        return `name=${name}\0pm_id=1\0pm_cwd=${APP}/current\0DEPLOY_SHA=${sha}\0TOKEN=fakeSensitiveValue\0`
      }
      if (value.endsWith('/.env')) return 'DATABASE_URL="mysql://fixture_user:fakeSensitiveValue@db.example.invalid:3306/ecfc"\nCOS_SECRET=fakeSensitiveValue\n'
      throw new Error('UNEXPECTED_READ')
    },
    run(binary, args, options) {
      calls.push(['run', binary, args, options])
      if (args.includes('--version')) return { status: 0, stdout: state.version }
      if (state.changedCurrent) state.current = APP + '/releases/other'
      return { status: state.sqlStatus, stdout: state.sql, stderr: 'fakeSensitiveValue', error: state.sqlStatus ? new Error('fakeSensitiveValue') : undefined }
    },
    async health() { calls.push(['health']); return state.healthSha },
  }
  return { io, state, calls }
}
const target = { host: 'db.example.invalid', port: '3306', database: 'ecfc' }
const steps = Object.values(workflow.jobs).flatMap(job => job.steps)
const stepNamed = prefix => steps.find(step => step.name?.startsWith(prefix))
const guardStep = stepNamed('Require main')
const sshStep = stepNamed('Stream audited')
const credentialsStep = stepNamed('Prepare credentials')
const queueStep = stepNamed('Observe concurrent')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ecfc-readonly-tests-'))
process.on('exit', () => fs.rmSync(temp, { recursive: true, force: true })) // local test fixtures only
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/bash'
function bashRun(script, extra = {}) {
  const env = { ...process.env, PATH: path.dirname(process.execPath) + path.delimiter + process.env.PATH,
    GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main', APPROVED_SHA: rc, EXPECTED_SHA: sha,
    SSH_HOST: 'example.invalid', SSH_USER: 'reader', SSH_PORT: '22', KEY_FILE: '/runner/key', HOSTS_FILE: '/runner/hosts',
    PREFLIGHT_PAYLOAD: Buffer.from(JSON.stringify(manifest)).toString('base64'), ...extra }
  return spawnSync(bash, ['--noprofile', '--norc', '-c', script], { cwd: root, env, encoding: 'utf8', timeout: 10000 })
}
const shellMocks = `
timeout() { [[ "$1" == --foreground && "$2" == --signal=TERM && "$3" == 120s ]] || return 99; shift 3; "$@"; }
ssh() { printf '%s\\n' "$@" > "$SIM_ARGS"; cat > "$SIM_STREAM"; }
`

test('YAML has no parse errors or duplicate keys', () => assert.deepEqual(doc.errors, []))
test('manual-only trigger, no push/pull_request/schedule', () => assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']))
test('only contents/actions read; no deployment writes', () => assert.deepEqual(workflow.permissions, { contents: 'read', actions: 'read' }))
test('diagnostic concurrency never cancels deployment or another diagnostic', () => {
  assert.equal(workflow.concurrency['cancel-in-progress'], false)
  assert.notEqual(workflow.concurrency.group, 'production-deploy')
})
test('secrets are bound to Production after the main-only validation job', () => {
  assert.equal(workflow.jobs.inspect.environment.name, 'Production')
  assert.equal(workflow.jobs.inspect.needs, 'validate')
  assert.equal(workflow.jobs.inspect.if, "needs.validate.result == 'success'")
  assert.doesNotMatch(JSON.stringify(workflow.jobs.validate), /secrets\./)
  assert.equal(workflow.jobs.validate.steps[0], guardStep)
  const expectedSecrets = { SSH_HOST: '${{ secrets.SERVER_HOST }}', SSH_USER: '${{ secrets.SERVER_USER }}',
    SSH_PORT: '${{ secrets.SERVER_PORT }}', SSH_KEY: '${{ secrets.SERVER_SSH_KEY }}' }
  for (const [name, reference] of Object.entries(expectedSecrets)) assert.equal(credentialsStep.env[name], reference)
  for (const name of ['SSH_HOST', 'SSH_USER', 'SSH_PORT']) assert.equal(sshStep.env[name], expectedSecrets[name])
  assert.equal(credentialsStep.env.PINNED_HOSTS, '${{ vars.PRODUCTION_SSH_KNOWN_HOSTS }}')
  assert.equal(credentialsStep.env.PINNED_FINGERPRINT, '${{ vars.PRODUCTION_SSH_HOST_KEY_SHA256 }}')
  assert.doesNotMatch(workflowText, /secrets\.PRODUCTION_SSH_/)
  // Reusing the existing principal changes no command capabilities: no sudo,
  // alternate SSH user, deployment script or environment secret fallback.
  assert.doesNotMatch(credentialsStep.run + sshStep.run, /\bsudo\b|PRODUCTION_SSH_USER|SERVER_ROOT|SERVER_ADMIN/)
})
test('main dispatch accepted locally', () => assert.equal(bashRun(guardStep.run).status, 0))
for (const [name, env] of Object.entries({ push: { GITHUB_EVENT_NAME: 'push' }, branch: { GITHUB_REF: 'refs/heads/feature' },
  shortSHA: { APPROVED_SHA: '47396d1' }, shellInjection: { APPROVED_SHA: '$(touch forbidden)' }, uppercase: { EXPECTED_SHA: sha.toUpperCase() } })) {
  test('reject trigger/SHA: ' + name, () => assert.notEqual(bashRun(guardStep.run, env).status, 0))
}
test('checks installed policy/RC using existing non-deploying guard', () => {
  assert.match(stepNamed('Validate installed').run, /approved-release-guard\.sh validate/)
  assert.match(stepNamed('Build a non-secret').run, /validateManifest/)
  const checkouts = steps.filter(step => step.uses?.startsWith('actions/checkout@'))
  assert.equal(checkouts.length, 3)
  assert.ok(checkouts.every(step => step.uses === 'actions/checkout@11d5960a326750d5838078e36cf38b85af677262' && step.with['persist-credentials'] === false))
  assert.equal(checkouts[1].with.ref, '${{ inputs.approved_sha }}')
  assert.equal(checkouts[2].with.ref, '${{ github.sha }}')
})
test('install .github-only files cannot trigger legacy deploy.yml push', () => {
  const legacy = parseDocument(fs.readFileSync(path.join(root, '.github/workflows/deploy.yml'), 'utf8')).toJS()
  assert.ok(legacy.on.push['paths-ignore'].includes('.github/**'))
  for (const file of ['.github/workflows/production-strict-readonly-preflight.yml', '.github/release/strict-readonly-preflight.mjs', '.github/release/test-strict-readonly-preflight.mjs']) assert.ok(file.startsWith('.github/'))
  // Local audit docs are not an installation whitelist item: mixed docs commits
  // would not be covered by paths-ignore. No installation is done by this test.
})
test('no invocation of deployment, PM2, package manager or database tooling in workflow', () => {
  const code = steps.filter(step => step.run).map(step => step.run.split('\n').filter(line => !line.trim().startsWith('#')).join('\n')).join('\n')
  assert.doesNotMatch(code, /(?:^|\n|;|&&|\|\||\$\()\s*(?:scp|sftp|rsync|pm2|flock|npm|pnpm|npx|prisma|migrate|deploy-production-git|rollback-production-git)(?:\s|$)/)
  assert.doesNotMatch(code, /StrictHostKeyChecking=(?:no|accept-new)|curl[^\n]*(?:--insecure| -k\b)|ssh-keyscan/)
  const cleanup = stepNamed('Remove temporary').run
  assert.match(cleanup, /\$RUNNER_TEMP\/ecfc-strict-/)
  assert.doesNotMatch(cleanup, /\bssh\b/)
})
test('SSH mock receives exact source through stdin; no remote redirects', () => {
  const args = path.join(temp, 'ssh-args.txt'), stream = path.join(temp, 'ssh-stdin.mjs')
  const result = bashRun(shellMocks + sshStep.run, { SIM_ARGS: args, SIM_STREAM: stream })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(fs.readFileSync(stream, 'utf8'), source)
  const lines = fs.readFileSync(args, 'utf8').trim().split(/\r?\n/)
  assert.ok(lines.includes('-T'))
  assert.ok(lines.includes('StrictHostKeyChecking=yes'))
  const remote = lines.at(-1)
  assert.match(remote, /exec \/usr\/bin\/env -i PATH=\/usr\/bin:\/bin HOME="\$HOME" LANG=C/)
  assert.match(remote, /--input-type=module - '[A-Za-z0-9+/=]+'$/)
  assert.doesNotMatch(remote, /[<>]|\b(?:mkdir|rm|tee|touch|scp|flock|pm2)\b/)
  assert.match(remote, /node_meta.*stat -c/)
  assert.match(remote, /0:555\|0:755/)
})
test('invalid streaming payload stops before SSH mock', () => {
  const result = bashRun('ssh() { exit 99; }\ntimeout() { exit 99; }\n' + sshStep.run, { PREFLIGHT_PAYLOAD: "' ; bad" })
  assert.equal(result.status, 1)
})
test('oversize streaming payload stops before SSH mock', () => {
  const result = bashRun('ssh() { exit 99; }\ntimeout() { exit 99; }\n' + sshStep.run, { PREFLIGHT_PAYLOAD: 'a'.repeat(66000) })
  // Windows may reject the oversize test environment before Bash starts.
  // Use Bash itself to construct the fixture, below, for OS-independent proof.
  if (result.error) {
    const retry = bashRun("PREFLIGHT_PAYLOAD=$(printf 'a%.0s' {1..66000}); ssh() { exit 99; }; timeout() { exit 99; };\n" + sshStep.run)
    assert.equal(retry.status, 1)
  } else assert.equal(result.status, 1)
})
for (const port of ['invalid', '0', '65536']) {
  test('invalid SSH port stops before credentials preparation: ' + port, () => {
    const result = bashRun(credentialsStep.run, { SSH_PORT: port, SSH_KEY: 'fixture-not-a-secret', PINNED_HOSTS: 'example.invalid ssh-ed25519 QUJD', PINNED_FINGERPRINT: 'SHA256:QUJD' })
    assert.equal(result.status, 1)
  })
}
test('all six missing SSH settings stop before runner credential writes or SSH', () => {
  const fixtureSettings = { SSH_HOST: 'example.invalid', SSH_USER: 'reader', SSH_PORT: '22', SSH_KEY: 'fixture-not-a-secret',
    PINNED_HOSTS: 'example.invalid ssh-ed25519 QUJD', PINNED_FINGERPRINT: 'SHA256:QUJD' }
  for (const name of Object.keys(fixtureSettings)) {
    const fixtureId = 'missing-' + name
    const result = bashRun('ssh-keygen() { exit 99; }; ssh() { exit 99; };\n' + credentialsStep.run, {
      ...fixtureSettings, [name]: '', RUNNER_TEMP: temp.replaceAll('\\', '/'), GITHUB_RUN_ID: fixtureId,
      GITHUB_RUN_ATTEMPT: '1', GITHUB_OUTPUT: path.join(temp, fixtureId + '-output').replaceAll('\\', '/'),
    })
    assert.equal(result.status, 1, name)
    assert.equal(fs.existsSync(path.join(temp, `ecfc-strict-${fixtureId}-1.key`)), false, name + ' key not written')
    assert.equal(fs.existsSync(path.join(temp, `ecfc-strict-${fixtureId}-1.hosts`)), false, name + ' hosts not written')
    assert.equal(fs.existsSync(path.join(temp, fixtureId + '-output')), false, name + ' no output file')
    assert.doesNotMatch(result.stdout + result.stderr, /fixture-not-a-secret/)
  }
  const allMissing = Object.fromEntries(Object.keys(fixtureSettings).map(name => [name, '']))
  assert.equal(bashRun('ssh-keygen() { exit 99; }; ssh() { exit 99; };\n' + credentialsStep.run, allMissing).status, 1)
})
for (const [label, hosts] of Object.entries({ extraKey: 'example.invalid ssh-ed25519 QUJD\nother.invalid ssh-ed25519 QUJD',
  wrongHost: 'other.invalid ssh-ed25519 QUJD', wildcard: '*.invalid ssh-ed25519 QUJD', ca: '@cert-authority example.invalid ssh-ed25519 QUJD' })) {
  test('pinned host rejects ' + label, () => {
    const result = bashRun('ssh-keygen() { printf "256 SHA256:QUJD fixture\\n"; }\n' + credentialsStep.run, {
      RUNNER_TEMP: temp.replaceAll('\\', '/'), GITHUB_RUN_ID: '100', GITHUB_RUN_ATTEMPT: '1', GITHUB_OUTPUT: path.join(temp, 'output').replaceAll('\\', '/'),
      SSH_KEY: 'fixture-not-a-secret', PINNED_HOSTS: hosts, PINNED_FINGERPRINT: 'SHA256:QUJD',
    })
    assert.notEqual(result.status, 0)
  })
}
test('single pinned host/fingerprint accepted with runner-only mocked key checks', () => {
  const result = bashRun('ssh-keygen() { printf "256 SHA256:QUJD fixture\\n"; }\n' + credentialsStep.run, {
    RUNNER_TEMP: temp.replaceAll('\\', '/'), GITHUB_RUN_ID: '101', GITHUB_RUN_ATTEMPT: '1', GITHUB_OUTPUT: path.join(temp, 'output').replaceAll('\\', '/'),
    SSH_KEY: 'fixture-not-a-secret', PINNED_HOSTS: 'example.invalid ssh-ed25519 QUJD', PINNED_FINGERPRINT: 'SHA256:QUJD',
  })
  assert.equal(result.status, 0, result.stderr)
})
test('configured IPv4 pin rejects a different SERVER_HOST or SERVER_PORT before credential output', () => {
  // Only the user-confirmed public address is reused; the key and fingerprint
  // are synthetic fixtures, not production values. No SSH connection occurs.
  const host = '43.138.254.68'
  const fixtures = [
    { id: 'different-ip', SSH_HOST: '192.0.2.10', SSH_PORT: '22' },
    { id: 'different-hostname', SSH_HOST: 'fixture.example.invalid', SSH_PORT: '22' },
    { id: 'different-port', SSH_HOST: host, SSH_PORT: '2222' },
  ]
  for (const fixture of fixtures) {
    const output = path.join(temp, 'address-mismatch-' + fixture.id)
    const result = bashRun('ssh-keygen() { exit 99; }; ssh() { exit 99; };\n' + credentialsStep.run, {
      ...fixture, RUNNER_TEMP: temp.replaceAll('\\', '/'), GITHUB_RUN_ID: 'address-' + fixture.id,
      GITHUB_RUN_ATTEMPT: '1', GITHUB_OUTPUT: output.replaceAll('\\', '/'),
      SSH_KEY: 'fixture-not-a-secret', PINNED_HOSTS: host + ' ssh-ed25519 QUJD', PINNED_FINGERPRINT: 'SHA256:QUJD',
    })
    assert.equal(result.status, 1, fixture.id)
    assert.equal(fs.existsSync(output), false, fixture.id + ' must not authorize the later SSH step')
    assert.doesNotMatch(result.stdout + result.stderr, /fixture-not-a-secret/)
  }
})
test('Bash syntax check of every workflow run block', () => {
  for (const step of steps.filter(step => step.run)) {
    const result = spawnSync(bash, ['--noprofile', '--norc', '-n'], { input: step.run, encoding: 'utf8' })
    assert.equal(result.status, 0, step.name + ': ' + result.stderr)
  }
})
test('GitHub queue mock uses GET only and reports matching running deployments', async () => {
  const code = queueStep.run.split("node <<'NODE'\n")[1].split('\nNODE')[0]
  const output = [], queries = [], processMock = { env: { GITHUB_API_URL: 'https://api.example.invalid', GITHUB_REPOSITORY: 'owner/repo', GH_TOKEN: 'fakeToken' } }
  await vm.runInNewContext(code, { process: processMock, console: { log: value => output.push(value) }, AbortSignal,
    fetch: async (url, options) => {
      queries.push({ url, method: options.method })
      return { ok: true, json: async () => ({ workflow_runs: url.includes('status=in_progress') ? [{ path: '.github/workflows/deploy.yml' }, { path: '.github/workflows/unrelated.yml' }] : [] }) }
    },
  })
  assert.equal(output[0], 'CONCURRENT_DEPLOYMENTS=1')
  assert.ok(queries.every(row => row.method === undefined))
  assert.equal(queries.length, 5)
})
test('failed GitHub queue observation reports UNKNOWN, not no concurrent deploys', async () => {
  const code = queueStep.run.split("node <<'NODE'\n")[1].split('\nNODE')[0]
  const output = [], processMock = { env: { GITHUB_API_URL: 'https://api.example.invalid', GITHUB_REPOSITORY: 'o/r' } }
  await vm.runInNewContext(code, { process: processMock, console: { log: value => output.push(value) }, AbortSignal, fetch: async () => ({ ok: false }) })
  assert.equal(output[0], 'CONCURRENT_DEPLOYMENTS=UNKNOWN')
  assert.equal(processMock.exitCode, 1)
})

test('valid exact 171-row manifest accepted', () => assert.equal(validateManifest(manifest), manifest))
for (const [name, mutate] of Object.entries({ wrongApp: m => { m.app = '/tmp' }, shortSHA: m => { m.expectedSha = '123' },
  count: m => { m.migrations.pop() }, duplicate: m => { m.migrations[1] = m.migrations[0] }, unsafeName: m => { m.migrations[0].name = '../secret' },
  badChecksum: m => { m.migrations[0].checksum = '123' } })) {
  test('reject manifest ' + name, () => { const m = copy(manifest); mutate(m); assert.throws(() => validateManifest(m), /MANIFEST_INVALID/) })
}
test('SELECT matches exactly one constant, no mutation/OUTFILE/lock/functions', () => {
  assert.match(SELECT_MIGRATIONS, /^SELECT .+ FROM _prisma_migrations ORDER BY migration_name, id;$/)
  assert.doesNotMatch(SELECT_MIGRATIONS, /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|CALL|SET|INTO|OUTFILE|FOR UPDATE|GET_LOCK|RELEASE_LOCK|SLEEP|LOAD_FILE)\b/i)
  assert.equal(SELECT_MIGRATIONS.split(';').length, 2)
})
test('migration 171/171 identical names and checksums', () => assert.deepEqual(migrationState(manifest.migrations, completeTsv), {
  status: 'UP_TO_DATE', repo: 171, applied: 171, pending: 0, failed: 0, unfinished: 0, divergence: 0, duplicates: 0, activeDuplicates: 0,
}))
test('pending migration explicitly reported', () => assert.equal(migrationState(manifest.migrations, tsv(manifest.migrations.slice(1))).pending, 1))
test('unfinished migration reported FAILED', () => assert.equal(migrationState(manifest.migrations, completeTsv.replace('\t1\t0\t1', '\t0\t0\t1')).status, 'FAILED'))
test('missing started timestamp reported unfinished', () => assert.equal(migrationState(manifest.migrations, completeTsv.replace('\t1\t0\t1', '\t1\t0\t0')).unfinished, 1))
test('active duplicate is divergence', () => assert.equal(migrationState(manifest.migrations, completeTsv + '\n' + completeTsv.split('\n')[0]).activeDuplicates, 1))
test('rolled-back retry history is reported without double-counting applied', () => {
  const result = migrationState(manifest.migrations, completeTsv + '\n' + completeTsv.split('\n')[0].replace('\t1\t0\t1', '\t0\t1\t1'))
  assert.equal(result.status, 'UP_TO_DATE'); assert.equal(result.applied, 171); assert.equal(result.duplicates, 1)
})
test('checksum mismatch is divergence', () => assert.equal(migrationState(manifest.migrations, completeTsv.replace('0'.repeat(64), 'f'.repeat(64))).status, 'DIVERGENCE'))
test('unexpected applied migration is divergence', () => assert.equal(migrationState(manifest.migrations, completeTsv + '\n20261001999999_unknown\t' + 'f'.repeat(64) + '\t1\t0\t1').status, 'DIVERGENCE'))
for (const invalid of ['password=do-not-print', '20261001000000_fixture\tbad\t1\t0\t1', completeTsv + '\ninvalid']) {
  test('malformed DB response produces sanitized UNKNOWN: ' + invalid.slice(0, 15), () => assert.equal(migrationState(manifest.migrations, invalid).status, 'UNKNOWN'))
}
test('database URL parsing discards credentials and preserves only safe target', () => {
  assert.deepEqual(databaseTarget('DATABASE_URL="mysql://u:fakeSensitiveValue@db.example.invalid:3306/ecfc"'), target)
  assert.throws(() => databaseTarget('DATABASE_URL=mysql://u:p@db/ecfc\nDATABASE_URL=mysql://u:p@other/ecfc'))
  assert.throws(() => databaseTarget('DATABASE_URL=mysql://u:p@db/ecfc%2Fother'))
})
test('mysql SQL uses existing login only, TLS verification, no history/syslog', () => {
  const args = mysqlArgs(target)
  for (const option of ['--no-defaults', '--login-path=ecfc_readonly_preflight', '--batch', '--skip-syslog', '--ssl-mode=VERIFY_IDENTITY']) assert.ok(args.includes(option))
  assert.equal(args.at(-1), '--execute=' + SELECT_MIGRATIONS)
  assert.doesNotMatch(args.join(' '), /password|fixture_user|fakeSensitiveValue|ssl-mode=DISABLED/)
})
test('mocked database client is only fixed root-owned binary, SELECT, and minimal environment', () => {
  const { io, calls } = fixture()
  assert.equal(migrationRead(target, manifest.migrations, io).status, 'UP_TO_DATE')
  const runs = calls.filter(row => row[0] === 'run')
  assert.equal(runs.length, 2)
  for (const row of runs) { assert.equal(row[1], '/usr/bin/mysql'); assert.equal(row[3].shell, false); assert.deepEqual(Object.keys(row[3].env).sort(), ['HOME', 'LANG', 'PATH']) }
})
for (const [name, mutate] of Object.entries({ missingLogin: s => { s.login = false }, missingBinary: s => { s.binary = false }, MariaDB: s => { s.version = 'mysql Ver 15.1 Distrib 10.11 MariaDB' },
  unsupported: s => { s.version = 'mysql Ver 5.7.44' }, TLSFailure: s => { s.sqlStatus = 1 } })) {
  test('DB access failure sanitized UNKNOWN: ' + name, () => {
    const { io, state } = fixture(); mutate(state)
    const result = migrationRead(target, manifest.migrations, io)
    assert.equal(result.status, 'UNKNOWN'); assert.doesNotMatch(JSON.stringify(result), /fakeSensitiveValue|password/)
  })
}
for (const [name, value] of Object.entries({ writableBinary: normalStat({ uid: 0, mode: 0o100777 }), symlinkBinary: normalStat({ uid: 0, isSymbolicLink: () => true }),
  wrongOwner: normalStat({ uid: 1001, mode: 0o100755 }) })) {
  test('unsafe client skipped: ' + name, () => { const { io, state, calls } = fixture(); state.files.set('/usr/bin/mysql', value); assert.equal(migrationRead(target, manifest.migrations, io).status, 'UNKNOWN'); assert.equal(calls.filter(row => row[0] === 'run').length, 0) })
}
test('unsafe existing login permissions skipped without configuring anything', () => {
  const { io, state, calls } = fixture(); state.files.set(io.home + '/.mylogin.cnf', normalStat({ mode: 0o100644 }))
  assert.equal(migrationRead(target, manifest.migrations, io).status, 'UNKNOWN'); assert.equal(calls.filter(row => row[0] === 'run').length, 0)
})
test('existing FLOCK WRITE is occupied', () => assert.equal(lockObservation(lockStat, heldLock).state, 'OCCUPIED'))
test('existing READ lock conservatively occupied', () => assert.equal(lockObservation(lockStat, heldLock.replace('WRITE', 'READ')).state, 'OCCUPIED'))
test('OFDLCK supported without acquisition', () => assert.equal(lockObservation(lockStat, heldLock.replace('FLOCK', 'OFDLCK').replace('900', '-1')).state, 'OCCUPIED'))
test('empty lock table is observation only, never FREE/acquirable', () => {
  const result = lockObservation(lockStat, ''); assert.equal(result.state, 'NO_LOCK_OBSERVED'); assert.equal(result.scope, 'PROC_PID_NAMESPACE_SNAPSHOT')
})
test('lock precision/format/symlink unavailable produces UNKNOWN', () => {
  assert.equal(lockObservation(normalStat({ ino: Number.MAX_SAFE_INTEGER + 1 }), '').state, 'UNKNOWN')
  assert.equal(lockObservation(lockStat, 'unknown record').state, 'UNKNOWN')
  assert.equal(lockObservation(normalStat({ isSymbolicLink: () => true }), '').state, 'UNKNOWN')
})
test('process environment returns only four explicit labels, not secrets', () => assert.deepEqual(envSubset('name=a\0TOKEN=secret\0DATABASE_URL=secret\0pm_id=1\0'), { name: 'a', pm_id: '1' }))
test('release real symlink and marker observed, expected input is not substituted', () => { const { io } = fixture(); assert.deepEqual(releaseSnapshot(io), { target: release, sha }) })
test('bad marker/outside release returns UNKNOWN', () => {
  const { io, state } = fixture(); state.marker = 'not-a-sha'; assert.equal(releaseSnapshot(io).sha, 'UNKNOWN'); state.current = '/tmp/other'; assert.equal(releaseSnapshot(io).target, 'UNKNOWN')
})
test('rollback requirements nonempty package/build/Prisma/dotenv/environment link', () => { const { io } = fixture(); assert.equal(rollbackSnapshot(io, { target: release, sha }).state, 'PRESENT') })
test('empty rollback required file is INCOMPLETE', () => { const { io, state } = fixture(); state.files.set(release + '/.next/BUILD_ID', normalStat({ size: 0 })); assert.equal(rollbackSnapshot(io, { target: release, sha }).state, 'INCOMPLETE') })
test('deleted Worker cwd flagged with old release, not fixed/restarted', () => {
  const { io, state } = fixture(); state.cwd[200] = APP + '/releases/old (deleted)'
  const worker = processSnapshots(io, { target: release, sha }).rows.find(row => row.name === 'instagram-sync-worker')
  assert.equal(worker.deleted, true); assert.equal(worker.olderRelease, true)
})
test('unknown current must not claim worker uses an old release', () => { const { io } = fixture(); assert.equal(processSnapshots(io, { target: 'UNKNOWN', sha: 'UNKNOWN' }).rows[1].olderRelease, 'UNKNOWN') })
test('unreadable process environments reported; no permissions workaround', () => { const { io, state } = fixture(); state.readsDenied.add('/proc/200/environ'); assert.equal(processSnapshots(io, { target: release, sha }).inaccessible, 1) })
test('outside-app cwd redacted', () => { const { io, state } = fixture(); state.cwd[200] = '/sensitive/secret'; assert.equal(processSnapshots(io, { target: release, sha }).rows[1].cwd, 'UNKNOWN') })
test('large /proc scan remains UNKNOWN', () => { const { io, state } = fixture(); state.pids = Array.from({ length: 4097 }, (_, i) => String(i + 1)); assert.equal(processSnapshots(io, { target: release, sha }).state, 'UNKNOWN') })
test('complete mocked observation never invents live PM2/task health or GO', async () => {
  const { io, calls } = fixture(), result = await inspect(manifest, io)
  assert.equal(result.current.sha, sha); assert.equal(result.markerHealthMatch, true); assert.equal(result.webCwdMatch, true)
  assert.equal(result.migrations.status, 'UP_TO_DATE'); assert.equal(result.pm2WebStatus, 'UNKNOWN'); assert.equal(result.workerActiveTasks, 'UNKNOWN')
  assert.match(result.releaseDecision, /^NO_GO/); assert.equal(result.snapshotAtomic, false)
  assert.ok(calls.every(row => ['stat', 'real', 'link', 'list', 'read', 'run', 'health'].includes(row[0])))
  assert.doesNotMatch(JSON.stringify(result), /fakeSensitiveValue|fixture_user|mysql:\/\//)
})
test('runtime SHA mismatch does not use expected input as evidence', async () => { const { io, state } = fixture(); state.marker = 'a'.repeat(40); const result = await inspect(manifest, io); assert.equal(result.current.sha, state.marker); assert.equal(result.markerHealthMatch, false) })
test('health error UNKNOWN without leaking error response', async () => { const { io } = fixture(); io.health = async () => { throw new Error('fakeSensitiveValue') }; const result = await inspect(manifest, io); assert.equal(result.localHealthSha, 'UNKNOWN'); assert.doesNotMatch(JSON.stringify(result), /fakeSensitiveValue/) })
test('held deployment lock skips DB and is never acquired/released', async () => { const { io, state, calls } = fixture(); state.locks = heldLock; const result = await inspect(manifest, io); assert.equal(result.lock.state, 'OCCUPIED'); assert.equal(result.migrations.status, 'UNKNOWN'); assert.equal(calls.filter(row => row[0] === 'run').length, 0) })
test('release changes during SELECT: unstable snapshot explicitly flagged', async () => { const { io, state } = fixture(); state.changedCurrent = true; const result = await inspect(manifest, io); assert.equal(result.snapshotStable, false); assert.equal(result.webCwdMatch, 'UNKNOWN'); assert.equal(result.markerHealthMatch, false) })
test('lock observed twice; new holder reported at end without interrupting it', async () => {
  const { io } = fixture(), read = io.read; let times = 0
  io.read = value => value === '/proc/locks' && ++times === 2 ? heldLock : read(value)
  const result = await inspect(manifest, io); assert.equal(result.lock.state, 'NO_LOCK_OBSERVED'); assert.equal(result.lockEnd.state, 'OCCUPIED')
})
test('no safe DB capability reports UNKNOWN while other observations remain', async () => { const { io, state } = fixture(); state.login = false; const result = await inspect(manifest, io); assert.equal(result.migrations.status, 'UNKNOWN'); assert.equal(result.current.sha, sha) })
test('AST production filesystem/child-process API allowlist has no writers', () => {
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' }), allowedFS = new Set(['lstatSync', 'realpathSync', 'readlinkSync', 'readdirSync', 'readFileSync'])
  const fsCalls = [], imports = []
  function visit(node) {
    if (!node || typeof node !== 'object') return
    if (node.type === 'ImportDeclaration') imports.push(node.source.value)
    if (node.type === 'MemberExpression' && node.object?.name === 'fs') { assert.equal(node.computed, false); fsCalls.push(node.property.name); assert.ok(allowedFS.has(node.property.name), node.property.name) }
    if (node.type === 'CallExpression' && node.callee?.name === 'spawnSync') assert.equal(source.slice(node.start, node.end), 'spawnSync(binary, args, options)')
    for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === 'object') visit(value)
  }
  visit(ast); assert.ok(fsCalls.length > 0); assert.deepEqual(imports.sort(), ['node:child_process', 'node:fs', 'node:path'])
  assert.doesNotMatch(source, /\b(?:execSync|execFile|writeFile|appendFile|mkdir|unlink|rename|chmod|flock|mysql_config_editor|pm2)\s*\(/)
})
test('real adapter only invokes client via two validated literal call sites', () => {
  assert.equal((source.match(/io\.run\(/g) || []).length, 2)
  assert.match(source, /io\.run\('\/usr\/bin\/mysql', \['--no-defaults', '--version'\]/)
  assert.match(source, /io\.run\('\/usr\/bin\/mysql', mysqlArgs\(target\), options\)/)
  assert.match(source, /fetch\('http:\/\/127\.0\.0\.1:3000\/api\/health\/live'/)
  assert.doesNotMatch(source, /process\.env\.(?:MYSQL_PWD|DATABASE_URL|COS_SECRET|NODE_V8_COVERAGE|NODE_COMPILE_CACHE)/)
})
test('sensitive credential scan contains no real tokens, keys or passwords', () => {
  for (const text of [source, workflowText]) {
    assert.doesNotMatch(text, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:ghp_|github_pat_|AKID)[A-Za-z0-9]{20,}|mysql:\/\/[^\s'"<>]+:[^\s'"<>]+@/)
  }
})
test('source/workflow have no trailing whitespace', () => {
  for (const text of [source, workflowText]) assert.ok(text.split(/\r?\n/).every(line => !/[ \t]+$/.test(line)))
})

for (const [stage, path, code, reason] of [
  ['binary', '/usr/bin/mysql', 'ENOENT', 'MYSQL_CLIENT_NOT_FOUND'],
  ['binary', '/usr/bin/mysql', 'EACCES', 'MYSQL_CLIENT_ACCESS_DENIED'],
  ['binary', '/usr/bin/mysql', 'EIO', 'MYSQL_CLIENT_UNAVAILABLE'],
  ['login', '/home/read-only/.mylogin.cnf', 'ENOENT', 'MYSQL_LOGIN_CONFIG_NOT_FOUND'],
  ['login', '/home/read-only/.mylogin.cnf', 'EPERM', 'MYSQL_LOGIN_CONFIG_ACCESS_DENIED'],
  ['login', '/home/read-only/.mylogin.cnf', 'EIO', 'MYSQL_LOGIN_CONFIG_UNAVAILABLE'],
]) {
  test('granular sanitized metadata failure: ' + stage + ' ' + code, () => {
    const { io, calls } = fixture(), stat = io.stat
    io.stat = value => { if (value === path) throw Object.assign(new Error('fakeSensitiveValue'), { code }); return stat(value) }
    const result = migrationRead(target, manifest.migrations, io)
    assert.equal(result.reason, reason); assert.equal(result.status, 'UNKNOWN')
    assert.equal(calls.filter(row => row[0] === 'run').length, 0)
    assert.doesNotMatch(JSON.stringify(result), /fakeSensitiveValue|db\.example|\.mylogin/)
  })
}
for (const version of ['mysql Ver 5.7.44', 'mysql Ver 15.1 Distrib 10.11 MariaDB', 'unrecognized fakeSensitiveValue']) {
  test('unsupported version has precise reason: ' + version.split(' ')[0], () => {
    const { io, state, calls } = fixture(); state.version = version
    assert.equal(migrationRead(target, manifest.migrations, io).reason, 'MYSQL_CLIENT_VERSION_UNSUPPORTED')
    assert.equal(calls.filter(row => row[0] === 'run').length, 1)
  })
}
for (const [code, reason] of [
  ['2002', 'DATABASE_CONNECTION_FAILED'], ['2003', 'DATABASE_CONNECTION_FAILED'],
  ['2005', 'DATABASE_CONNECTION_FAILED'], ['2006', 'DATABASE_CONNECTION_FAILED'], ['2013', 'DATABASE_CONNECTION_FAILED'],
  ['2026', 'DATABASE_TLS_FAILED'], ['1045', 'DATABASE_AUTH_FAILED'], ['1044', 'DATABASE_ACCESS_DENIED'],
  ['1049', 'FIXED_SELECT_FAILED'], ['1054', 'FIXED_SELECT_FAILED'], ['1064', 'FIXED_SELECT_FAILED'],
  ['1142', 'FIXED_SELECT_FAILED'], ['1146', 'FIXED_SELECT_FAILED'], ['9999', 'DATABASE_QUERY_FAILURE_UNCLASSIFIED'],
]) {
  test('client numeric error redaction: ' + code, () => {
    const { io } = fixture(), run = io.run
    io.run = (binary, args, options) => args.includes('--version') ? run(binary, args, options) :
      { status: 1, stderr: `ERROR ${code} (HY000): fakeSensitiveValue mysql://private\n`, stdout: 'fakeSensitiveValue' }
    const result = migrationRead(target, manifest.migrations, io)
    assert.equal(result.reason, reason); assert.equal(result.status, 'UNKNOWN')
    assert.equal(result.loginPathConfigured, 'UNKNOWN')
    assert.doesNotMatch(JSON.stringify(result), /fakeSensitiveValue|mysql:\/\/|HY000/)
  })
}
test('arbitrary client text cannot be mistaken for TLS or missing named login path', () => {
  for (const stderr of ['password TLS failure fakeSensitiveValue', 'login path ecfc_readonly_preflight missing', 'ERROR 2026not-an-error']) {
    assert.equal(mysqlFailure({ status: 1, stderr }, 'FIXED_SELECT'), 'DATABASE_QUERY_FAILURE_UNCLASSIFIED')
  }
})
for (const [stage, code, reason] of [
  ['version', 'ETIMEDOUT', 'MYSQL_VERSION_TIMEOUT'], ['version', 'ENOENT', 'MYSQL_VERSION_EXECUTION_UNAVAILABLE'],
  ['query', 'ETIMEDOUT', 'FIXED_SELECT_TIMEOUT'], ['query', 'EACCES', 'FIXED_SELECT_EXECUTION_UNAVAILABLE'],
]) {
  test('spawn failure is safe and stage-specific: ' + stage + ' ' + code, () => {
    const { io } = fixture(), run = io.run
    io.run = (binary, args, options) => (args.includes('--version') === (stage === 'version')) ?
      { status: null, error: Object.assign(new Error('fakeSensitiveValue'), { code }), stderr: 'fakeSensitiveValue' } : run(binary, args, options)
    assert.equal(migrationRead(target, manifest.migrations, io).reason, reason)
  })
}
test('unsafe login owner, symlink or unreadable mode skipped, never reconfigured', () => {
  for (const value of [normalStat({ uid: 0 }), normalStat({ isSymbolicLink: () => true }), normalStat({ mode: 0o100000 })]) {
    const { io, state, calls } = fixture(); state.files.set(io.home + '/.mylogin.cnf', value)
    assert.equal(migrationRead(target, manifest.migrations, io).reason, 'MYSQL_LOGIN_PERMISSIONS_UNSAFE')
    assert.equal(calls.filter(row => row[0] === 'run').length, 0)
  }
})
test('unavailable or unsafe HOME cannot select another login configuration', () => {
  for (const home of ['', '../private', '/home with spaces']) {
    const { io, calls } = fixture(); io.home = home
    assert.equal(migrationRead(target, manifest.migrations, io).reason, 'MYSQL_LOGIN_LOCATION_UNKNOWN')
    assert.equal(calls.filter(row => row[0] === 'run').length, 0)
  }
})
test('successful exit with malformed fixed SELECT never reports migration success', () => {
  const { io, state } = fixture(); state.sql = 'fakeSensitiveValue'
  assert.deepEqual(migrationRead(target, manifest.migrations, io), { status: 'UNKNOWN', reason: 'MIGRATION_RESPONSE_INVALID' })
})
test('DB gating explains lock, rollback and configuration unavailability independently', async () => {
  const locked = fixture(); locked.state.locks = heldLock
  assert.equal((await inspect(manifest, locked.io)).migrations.reason, 'DATABASE_CHECK_SKIPPED_LOCK_NOT_CLEAR')
  const incomplete = fixture(); incomplete.state.files.set(release + '/.next/BUILD_ID', normalStat({ size: 0 }))
  assert.equal((await inspect(manifest, incomplete.io)).migrations.reason, 'DATABASE_CHECK_SKIPPED_ROLLBACK_UNVERIFIED')
  const unavailable = fixture(); unavailable.state.readsDenied.add(APP + '/shared/.env')
  assert.equal((await inspect(manifest, unavailable.io)).migrations.reason, 'DATABASE_CONFIGURATION_UNAVAILABLE')
})

test('stat parser handles parenthesized command name and preserves integer precision', () => {
  assert.equal(processStartTicks(procStat('100', '90071992547409933'), '100'), '90071992547409933')
  for (const raw of ['200 (other) S 0', procStat('100', 'secret'), '100 malformed']) assert.equal(processStartTicks(raw, '100'), 'UNKNOWN')
})
test('PID reuse within one process sample cannot be called stable', async () => {
  const { io } = fixture(), read = io.read; let reads = 0
  io.read = value => value === '/proc/100/stat' ? procStat('100', (++reads % 2) ? '123' : '456') : read(value)
  const result = await inspect(manifest, io)
  assert.equal(result.consistency.state, 'UNSTABLE')
  assert.ok(result.consistency.changed.includes('PROCESS_IDENTITY_WITHIN_SAMPLE'))
  assert.equal(result.webCwdMatch, 'UNKNOWN')
})
test('unreadable start time means unknown identity, not an invented timestamp', async () => {
  const { io, state } = fixture(); state.readsDenied.add('/proc/200/stat')
  const result = await inspect(manifest, io)
  assert.equal(result.processes.rows[1].startTicks, 'UNKNOWN')
  assert.equal(result.consistency.state, 'UNKNOWN'); assert.equal(result.snapshotStable, 'UNKNOWN')
})
test('same endpoint samples have explicit window and are never atomic/continuous', async () => {
  const { io } = fixture(); let times = 0
  io.now = () => ++times === 1 ? '2026-10-12T00:00:00.000Z' : '2026-10-12T00:00:05.000Z'
  const result = await inspect(manifest, io)
  assert.equal(result.consistency.state, 'REPEATED_SAMPLES_MATCH')
  assert.equal(result.consistency.durationMs, 5000)
  assert.equal(result.consistency.scope, 'ENDPOINT_SAMPLES_NOT_CONTINUOUS')
  assert.equal(result.consistency.atomic, false); assert.equal(result.snapshotAtomic, false)
})
for (const [name, mutate, reason] of [
  ['PID disappearance', state => { state.pids = ['100'] }, 'OBSERVED_PROCESSES'],
  ['PID start ticks', state => { state.startTicks[100] = '98765' }, 'OBSERVED_PROCESSES'],
  ['cwd', state => { state.cwd[200] = APP + '/releases/old' }, 'OBSERVED_PROCESSES'],
  ['health SHA', state => { state.healthSha = 'a'.repeat(40) }, 'HEALTH_SHA'],
  ['lock holder', state => { state.locks = heldLock }, 'DEPLOY_LOCK'],
  ['release SHA', state => { state.marker = 'b'.repeat(40) }, 'CURRENT_RELEASE'],
]) {
  test('window detects change: ' + name, async () => {
    const { io, state } = fixture(), run = io.run
    io.run = (binary, args, options) => { const result = run(binary, args, options); if (!args.includes('--version')) mutate(state); return result }
    const result = await inspect(manifest, io)
    assert.equal(result.consistency.state, 'UNSTABLE'); assert.ok(result.consistency.changed.includes(reason))
    assert.equal(result.snapshotStable, false); assert.match(result.releaseDecision, /^NO_GO/)
  })
}
test('lock replacement with no holders is still a changed observation', async () => {
  const { io, state } = fixture(), run = io.run
  io.run = (binary, args, options) => { const result = run(binary, args, options); if (!args.includes('--version')) state.files.set(APP + '/.deploy.lock', normalStat({ ino: 78 })); return result }
  assert.ok((await inspect(manifest, io)).consistency.changed.includes('DEPLOY_LOCK'))
})
test('unknown or backward check clock is not stable', async () => {
  const absent = fixture(); delete absent.io.now
  assert.equal((await inspect(manifest, absent.io)).consistency.state, 'UNKNOWN')
  const backward = fixture(); let count = 0
  backward.io.now = () => ++count === 1 ? '2026-10-12T00:00:05.000Z' : '2026-10-12T00:00:00.000Z'
  assert.ok((await inspect(manifest, backward.io)).consistency.changed.includes('CLOCK_MOVED_BACKWARDS'))
})
test('health is sampled twice and untrusted health payload is redacted', async () => {
  const { io } = fixture(); let count = 0
  io.health = async () => ++count === 1 ? sha : 'fakeSensitiveValue'
  const result = await inspect(manifest, io)
  assert.equal(count, 2); assert.equal(result.endSample.healthSha, 'UNKNOWN')
  assert.equal(result.consistency.state, 'UNKNOWN'); assert.doesNotMatch(JSON.stringify(result), /fakeSensitiveValue/)
})
test('partial process visibility cannot establish whole-snapshot stability', async () => {
  const { io, state } = fixture(); state.readsDenied.add('/proc/200/environ')
  const result = await inspect(manifest, io)
  assert.equal(result.consistency.state, 'UNKNOWN'); assert.equal(result.webCwdMatch, 'UNKNOWN')
  assert.equal(result.markerHealthMatch, true) // independently observed matching SHA, not PM2 health
})
test('PM2 socket/version and actual Worker task state remain unproven, never safe to reload', async () => {
  const { io, calls } = fixture(), result = await inspect(manifest, io)
  assert.equal(result.pm2WebStatus, 'UNKNOWN'); assert.equal(result.pm2WorkerStatus, 'UNKNOWN')
  assert.equal(result.workerActiveTasks, 'UNKNOWN'); assert.equal(result.workerSafeToReload, 'UNKNOWN')
  assert.equal(result.workerObservability.lease, 'NOT_QUERIED'); assert.equal(result.workerObservability.runningLogs, 'NOT_QUERIED')
  assert.ok(calls.filter(row => row[0] === 'run').every(row => row[1] === '/usr/bin/mysql'))
  assert.doesNotMatch(source, /import.+(?:pm2|net|instagram|prisma)|connect\s*\(|SAFE_TO_RELOAD.*YES/)
})
test('per-process diagnostic row uses explicit field whitelist, not PM2 env or arbitrary stat', () => {
  const { io } = fixture(), row = processSnapshots(io, { target: release, sha }).rows[0]
  assert.deepEqual(Object.keys(row).sort(), ['name', 'pid', 'pmId', 'cwd', 'deleted', 'startTicks', 'identityStable',
    'currentRelease', 'olderRelease', 'deploySha', 'configuredCwd', 'configuredCwdMatchesCurrent', 'evidence'].sort())
  assert.doesNotMatch(JSON.stringify(row), /fakeSensitiveValue|fixture worker/)
})
test('nonzero version command cannot proceed to SELECT or leak its output', () => {
  const { io, calls } = fixture()
  io.run = () => { calls.push(['mock-version']); return { status: 1, stdout: 'fakeSensitiveValue', stderr: 'fakeSensitiveValue' } }
  const result = migrationRead(target, manifest.migrations, io)
  assert.equal(result.reason, 'MYSQL_CLIENT_VERSION_UNAVAILABLE')
  assert.equal(calls.filter(row => row[0] === 'mock-version').length, 1)
  assert.doesNotMatch(JSON.stringify(result), /fakeSensitiveValue/)
})
test('thrown client execution error is sanitized without fallback commands', () => {
  const { io } = fixture(); let count = 0
  io.run = () => { count++; throw new Error('fakeSensitiveValue') }
  const result = migrationRead(target, manifest.migrations, io)
  assert.equal(result.reason, 'MYSQL_CLIENT_EXECUTION_UNAVAILABLE'); assert.equal(count, 1)
  assert.doesNotMatch(JSON.stringify(result), /fakeSensitiveValue/)
})
test('changed process environment identity is sampled, never exported wholesale', async () => {
  const { io } = fixture(), read = io.read; let count = 0
  io.read = value => { const raw = read(value); return value === '/proc/100/environ' && ++count === 2 ? raw.replace('pm_id=1', 'pm_id=2') : raw }
  const result = await inspect(manifest, io)
  assert.ok(result.consistency.changed.includes('OBSERVED_PROCESSES'))
  assert.doesNotMatch(JSON.stringify(result), /fakeSensitiveValue/)
})
test('supported MySQL 8.4 keeps the existing fixed read-only SELECT contract', () => {
  const { io, state, calls } = fixture(); state.version = 'mysql Ver 8.4.6 for Linux'
  assert.equal(migrationRead(target, manifest.migrations, io).status, 'UP_TO_DATE')
  assert.equal(calls.filter(row => row[0] === 'run').at(-1)[2].at(-1), '--execute=' + SELECT_MIGRATIONS)
})
test('invalid clock output is not exported and cannot imply a stable window', async () => {
  const { io } = fixture(); io.now = () => 'fakeSensitiveValue'
  const result = await inspect(manifest, io)
  assert.equal(result.consistency.startedAt, 'UNKNOWN'); assert.equal(result.consistency.endedAt, 'UNKNOWN')
  assert.equal(result.consistency.state, 'UNKNOWN'); assert.doesNotMatch(JSON.stringify(result), /fakeSensitiveValue/)
})

function matchingBoundarySamples() {
  const { io } = fixture()
  const first = { current: { target: release, sha }, healthSha: sha,
    lock: lockObservation(lockStat, ''), processes: processSnapshots(io, { target: release, sha }) }
  return [first, copy(first)]
}
const boundaryConsistency = (first, last) => sampleConsistency(first, last,
  '2026-10-12T00:00:00.000Z', '2026-10-12T00:00:01.000Z')
for (const [label, value] of Object.entries({ unknown: 'UNKNOWN', missing: undefined, null: null,
  empty: '', outside: '/tmp/private', parent: APP + '/releases/..', nested: release + '/child' })) {
  test('Phase1 boundary CURRENT_RELEASE rejects target: ' + label, () => {
    for (const sides of [[0], [1], [0, 1]]) {
      const samples = matchingBoundarySamples()
      for (const side of sides) samples[side].current.target = value
      const result = boundaryConsistency(...samples)
      assert.equal(result.state, 'UNKNOWN'); assert.ok(result.unknown.includes('CURRENT_RELEASE'))
      assert.equal(result.atomic, false); assert.equal(result.scope, 'ENDPOINT_SAMPLES_NOT_CONTINUOUS')
    }
  })
}
for (const [label, value] of Object.entries({ unknown: 'UNKNOWN', missing: undefined, null: null,
  empty: '', short: '635ae4a0', uppercase: sha.toUpperCase(), arbitrary: 'fakeSensitiveValue' })) {
  test('Phase1 boundary CURRENT_RELEASE rejects SHA: ' + label, () => {
    for (const sides of [[0], [1], [0, 1]]) {
      const samples = matchingBoundarySamples()
      for (const side of sides) samples[side].current.sha = value
      const result = boundaryConsistency(...samples)
      assert.equal(result.state, 'UNKNOWN'); assert.ok(result.unknown.includes('CURRENT_RELEASE'))
    }
  })
}
for (const [label, value] of Object.entries({ missing: undefined, null: null, empty: {},
  missingDevice: { inode: '77' }, missingInode: { device: '2049' },
  unknownDevice: { device: 'UNKNOWN', inode: '77' }, unknownInode: { device: '2049', inode: 'UNKNOWN' },
  negativeDevice: { device: '-1', inode: '77' }, zeroInode: { device: '2049', inode: '0' },
  fractional: { device: '2049', inode: '77.5' }, numeric: { device: 2049, inode: 77 },
  noncanonical: { device: '02049', inode: '077' } })) {
  test('Phase1 boundary DEPLOY_LOCK rejects identity: ' + label, () => {
    for (const sides of [[0], [1], [0, 1]]) {
      const samples = matchingBoundarySamples()
      for (const side of sides) samples[side].lock.identity = value
      const result = boundaryConsistency(...samples)
      assert.equal(result.state, 'UNKNOWN'); assert.ok(result.unknown.includes('DEPLOY_LOCK'))
      assert.equal(result.atomic, false)
    }
  })
}
test('Phase1 boundary known release and canonical lock identity still match', () => {
  const result = boundaryConsistency(...matchingBoundarySamples())
  assert.equal(result.state, 'REPEATED_SAMPLES_MATCH'); assert.deepEqual(result.unknown, [])
  assert.equal(result.atomic, false); assert.equal(result.scope, 'ENDPOINT_SAMPLES_NOT_CONTINUOUS')
})
test('Phase1 boundary invalid lock status is not evidence despite valid identity', () => {
  const samples = matchingBoundarySamples(); samples.forEach(s => { s.lock.state = 'UNVERIFIED' })
  assert.ok(boundaryConsistency(...samples).unknown.includes('DEPLOY_LOCK'))
})
test('Phase1 boundary lock metadata rejects negative device and invalid inode', () => {
  for (const identity of [{ dev: -1 }, { ino: 0 }, { ino: -1 }]) {
    assert.equal(lockObservation(normalStat(identity), '').state, 'UNKNOWN')
  }
})
test('Phase1 boundary full inspect remains NO_GO even when all endpoint samples match', async () => {
  const { io } = fixture(), result = await inspect(manifest, io)
  assert.equal(result.consistency.state, 'REPEATED_SAMPLES_MATCH')
  assert.equal(result.snapshotAtomic, false)
  assert.equal(result.releaseDecision, 'NO_GO_UNTIL_UNKNOWN_PM2_AND_OTHER_CRITICAL_CHECKS_RESOLVED')
})

const privateDbFixture = 'mysql' + '://fixture_user:fakeSensitiveValue@db.example.invalid:3306/ecfc'
for (const scenario of ['binaryMetadata', 'loginMetadata', 'metadataMethod', 'configurationRead', 'configurationParse',
  'versionThrow', 'versionNonzero', 'versionUnsupported', 'queryThrow', 'queryNonzero', 'queryError',
  'queryNull', 'queryKilled', 'queryStderrConversion', 'queryMalformedRows', 'queryNonStringRows']) {
  test('Phase1 DB exception output contains only sanitized codes: ' + scenario, async () => {
    const { io } = fixture(), stat = io.stat, read = io.read, run = io.run
    io.stat = value => {
      if ((scenario === 'binaryMetadata' && value === '/usr/bin/mysql') ||
        (scenario === 'loginMetadata' && value === io.home + '/.mylogin.cnf')) {
        throw Object.assign(new Error(privateDbFixture), { code: privateDbFixture })
      }
      if (scenario === 'metadataMethod' && value === '/usr/bin/mysql') return normalStat({ isFile() { throw new Error(privateDbFixture) } })
      return stat(value)
    }
    io.read = value => {
      if (value === APP + '/shared/.env') {
        if (scenario === 'configurationRead') throw new Error(privateDbFixture)
        if (scenario === 'configurationParse') return 'DATABASE_URL="' + privateDbFixture + '%ZZ"'
      }
      return read(value)
    }
    io.run = (binary, args, options) => {
      if (args.includes('--version')) {
        if (scenario === 'versionThrow') throw new Error(privateDbFixture)
        if (scenario === 'versionNonzero') return { status: 1, stderr: privateDbFixture, stdout: privateDbFixture }
        if (scenario === 'versionUnsupported') return { status: 0, stdout: privateDbFixture }
      } else {
        if (scenario === 'queryThrow') throw new Error(privateDbFixture)
        if (scenario === 'queryNonzero') return { status: 1, stderr: 'ERROR 2026 (HY000): ' + privateDbFixture }
        if (scenario === 'queryError') return { status: null, error: Object.assign(new Error(privateDbFixture), { code: privateDbFixture }) }
        if (scenario === 'queryNull') return null
        if (scenario === 'queryKilled') return { status: null, signal: privateDbFixture, stderr: privateDbFixture }
        if (scenario === 'queryStderrConversion') return { status: 1, stderr: { toString() { throw new Error(privateDbFixture) } } }
        if (scenario === 'queryMalformedRows') return { status: 0, stdout: privateDbFixture, stderr: privateDbFixture }
        if (scenario === 'queryNonStringRows') return { status: 0, stdout: { privateDbFixture }, stderr: privateDbFixture }
      }
      return run(binary, args, options)
    }
    const result = await inspect(manifest, io)
    assert.equal(result.migrations.status, 'UNKNOWN')
    assert.match(result.migrations.reason, /^[A-Z][A-Z_]+$/)
    assert.doesNotMatch(JSON.stringify(result), /fakeSensitiveValue|fixture_user|db\.example\.invalid|mysql:\/\//)
    assert.equal(result.releaseDecision, 'NO_GO_UNTIL_UNKNOWN_PM2_AND_OTHER_CRITICAL_CHECKS_RESOLVED')
  })
}
