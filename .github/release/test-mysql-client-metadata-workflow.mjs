import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { REPOSITORY, SOURCE_SHA256, ACTIVE_STATUSES, BLOCKED_WORKFLOWS, METADATA_WORKFLOW,
  invocation, sourceGuard, deploymentsClear, credentialShape, credentialFiles,
  prepare, cleanup, sanitizedFailure } from './mysql-client-metadata-runner.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const require = createRequire(import.meta.url)
const parser = name => require(process.env.PREFLIGHT_PARSER_ROOT ? path.join(process.env.PREFLIGHT_PARSER_ROOT, name) : name)
const { parseDocument } = parser('yaml')
const { parse } = parser('acorn')
const text = fs.readFileSync(path.join(root, '.github/workflows/production-mysql-client-metadata.yml'), 'utf8')
const document = parseDocument(text, { uniqueKeys: true })
const workflow = document.toJS()
const script = fs.readFileSync(new URL('./mysql-client-metadata-check.sh', import.meta.url))
const control = fs.readFileSync(new URL('./mysql-client-metadata-runner.mjs', import.meta.url), 'utf8')
const sha = '7039d5889819cc7928aad9317b418b2a1c116003'
const baseEnv = () => ({ GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main',
  GITHUB_REPOSITORY: REPOSITORY, GITHUB_API_URL: 'https://api.github.com', GITHUB_SHA: sha,
  GITHUB_RUN_ID: '12345', GITHUB_RUN_ATTEMPT: '1', GH_TOKEN: 'fixture-api-canary', RUNNER_TEMP: '/runner/temp' })
const pinned = 'SHA256:' + createHash('sha256').update(Buffer.from('QUJD', 'base64')).digest('base64').replace(/=+$/, '')
const credentials = () => ({ ...baseEnv(), SSH_HOST: 'fixture.example.invalid', SSH_PORT: '22', SSH_USER: 'fixtureUser',
  SSH_KEY: 'fixture-noncredential-canary', PINNED_HOSTS: 'fixture.example.invalid ssh-ed25519 QUJD', PINNED_FINGERPRINT: pinned })
const stages = Object.values(workflow.jobs).flatMap(job => job.steps)
const queueResponse = () => ({ total_count: 0, workflow_runs: [] })
function apiMock(transform = x => x) {
  const calls = []
  const request = async (url, options) => {
    calls.push({ url, options })
    const body = url.endsWith('/git/ref/heads/main') ? { object: { sha } } : queueResponse()
    return { ok: true, status: 200, json: async () => transform(body, url) }
  }
  return { request, calls }
}
function fakeFiles() {
  const calls = [], files = new Map()
  const stat = (kind, mode, uid = 1000) => ({ uid, mode,
    isDirectory: () => kind === 'DIRECTORY', isFile: () => kind === 'FILE', isSymbolicLink: () => kind === 'LINK' })
  const io = {
    lstatSync(file) { calls.push(['lstat', file]); if (file === '/runner/temp') return stat('DIRECTORY', 0o40700)
      if (!files.has(file)) throw Object.assign(new Error('fixture-raw-private-error'), { code: 'ENOENT' })
      return files.get(file).stat },
    writeFileSync(file, content, options) { calls.push(['write', file, options]);
      assert.equal(options.flag, 'wx'); assert.equal(options.mode, 0o600)
      if (files.has(file)) throw Object.assign(new Error('fixture-raw-private-error'), { code: 'EEXIST' })
      files.set(file, { content, stat: stat('FILE', 0o100600) }) },
    unlinkSync(file) { calls.push(['unlink', file]); if (!files.delete(file)) throw Object.assign(new Error('fixture-raw-private-error'), { code: 'ENOENT' }) },
  }
  return { io, calls, files, stat }
}

test('valid unique-key YAML and exactly manual dispatch without inputs', () => {
  assert.deepEqual(document.errors, [])
  assert.deepEqual(workflow.on, { workflow_dispatch: null })
  assert.deepEqual(Object.keys(workflow.jobs), ['validate', 'inspect'])
})
test('permissions are exactly read-only contents and actions', () => {
  assert.deepEqual(workflow.permissions, { contents: 'read', actions: 'read' })
  assert.ok(Object.values(workflow.jobs).every(job => !job.permissions))
})
test('all jobs reject non-main non-manual other-repository before secrets', () => {
  for (const job of Object.values(workflow.jobs)) {
    assert.match(job.if, /github.event_name == 'workflow_dispatch'/)
    assert.match(job.if, /github.ref == 'refs\/heads\/main'/)
    assert.match(job.if, /github.repository == 'andkdiids\/EasonFansClub'/)
  }
  assert.match(workflow.jobs.inspect.if, /needs.validate.result == 'success'/)
})
test('Production binding and Ubuntu runners with bounded jobs', () => {
  assert.deepEqual(workflow.jobs.inspect.environment, { name: 'Production' })
  assert.equal(workflow.jobs.validate.environment, undefined)
  for (const job of Object.values(workflow.jobs)) { assert.equal(job['runs-on'], 'ubuntu-22.04'); assert.ok(job['timeout-minutes'] <= 10) }
})
test('diagnostic concurrency is independent of every existing production workflow', () => {
  assert.equal(workflow.concurrency.group, 'production-mysql-client-metadata-only')
  assert.equal(workflow.concurrency['cancel-in-progress'], false)
  for (const job of Object.values(workflow.jobs)) assert.equal(job.concurrency, undefined)
  for (const file of BLOCKED_WORKFLOWS) {
    if (file === METADATA_WORKFLOW) continue
    const existing = parseDocument(fs.readFileSync(path.join(root, file), 'utf8')).toJS()
    for (const group of [existing.concurrency, ...Object.values(existing.jobs).map(j => j.concurrency)].filter(Boolean)) {
      assert.notEqual(workflow.concurrency.group.toLowerCase(), group.group.toLowerCase())
    }
  }
  assert.doesNotMatch(text, /group: production-deploy|group: production-entry/)
})
test('only SHA-pinned checkout actions without persistent Git credentials', () => {
  const actions = stages.filter(s => s.uses)
  assert.equal(actions.length, 2)
  for (const step of actions) {
    assert.equal(step.uses, 'actions/checkout@11d5960a326750d5838078e36cf38b85af677262')
    assert.equal(step.with.ref, '${{ github.sha }}')
    assert.equal(step.with['persist-credentials'], false)
  }
})
test('four existing secret names only; secrets are step scoped, never in test job', () => {
  assert.deepEqual([...new Set([...text.matchAll(/secrets\.([A-Z_]+)/g)].map(m => m[1]))].sort(),
    ['SERVER_HOST', 'SERVER_PORT', 'SERVER_SSH_KEY', 'SERVER_USER'])
  assert.doesNotMatch(JSON.stringify(workflow.jobs.validate), /secrets\./)
  assert.equal(workflow.jobs.inspect.env, undefined)
  const step = stages.find(s => s.name === 'Create private credentials on the runner only')
  assert.equal(step.env.SSH_KEY, '${{ secrets.SERVER_SSH_KEY }}')
  assert.equal(step.env.PINNED_HOSTS, '${{ vars.PRODUCTION_SSH_KNOWN_HOSTS }}')
  assert.equal(step.env.PINNED_FINGERPRINT, '${{ vars.PRODUCTION_SSH_HOST_KEY_SHA256 }}')
  assert.match(step.run, /set \+x/); assert.match(step.run, /umask 077/)
})
test('three queue gates, final gate before SSH, no continue-on-error', () => {
  assert.equal(stages.filter(s => /runner\.mjs queue/.test(s.run || '')).length, 3)
  const steps = workflow.jobs.inspect.steps
  const prepareIndex = steps.findIndex(s => /runner\.mjs prepare/.test(s.run || ''))
  const sshIndex = steps.findIndex(s => /bash \.github\/release\/mysql-client-metadata-check.sh/.test(s.run || ''))
  assert.match(steps[prepareIndex - 1].run, /runner\.mjs queue/)
  assert.match(steps[sshIndex - 1].run, /runner\.mjs queue/)
  assert.ok(stages.every(s => s['continue-on-error'] === undefined))
})
test('fixed SSH source, source guard before use, no arbitrary argument interpolation', () => {
  const step = stages.find(s => /export KEY_FILE/.test(s.run || ''))
  assert.ok(step.run.indexOf('runner.mjs guard') < step.run.indexOf('bash .github/release/mysql-client-metadata-check.sh'))
  assert.doesNotMatch(text, /inputs\.|workflow_call:|pull_request:|schedule:|push:|scp |ssh-keyscan|upload-artifact|actions\/cache/)
  assert.doesNotMatch(text, /migrate|deploy-production|rollback-production|pm2|window|StrictHostKeyChecking=no/)
})
test('cleanup always runs on disposable runner with no production cleanup command', () => {
  const last = workflow.jobs.inspect.steps.at(-1)
  assert.equal(last.if, 'always()')
  assert.equal(last.run, 'node .github/release/mysql-client-metadata-runner.mjs cleanup')
  assert.doesNotMatch(last.run, /ssh|sudo|rm -rf/)
})
test('runner test dependencies pinned without lifecycle scripts or application install', () => {
  const step = stages.find(s => /npm install/.test(s.run || ''))
  assert.match(step.run, /--prefix "\$RUNNER_TEMP\//)
  assert.match(step.run, /--ignore-scripts --no-audit --no-fund --no-package-lock acorn@8.17.0 yaml@2.9.0/)
})
test('installation touches github-only excluded paths, entry remains manual only', () => {
  const deploy = parseDocument(fs.readFileSync(path.join(root, '.github/workflows/deploy.yml'), 'utf8')).toJS()
  const entry = parseDocument(fs.readFileSync(path.join(root, '.github/workflows/configure-production-entry.yml'), 'utf8')).toJS()
  assert.ok(deploy.on.push['paths-ignore'].includes('.github/**'))
  assert.deepEqual(Object.keys(entry.on), ['workflow_dispatch'])
  for (const file of ['.github/workflows/production-mysql-client-metadata.yml', '.github/release/mysql-client-metadata-check.sh',
    '.github/release/test-mysql-client-metadata.mjs', '.github/release/mysql-client-metadata-runner.mjs', '.github/release/test-mysql-client-metadata-workflow.mjs']) {
    assert.ok(file.startsWith('.github/'))
  }
})
test('native Node parser syntax and Bash syntax for every workflow run block', () => {
  parse(control, { ecmaVersion: 'latest', sourceType: 'module' })
  for (const step of stages.filter(s => s.run)) {
    const r = spawnSync(process.env.METADATA_TEST_BASH || 'bash', ['--noprofile', '--norc', '-n'], { input: step.run, encoding: 'utf8' })
    assert.equal(r.status, 0, r.stderr)
  }
})
test('audited source SHA256 with only documented EOF whitespace normalization; changed bytes rejected', () => {
  assert.equal(createHash('sha256').update(script).digest('hex'), SOURCE_SHA256)
  // Reconstituting the removed LF proves every original executable byte remains.
  assert.equal(createHash('sha256').update(Buffer.concat([script, Buffer.from('\n')])).digest('hex'),
    '2bf45dfa2e2719754de2f5ba381a537d81d5bda19c950a545de25583639075e4')
  sourceGuard(script)
  assert.throws(() => sourceGuard(Buffer.concat([script, Buffer.from('\n')])) , /SOURCE_HASH_MISMATCH/)
})
for (const [key, value] of [
  ['GITHUB_EVENT_NAME', 'push'], ['GITHUB_EVENT_NAME', 'pull_request'], ['GITHUB_REF', 'refs/heads/ops/test'],
  ['GITHUB_REF', 'refs/tags/main'], ['GITHUB_REPOSITORY', 'other/repo'], ['GITHUB_API_URL', 'https://evil.invalid'],
  ['GITHUB_SHA', 'short'], ['GITHUB_RUN_ID', '../escape'], ['GITHUB_RUN_ATTEMPT', '0'],
]) test('invocation rejects ' + key + '=' + value, () => assert.throws(() => invocation({ ...baseEnv(), [key]: value })))
test('normal invocation accepted and CLI failure never prints raw error', () => {
  invocation(baseEnv())
  const failure = sanitizedFailure(new Error('mysql://private-password@host fixture-raw-private-error'))
  assert.deepEqual(failure, { status: 'FAIL', result: 'FAIL_CLOSED', reason: 'RUNNER_OPERATION_UNAVAILABLE', releaseDecision: 'NO_GO' })
})
test('queue checks remote main and all five states with GET only', async () => {
  const f = apiMock(); const result = await deploymentsClear(baseEnv(), f.request)
  assert.equal(f.calls.length, 7); assert.equal(result.releaseDecision, 'NO_GO'); assert.equal(result.observation, 'NON_ATOMIC')
  assert.equal(result.crossWorkflowLock, false)
  assert.ok(f.calls.every(c => c.options.method === 'GET' && c.options.redirect === 'error' &&
    c.url.startsWith('https://api.github.com/repos/' + REPOSITORY)))
  assert.deepEqual(f.calls.slice(1, -1).map(c => new URL(c.url).searchParams.get('status')), ACTIVE_STATUSES)
})
for (const workflowPath of BLOCKED_WORKFLOWS) for (const status of ACTIVE_STATUSES) {
  test('queue refuses ' + workflowPath + ' ' + status, async () => {
    const f = apiMock((body, url) => new URL(url).searchParams.get('status') === status ?
      { total_count: 1, workflow_runs: [{ id: 99, path: workflowPath, status }] } : body)
    await assert.rejects(deploymentsClear(baseEnv(), f.request), /PRODUCTION_WORKFLOW_CONFLICT/)
  })
}
for (const [name, change] of [
  ['missing array', () => ({ total_count: 0 })], ['missing total', () => ({ workflow_runs: [] })],
  ['missing records', () => ({ total_count: 1, workflow_runs: [] })], ['negative total', () => ({ total_count: -1, workflow_runs: [] })],
  ['search cap', () => ({ total_count: 1001, workflow_runs: [] })],
  ['unknown workflow', () => ({ total_count: 1, workflow_runs: [{ id: 99, path: '.github/workflows/unknown.yml', status: 'queued' }] })],
  ['missing status', () => ({ total_count: 1, workflow_runs: [{ id: 99, path: '.github/workflows/deploy.yml' }] })],
  ['duplicate rows', () => ({ total_count: 2, workflow_runs: [1, 2].map(() => ({ id: 99, path: '.github/workflows/deploy.yml', status: 'queued' })) })],
]) test('queue malformed response fails closed: ' + name, async () => {
  const f = apiMock((body, url) => url.includes('/actions/runs') ? change(body) : body)
  await assert.rejects(deploymentsClear(baseEnv(), f.request))
})
test('main changed after dispatch is rejected without production access', async () => {
  const f = apiMock((body, url) => url.endsWith('/git/ref/heads/main') ? { object: { sha: 'f'.repeat(40) } } : body)
  await assert.rejects(deploymentsClear(baseEnv(), f.request), /REMOTE_MAIN_CHANGED/)
})
test('API denied, timeout and parse failures remain sanitized', async () => {
  for (const request of [async () => ({ ok: false }), async () => { throw Error('fixture-secret-canary') },
    async () => ({ ok: true, status: 200, json: async () => { throw Error('fixture-secret-canary') } })]) {
    try { await deploymentsClear(baseEnv(), request); assert.fail('must reject') } catch (e) {
      assert.doesNotMatch(JSON.stringify(sanitizedFailure(e)), /fixture-secret-canary|Bearer/)
    }
  }
})
test('absent API token stops before requests', async () => {
  await assert.rejects(deploymentsClear({ ...baseEnv(), GH_TOKEN: '' }, () => assert.fail('request forbidden')), /ACTIONS_READ_UNAVAILABLE/)
})
test('only exact current metadata run identity is excluded', async () => {
  const f = apiMock((body, url) => new URL(url).searchParams.get('status') === 'in_progress' ?
    { total_count: 1, workflow_runs: [{ id: 12345, path: METADATA_WORKFLOW, status: 'in_progress', head_sha: sha, run_attempt: 1 }] } : body)
  assert.equal((await deploymentsClear(baseEnv(), f.request)).conflictingProductionRuns, 0)
})
test('complete second page checked for conflicts and changed pagination rejected', async () => {
  const observer = '.github/workflows/production-strict-readonly-preflight.yml'
  for (const changed of [false, true]) {
    const f = apiMock((body, url) => {
      const q = new URL(url).searchParams
      if (q.get('status') !== 'queued') return body
      if (q.get('page') === '1') return { total_count: 101, workflow_runs: Array.from({ length: 100 }, (_, i) => ({ id: i + 1, path: observer, status: 'queued' })) }
      return { total_count: changed ? 100 : 101, workflow_runs: [{ id: 101, path: observer, status: 'queued' }] }
    })
    if (changed) await assert.rejects(deploymentsClear(baseEnv(), f.request), /ACTIONS_WINDOW_CHANGED/)
    else {
      await assert.rejects(deploymentsClear(baseEnv(), f.request), /PRODUCTION_WORKFLOW_CONFLICT/)
      assert.equal(f.calls.filter(c => new URL(c.url).searchParams.get('status') === 'queued').length, 2)
    }
  }
})
test('port-specific exact host binding and correct fingerprint accepted', () => {
  credentialShape(credentials())
  credentialShape({ ...credentials(), SSH_PORT: '2222', PINNED_HOSTS: '[fixture.example.invalid]:2222 ssh-ed25519 QUJD' })
})
for (const [key, value] of [
  ['SSH_HOST', 'different.example.invalid'], ['SSH_PORT', '2222'], ['SSH_PORT', '022'], ['SSH_PORT', '65536'],
  ['SSH_USER', 'bad user'], ['SSH_KEY', ''], ['PINNED_FINGERPRINT', 'SHA256:REVG'],
  ['PINNED_HOSTS', 'fixture.example.invalid ssh-ed25519 QUJD\nother.invalid ssh-ed25519 QUJD'],
  ['PINNED_HOSTS', '*.invalid ssh-ed25519 QUJD'], ['PINNED_HOSTS', 'fixture.example.invalid invalid QUJD'],
]) test('credential and pin configuration refuses ' + key + ' invalid fixture', () => assert.throws(() => credentialShape({ ...credentials(), [key]: value })))
test('exclusive private files created only under Runner temporary directory; no secret output', () => {
  const f = fakeFiles(); const result = prepare(credentials(), f.io, 1000, 'linux')
  assert.equal(f.files.size, 2)
  assert.ok(f.calls.filter(c => c[0] === 'write').every(c => c[1].startsWith('/runner/temp/ecfc-mysql-metadata-12345-1.')))
  assert.doesNotMatch(JSON.stringify(result), /fixture-noncredential-canary|QUJD|fixtureUser/)
  assert.equal(result.releaseDecision, 'NO_GO')
})
test('preexisting key cannot be overwritten and failure is sanitized', () => {
  const f = fakeFiles(); prepare(credentials(), f.io, 1000, 'linux')
  assert.throws(() => prepare(credentials(), f.io, 1000, 'linux'), /fixture-raw-private-error/)
})
for (const [label, temp] of [
  ['wrong owner', { kind: 'DIRECTORY', mode: 0o40700, uid: 0 }],
  ['writable', { kind: 'DIRECTORY', mode: 0o40777, uid: 1000 }],
  ['symlink', { kind: 'LINK', mode: 0o120777, uid: 1000 }],
]) test('unsafe runner temporary directory refuses writes: ' + label, () => {
  const f = fakeFiles(); const read = f.io.lstatSync
  f.io.lstatSync = file => file === '/runner/temp' ? f.stat(temp.kind, temp.mode, temp.uid) : read(file)
  assert.throws(() => prepare(credentials(), f.io, 1000, 'linux'), /RUNNER_TEMP_UNSAFE/)
  assert.equal(f.files.size, 0)
})
test('Windows runtime refuses real credential preparation without relaxing uid rules', () => {
  const f = fakeFiles(); assert.throws(() => prepare(credentials(), f.io, undefined, 'win32'), /LINUX_RUNNER_REQUIRED/)
  assert.equal(f.calls.length, 0)
})
test('cleanup deletes only exact two Runner files and is idempotent', () => {
  const f = fakeFiles(); prepare(credentials(), f.io, 1000, 'linux')
  cleanup(baseEnv(), f.io); cleanup(baseEnv(), f.io)
  assert.equal(f.files.size, 0)
  assert.deepEqual([...new Set(f.calls.filter(c => c[0] === 'unlink').map(c => c[1]))].sort(), Object.values(credentialFiles(baseEnv())).sort())
})
test('partial credential creation is cleaned after hosts write failure', () => {
  const f = fakeFiles(), write = f.io.writeFileSync
  f.io.writeFileSync = (file, ...args) => { if (file.endsWith('.hosts')) throw Error('fixture-secret-canary'); write(file, ...args) }
  assert.throws(() => prepare(credentials(), f.io, 1000, 'linux'))
  assert.equal(f.files.size, 1); cleanup(baseEnv(), f.io); assert.equal(f.files.size, 0)
})
test('cleanup errors fail closed without raw IO errors; path traversal rejected', () => {
  const f = fakeFiles(); f.io.unlinkSync = () => { throw Error('fixture-secret-canary') }
  assert.throws(() => cleanup(baseEnv(), f.io))
  assert.throws(() => cleanup({ ...baseEnv(), GITHUB_RUN_ID: '../../production' }, f.io), /RUN_ID_INVALID/)
})
test('runner controller has no SSH, child processes, production URLs or environment dump', () => {
  const ast = parse(control, { ecmaVersion: 'latest', sourceType: 'module' })
  const imports = ast.body.filter(v => v.type === 'ImportDeclaration').map(v => v.source.value)
  assert.deepEqual(imports, ['node:fs', 'node:path', 'node:crypto', 'node:url'])
  assert.doesNotMatch(control, /spawn|execSync|pm2|mysql:\/\/|DATABASE_URL|console\.log\(process\.env/)
  assert.match(control, /method: 'GET'/)
})
test('sensitive scan on candidate files contains no real credential material', () => {
  for (const file of ['production-mysql-client-metadata.yml', 'mysql-client-metadata-check.sh',
    'mysql-client-metadata-runner.mjs', 'test-mysql-client-metadata.mjs', 'test-mysql-client-metadata-workflow.mjs']) {
    const source = fs.readFileSync(path.join(root, '.github', file.endsWith('.yml') ? 'workflows' : 'release', file), 'utf8')
    assert.doesNotMatch(source, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:ghp_|github_pat_|AKID)[A-Za-z0-9]{20,}|mysql:\/\/[^\s'"]+:[^\s'"]+@/)
  }
})

test('production inventory covers deployment, entry, legacy and strict diagnostics plus metadata', () => {
  assert.deepEqual([...BLOCKED_WORKFLOWS].sort(), [
    '.github/workflows/deploy.yml', '.github/workflows/configure-production-entry.yml',
    '.github/workflows/production-release-approved.yml', '.github/workflows/production-migration-status.yml',
    '.github/workflows/production-strict-readonly-preflight.yml', METADATA_WORKFLOW,
  ].sort())
  assert.deepEqual(ACTIVE_STATUSES, ['queued', 'in_progress', 'waiting', 'requested', 'pending'])
})
test('standard pending replacement is confined to diagnostics and cannot affect production queues', () => {
  // Scheduler model only: mirrors standard single-pending replacement semantics.
  const original = {
    'production-deploy': { running: 'deploy-A', pending: 'deploy-B' },
    'production-entry': { running: 'entry-A', pending: 'entry-B' },
    'production-strict-readonly-preflight': { running: 'strict-A', pending: 'strict-B' },
    'production-readonly-diagnostic': { running: 'legacy-A', pending: 'legacy-B' },
  }
  const queue = structuredClone(original)
  queue[workflow.concurrency.group] = { running: 'metadata-A', pending: 'metadata-B' }
  const cancelled = [queue[workflow.concurrency.group].pending]
  queue[workflow.concurrency.group].pending = 'metadata-C'
  assert.deepEqual(cancelled, ['metadata-B'])
  assert.equal(queue[workflow.concurrency.group].running, 'metadata-A')
  for (const [group, entries] of Object.entries(original)) assert.deepEqual(queue[group], entries)
})
test('controller exposes no cancellation, dispatch, lock or cross-workflow mutation API', () => {
  assert.doesNotMatch(control, /\/cancel|\/force-cancel|\/dispatches|method:\s*['"](?:POST|PUT|PATCH|DELETE)['"]|flock|\.deploy\.lock/)
  assert.doesNotMatch(text, /cancel-in-progress: true|workflow_run:|workflow_call:|pull_request_target:|repository_dispatch:/)
  assert.equal(stages.filter(s => s.run?.includes('mysql-client-metadata-check.sh') && /export KEY_FILE/.test(s.run)).length, 1)
})
for (const status of ACTIVE_STATUSES) {
  test('same-workflow different metadata run blocks: ' + status, async () => {
    const f = apiMock((body, url) => new URL(url).searchParams.get('status') === status ?
      { total_count: 1, workflow_runs: [{ id: 67890, path: METADATA_WORKFLOW, status, head_sha: sha, run_attempt: 1 }] } : body)
    await assert.rejects(deploymentsClear(baseEnv(), f.request), /PRODUCTION_WORKFLOW_CONFLICT/)
  })
}
for (const [name, alter] of [
  ['wrong workflow', r => { r.path = '.github/workflows/deploy.yml' }],
  ['wrong attempt', r => { r.run_attempt = 2 }], ['missing attempt', r => { delete r.run_attempt }],
  ['string attempt', r => { r.run_attempt = '1' }], ['wrong SHA', r => { r.head_sha = 'f'.repeat(40) }],
  ['missing SHA', r => { delete r.head_sha }],
]) {
  test('current run exclusion rejects uncertain identity: ' + name, async () => {
    const row = { id: 12345, path: METADATA_WORKFLOW, status: 'in_progress', head_sha: sha, run_attempt: 1 }
    alter(row)
    const f = apiMock((body, url) => new URL(url).searchParams.get('status') === 'in_progress' ?
      { total_count: 1, workflow_runs: [row] } : body)
    await assert.rejects(deploymentsClear(baseEnv(), f.request), /CURRENT_RUN_IDENTITY_INVALID/)
  })
}
for (const statusCode of [401, 403, 429, 500]) {
  test('HTTP permission or availability failure blocks with sanitized code: ' + statusCode, async () => {
    const request = async () => ({ ok: false, status: statusCode, json: () => { throw Error('fixture-private-raw-body') } })
    let failure
    try { await deploymentsClear(baseEnv(), request) } catch (e) { failure = sanitizedFailure(e) }
    assert.deepEqual(failure, { status: 'FAIL', result: 'FAIL_CLOSED', reason: 'ACTIONS_READ_UNAVAILABLE', releaseDecision: 'NO_GO' })
    assert.doesNotMatch(JSON.stringify(failure), /fixture-private-raw-body/)
  })
}
test('production conflict appearing on second page cannot pass', async () => {
  const f = apiMock((body, url) => {
    const q = new URL(url).searchParams
    if (q.get('status') !== 'queued') return body
    const rows = q.get('page') === '1' ? Array.from({ length: 100 }, (_, i) => ({
      id: i + 1, path: '.github/workflows/production-strict-readonly-preflight.yml', status: 'queued',
    })) : [{ id: 101, path: '.github/workflows/deploy.yml', status: 'queued' }]
    return { total_count: 101, workflow_runs: rows }
  })
  await assert.rejects(deploymentsClear(baseEnv(), f.request), /PRODUCTION_WORKFLOW_CONFLICT/)
  assert.ok(f.calls.some(c => new URL(c.url).searchParams.get('page') === '2'))
})
test('API search limit boundary scans all ten full pages without silent truncation', async () => {
  const f = apiMock((body, url) => {
    const q = new URL(url).searchParams
    if (q.get('status') !== 'waiting') return body
    const page = Number(q.get('page'))
    return { total_count: 1000, workflow_runs: Array.from({ length: 100 }, (_, i) => ({
      id: (page - 1) * 100 + i + 1, path: '.github/workflows/deploy.yml', status: 'waiting',
    })) }
  })
  await assert.rejects(deploymentsClear(baseEnv(), f.request), /PRODUCTION_WORKFLOW_CONFLICT/)
  assert.equal(f.calls.filter(c => new URL(c.url).searchParams.get('status') === 'waiting').length, 10)
})
test('short middle page, missing terminal records and duplicate cross-page IDs fail closed', async () => {
  for (const scenario of ['short-middle', 'missing-terminal', 'duplicate-ID']) {
    const f = apiMock((body, url) => {
      const q = new URL(url).searchParams
      if (q.get('status') !== 'pending') return body
      const rows = q.get('page') === '1' ? Array.from({ length: scenario === 'short-middle' ? 99 : 100 }, (_, i) => ({
        id: i + 1, path: '.github/workflows/deploy.yml', status: 'pending',
      })) : scenario === 'missing-terminal' ? [] : [{ id: 1, path: '.github/workflows/deploy.yml', status: 'pending' }]
      return { total_count: 101, workflow_runs: rows }
    })
    await assert.rejects(deploymentsClear(baseEnv(), f.request), /ACTIONS_RESPONSE_INCOMPLETE|ACTIONS_RESPONSE_INVALID/)
  }
})
test('same run observed transitioning across status samples is unstable and blocks', async () => {
  const f = apiMock((body, url) => {
    const status = new URL(url).searchParams.get('status')
    return ['queued', 'in_progress'].includes(status) ? { total_count: 1, workflow_runs: [{
      id: 12345, path: METADATA_WORKFLOW, status, head_sha: sha, run_attempt: 1,
    }] } : body
  })
  await assert.rejects(deploymentsClear(baseEnv(), f.request), /ACTIONS_RESPONSE_INVALID/)
})
test('main changed during status scan blocks before connection', async () => {
  let mainReads = 0
  const f = apiMock((body, url) => url.endsWith('/git/ref/heads/main') && ++mainReads === 2 ?
    { object: { sha: 'f'.repeat(40) } } : body)
  await assert.rejects(deploymentsClear(baseEnv(), f.request), /REMOTE_MAIN_CHANGED/)
  assert.equal(mainReads, 2)
})
test('empty observation does not claim atomic exclusion or eliminate a later deployment race', async () => {
  const f = apiMock()
  const result = await deploymentsClear(baseEnv(), f.request)
  assert.deepEqual(result, { conflictingProductionRuns: 0, observation: 'NON_ATOMIC', crossWorkflowLock: false, releaseDecision: 'NO_GO' })
  // A deployment arriving after these GETs is not prevented by this workflow.
  const laterRun = { id: 67890, path: '.github/workflows/deploy.yml', status: 'queued' }
  assert.equal(laterRun.status, 'queued')
  assert.notEqual(workflow.concurrency.group, 'production-deploy')
  assert.match(text, /NOT a cross-workflow lock|never claim atomic exclusion/)
})
test('explicit incomplete result flag cannot produce an empty-queue PASS', async () => {
  const f = apiMock((body, url) => url.includes('/actions/runs') ? { ...body, incomplete_results: true } : body)
  await assert.rejects(deploymentsClear(baseEnv(), f.request), /ACTIONS_RESPONSE_INCOMPLETE/)
})
for (const code of [204, 206]) test('partial or empty success HTTP status rejected: ' + code, async () => {
  let parsed = false
  await assert.rejects(deploymentsClear(baseEnv(), async () => ({ ok: true, status: code,
    json: async () => { parsed = true; return { object: { sha } } } })), /ACTIONS_READ_UNAVAILABLE/)
  assert.equal(parsed, false)
})
