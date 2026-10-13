// Runner-local control only. Never executes SSH or contacts production itself.
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

export const REPOSITORY = 'andkdiids/EasonFansClub'
// Reviewed input hash: 2bf45dfa2e2719754de2f5ba381a537d81d5bda19c950a545de25583639075e4.
// Candidate differs only by removal of one trailing blank line (Git whitespace).
export const SOURCE_SHA256 = '58188c517bdbc7ecd34498917562d8306eda996a680dbce55781b18252c2b89c'
export const ACTIVE_STATUSES = ['queued', 'in_progress', 'waiting', 'requested', 'pending']
export const METADATA_WORKFLOW = '.github/workflows/production-mysql-client-metadata.yml'
export const BLOCKED_WORKFLOWS = new Set([
  '.github/workflows/deploy.yml',
  '.github/workflows/configure-production-entry.yml',
  '.github/workflows/production-release-approved.yml',
  // The legacy diagnostic can write production /tmp; do not overlap it.
  '.github/workflows/production-migration-status.yml',
  '.github/workflows/production-strict-readonly-preflight.yml',
  METADATA_WORKFLOW,
])
class SafeFailure extends Error {
  constructor(code) { super(code); this.code = code }
}
function requireThat(condition, code) { if (!condition) throw new SafeFailure(code) }

export function invocation(env) {
  requireThat(env.GITHUB_EVENT_NAME === 'workflow_dispatch' && env.GITHUB_REF === 'refs/heads/main', 'MANUAL_MAIN_REQUIRED')
  requireThat(env.GITHUB_REPOSITORY === REPOSITORY && env.GITHUB_API_URL === 'https://api.github.com', 'REPOSITORY_OR_API_INVALID')
  requireThat(/^[0-9a-f]{40}$/.test(env.GITHUB_SHA || ''), 'CHECKOUT_SHA_INVALID')
  requireThat(/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID || '') && /^[1-9][0-9]*$/.test(env.GITHUB_RUN_ATTEMPT || ''), 'RUN_ID_INVALID')
}

export function sourceGuard(bytes) {
  requireThat(createHash('sha256').update(bytes).digest('hex') === SOURCE_SHA256, 'SOURCE_HASH_MISMATCH')
}

export async function deploymentsClear(env, request = fetch, currentWorkflow = METADATA_WORKFLOW) {
  invocation(env)
  requireThat([METADATA_WORKFLOW, '.github/workflows/production-strict-readonly-preflight.yml',
    '.github/workflows/production-release-approved.yml'].includes(currentWorkflow), 'CURRENT_WORKFLOW_INVALID')
  requireThat(typeof env.GH_TOKEN === 'string' && env.GH_TOKEN.length > 0, 'ACTIONS_READ_UNAVAILABLE')
  async function get(endpoint) {
    const response = await request('https://api.github.com/repos/' + REPOSITORY + endpoint, {
      method: 'GET', redirect: 'error', headers: { authorization: 'Bearer ' + env.GH_TOKEN,
        accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' },
      signal: AbortSignal.timeout(15000),
    })
    requireThat(response?.ok === true && response.status === 200, 'ACTIONS_READ_UNAVAILABLE')
    return response.json()
  }
  async function currentMainMatches() {
    const main = await get('/git/ref/heads/main')
    requireThat(main?.object?.sha === env.GITHUB_SHA, 'REMOTE_MAIN_CHANGED')
  }
  await currentMainMatches()
  let blocked = 0
  const windowIds = new Set()
  for (const status of ACTIVE_STATUSES) {
    let finished = false
    let expectedTotal
    let observed = 0
    for (let page = 1; page <= 10; page++) {
      const result = await get(`/actions/runs?status=${status}&per_page=100&page=${page}`)
      requireThat(Number.isSafeInteger(result?.total_count) && result.total_count >= 0 && result.total_count <= 1000 &&
        Array.isArray(result.workflow_runs) && result.workflow_runs.length <= 100, 'ACTIONS_RESPONSE_INVALID')
      requireThat(result.incomplete_results === undefined || result.incomplete_results === false, 'ACTIONS_RESPONSE_INCOMPLETE')
      const rows = result.workflow_runs
      if (expectedTotal === undefined) expectedTotal = result.total_count
      requireThat(result.total_count === expectedTotal, 'ACTIONS_WINDOW_CHANGED')
      observed += rows.length
      requireThat(observed <= expectedTotal, 'ACTIONS_RESPONSE_INVALID')
      for (const row of rows) {
        requireThat(row && Number.isSafeInteger(row.id) && row.id > 0 && typeof row.path === 'string' &&
          row.status === status && row.path.startsWith('.github/workflows/'), 'ACTIONS_RESPONSE_INVALID')
        requireThat(!windowIds.has(row.id), 'ACTIONS_RESPONSE_INVALID')
        windowIds.add(row.id)
        const workflow = row.path.split('@', 1)[0]
        // Only this exact run, revision and attempt may be excluded. Other
        // metadata runs and strictly-readonly diagnostics still conflict.
        if (String(row.id) === env.GITHUB_RUN_ID) {
          requireThat(workflow === currentWorkflow && row.head_sha === env.GITHUB_SHA &&
            Number.isSafeInteger(row.run_attempt) && String(row.run_attempt) === env.GITHUB_RUN_ATTEMPT,
          'CURRENT_RUN_IDENTITY_INVALID')
        } else {
          requireThat(BLOCKED_WORKFLOWS.has(workflow), 'UNCLASSIFIED_ACTIVE_WORKFLOW')
          blocked++
        }
      }
      if (observed === expectedTotal) { finished = true; break }
      requireThat(rows.length === 100, 'ACTIONS_RESPONSE_INCOMPLETE')
    }
    requireThat(finished, 'ACTIONS_PAGINATION_INCOMPLETE')
    requireThat(observed === expectedTotal, 'ACTIONS_RESPONSE_INCOMPLETE')
  }
  requireThat(blocked === 0, 'PRODUCTION_WORKFLOW_CONFLICT')
  await currentMainMatches()
  return { conflictingProductionRuns: 0, observation: 'NON_ATOMIC', crossWorkflowLock: false, releaseDecision: 'NO_GO' }
}

export function credentialShape(env) {
  requireThat(/^[A-Za-z0-9._-]+$/.test(env.SSH_HOST || '') &&
    /^[A-Za-z_][A-Za-z0-9_-]*$/.test(env.SSH_USER || '') &&
    /^[1-9][0-9]{0,4}$/.test(env.SSH_PORT || '') && Number(env.SSH_PORT) <= 65535, 'SSH_CONFIG_INVALID')
  requireThat(typeof env.SSH_KEY === 'string' && env.SSH_KEY.trim().length > 0 &&
    typeof env.PINNED_HOSTS === 'string' && /^SHA256:[A-Za-z0-9+/]+=?$/.test(env.PINNED_FINGERPRINT || ''), 'HOST_PIN_OR_KEY_UNAVAILABLE')
  const lines = env.PINNED_HOSTS.trim().split(/\r?\n/)
  const fields = lines.length === 1 ? lines[0].split(/\s+/) : []
  const host = env.SSH_PORT === '22' ? env.SSH_HOST : `[${env.SSH_HOST}]:${env.SSH_PORT}`
  requireThat(fields.length === 3 && fields[0] === host &&
    /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521))$/.test(fields[1]) &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(fields[2]), 'HOST_BINDING_INVALID')
  const fingerprint = 'SHA256:' + createHash('sha256').update(Buffer.from(fields[2], 'base64')).digest('base64').replace(/=+$/, '')
  requireThat(fingerprint === env.PINNED_FINGERPRINT, 'HOST_FINGERPRINT_MISMATCH')
}

export function credentialFiles(env) {
  invocation(env)
  requireThat(typeof env.RUNNER_TEMP === 'string' && path.posix.isAbsolute(env.RUNNER_TEMP), 'RUNNER_TEMP_INVALID')
  // Runtime is Linux-only; keep Linux paths in Windows-hosted mock tests too.
  const prefix = path.posix.join(env.RUNNER_TEMP, `ecfc-mysql-metadata-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`)
  return { key: prefix + '.key', hosts: prefix + '.hosts' }
}

export function prepare(env, io = fs, uid = process.getuid?.(), platform = process.platform) {
  invocation(env)
  requireThat(platform === 'linux' && Number.isSafeInteger(uid), 'LINUX_RUNNER_REQUIRED')
  credentialShape(env)
  const temp = io.lstatSync(env.RUNNER_TEMP)
  requireThat(temp.isDirectory() && !temp.isSymbolicLink() && temp.uid === uid && !(temp.mode & 0o022), 'RUNNER_TEMP_UNSAFE')
  const files = credentialFiles(env)
  // Exclusive creation; no overwrite, symlink following or broader permissions.
  io.writeFileSync(files.key, env.SSH_KEY.replace(/\r/g, '') + '\n', { flag: 'wx', mode: 0o600 })
  io.writeFileSync(files.hosts, env.PINNED_HOSTS.trim() + '\n', { flag: 'wx', mode: 0o600 })
  for (const file of Object.values(files)) {
    const s = io.lstatSync(file)
    requireThat(s.isFile() && !s.isSymbolicLink() && s.uid === uid && (s.mode & 0o777) === 0o600, 'RUNNER_FILE_UNSAFE')
  }
  return { credentials: 'PREPARED_RUNNER_ONLY', releaseDecision: 'NO_GO' }
}

export function cleanup(env, io = fs) {
  for (const file of Object.values(credentialFiles(env))) {
    try { io.unlinkSync(file) } catch (e) { if (e?.code !== 'ENOENT') throw e }
  }
  return { credentials: 'CLEANED_RUNNER_ONLY', releaseDecision: 'NO_GO' }
}

export function sanitizedFailure(error) {
  return { status: 'FAIL', result: 'FAIL_CLOSED', reason: error instanceof SafeFailure ? error.code : 'RUNNER_OPERATION_UNAVAILABLE', releaseDecision: 'NO_GO' }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const mode = process.argv[2]
    requireThat(process.argv.length === 3 && ['guard', 'queue', 'prepare', 'cleanup'].includes(mode), 'MODE_INVALID')
    invocation(process.env)
    if (mode !== 'cleanup') {
      sourceGuard(fs.readFileSync(new URL('./mysql-client-metadata-check.sh', import.meta.url)))
    }
    let result = { status: 'PASS', scope: 'RUNNER_CONTROL_ONLY', releaseDecision: 'NO_GO' }
    if (mode === 'queue') result = await deploymentsClear(process.env)
    if (mode === 'prepare') result = prepare(process.env)
    if (mode === 'cleanup') result = cleanup(process.env)
    console.log(JSON.stringify(result))
  } catch (error) {
    console.log(JSON.stringify(sanitizedFailure(error)))
    process.exitCode = 1
  }
}
