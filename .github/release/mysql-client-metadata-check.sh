# LOCAL REVIEW ONLY: NOT APPROVED FOR REAL SSH OR PRODUCTION EXECUTION.
# Metadata results are non-atomic; no mysql/version/SQL/PM2 invocation.
set -euo pipefail
set +x

stop() { printf '{"status":"FAIL","result":"FAIL_CLOSED","reason":"%s","releaseDecision":"NO_GO"}\n' "$1"; exit 1; }

[[ "${SSH_HOST:-}" =~ ^[A-Za-z0-9._-]+$ ]] ||
  stop CONFIG_UNAVAILABLE
[[ "${SSH_USER:-}" =~ ^[A-Za-z_][A-Za-z0-9_-]*$ ]] ||
  stop CONFIG_UNAVAILABLE
[[ "${SSH_PORT:-}" =~ ^[1-9][0-9]{0,4}$ ]] ||
  stop CONFIG_UNAVAILABLE
(( SSH_PORT <= 65535 )) || stop CONFIG_UNAVAILABLE
[[ -n "${KEY_FILE:-}" && -n "${HOSTS_FILE:-}" &&
   "${PINNED_FINGERPRINT:-}" =~ ^SHA256:[A-Za-z0-9+/]+=?$ ]] ||
  stop CONFIG_UNAVAILABLE

export SSH_HOST SSH_USER SSH_PORT
export KEY_FILE HOSTS_FILE PINNED_FINGERPRINT

# 只读取本地私钥文件元数据及公开 known_hosts 内容。
# 不读取或打印私钥内容。
if ! node --input-type=module - 2>/dev/null <<'CHECK_PIN'
import fs from 'node:fs'

try {
  for (const name of ['KEY_FILE', 'HOSTS_FILE']) {
    const s = fs.lstatSync(process.env[name])
    if (!s.isFile() || s.isSymbolicLink() ||
        s.uid !== process.getuid() || (s.mode & 0o077)) {
      throw new Error()
    }
  }

  const lines = fs.readFileSync(process.env.HOSTS_FILE, 'utf8')
    .trim().split(/\r?\n/)
  const expected = process.env.SSH_PORT === '22'
    ? process.env.SSH_HOST
    : `[${process.env.SSH_HOST}]:${process.env.SSH_PORT}`
  const fields = lines.length === 1 ? lines[0].split(/\s+/) : []

  if (fields.length !== 3 || fields[0] !== expected ||
      !/^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521))$/.test(fields[1]) ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(fields[2])) {
    throw new Error()
  }
} catch {
  process.exitCode = 1
}
CHECK_PIN
then
  stop LOCAL_CREDENTIAL_OR_HOST_PIN_INVALID
fi

actual_fingerprint="$(
  ssh-keygen -lf "$HOSTS_FILE" -E sha256 2>/dev/null |
  awk '{print $2}'
)" || stop HOST_PIN_UNAVAILABLE

[[ "$actual_fingerprint" == "$PINNED_FINGERPRINT" ]] ||
  stop HOST_PIN_MISMATCH

# 沿用现有诊断的固定 Node 路径和最小远端环境。
remote_command='test -f /usr/bin/node &&
test ! -L /usr/bin/node || exit 1;
node_meta=$(/usr/bin/stat -c "%u:%a" /usr/bin/node) || exit 1;
case "$node_meta" in 0:555|0:755) ;; *) exit 1;; esac;
exec /usr/bin/env -i PATH=/usr/bin:/bin HOME="$HOME" LANG=C
/usr/bin/node --input-type=module -'
remote_command="${remote_command//$'\n'/ }"

# stdout 先保留在执行端内存，不直接打印未经检查的 SSH 输出。
if ! METADATA_RESULT="$(
  timeout --foreground --signal=TERM --kill-after=5s 45s \
    ssh -F /dev/null -T \
      -i "$KEY_FILE" -p "$SSH_PORT" \
      -o BatchMode=yes \
      -o IdentitiesOnly=yes \
      -o IdentityAgent=none \
      -o PasswordAuthentication=no \
      -o KbdInteractiveAuthentication=no \
      -o ConnectTimeout=20 \
      -o StrictHostKeyChecking=yes \
      -o UserKnownHostsFile="$HOSTS_FILE" \
      -o GlobalKnownHostsFile=/dev/null \
      -o UpdateHostKeys=no \
      -o ControlMaster=no \
      -o ControlPath=none \
      -o ControlPersist=no \
      -o ForwardAgent=no \
      -o ClearAllForwardings=yes \
      "$SSH_USER@$SSH_HOST" "$remote_command" \
      2>/dev/null <<'REMOTE_NODE'
import fs from 'node:fs'
import path from 'node:path'

const clients = ['/usr/bin/mysql', '/usr/local/bin/mysql', '/bin/mysql']
const parentPaths = ['/', '/usr', '/usr/bin', '/usr/local', '/usr/local/bin', '/bin']
const clientSet = new Set(clients)
const parentSet = new Set(parentPaths)
const parentRows = new Map()
const uid = process.getuid()

function classify(e) {
  if (e?.code === 'ENOENT') return 'NOT_FOUND'
  if (['EACCES', 'EPERM'].includes(e?.code)) return 'ACCESS_DENIED'
  if (e?.code === 'EIO') return 'IO_ERROR'
  return ['OUTSIDE_SCOPE', 'SYMLINK_LIMIT', 'PATH_CHANGED', 'PARENT_CHANGED',
    'INVALID_METADATA', 'HOME_UNVERIFIED'].includes(e?.code) ? e.code : 'METADATA_UNAVAILABLE'
}
function stop(code) { throw Object.assign(new Error(), { code }) }
function integer(value) {
  const n = typeof value === 'bigint' ? Number(value) : value
  if (!Number.isSafeInteger(n) || n < 0) stop('INVALID_METADATA')
  return n
}
function meta(s) {
  const identity = {}
  for (const field of ['dev', 'ino']) {
    if (typeof s[field] !== 'bigint' && !Number.isSafeInteger(s[field])) stop('INVALID_METADATA')
    const n = BigInt(s[field])
    if (n < 0n || (field === 'ino' && n === 0n)) stop('INVALID_METADATA')
    identity[field] = n.toString()
  }
  const mode = integer(s.mode)
  return { type: s.isFile() ? 'FILE' : s.isDirectory() ? 'DIRECTORY' :
    s.isSymbolicLink() ? 'SYMLINK' : 'OTHER', uid: integer(s.uid), gid: integer(s.gid),
    mode: (mode & 0o7777).toString(8).padStart(4, '0'), identity }
}
function readMeta(p) { return meta(fs.lstatSync(p, { bigint: true })) }
function protectedDirectory(m, owner = 0) {
  return m.type === 'DIRECTORY' && m.uid === owner && !(parseInt(m.mode, 8) & 0o022)
}
function blank(p) {
  return { path: p, state: 'UNKNOWN', status: 'UNKNOWN', phase: 'SKIPPED',
    reason: 'PARENT_UNVERIFIED', type: null, uid: null, gid: null, mode: null,
    identity: null, realPath: 'UNKNOWN', target: null, chain: [], linkTarget: null,
    parentChecks: [], executableBySshUser: 'NOT_APPLICABLE',
    execution: { status: 'NOT_APPLICABLE', classification: 'NOT_REQUESTED' },
    rootOwnedNotGroupOrOtherWritable: 'UNKNOWN' }
}
function setMeta(row, m) { Object.assign(row, m, { state: 'PRESENT' }) }
function safeMeta(row) {
  return { type: row.type, uid: row.uid, gid: row.gid, mode: row.mode, identity: row.identity }
}

// Every descendant metadata operation is gated by its parent chain.
// Resolve only fixed, explicitly allowed directory aliases; no realpath traversal.
function directory(p, visiting = new Set()) {
  if (parentRows.has(p)) return parentRows.get(p)
  const row = blank(p)
  if (!parentSet.has(p)) { row.reason = 'OUTSIDE_SCOPE'; return row }
  if (visiting.has(p) || visiting.size >= 8) { row.reason = 'SYMLINK_LIMIT'; return row }
  const next = new Set(visiting); next.add(p)
  let parent
  if (p !== '/') {
    parent = directory(path.posix.dirname(p), next)
    row.parentChecks = [...parent.parentChecks, parent.path]
    if (parent.status !== 'PASS') { row.reason = parent.reason; parentRows.set(p, row); return row }
  }
  try {
    if (parent) verifyChain(parent)
    const actual = p === '/' ? '/' : path.posix.join(parent.realPath, path.posix.basename(p))
    if (!parentSet.has(actual)) stop('OUTSIDE_SCOPE')
    row.phase = 'EXECUTED'
    const m = readMeta(actual)
    setMeta(row, m)
    if (m.type === 'SYMLINK') {
      if (m.uid !== 0) { row.status = 'FAIL'; row.reason = 'UNTRUSTED_OWNER'; parentRows.set(p, row); return row }
      const target = path.posix.resolve(path.posix.dirname(actual), fs.readlinkSync(actual))
      if (!parentSet.has(target)) stop('OUTSIDE_SCOPE')
      row.linkTarget = target
      const targetRow = directory(target, next)
      if (targetRow.status !== 'PASS') stop(targetRow.reason === 'SYMLINK_LIMIT' ? 'SYMLINK_LIMIT' : 'OUTSIDE_SCOPE')
      verifyChain(targetRow)
      row.realPath = targetRow.realPath
      row.target = targetRow.target
      row.parentChecks = [...new Set([...row.parentChecks, ...targetRow.parentChecks, targetRow.path])]
    } else {
      row.realPath = actual
      row.target = m
    }
    row.status = protectedDirectory(row.target) ? 'PASS' : 'FAIL'
    row.reason = row.status === 'PASS' ? 'METADATA_VERIFIED' :
      row.target.type !== 'DIRECTORY' ? 'NOT_DIRECTORY' : row.target.uid !== 0 ? 'UNTRUSTED_OWNER' : 'WRITABLE_PARENT'
    row.rootOwnedNotGroupOrOtherWritable = row.status === 'PASS'
    row.chain = [...new Set([...row.parentChecks, p])]
  } catch (e) { row.status = 'UNKNOWN'; row.reason = classify(e); row.realPath = 'UNKNOWN' }
  parentRows.set(p, row)
  return row
}

// Re-sample verified ancestors from root downward before touching a candidate.
// This detects observed changes, not an atomic filesystem snapshot.
function verifyChain(row) {
  for (const p of row.chain) {
    const old = parentRows.get(p)
    if (!old || old.status !== 'PASS') stop('PARENT_CHANGED')
    const parent = p === '/' ? null : parentRows.get(path.posix.dirname(p))
    if (parent && parent.status !== 'PASS') stop('PARENT_CHANGED')
    const actual = p === '/' ? '/' : path.posix.join(parent.realPath, path.posix.basename(p))
    const now = readMeta(actual)
    if (JSON.stringify(now) !== JSON.stringify(safeMeta(old))) {
      old.status = 'UNKNOWN'; old.reason = 'PARENT_CHANGED'; stop('PARENT_CHANGED')
    }
    if (now.type === 'SYMLINK') {
      const target = path.posix.resolve(path.posix.dirname(actual), fs.readlinkSync(actual))
      if (target !== old.linkTarget) {
        old.status = 'UNKNOWN'; old.reason = 'PARENT_CHANGED'; stop('PARENT_CHANGED')
      }
    }
  }
}
function client(p) {
  const row = blank(p)
  const chain = []
  let current = p
  try {
    for (let hop = 0; hop < 8; hop++) {
      if (!clientSet.has(current)) stop('OUTSIDE_SCOPE')
      const parent = directory(path.posix.dirname(current))
      row.parentChecks = [...new Set([...row.parentChecks, ...parent.chain])]
      if (parent.status !== 'PASS') { row.reason = parent.reason; return row }
      verifyChain(parent)
      const actual = path.posix.join(parent.realPath, path.posix.basename(current))
      if (!clientSet.has(actual)) stop('OUTSIDE_SCOPE')
      if (chain.includes(actual)) stop('SYMLINK_LIMIT')
      chain.push(actual)
      row.phase = 'EXECUTED'
      const m = readMeta(actual)
      if (hop === 0) setMeta(row, m)
      row.rootOwnedNotGroupOrOtherWritable = m.uid === 0 && !(parseInt(m.mode, 8) & 0o022)
      if (m.uid !== 0) { row.status = 'FAIL'; row.reason = 'UNTRUSTED_OWNER'; return row }
      if (m.type === 'SYMLINK') {
        const next = path.posix.resolve(path.posix.dirname(actual), fs.readlinkSync(actual))
        if (!clientSet.has(next)) stop('OUTSIDE_SCOPE')
        if (hop === 0) row.linkTarget = next
        current = next
        continue
      }
      row.realPath = actual
      row.target = m
      row.chain = chain
      row.rootOwnedNotGroupOrOtherWritable = !(parseInt(m.mode, 8) & 0o022)
      if (m.type !== 'FILE') { row.status = 'FAIL'; row.reason = 'NOT_FILE'; return row }
      if (!row.rootOwnedNotGroupOrOtherWritable) { row.status = 'FAIL'; row.reason = 'WRITABLE_CLIENT'; return row }
      if (!(parseInt(m.mode, 8) & 0o111)) {
        row.executableBySshUser = false
        row.execution = { status: 'FAIL', classification: 'NOT_EXECUTABLE' }
        row.status = 'FAIL'; row.reason = 'NOT_EXECUTABLE'; return row
      }
      try {
        fs.accessSync(actual, fs.constants.X_OK)
        row.executableBySshUser = true
        row.execution = { status: 'PASS', classification: 'X_OK_OBSERVED' }
      } catch (e) {
        row.executableBySshUser = 'UNKNOWN'
        row.execution = { status: 'UNKNOWN', classification: classify(e) }
        row.status = 'UNKNOWN'; row.reason = classify(e); return row
      }
      if (JSON.stringify(readMeta(actual)) !== JSON.stringify(m)) stop('PATH_CHANGED')
      verifyChain(parent)
      row.status = 'PASS'; row.reason = 'METADATA_VERIFIED'; return row
    }
    stop('SYMLINK_LIMIT')
  } catch (e) { row.status = 'UNKNOWN'; row.reason = classify(e); row.realPath = 'UNKNOWN' }
  return row
}
function loginMetadata() {
  const result = { scope: 'SSH_HOME', state: 'UNKNOWN', status: 'UNKNOWN', phase: 'SKIPPED',
    reason: 'HOME_UNVERIFIED', home: null, file: null, parentChecks: [],
    ownerMatchesSshUser: 'UNKNOWN', privateMode: 'UNKNOWN', ownerReadWriteBits: 'UNKNOWN',
    namedLoginPath: 'NOT_CHECKED', databasePrivileges: 'NOT_CHECKED' }
  try {
    const home = process.env.HOME
    if (!/^\/(?:root|home\/[A-Za-z0-9._-]+)$/.test(home || '') ||
        path.posix.normalize(home) !== home) stop('HOME_UNVERIFIED')
    const root = directory('/')
    if (root.status !== 'PASS') return result
    verifyChain(root)
    const base = home === '/root' ? '/' : '/home'
    let baseMeta
    const baseRecord = { path: 'SSH_HOME_BASE', phase: 'EXECUTED', status: 'UNKNOWN', reason: 'HOME_UNVERIFIED', metadata: null }
    result.parentChecks.push(baseRecord)
    try {
      baseMeta = readMeta(base); baseRecord.metadata = baseMeta
      baseRecord.status = protectedDirectory(baseMeta) ? 'PASS' : 'FAIL'
      baseRecord.reason = baseRecord.status === 'PASS' ? 'METADATA_VERIFIED' : 'HOME_UNVERIFIED'
    } catch (e) { baseRecord.reason = classify(e); return result }
    if (baseRecord.status !== 'PASS') return result
    const homeRecord = { path: 'SSH_HOME', phase: 'EXECUTED', status: 'UNKNOWN', reason: 'HOME_UNVERIFIED', metadata: null }
    result.parentChecks.push(homeRecord)
    const homeMeta = readMeta(home); result.home = homeMeta; homeRecord.metadata = homeMeta
    homeRecord.status = protectedDirectory(homeMeta, uid) ? 'PASS' : 'FAIL'
    homeRecord.reason = homeRecord.status === 'PASS' ? 'METADATA_VERIFIED' : 'HOME_UNVERIFIED'
    if (homeRecord.status !== 'PASS') return result
    if (JSON.stringify(readMeta(base)) !== JSON.stringify(baseMeta) ||
        JSON.stringify(readMeta(home)) !== JSON.stringify(homeMeta)) stop('PARENT_CHANGED')
    result.phase = 'EXECUTED'
    const s = readMeta(path.posix.join(home, '.mylogin.cnf'))
    result.file = s; result.state = 'PRESENT'
    result.ownerMatchesSshUser = s.uid === uid
    result.privateMode = !(parseInt(s.mode, 8) & 0o077)
    result.ownerReadWriteBits = (parseInt(s.mode, 8) & 0o600) === 0o600
    result.status = s.type === 'FILE' && result.ownerMatchesSshUser &&
      result.privateMode && result.ownerReadWriteBits ? 'PASS' : 'FAIL'
    result.reason = result.status === 'PASS' ? 'METADATA_VERIFIED' : 'LOGIN_METADATA_UNSAFE'
    if (JSON.stringify(readMeta(base)) !== JSON.stringify(baseMeta) ||
        JSON.stringify(readMeta(home)) !== JSON.stringify(homeMeta)) stop('PARENT_CHANGED')
  } catch (e) { result.status = 'UNKNOWN'; result.reason = classify(e) }
  for (const label of ['SSH_HOME_BASE', 'SSH_HOME']) {
    if (!result.parentChecks.some(r => r.path === label)) result.parentChecks.push({
      path: label, phase: 'SKIPPED', status: 'UNKNOWN', reason: 'HOME_UNVERIFIED', metadata: null })
  }
  return result
}
try {
  parentPaths.forEach(p => directory(p))
  const candidates = clients.map(client)
  const login = loginMetadata()
  // Include fixed placeholders even after an unsafe ancestor; no missing rows.
  for (const label of ['SSH_HOME_BASE', 'SSH_HOME']) {
    if (!login.parentChecks.some(r => r.path === label)) login.parentChecks.push({
      path: label, phase: 'SKIPPED', status: 'UNKNOWN', reason: 'HOME_UNVERIFIED', metadata: null })
  }
  const parents = parentPaths.map(p => parentRows.get(p) || blank(p))
  console.log(JSON.stringify({ check: 'MYSQL_CLIENT_METADATA_ONLY_V2', sshUid: uid, candidates, parents, login,
    clientVersion: 'NOT_CHECKED', databaseConnection: 'NOT_CHECKED',
    excludedChecks: { clientVersion: 'NOT_APPLICABLE', databaseConnection: 'NOT_APPLICABLE',
      namedLoginPath: 'NOT_APPLICABLE', databasePrivileges: 'NOT_APPLICABLE' },
    snapshotAtomic: false, scope: 'METADATA_ONLY_NON_CONTINUOUS', releaseDecision: 'NO_GO' }))
} catch {
  console.log(JSON.stringify({ check: 'MYSQL_CLIENT_METADATA_ONLY_V2', status: 'UNKNOWN',
    reason: 'METADATA_UNAVAILABLE', releaseDecision: 'NO_GO' }))
}
REMOTE_NODE
)"
then
  stop SSH_METADATA_CHECK_FAILED
fi

export METADATA_RESULT

# 只允许固定字段及脱敏值出现在最终输出。
node --input-type=module - 2>/dev/null <<'FILTER_OUTPUT'
const keys = new Set([
  'check', 'sshUid', 'candidates', 'parents', 'login', 'clientVersion', 'databaseConnection',
  'excludedChecks', 'snapshotAtomic', 'scope', 'releaseDecision',
])
const clients = ['/usr/bin/mysql', '/usr/local/bin/mysql', '/bin/mysql']
const parents = ['/', '/usr', '/usr/bin', '/usr/local', '/usr/local/bin', '/bin']
const statuses = new Set(['PASS', 'FAIL', 'UNKNOWN', 'NOT_APPLICABLE'])
const reasons = new Set(['METADATA_VERIFIED', 'NOT_FOUND', 'ACCESS_DENIED', 'IO_ERROR',
  'METADATA_UNAVAILABLE', 'OUTSIDE_SCOPE', 'SYMLINK_LIMIT', 'PATH_CHANGED', 'PARENT_CHANGED',
  'INVALID_METADATA', 'HOME_UNVERIFIED', 'PARENT_UNVERIFIED', 'UNTRUSTED_OWNER',
  'NOT_DIRECTORY', 'WRITABLE_PARENT', 'NOT_FILE', 'WRITABLE_CLIENT', 'NOT_EXECUTABLE',
  'LOGIN_METADATA_UNSAFE', 'NOT_REQUESTED', 'X_OK_OBSERVED'])
function reject() { throw new Error() }
function exact(v, expected) {
  if (!v || typeof v !== 'object' || Array.isArray(v) ||
      Object.keys(v).length !== expected.length || !Object.keys(v).every(k => expected.includes(k))) reject()
}
function number(v) { if (!Number.isSafeInteger(v) || v < 0) reject() }
function metadata(v) {
  exact(v, ['type', 'uid', 'gid', 'mode', 'identity'])
  if (!['FILE', 'DIRECTORY', 'SYMLINK', 'OTHER'].includes(v.type) || typeof v.mode !== 'string' ||
      !/^[0-7]{4}$/.test(v.mode)) reject()
  number(v.uid); number(v.gid)
  exact(v.identity, ['dev', 'ino'])
  if (typeof v.identity.dev !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(v.identity.dev) ||
      typeof v.identity.ino !== 'string' || !/^[1-9][0-9]*$/.test(v.identity.ino)) reject()
}
function protectedMeta(v, type, owner) {
  return v && v.type === type && v.uid === owner && !(parseInt(v.mode, 8) & 0o022)
}
function sameMeta(a, b) {
  return a && b && a.type === b.type && a.uid === b.uid && a.gid === b.gid &&
    a.mode === b.mode && a.identity?.dev === b.identity?.dev && a.identity?.ino === b.identity?.ino
}
function strings(v, allowed) {
  if (!Array.isArray(v) || v.length > allowed.length || new Set(v).size !== v.length ||
      !v.every(x => typeof x === 'string' && allowed.includes(x))) reject()
}
function stage(v) {
  if (!statuses.has(v.status) || !['EXECUTED', 'SKIPPED'].includes(v.phase) || !reasons.has(v.reason)) reject()
  if (v.status === 'NOT_APPLICABLE' || (v.phase === 'SKIPPED' && v.status !== 'UNKNOWN')) reject()
}
function row(v, parent) {
  exact(v, ['path', 'state', 'status', 'phase', 'reason', 'type', 'uid', 'gid', 'mode',
    'identity', 'realPath', 'target', 'chain', 'linkTarget', 'parentChecks',
    'executableBySshUser', 'execution', 'rootOwnedNotGroupOrOtherWritable'])
  stage(v)
  if (!['PRESENT', 'UNKNOWN'].includes(v.state)) reject()
  if (v.state === 'PRESENT') metadata({ type: v.type, uid: v.uid, gid: v.gid, mode: v.mode, identity: v.identity })
  else if ([v.type, v.uid, v.gid, v.mode, v.identity].some(x => x !== null)) reject()
  if (v.phase === 'SKIPPED' && v.state !== 'UNKNOWN') reject()
  const allowed = parent ? parents : clients
  if (!allowed.includes(v.path) || ![...allowed, 'UNKNOWN'].includes(v.realPath) ||
      (v.linkTarget !== null && !allowed.includes(v.linkTarget))) reject()
  strings(v.chain, allowed); strings(v.parentChecks, parents)
  if (v.target !== null) metadata(v.target)
  if (![true, false, 'UNKNOWN', 'NOT_APPLICABLE'].includes(v.executableBySshUser) ||
      ![true, false, 'UNKNOWN'].includes(v.rootOwnedNotGroupOrOtherWritable)) reject()
  exact(v.execution, ['status', 'classification'])
  if (!statuses.has(v.execution.status) || !reasons.has(v.execution.classification)) reject()
  if (parent && (v.executableBySshUser !== 'NOT_APPLICABLE' ||
      v.execution.status !== 'NOT_APPLICABLE' || v.execution.classification !== 'NOT_REQUESTED')) reject()
  if (v.execution.status === 'PASS' && (v.executableBySshUser !== true || v.execution.classification !== 'X_OK_OBSERVED')) reject()
  if (v.executableBySshUser === true && v.execution.status !== 'PASS') reject()
  if (v.executableBySshUser === false && !(v.execution.status === 'FAIL' &&
      v.execution.classification === 'NOT_EXECUTABLE' && v.target?.type === 'FILE' &&
      !(parseInt(v.target.mode, 8) & 0o111))) reject()
  if (v.execution.status === 'UNKNOWN' && v.executableBySshUser !== 'UNKNOWN') reject()
  if (v.status === 'PASS') {
    if (v.type === 'SYMLINK' && v.linkTarget === null) reject()
    if (v.type !== 'SYMLINK' && !sameMeta({ type: v.type, uid: v.uid, gid: v.gid,
        mode: v.mode, identity: v.identity }, v.target)) reject()
    if (v.phase !== 'EXECUTED' || v.state !== 'PRESENT' || v.realPath === 'UNKNOWN' ||
        v.reason !== 'METADATA_VERIFIED' || !protectedMeta(v.target, parent ? 'DIRECTORY' : 'FILE', 0) ||
        v.rootOwnedNotGroupOrOtherWritable !== true) reject()
    if (!parent && (v.execution.status !== 'PASS' || !(parseInt(v.target.mode, 8) & 0o111) ||
        !['FILE', 'SYMLINK'].includes(v.type) || v.uid !== 0)) reject()
  }
}
function collection(v, expected, fn) {
  if (!Array.isArray(v) || v.length !== expected.length || new Set(v.map(x => x?.path)).size !== expected.length) reject()
  for (const p of expected) {
    const found = v.find(x => x?.path === p)
    if (!found) reject()
    fn(found)
  }
}
function login(v, sshUid) {
  exact(v, ['scope', 'state', 'status', 'phase', 'reason', 'home', 'file', 'parentChecks',
    'ownerMatchesSshUser', 'privateMode', 'ownerReadWriteBits', 'namedLoginPath', 'databasePrivileges'])
  stage(v)
  if (v.scope !== 'SSH_HOME' || !['PRESENT', 'UNKNOWN'].includes(v.state) ||
      v.namedLoginPath !== 'NOT_CHECKED' || v.databasePrivileges !== 'NOT_CHECKED') reject()
  for (const field of ['home', 'file']) if (v[field] !== null) metadata(v[field])
  for (const field of ['ownerMatchesSshUser', 'privateMode', 'ownerReadWriteBits'])
    if (![true, false, 'UNKNOWN'].includes(v[field])) reject()
  collection(v.parentChecks, ['SSH_HOME_BASE', 'SSH_HOME'], p => {
    exact(p, ['path', 'phase', 'status', 'reason', 'metadata']); stage(p)
    if (p.metadata !== null) metadata(p.metadata)
    if (p.phase === 'SKIPPED' && p.metadata !== null) reject()
    if (p.status === 'PASS' && (p.phase !== 'EXECUTED' ||
        !protectedMeta(p.metadata, 'DIRECTORY', p.path === 'SSH_HOME_BASE' ? 0 : sshUid))) reject()
  })
  if (v.state === 'PRESENT') {
    if (v.phase !== 'EXECUTED' || !v.file ||
        v.ownerMatchesSshUser !== (v.file.uid === sshUid) ||
        v.privateMode !== !(parseInt(v.file.mode, 8) & 0o077) ||
        v.ownerReadWriteBits !== ((parseInt(v.file.mode, 8) & 0o600) === 0o600)) reject()
  } else if (v.file !== null) reject()
  if (v.status === 'PASS' && !sameMeta(v.home, v.parentChecks.find(p => p.path === 'SSH_HOME').metadata)) reject()
  if (v.status === 'PASS' && !(v.phase === 'EXECUTED' && v.state === 'PRESENT' &&
      v.reason === 'METADATA_VERIFIED' && protectedMeta(v.home, 'DIRECTORY', sshUid) &&
      v.file.type === 'FILE' && v.ownerMatchesSshUser && v.privateMode && v.ownerReadWriteBits &&
      v.parentChecks.every(p => p.status === 'PASS'))) reject()
}
try {
  const raw = process.env.METADATA_RESULT || ''
  if (raw.length > 65536) reject()
  const result = JSON.parse(raw)
  exact(result, [...keys])
  if (result.check !== 'MYSQL_CLIENT_METADATA_ONLY_V2' || result.releaseDecision !== 'NO_GO' ||
      result.clientVersion !== 'NOT_CHECKED' || result.databaseConnection !== 'NOT_CHECKED' ||
      result.snapshotAtomic !== false || result.scope !== 'METADATA_ONLY_NON_CONTINUOUS') reject()
  number(result.sshUid)
  exact(result.excludedChecks, ['clientVersion', 'databaseConnection', 'namedLoginPath', 'databasePrivileges'])
  if (!Object.values(result.excludedChecks).every(x => x === 'NOT_APPLICABLE')) reject()
  collection(result.parents, parents, v => row(v, true))
  collection(result.candidates, clients, v => row(v, false))
  login(result.login, result.sshUid)
  const parentMap = new Map(result.parents.map(p => [p.path, p]))
  for (const item of [...result.parents, ...result.candidates]) {
    if (item.status === 'PASS' && !item.parentChecks.every(p => parentMap.get(p)?.status === 'PASS')) reject()
  }
  for (const item of result.parents) if (item.status === 'PASS') {
    if (item.type === 'SYMLINK') {
      const linked = parentMap.get(item.linkTarget)
      if (linked?.status !== 'PASS' || item.realPath !== linked.realPath ||
          !sameMeta(item.target, linked.target) ||
          !item.parentChecks.includes(item.linkTarget)) reject()
    }
    const parts = item.path.split('/').filter(Boolean)
    const expected = ['/']
    for (let i = 1; i <= parts.length; i++) expected.push('/' + parts.slice(0, i).join('/'))
    if (!expected.every(p => item.chain.includes(p)) ||
        !expected.filter(p => p !== item.path).every(p => item.parentChecks.includes(p))) reject()
    if (!['DIRECTORY', 'SYMLINK'].includes(item.type) || item.uid !== 0) reject()
  }
  for (const item of result.candidates) if (item.phase === 'EXECUTED') {
    if (item.status === 'PASS') {
      const slash = item.path.lastIndexOf('/')
      const parent = parentMap.get(item.path.slice(0, slash))
      const canonical = parent?.realPath + '/' + item.path.slice(slash + 1)
      if (item.chain[0] !== canonical || item.chain.at(-1) !== item.realPath) reject()
      if (item.type === 'SYMLINK') {
        const cut = item.linkTarget.lastIndexOf('/')
        const targetParent = parentMap.get(item.linkTarget.slice(0, cut))
        const target = targetParent?.realPath + '/' + item.linkTarget.slice(cut + 1)
        if (targetParent?.status !== 'PASS' || !item.chain.includes(target)) reject()
      }
    }
    const parts = item.path.split('/').filter(Boolean)
    const expected = ['/']
    for (let i = 1; i < parts.length; i++) expected.push('/' + parts.slice(0, i).join('/'))
    if (!expected.every(p => item.parentChecks.includes(p))) reject()
  }
  const required = [...result.parents, ...result.candidates, ...result.login.parentChecks, result.login]
  const incomplete = required.some(v => v.phase !== 'EXECUTED')
  const uncertain = required.some(v => v.status === 'UNKNOWN')
  const failed = required.some(v => v.status === 'FAIL')
  const overallStatus = incomplete || uncertain ? 'UNKNOWN' : failed ? 'FAIL' : 'PASS'
  console.log(JSON.stringify({ ...result, validationResult: incomplete || overallStatus !== 'PASS' ? 'FAIL_CLOSED' : 'PASS',
    overallStatus }, null, 2))
  if (overallStatus !== 'PASS' || incomplete) process.exitCode = 1
} catch {
  console.log(JSON.stringify({ status: 'FAIL', result: 'FAIL_CLOSED', reason: 'OUTPUT_SCHEMA_INVALID', releaseDecision: 'NO_GO' }))
  process.exitCode = 1
}
FILTER_OUTPUT

unset METADATA_RESULT actual_fingerprint
