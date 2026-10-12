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
  return { state: holders.length ? 'OCCUPIED' : 'NO_LOCK_OBSERVED', holders, scope: 'PROC_PID_NAMESPACE_SNAPSHOT' }
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

export function migrationRead(target, manifest, io) {
  try {
    const binary = io.stat('/usr/bin/mysql')
    const login = io.stat(path.posix.join(io.home, '.mylogin.cnf'))
    if (!binary.isFile() || binary.isSymbolicLink() || binary.uid !== 0 || (binary.mode & 0o022) ||
      !login.isFile() || login.isSymbolicLink() || login.uid !== io.uid || (login.mode & 0o077)) return { status: 'UNKNOWN', reason: 'SAFE_MYSQL_OR_EXISTING_LOGIN_PATH_UNAVAILABLE' }
    const env = { HOME: io.home, PATH: '/usr/bin:/bin', LANG: 'C' }
    const options = { encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024, env, shell: false }
    const version = io.run('/usr/bin/mysql', ['--no-defaults', '--version'], options)
    if (version.status !== 0 || version.error || !/\b(?:Ver|Distrib)\s+8\.(?:0|4)\./.test(version.stdout || '') || /MariaDB/i.test(version.stdout || '')) return { status: 'UNKNOWN', reason: 'MYSQL_IMPLEMENTATION_NOT_SUPPORTED' }
    const result = io.run('/usr/bin/mysql', mysqlArgs(target), options)
    if (result.status !== 0 || result.error) return { status: 'UNKNOWN', reason: 'READONLY_SELECT_OR_TLS_UNAVAILABLE' }
    return migrationState(manifest, result.stdout)
  } catch { return { status: 'UNKNOWN', reason: 'READONLY_DATABASE_UNAVAILABLE' } }
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

export function processSnapshots(io, release) {
  const rows = []
  let inaccessible = 0
  try {
    const pids = io.list('/proc').filter(value => /^[1-9][0-9]*$/.test(value))
    if (pids.length > 4096) return { state: 'UNKNOWN', reason: 'PROC_SCAN_LIMIT', rows }
    for (const pid of pids) {
      try {
        const env = envSubset(io.read('/proc/' + pid + '/environ'))
        if (!['easonfansclub', 'instagram-sync-worker'].includes(env.name) || !/^\d+$/.test(env.pm_id || '')) continue
        const cwdRaw = io.link('/proc/' + pid + '/cwd')
        const deleted = cwdRaw.endsWith(' (deleted)')
        const cwd = cwdRaw.replace(/ \(deleted\)$/, '')
        // Never print arbitrary environment values or a path outside the app.
        const safeCwd = /^\/home\/apps\/easonfansclub(?:\/[A-Za-z0-9._/-]+)?$/.test(cwd) ? cwd : 'UNKNOWN'
        rows.push({ name: env.name, pid: Number(pid), pmId: Number(env.pm_id), cwd: safeCwd, deleted,
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

export async function inspect(manifest, io) {
  validateManifest(manifest)
  const start = releaseSnapshot(io)
  let lock
  try { lock = lockObservation(io.stat(APP + '/.deploy.lock'), io.read('/proc/locks')) } catch { lock = { state: 'UNKNOWN' } }
  const processes = processSnapshots(io, start)
  let healthSha = 'UNKNOWN'
  try { healthSha = await io.health() } catch { /* no raw network errors */ }
  const rollback = rollbackSnapshot(io, start)
  let migrations = { status: 'UNKNOWN', reason: 'SAFE_EXISTING_DB_ACCESS_NOT_AVAILABLE' }
  try {
    if (rollback.state === 'PRESENT' && lock.state === 'NO_LOCK_OBSERVED') {
      migrations = migrationRead(databaseTarget(io.read(io.real(start.target + '/.env'))), manifest.migrations, io)
    }
  } catch { /* unknown, no credential/raw exception output */ }
  const end = releaseSnapshot(io)
  let lockEnd
  try { lockEnd = lockObservation(io.stat(APP + '/.deploy.lock'), io.read('/proc/locks')) } catch { lockEnd = { state: 'UNKNOWN' } }
  const stable = start.target !== 'UNKNOWN' && start.target === end.target && start.sha === end.sha
  const web = processes.rows.filter(row => row.name === 'easonfansclub')
  const webCwdMatch = web.length > 0 && web.every(row => row.cwd === start.target && !row.deleted && row.deploySha === start.sha)
  return { diagnostic: 'STRICT_READONLY_SNAPSHOT', expectedSha: manifest.expectedSha,
    current: start, localHealthSha: healthSha, markerHealthMatch: stable && healthSha === start.sha && start.sha === manifest.expectedSha,
    webCwdMatch: stable && processes.inaccessible === 0 && web.length > 0 ? webCwdMatch : 'UNKNOWN', snapshotStable: stable, snapshotAtomic: false,
    pm2WebStatus: 'UNKNOWN', pm2WorkerStatus: 'UNKNOWN', pm2Reason: 'PM2_CLI_AND_UNAUDITED_RPC_NOT_IN_READONLY_ALLOWLIST',
    processes, workerActiveTasks: 'UNKNOWN', lock, lockEnd, rollback, migrations,
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
