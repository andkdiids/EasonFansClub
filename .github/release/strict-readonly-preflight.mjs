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

// Only a generated release Client, never the app singleton, CLI, dotenv loader,
// adapter or Prisma extension. Credentials remain inside the isolated child.
export function prismaDatabaseUrl(raw) {
  const lines = raw.split(/\r?\n/).filter(line => /^\s*DATABASE_URL\s*=/.test(line))
  if (lines.length !== 1) throw new Error('PRISMA_CONFIGURATION_INVALID')
  let value = lines[0].slice(lines[0].indexOf('=') + 1).trim()
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
  const url = new URL(value)
  if (url.protocol !== 'mysql:' || !/^[A-Za-z0-9._-]+$/.test(url.hostname) ||
    !/^[A-Za-z0-9_]+$/.test(decodeURIComponent(url.pathname.slice(1))) || !url.username || !url.password ||
    url.hash || (url.port && (Number(url.port) < 1 || Number(url.port) > 65535))) throw new Error('PRISMA_CONFIGURATION_INVALID')
  const allowed = new Set(['sslaccept', 'sslcert', 'connect_timeout', 'pool_timeout', 'socket_timeout',
    'connection_limit', 'statement_cache_size', 'prefer_socket'])
  const seen = new Set()
  for (const [key, v] of url.searchParams) {
    if (!allowed.has(key) || seen.has(key)) throw new Error('PRISMA_CONFIGURATION_UNSUPPORTED')
    seen.add(key)
    if (!['sslaccept', 'sslcert', 'prefer_socket'].includes(key) && !/^[0-9]+$/.test(v)) throw new Error('PRISMA_CONFIGURATION_INVALID')
  }
  const ca = url.searchParams.get('sslcert')
  if (ca && !['/etc/ssl/certs/ca-certificates.crt', '/home/apps/easonfansclub/shared/database-ca.pem'].includes(ca)) throw new Error('PRISMA_CA_LOCATION_UNAPPROVED')
  // Strengthen this connection only. Never persist or inherit insecure options.
  // Audited Prisma 6.19 native MySQL: strict enables TLS + cert/domain validation.
  url.searchParams.set('sslaccept', 'strict')
  url.searchParams.set('prefer_socket', 'false')
  url.searchParams.set('connection_limit', '1')
  url.searchParams.set('connect_timeout', '5')
  url.searchParams.set('pool_timeout', '5')
  url.searchParams.set('socket_timeout', '10')
  url.searchParams.set('statement_cache_size', '0')
  return { url: url.toString(), ca }
}

export function prismaFailure(error) {
  // Do not serialize error messages, metadata, stack, stdout or stderr.
  const codes = { P1000: 'AUTH_FAILED', P1001: 'CONNECTION_FAILED', P1002: 'TIMEOUT',
    P1011: 'TLS_FAILED', P2024: 'TIMEOUT', P2010: 'FIXED_SELECT_FAILED' }
  return 'PRISMA_' + (codes[error?.code] || 'QUERY_UNAVAILABLE')
}

export function trustedParents(file, io) {
  let dir = '/'
  for (const segment of path.posix.dirname(file).split('/').filter(Boolean)) {
    dir = path.posix.join(dir, segment)
    const s = io.stat(dir)
    if (!s.isDirectory() || s.isSymbolicLink() || ![0, io.uid].includes(s.uid) || (s.mode & 0o022)) throw new Error('UNTRUSTED_PARENT')
  }
}

export function prismaRowsToTsv(rows) {
  if (!Array.isArray(rows) || rows.length > 5000) throw new Error('PRISMA_RESPONSE_INVALID')
  return rows.map(row => {
    if (!row || !NAME.test(row.migration_name) || !HASH.test(row.checksum)) throw new Error('PRISMA_RESPONSE_INVALID')
    const flags = ['finished', 'rolled_back', 'started'].map(key => {
      const v = row[key]
      if (![0, 1, 0n, 1n, false, true].includes(v)) throw new Error('PRISMA_RESPONSE_INVALID')
      return Number(v)
    })
    return [row.migration_name, row.checksum, ...flags].join('\t')
  }).join('\n')
}

export async function queryReleaseLedger(release, io, loadClient) {
  let db
  let stage = 'PRISMA_RELEASE_METADATA_UNAVAILABLE'
  const unknown = reason => ({ status: 'UNKNOWN', reason })
  try {
    if (!/^\/home\/apps\/easonfansclub\/releases\/[A-Za-z0-9._-]+$/.test(release) ||
      ['.', '..'].includes(path.posix.basename(release))) return unknown('PRISMA_RELEASE_INVALID')
    const safe = (file, privateFile = false) => {
      trustedParents(file, io)
      const s = io.stat(file)
      if (!s.isFile() || s.isSymbolicLink() || ![0, io.uid].includes(s.uid) ||
        (s.mode & (privateFile ? 0o077 : 0o022)) || !(s.mode & 0o400) || s.size <= 0) throw new Error('UNSAFE')
    }
    // .env is the already existing shared file; no config initialization.
    stage = 'PRISMA_ENV_METADATA_UNSAFE_OR_UNAVAILABLE'
    trustedParents(release + '/.env', io)
    trustedParents(APP + '/shared/.env', io)
    const envFile = io.real(release + '/.env')
    if (envFile !== APP + '/shared/.env') return unknown('PRISMA_ENV_LOCATION_UNAPPROVED')
    safe(envFile, true)
    stage = 'PRISMA_CONFIGURATION_UNAVAILABLE_OR_UNSUPPORTED'
    const config = prismaDatabaseUrl(io.read(envFile))
    stage = 'PRISMA_CA_METADATA_UNSAFE_OR_UNAVAILABLE'
    if (config.ca) { if (io.real(config.ca) !== config.ca) return unknown('PRISMA_CA_UNSAFE'); safe(config.ca) }
    stage = 'PRISMA_CLIENT_METADATA_UNSAFE_OR_UNAVAILABLE'
    const packageFile = io.real(release + '/node_modules/@prisma/client/package.json')
    if (!packageFile.startsWith(release + '/node_modules/')) return unknown('PRISMA_CLIENT_OUTSIDE_RELEASE')
    safe(packageFile)
    const pkg = JSON.parse(io.read(packageFile))
    if (pkg.name !== '@prisma/client' || pkg.version !== '6.19.3') return unknown('PRISMA_CLIENT_VERSION_UNAUDITED')
    stage = 'PRISMA_CLIENT_LOAD_UNAVAILABLE'
    const client = loadClient(release)
    if (client.Prisma?.prismaVersion?.client !== '6.19.3' || client.Prisma?.prismaVersion?.engine !== 'c2990dca591cba766e3b7ef5d9e8a84796e47ab7') return unknown('PRISMA_GENERATED_CLIENT_UNAUDITED')
    stage = 'PRISMA_CLIENT_INITIALIZATION_UNAVAILABLE'
    db = new client.PrismaClient({ log: [], errorFormat: 'minimal', datasources: { db: { url: config.url } } })
    // Exactly one fixed application SELECT. No transaction/SET/DDL/DML API.
    stage = 'PRISMA_FIXED_SELECT_UNAVAILABLE'
    const rows = await db.$queryRaw`SELECT migration_name, checksum, (finished_at IS NOT NULL) AS finished, (rolled_back_at IS NOT NULL) AS rolled_back, (started_at IS NOT NULL) AS started FROM _prisma_migrations ORDER BY migration_name, id LIMIT 5001`
    stage = 'PRISMA_RESPONSE_INVALID'
    return { status: 'READ', tsv: prismaRowsToTsv(rows), backend: 'EXISTING_PRISMA_CLIENT', tls: 'STRICT_CERT_AND_DOMAIN' }
  } catch (error) {
    const reason = prismaFailure(error)
    return unknown(reason === 'PRISMA_QUERY_UNAVAILABLE' ? stage : reason)
  } finally {
    if (db) { try { await db.$disconnect() } catch { /* never emit engine errors */ } }
  }
}

// stdin-only child source: bounded lifetime, clean environment and all engine
// logs captured/discarded. No password in argv, process environment or output.
export function prismaChildSource() {
  return `import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module';
const APP=${JSON.stringify(APP)}, NAME=${NAME}, HASH=${HASH};
${prismaDatabaseUrl.toString()}
${prismaFailure.toString()}
${trustedParents.toString()}
${prismaRowsToTsv.toString()}
${queryReleaseLedger.toString()}
const io={uid:process.getuid(),stat:p=>fs.lstatSync(p),real:p=>fs.realpathSync(p),read:p=>{const s=fs.lstatSync(p);if(s.size>1048576)throw Error('LIMIT');return fs.readFileSync(p,'utf8')}};
const result=await queryReleaseLedger(process.argv[2],io,p=>createRequire(p+'/package.json')(p+'/node_modules/@prisma/client'));
process.stdout.write('PRISMA_LEDGER='+JSON.stringify(result)+'\\n');`
}

export function prismaMigrationRead(release, manifest, io) {
  const unknown = reason => ({ status: 'UNKNOWN', reason, backend: 'EXISTING_PRISMA_CLIENT' })
  try {
    const result = io.run('/usr/bin/node', ['--input-type=module', '-', release], {
      input: prismaChildSource(), encoding: 'utf8', timeout: 25000, maxBuffer: 1024 * 1024, shell: false,
      env: { HOME: io.home, PATH: '/usr/bin:/bin', LANG: 'C', NODE_ENV: 'production', PRISMA_HIDE_UPDATE_MESSAGE: '1' },
    })
    if (result?.error?.code === 'ETIMEDOUT') return unknown('PRISMA_CHILD_TIMEOUT')
    if (result?.error || result?.status !== 0) return unknown('PRISMA_CHILD_UNAVAILABLE')
    const lines = String(result.stdout).trim().split(/\r?\n/)
    if (lines.length !== 1 || !lines[0].startsWith('PRISMA_LEDGER=')) return unknown('PRISMA_CHILD_OUTPUT_INVALID')
    const value = JSON.parse(lines[0].slice(14))
    if (value.status === 'UNKNOWN' && /^PRISMA_[A-Z_]+$/.test(value.reason)) return unknown(value.reason)
    if (value.status !== 'READ' || typeof value.tsv !== 'string' || value.backend !== 'EXISTING_PRISMA_CLIENT' || value.tls !== 'STRICT_CERT_AND_DOMAIN') return unknown('PRISMA_CHILD_OUTPUT_INVALID')
    return { ...migrationState(manifest, value.tsv), backend: value.backend, tls: value.tls,
      applicationSql: 'FIXED_SELECT_ONLY', sessionSideEffects: 'CONNECTION_AND_DRIVER_INITIALIZATION_NOT_ZERO_SYSTEM_EFFECTS' }
  } catch { return unknown('PRISMA_CHILD_OUTPUT_INVALID') }
}

export function targetProcessEvidence(first, last) {
  const names = ['easonfansclub', 'instagram-sync-worker']
  return Object.fromEntries(names.map(name => {
    const a = first.processes.rows.filter(row => row.name === name)
    const b = last.processes.rows.filter(row => row.name === name)
    const valid = rows => rows.length > 0 && rows.every(r => r.identityStable === true && !r.deleted &&
      /^[0-9]+$/.test(r.startTicks) && r.cwd !== 'UNKNOWN')
    const view = rows => rows.map(r => [r.pid, r.startTicks, r.cwd]).sort((x,y) => x[0]-y[0])
    return [name, { state: !valid(a) || !valid(b) ? 'UNKNOWN' :
      JSON.stringify(view(a)) === JSON.stringify(view(b)) ? 'TARGET_ENDPOINTS_MATCH' : 'UNSTABLE',
      scope: 'OBSERVED_LABELLED_PROCESSES_ONLY_NOT_GLOBAL_COVERAGE_OR_PM2_STATUS', atomic: false, continuous: false }]
  }))
}

export function pm2DaemonEvidence(io) {
  // Metadata only. No PM2 require/connect/CLI/RPC: these may start a daemon.
  // A live daemon is still not evidence that either application is ONLINE.
  try {
    if (!/^\/home\/[A-Za-z0-9._/-]+$/.test(io.home) || io.home.includes('/../')) throw new Error('HOME')
    const base = io.home + '/.pm2'
    trustedParents(base + '/pm2.pid', io)
    const pidFile = io.stat(base + '/pm2.pid'), socket = io.stat(base + '/rpc.sock')
    if (!pidFile.isFile() || pidFile.isSymbolicLink() || pidFile.uid !== io.uid || (pidFile.mode & 0o022) ||
      !socket.isSocket() || socket.isSymbolicLink() || socket.uid !== io.uid || (socket.mode & 0o022)) throw new Error('METADATA')
    const pid = io.read(base + '/pm2.pid').trim()
    if (!/^[1-9][0-9]{0,8}$/.test(pid)) throw new Error('PID')
    const ticks = processStartTicks(io.read('/proc/' + pid + '/stat'), pid)
    return { state: ticks === 'UNKNOWN' ? 'UNKNOWN' : 'EXISTING_DAEMON_METADATA', pid: Number(pid), startTicks: ticks,
      applicationStatus: 'UNKNOWN', rpcAttempted: false, reason: 'EXACT_PM2_RPC_IMPLEMENTATION_NOT_PINNED_OR_AUDITED' }
  } catch { return { state: 'UNKNOWN', applicationStatus: 'UNKNOWN', rpcAttempted: false,
    reason: 'PM2_DAEMON_METADATA_UNAVAILABLE_NO_AUTO_START' } }
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
    databaseBackend: 'PRISMA',
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
  if (io.databaseBackend === 'PRISMA' && rollback.state === 'PRESENT' && lock.state === 'NO_LOCK_OBSERVED' &&
    (start.sha !== manifest.expectedSha || healthSha !== start.sha)) {
    migrations.reason = 'DATABASE_CHECK_SKIPPED_RUNTIME_IDENTITY_UNVERIFIED'
  }
  try {
    if (rollback.state === 'PRESENT' && lock.state === 'NO_LOCK_OBSERVED' &&
      (io.databaseBackend !== 'PRISMA' || (start.sha === manifest.expectedSha && healthSha === start.sha))) {
      // Existing mock/legacy CLI capability remains testable. Production IO
      // explicitly chooses the generated Client, never silently installs CLI.
      migrations = io.databaseBackend === 'PRISMA' ? prismaMigrationRead(start.target, manifest.migrations, io) :
        migrationRead(databaseTarget(io.read(io.real(start.target + '/.env'))), manifest.migrations, io)
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
    targetProcessEvidence: targetProcessEvidence(first, last),
    pm2DaemonEvidence: pm2DaemonEvidence(io),
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
