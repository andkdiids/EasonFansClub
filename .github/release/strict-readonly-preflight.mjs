import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

export const APP = '/home/apps/easonfansclub'
export const SELECT_MIGRATIONS = 'SELECT migration_name, checksum, (finished_at IS NOT NULL), (rolled_back_at IS NOT NULL), (started_at IS NOT NULL) FROM _prisma_migrations ORDER BY migration_name, id;'
const SHA = /^[0-9a-f]{40}$/
const HASH = /^[0-9a-f]{64}$/
const NAME = /^[0-9]{14}_[A-Za-z0-9_]+$/

export function validateManifest(value) {
  if (!value || value.app !== APP || !SHA.test(value.expectedSha) || !SHA.test(value.approvedSha) ||
    !Array.isArray(value.migrations) || value.migrations.length !== 171 ||
    new Set(value.migrations.map(row => row.name)).size !== 171 ||
    !value.migrations.every(row => NAME.test(row.name) && HASH.test(row.checksum))) throw new Error('MANIFEST_INVALID')
  return value
}

export function migrationState(manifest, text) {
  const expected = new Map(manifest.map(row => [row.name, row.checksum]))
  const rows = text.trim() ? text.trim().split(/\r?\n/).map(line => line.split('\t')) : []
  if (rows.length > 5000 || rows.some(row => row.length !== 5 || !NAME.test(row[0]) || !HASH.test(row[1]) || row.slice(2).some(value => !/^[01]$/.test(value)))) return { status: 'UNKNOWN', reason: 'MIGRATION_RESPONSE_INVALID' }
  const active = rows.filter(row => row[3] === '0')
  const applied = active.filter(row => row[2] === '1')
  const appliedNames = new Set(applied.map(row => row[0]))
  const failed = active.filter(row => row[2] === '0').length
  const unfinished = active.filter(row => row[2] === '0' || row[4] === '0').length
  const pending = [...expected.keys()].filter(name => !appliedNames.has(name)).length
  const divergence = applied.filter(row => expected.get(row[0]) !== row[1]).length
  const duplicates = rows.length - new Set(rows.map(row => row[0])).size
  const activeDuplicates = active.length - new Set(active.map(row => row[0])).size
  return { status: failed || unfinished ? 'FAILED' : divergence || activeDuplicates ? 'DIVERGENCE' : pending ? 'PENDING' : 'UP_TO_DATE',
    repo: expected.size, applied: appliedNames.size, pending, failed, unfinished, divergence, duplicates, activeDuplicates }
}

export function lockObservation(stat, text) {
  if (!stat || !stat.isFile() || stat.isSymbolicLink()) return { state: 'UNKNOWN', reason: 'LOCK_FILE_UNAVAILABLE' }
  if ([stat.dev, stat.ino].some(value => typeof value !== 'bigint' && !Number.isSafeInteger(value))) return { state: 'UNKNOWN', reason: 'LOCK_ID_PRECISION_UNKNOWN' }
  if (BigInt(stat.dev) < 0n || BigInt(stat.ino) <= 0n) return { state: 'UNKNOWN', reason: 'LOCK_ID_INVALID' }
  const dev = BigInt(stat.dev)
  const major = ((dev >> 8n) & 0xfffn) | ((dev >> 32n) & 0xfffff000n)
  const minor = (dev & 0xffn) | ((dev >> 12n) & 0xffffff00n)
  const holders = []
  for (const line of text.split('\n').filter(Boolean)) {
    const match = line.match(/^\d+:\s+(?:->\s+)?(FLOCK|POSIX|OFDLCK)\s+(?:ADVISORY|MANDATORY)\s+(READ|WRITE)\s+(-?\d+)\s+([0-9a-f]+):([0-9a-f]+):(\d+)\s+/i)
    if (!match) return { state: 'UNKNOWN', reason: 'LOCK_TABLE_FORMAT_UNKNOWN' }
    if (BigInt('0x' + match[4]) === major && BigInt('0x' + match[5]) === minor && BigInt(match[6]) === BigInt(stat.ino)) {
      holders.push({ type: match[1], access: match[2], pid: Number(match[3]) })
    }
  }
  // /proc/locks is namespace-filtered and this is a point-in-time observation,
  // not proof that an exclusive lock can be acquired or a future deploy is safe.
  return { state: holders.length ? 'OCCUPIED' : 'NO_LOCK_OBSERVED', holders,
    identity: { device: String(stat.dev), inode: String(stat.ino) }, scope: 'PROC_PID_NAMESPACE_SNAPSHOT' }
}

export function envSubset(raw) {
  const wanted = new Set(['name', 'pm_id', 'pm_cwd', 'DEPLOY_SHA'])
  const selected = {}
  for (const row of raw.split('\0')) {
    const index = row.indexOf('=')
    if (index > 0 && wanted.has(row.slice(0, index))) selected[row.slice(0, index)] = row.slice(index + 1)
  }
  return selected
}

export function databaseTarget(raw) {
  const lines = raw.split(/\r?\n/).filter(line => /^\s*DATABASE_URL\s*=/.test(line))
  if (lines.length !== 1) throw new Error('DATABASE_TARGET_UNKNOWN')
  let value = lines[0].slice(lines[0].indexOf('=') + 1).trim()
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
  const url = new URL(value)
  const database = decodeURIComponent(url.pathname.slice(1))
  if (url.protocol !== 'mysql:' || !/^[A-Za-z0-9._-]+$/.test(url.hostname) || !/^[A-Za-z0-9_]+$/.test(database) ||
    (url.port && !/^[0-9]{1,5}$/.test(url.port))) throw new Error('DATABASE_TARGET_UNKNOWN')
  return { host: url.hostname, port: url.port || '3306', database }
}

export function mysqlArgs(target) {
  // Existing login path only. Never create/configure it or expose credentials
  // through arguments, MYSQL_PWD, output, normal config files or client history.
  return ['--no-defaults', '--login-path=ecfc_readonly_preflight', '--batch', '--raw', '--skip-column-names', '--skip-syslog',
    '--connect-timeout=10', '--ssl-mode=VERIFY_IDENTITY', '--protocol=TCP', '--host=' + target.host, '--port=' + target.port,
    '--database=' + target.database, '--execute=' + SELECT_MIGRATIONS]
}

function metadataFailure(error, prefix) {
  // Never forward exception messages, paths or client output.
  return prefix + (error?.code === 'ENOENT' ? '_NOT_FOUND' :
    ['EACCES', 'EPERM'].includes(error?.code) ? '_ACCESS_DENIED' : '_UNAVAILABLE')
}

export function mysqlFailure(result, stage) {
  if (result.error?.code === 'ETIMEDOUT') return stage + '_TIMEOUT'
  if (result.error || result.status === null) return stage + '_EXECUTION_UNAVAILABLE'
  if (stage === 'MYSQL_VERSION') return 'MYSQL_CLIENT_VERSION_UNAVAILABLE'
  // Numeric MySQL error only; do not infer from arbitrary text containing a
  // credential/hostname, or export stderr, SQLSTATE or raw error messages.
  const code = String(result.stderr || '').match(/^ERROR ([0-9]{4})(?: \([A-Z0-9]{5}\))?:/m)?.[1]
  if (['2002', '2003', '2005', '2006', '2013'].includes(code)) return 'DATABASE_CONNECTION_FAILED'
  if (code === '2026') return 'DATABASE_TLS_FAILED'
  if (code === '1045') return 'DATABASE_AUTH_FAILED'
  if (code === '1044') return 'DATABASE_ACCESS_DENIED'
  if (['1049', '1054', '1064', '1142', '1146'].includes(code)) return 'FIXED_SELECT_FAILED'
  return 'DATABASE_QUERY_FAILURE_UNCLASSIFIED'
}

export function migrationRead(target, manifest, io) {
  const unknown = reason => ({ status: 'UNKNOWN', reason,
    loginPathConfigured: 'UNKNOWN' }) // private file exists != named login group exists
  let binary, login
  try { binary = io.stat('/usr/bin/mysql') } catch (error) { return unknown(metadataFailure(error, 'MYSQL_CLIENT')) }
  if (!binary.isFile() || binary.isSymbolicLink() || binary.uid !== 0 || (binary.mode & 0o022)) return unknown('MYSQL_CLIENT_UNSAFE')
  if (!/^\/[A-Za-z0-9._/-]+$/.test(io.home) || io.uid < 0) return unknown('MYSQL_LOGIN_LOCATION_UNKNOWN')
  try { login = io.stat(path.posix.join(io.home, '.mylogin.cnf')) } catch (error) { return unknown(metadataFailure(error, 'MYSQL_LOGIN_CONFIG')) }
  if (!login.isFile() || login.isSymbolicLink() || login.uid !== io.uid || !(login.mode & 0o400) || (login.mode & 0o077)) return unknown('MYSQL_LOGIN_PERMISSIONS_UNSAFE')
  try {
    const env = { HOME: io.home, PATH: '/usr/bin:/bin', LANG: 'C' }
    const options = { encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024, env, shell: false }
    const version = io.run('/usr/bin/mysql', ['--no-defaults', '--version'], options)
    if (version.status !== 0 || version.error) return unknown(mysqlFailure(version, 'MYSQL_VERSION'))
    if (!/\b(?:Ver|Distrib)\s+8\.(?:0|4)\./.test(version.stdout || '') || /MariaDB/i.test(version.stdout || '')) return unknown('MYSQL_CLIENT_VERSION_UNSUPPORTED')
    const result = io.run('/usr/bin/mysql', mysqlArgs(target), options)
    if (result.status !== 0 || result.error) return unknown(mysqlFailure(result, 'FIXED_SELECT'))
    return migrationState(manifest, result.stdout)
  } catch { return unknown('MYSQL_CLIENT_EXECUTION_UNAVAILABLE') }
}

export function makeReadIO() {
  return {
    stat: value => fs.lstatSync(value, { bigint: false }),
    real: value => fs.realpathSync(value),
    link: value => fs.readlinkSync(value),
    list: value => fs.readdirSync(value),
    read: value => {
      const stat = fs.lstatSync(value)
      if (stat.size > 1024 * 1024) throw new Error('READ_LIMIT')
      const raw = fs.readFileSync(value)
      if (raw.length > 1024 * 1024) throw new Error('READ_LIMIT')
      return raw.toString('utf8')
    },
    run: (binary, args, options) => spawnSync(binary, args, options),
    now: () => new Date().toISOString(),
    home: process.env.HOME || '', uid: process.getuid?.() ?? -1,
    health: async () => {
      const response = await fetch('http://127.0.0.1:3000/api/health/live', { redirect: 'error', signal: AbortSignal.timeout(10000) })
      const text = await response.text()
      if (text.length > 16384) throw new Error('HEALTH_LIMIT')
      const data = JSON.parse(text)
      return response.ok && data.ok === true && SHA.test(data.release) ? data.release : 'UNKNOWN'
    },
  }
}

export function releaseSnapshot(io) {
  try {
    const link = APP + '/current'
    if (!io.stat(link).isSymbolicLink()) throw new Error('NOT_SYMLINK')
    const target = io.real(link)
    if (!/^\/home\/apps\/easonfansclub\/releases\/[A-Za-z0-9._-]+$/.test(target)) throw new Error('OUTSIDE_RELEASES')
    const sha = io.read(target + '/.deployed-sha').trim()
    if (!SHA.test(sha)) throw new Error('MARKER_INVALID')
    return { target, sha }
  } catch { return { target: 'UNKNOWN', sha: 'UNKNOWN' } }
}

export function rollbackSnapshot(io, release) {
  if (release.target === 'UNKNOWN') return { state: 'UNKNOWN' }
  try {
    const missing = []
    for (const file of ['package.json', 'ecosystem.config.js', '.next/BUILD_ID', 'node_modules/@prisma/client/package.json', 'node_modules/dotenv/package.json']) {
      const stat = io.stat(io.real(release.target + '/' + file))
      if (!stat.isFile() || stat.size <= 0) missing.push(file)
    }
    const envTarget = io.real(release.target + '/.env')
    if (envTarget !== io.real(APP + '/shared/.env') || !io.stat(envTarget).isFile()) missing.push('.env')
    return { state: missing.length ? 'INCOMPLETE' : 'PRESENT', target: release.target, sha: release.sha, missing }
  } catch { return { state: 'UNKNOWN', target: release.target, sha: release.sha } }
}

export function processStartTicks(text, pid) {
  // comm (field 2) can contain spaces and parentheses. Only export field 22,
  // Linux clock ticks since boot, not the command name or the remaining stat.
  const close = text.lastIndexOf(')')
  if (!text.startsWith(pid + ' (') || close < 0) return 'UNKNOWN'
  const fields = text.slice(close + 1).trim().split(/\s+/)
  return fields.length >= 20 && /^[A-Za-z]$/.test(fields[0]) && /^[0-9]+$/.test(fields[19]) ? fields[19] : 'UNKNOWN'
}

export function processSnapshots(io, release) {
  const rows = []
  let inaccessible = 0
  try {
    const pids = io.list('/proc').filter(value => /^[1-9][0-9]*$/.test(value))
    if (pids.length > 4096) return { state: 'UNKNOWN', reason: 'PROC_SCAN_LIMIT', rows }
    for (const pid of pids) {
      try {
        let startTicks = 'UNKNOWN', endTicks = 'UNKNOWN'
        try { startTicks = processStartTicks(io.read('/proc/' + pid + '/stat'), pid) } catch { /* unknown identity */ }
        const env = envSubset(io.read('/proc/' + pid + '/environ'))
        if (!['easonfansclub', 'instagram-sync-worker'].includes(env.name) || !/^\d+$/.test(env.pm_id || '')) continue
        const cwdRaw = io.link('/proc/' + pid + '/cwd')
        const deleted = cwdRaw.endsWith(' (deleted)')
        const cwd = cwdRaw.replace(/ \(deleted\)$/, '')
        // Never print arbitrary environment values or a path outside the app.
        const safeCwd = /^\/home\/apps\/easonfansclub(?:\/[A-Za-z0-9._/-]+)?$/.test(cwd) ? cwd : 'UNKNOWN'
        try { endTicks = processStartTicks(io.read('/proc/' + pid + '/stat'), pid) } catch { /* unknown identity */ }
        rows.push({ name: env.name, pid: Number(pid), pmId: Number(env.pm_id), cwd: safeCwd, deleted,
          startTicks, identityStable: startTicks === 'UNKNOWN' || endTicks === 'UNKNOWN' ? 'UNKNOWN' : startTicks === endTicks,
          currentRelease: release.target === 'UNKNOWN' ? 'UNKNOWN' : safeCwd === release.target,
          olderRelease: release.target === 'UNKNOWN' || safeCwd === 'UNKNOWN' ? 'UNKNOWN' : safeCwd !== release.target,
          deploySha: SHA.test(env.DEPLOY_SHA || '') ? env.DEPLOY_SHA : 'UNKNOWN',
          configuredCwd: /^\/home\/apps\/easonfansclub(?:\/[A-Za-z0-9._/-]+)?$/.test(env.pm_cwd || '') ? env.pm_cwd : 'UNKNOWN',
          configuredCwdMatchesCurrent: env.pm_cwd === APP + '/current', evidence: 'PROC_ENV_LABEL_NOT_LIVE_PM2_RPC' })
        if (rows.length > 32) return { state: 'UNKNOWN', reason: 'AMBIGUOUS_PROCESS_COUNT', rows: [] }
      } catch { inaccessible++ }
    }
    return { state: 'OBSERVED_OS_PROCESSES', inaccessible, rows }
  } catch { return { state: 'UNKNOWN', reason: 'PROC_UNAVAILABLE', rows } }
}

function windowTime(io) {
  try {
    const value = io.now()
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
      Number.isFinite(Date.parse(value)) ? value : 'UNKNOWN'
  } catch { return 'UNKNOWN' }
}

async function sample(io) {
  const current = releaseSnapshot(io)
  let lock
  try { lock = lockObservation(io.stat(APP + '/.deploy.lock'), io.read('/proc/locks')) } catch { lock = { state: 'UNKNOWN' } }
  const processes = processSnapshots(io, current)
  let healthSha = 'UNKNOWN'
  try { const value = await io.health(); if (SHA.test(value)) healthSha = value } catch { /* no raw errors */ }
  return { current, lock, processes, healthSha }
}

export function sampleConsistency(first, last, startedAt, endedAt) {
  const changed = [], unknown = []
  const compare = (name, a, b, available) => {
    if (!available) unknown.push(name)
    else if (JSON.stringify(a) !== JSON.stringify(b)) changed.push(name)
  }
  // Missing/invalid evidence is UNKNOWN, not agreement between identical gaps.
  const knownRelease = current => typeof current?.target === 'string' &&
    /^\/home\/apps\/easonfansclub\/releases\/[A-Za-z0-9._-]+$/.test(current.target) &&
    !['.', '..'].includes(path.posix.basename(current.target)) && typeof current.sha === 'string' && SHA.test(current.sha)
  compare('CURRENT_RELEASE', first.current, last.current, [first, last].every(s => knownRelease(s.current)))
  compare('HEALTH_SHA', first.healthSha, last.healthSha, [first, last].every(s => s.healthSha !== 'UNKNOWN'))
  const lockView = lock => ({ state: lock.state, identity: lock.identity,
    holders: [...(lock.holders || [])].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) })
  const knownLock = lock => ['OCCUPIED', 'NO_LOCK_OBSERVED'].includes(lock.state) &&
    typeof lock.identity?.device === 'string' && /^(?:0|[1-9][0-9]*)$/.test(lock.identity.device) &&
    typeof lock.identity?.inode === 'string' && /^[1-9][0-9]*$/.test(lock.identity.inode)
  compare('DEPLOY_LOCK', lockView(first.lock), lockView(last.lock), [first, last].every(s => knownLock(s.lock)))
  const processView = processes => [...processes.rows].sort((a, b) => a.pid - b.pid)
  compare('OBSERVED_PROCESSES', processView(first.processes), processView(last.processes),
    [first, last].every(s => s.processes.state === 'OBSERVED_OS_PROCESSES'))
  for (const s of [first, last]) {
    if (s.processes.inaccessible > 0 || s.processes.rows.length === 0 ||
      s.processes.rows.some(row => row.identityStable === 'UNKNOWN' || row.cwd === 'UNKNOWN')) unknown.push('PROCESS_COVERAGE')
    if (s.processes.rows.some(row => row.identityStable === false)) changed.push('PROCESS_IDENTITY_WITHIN_SAMPLE')
  }
  const durationMs = startedAt === 'UNKNOWN' || endedAt === 'UNKNOWN' ? 'UNKNOWN' : Date.parse(endedAt) - Date.parse(startedAt)
  if (durationMs === 'UNKNOWN') unknown.push('CHECK_WINDOW_CLOCK')
  else if (durationMs < 0) changed.push('CLOCK_MOVED_BACKWARDS')
  return { state: changed.length ? 'UNSTABLE' : unknown.length ? 'UNKNOWN' : 'REPEATED_SAMPLES_MATCH',
    changed: [...new Set(changed)], unknown: [...new Set(unknown)], startedAt, endedAt, durationMs,
    scope: 'ENDPOINT_SAMPLES_NOT_CONTINUOUS', atomic: false }
}

export async function inspect(manifest, io) {
  validateManifest(manifest)
  const startedAt = windowTime(io)
  const first = await sample(io)
  const { current: start, lock, processes, healthSha } = first
  const rollback = rollbackSnapshot(io, start)
  let migrations = { status: 'UNKNOWN', reason: rollback.state !== 'PRESENT' ? 'DATABASE_CHECK_SKIPPED_ROLLBACK_UNVERIFIED' : 'DATABASE_CHECK_SKIPPED_LOCK_NOT_CLEAR' }
  try {
    if (rollback.state === 'PRESENT' && lock.state === 'NO_LOCK_OBSERVED') {
      migrations = migrationRead(databaseTarget(io.read(io.real(start.target + '/.env'))), manifest.migrations, io)
    }
  } catch { migrations = { status: 'UNKNOWN', reason: 'DATABASE_CONFIGURATION_UNAVAILABLE' } }
  const last = await sample(io)
  const consistency = sampleConsistency(first, last, startedAt, windowTime(io))
  const stable = consistency.state === 'REPEATED_SAMPLES_MATCH'
  const web = processes.rows.filter(row => row.name === 'easonfansclub')
  const webCwdMatch = web.length > 0 && web.every(row => row.cwd === start.target && !row.deleted && row.deploySha === start.sha)
  // Preserve independent SHA evidence even when /proc visibility is incomplete.
  // This is endpoint agreement only, not proof of an atomic/stable whole snapshot.
  const markerHealthMatch = start.sha !== 'UNKNOWN' && start.sha === manifest.expectedSha &&
    start.target === last.current.target && start.sha === last.current.sha && healthSha === start.sha && last.healthSha === start.sha
  return { diagnostic: 'STRICT_READONLY_SNAPSHOT', expectedSha: manifest.expectedSha,
    current: start, localHealthSha: healthSha, markerHealthMatch,
    webCwdMatch: stable && processes.inaccessible === 0 && web.length > 0 ? webCwdMatch : 'UNKNOWN',
    snapshotStable: consistency.state === 'UNKNOWN' ? 'UNKNOWN' : stable, snapshotAtomic: false, consistency,
    pm2WebStatus: 'UNKNOWN', pm2WorkerStatus: 'UNKNOWN', pm2Reason: 'PM2_CLI_AND_UNAUDITED_RPC_NOT_IN_READONLY_ALLOWLIST',
    processes, workerActiveTasks: 'UNKNOWN', workerSafeToReload: 'UNKNOWN',
    workerObservability: { lease: 'NOT_QUERIED', runningLogs: 'NOT_QUERIED',
      reason: 'LEASE_AND_RUNNING_LOGS_DO_NOT_PROVE_ACTUAL_INFLIGHT_TASKS' },
    lock, lockEnd: last.lock, endSample: last, rollback, migrations,
    releaseDecision: 'NO_GO_UNTIL_UNKNOWN_PM2_AND_OTHER_CRITICAL_CHECKS_RESOLVED' }
}

// Only stdin streaming invokes production inspection; importing for local
// tests never touches the host or opens a database connection.
if (process.argv[1] === '-' && process.argv[2]) {
  try {
    const encoded = process.argv[2]
    if (!/^[A-Za-z0-9+/=]{1,65536}$/.test(encoded)) throw new Error('MANIFEST_INVALID')
    const manifest = validateManifest(JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')))
    const result = await inspect(manifest, makeReadIO())
    console.log('STRICT_PREFLIGHT=' + JSON.stringify(result))
  } catch {
    console.log('STRICT_PREFLIGHT={"diagnostic":"UNKNOWN","reason":"SANITIZED_DIAGNOSTIC_FAILURE"}')
    process.exitCode = 1
  }
}
