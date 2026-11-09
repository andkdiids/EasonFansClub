import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  CANDIDATE,
  assertRegularFileMetadata,
  performQuarantine,
} from '../scripts/quarantine-invalid-production-attestation.mjs'

const TARGET_SHA = '80b62a5938aba4d2b50075ed0ed55da169c94f4d'

function hash(value) {
  return createHash('sha256').update(value).digest('hex')
}

function proofText(options = {}) {
  const now = options.now ?? Date.parse('2026-11-10T12:00:00.000Z')
  const targetSha = options.targetSha ?? TARGET_SHA
  const proof = {
    schemaVersion: 3,
    targetReleaseSha: targetSha,
    expiresAt: new Date(now - 60_000).toISOString(),
    riskAcceptance: {
      approvedBy: 'Eason',
      approvedAt: new Date(now - 2 * 60 * 60_000).toISOString(),
      approvalCommentId: '6740000000',
      approvalAuthorAssociation: 'OWNER',
      riskStatement: 'Historical one-time risk acceptance for the specified release.',
      releaseId: targetSha,
      noIndependentBackupVerification: true,
      noRestoreDrill: true,
    },
  }
  return JSON.stringify(proof, null, 2) + '\n'
}

function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecfc-proof-quarantine-'))
  const shared = path.join(root, 'shared')
  const sourcePath = path.join(shared, '.backup-verification.json')
  const statePath = sourcePath + '.state'
  const issued = path.join(statePath, 'issued')
  const consumed = path.join(statePath, 'consumed')
  const archived = path.join(statePath, 'archived')
  fs.mkdirSync(shared, { mode: 0o700 })
  fs.mkdirSync(statePath, { mode: 0o700 })
  fs.mkdirSync(issued, { mode: 0o700 })
  fs.mkdirSync(consumed, { mode: 0o700 })
  fs.mkdirSync(archived, { mode: 0o700 })

  const body = options.body ?? proofText({ now: options.now })
  fs.writeFileSync(sourcePath, body, { mode: 0o600, flag: 'wx' })
  const mtime = options.mtime ?? new Date('2026-11-10T10:00:00.000Z')
  fs.utimesSync(sourcePath, mtime, mtime)
  const sourceStats = fs.lstatSync(sourcePath)
  let parsedBody = null
  try {
    parsedBody = JSON.parse(body)
  } catch {
    // The malformed-JSON test intentionally uses an unreadable proof payload.
  }
  const expected = {
    ...CANDIDATE,
    targetSha: TARGET_SHA,
    proofSha256: options.expectedHash ?? hash(body),
    sizeBytes: Buffer.byteLength(body),
    mode: 0o600,
    ownerUid: typeof process.getuid === 'function' ? process.getuid() : undefined,
    mtimeUtc: sourceStats.mtime.toISOString(),
    expiresAt: options.expiresAt ?? parsedBody?.expiresAt ?? CANDIDATE.expiresAt,
    historicalValidationAt: options.historicalValidationAt ??
      new Date(Date.parse(parsedBody?.expiresAt ?? CANDIDATE.expiresAt) - 3_600_000).toISOString(),
    historicalApproverDisplay: 'Eason',
  }
  return {
    root,
    sourcePath,
    statePath,
    issued,
    consumed,
    archived,
    expected,
    sourceBytes: Buffer.from(body),
    sourceStats,
    runId: '9001001',
    runAttempt: '1',
    now: Date.parse('2026-11-10T12:00:00.000Z'),
    perform(extra = {}) {
      return performQuarantine({
        sourcePath,
        statePath,
        expected,
        runId: this.runId,
        runAttempt: this.runAttempt,
        lockHeld: true,
        now: this.now,
        ...extra,
      })
    },
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true })
    },
  }
}

function unchanged(f) {
  assert.deepEqual(fs.readFileSync(f.sourcePath), f.sourceBytes)
  assert.equal(hash(fs.readFileSync(f.sourcePath)), hash(f.sourceBytes))
  assert.deepEqual(fs.readdirSync(f.issued), [])
  assert.deepEqual(fs.readdirSync(f.consumed), [])
}

test('quarantine refuses a source whose bytes do not match the diagnostic SHA', t => {
  const f = fixture(t, { expectedHash: '0'.repeat(64) })
  t.after(() => f.cleanup())
  assert.throws(() => f.perform(), /SOURCE_SHA256_MISMATCH/)
  unchanged(f)
  assert.deepEqual(fs.readdirSync(f.archived), [])
})

test('quarantine safely rejects malformed JSON without touching the source', t => {
  const body = '{not-json}\n'
  const f = fixture(t, { body })
  t.after(() => f.cleanup())
  assert.throws(() => f.perform(), /SOURCE_SCHEMA_MISMATCH|SOURCE_JSON_INVALID/)
  unchanged(f)
  assert.deepEqual(fs.readdirSync(f.archived), [])
})

test('a proof matching the current schema is never eligible for historical quarantine', t => {
  const body = `${JSON.stringify({
    schemaVersion: 3,
    attestationId: 'a8d80c25-e06e-4fee-b302-1155c65fb85a',
    issuedByWorkflowRunId: '42627921767',
    targetReleaseSha: TARGET_SHA,
    expiresAt: '2026-11-10T11:59:00.000Z',
    riskAcceptance: {
      approvedBy: 'andkdiids',
      approvedAt: '2026-11-10T10:00:00.000Z',
      approvalCommentId: '6741233172',
      approvalAuthorAssociation: 'OWNER',
      riskStatement: 'No independent backup/PITR verification and no isolated restore drill.',
      releaseId: TARGET_SHA,
      noIndependentBackupVerification: true,
      noRestoreDrill: true,
    },
  }, null, 2)}\n`
  const f = fixture(t, {
    body,
    expectedHash: hash(body),
    expiresAt: '2026-11-10T11:59:00.000Z',
    historicalValidationAt: '2026-11-10T10:30:00.000Z',
  })
  t.after(() => f.cleanup())
  f.expected.historicalApproverDisplay = 'andkdiids'
  assert.throws(() => f.perform(), /SOURCE_FIELDS_MATCH_EXPECTED_SCHEMA/)
  unchanged(f)
  assert.deepEqual(fs.readdirSync(f.archived), [])
})

test('quarantine refuses a symbolic-link proof path', t => {
  if (process.platform === 'win32') {
    t.skip('Windows test runner does not reliably permit symlink fixtures')
    return
  }
  const f = fixture(t)
  t.after(() => f.cleanup())
  const target = f.sourcePath + '.target'
  fs.renameSync(f.sourcePath, target)
  fs.symlinkSync(target, f.sourcePath)
  assert.throws(() => f.perform(), /SOURCE_NOT_REGULAR_FILE/)
  assert.equal(fs.readlinkSync(f.sourcePath), target)
  assert.deepEqual(fs.readdirSync(f.archived), [])
})

test('file permission anomalies are rejected on the production POSIX policy', () => {
  const fake = {
    mode: 0o100640,
    uid: 1000,
    isFile: () => true,
    isSymbolicLink: () => false,
  }
  assert.throws(() => assertRegularFileMetadata(fake, {
    platform: 'linux',
    expectedUid: 1000,
    expectedMode: 0o600,
  }), /SOURCE_MODE_MISMATCH/)
  assert.throws(() => assertRegularFileMetadata({ ...fake, mode: 0o100600, uid: 1001 }, {
    platform: 'linux',
    expectedUid: 1000,
    expectedMode: 0o600,
  }), /SOURCE_OWNER_MISMATCH/)
})

test('archive path collision refuses without replacing the existing archive', t => {
  const f = fixture(t)
  t.after(() => f.cleanup())
  const collision = path.join(f.archived, 'historical-invalid-' + f.expected.proofSha256 + '.json')
  fs.writeFileSync(collision, 'do-not-replace')
  const collisionHash = hash(fs.readFileSync(collision))
  assert.throws(() => f.perform(), /QUARANTINE_ARCHIVE_CONFLICT/)
  unchanged(f)
  assert.equal(hash(fs.readFileSync(collision)), collisionHash)
  assert.deepEqual(fs.readdirSync(f.archived), [path.basename(collision)])
})

test('missing production lock refuses before reading or writing proof files', t => {
  const f = fixture(t)
  t.after(() => f.cleanup())
  assert.throws(() => f.perform({ lockHeld: false }), /PRODUCTION_LOCK_NOT_HELD/)
  unchanged(f)
  assert.deepEqual(fs.readdirSync(f.archived), [])
})

test('existing issued or consumed history is preserved and blocks quarantine', t => {
  const f = fixture(t)
  t.after(() => f.cleanup())
  const issuedMarker = path.join(f.issued, 'historical.json')
  const consumedMarker = path.join(f.consumed, 'historical.json')
  fs.writeFileSync(issuedMarker, 'issued-audit')
  fs.writeFileSync(consumedMarker, 'consumed-audit')
  const issuedHash = hash(fs.readFileSync(issuedMarker))
  const consumedHash = hash(fs.readFileSync(consumedMarker))
  assert.throws(() => f.perform(), /STATE_RECORDS_PRESENT/)
  unchangedSourceOnly(f)
  assert.equal(hash(fs.readFileSync(issuedMarker)), issuedHash)
  assert.equal(hash(fs.readFileSync(consumedMarker)), consumedHash)
  assert.deepEqual(fs.readdirSync(f.archived), [])
})

function unchangedSourceOnly(f) {
  assert.deepEqual(fs.readFileSync(f.sourcePath), f.sourceBytes)
  assert.equal(hash(fs.readFileSync(f.sourcePath)), f.expected.proofSha256)
}

test('successful quarantine preserves the proof inode metadata and records historical use', t => {
  if (process.platform === 'win32') {
    t.skip('POSIX hard-link quarantine semantics are exercised on Linux CI')
    return
  }
  const f = fixture(t)
  t.after(() => f.cleanup())
  const sourceBefore = fs.lstatSync(f.sourcePath)
  const result = f.perform()
  assert.equal(result.status, 'QUARANTINED')
  assert.equal(result.proofSha256, f.expected.proofSha256)
  assert.equal(fs.existsSync(f.sourcePath), false)
  const archivedPath = result.archivePath
  assert.deepEqual(fs.readFileSync(archivedPath), f.sourceBytes)
  const archived = fs.lstatSync(archivedPath)
  assert.equal(archived.dev, sourceBefore.dev)
  assert.equal(archived.ino, sourceBefore.ino)
  assert.equal(archived.size, sourceBefore.size)
  assert.equal(archived.mtimeMs, sourceBefore.mtimeMs)
  if (process.platform !== 'win32') {
    assert.equal(archived.mode & 0o777, sourceBefore.mode & 0o777)
    assert.equal(archived.uid, sourceBefore.uid)
  }
  const audit = JSON.parse(fs.readFileSync(result.auditPath, 'utf8'))
  assert.equal(audit.historicalUse, 'CONFIRMED_BY_DEPLOY_WORKFLOW_LOG')
  assert.equal(audit.historicalRuns[1].runId, '42516766789')
  assert.equal(audit.proof.sha256, f.expected.proofSha256)
  assert.deepEqual(fs.readdirSync(f.issued), [])
  assert.deepEqual(fs.readdirSync(f.consumed), [])
  assert.equal(fs.existsSync(result.completionPath), true)
})

test('link failure keeps its prepared audit and never deletes the source', t => {
  const f = fixture(t)
  t.after(() => f.cleanup())
  const faultyFs = new Proxy(fs, {
    get(target, property) {
      if (property === 'linkSync') return () => { throw Object.assign(new Error('simulated'), { code: 'EIO' }) }
      const value = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  assert.throws(() => f.perform({ fsImpl: faultyFs }), /simulated/)
  unchanged(f)
  const prepared = path.join(f.archived, 'historical-invalid-' + f.expected.proofSha256 + '.json.quarantine.json')
  assert.equal(fs.existsSync(prepared), true)
  assert.equal(JSON.parse(fs.readFileSync(prepared, 'utf8')).status, 'QUARANTINE_PREPARED')
})

test('completion-record failure keeps the archived proof and does not roll back evidence', t => {
  if (process.platform === 'win32') {
    t.skip('POSIX hard-link quarantine semantics are exercised on Linux CI')
    return
  }
  const f = fixture(t)
  t.after(() => f.cleanup())
  const faultyFs = new Proxy(fs, {
    get(target, property) {
      if (property === 'openSync') return (filePath, ...args) => {
        if (String(filePath).endsWith('.complete.json')) {
          throw Object.assign(new Error('simulated-completion-failure'), { code: 'EIO' })
        }
        return target.openSync(filePath, ...args)
      }
      const value = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  assert.throws(() => f.perform({ fsImpl: faultyFs }), /simulated-completion-failure/)
  assert.equal(fs.existsSync(f.sourcePath), false)
  const archivedPath = path.join(f.archived, 'historical-invalid-' + f.expected.proofSha256 + '.json')
  assert.equal(hash(fs.readFileSync(archivedPath)), f.expected.proofSha256)
  const prepared = JSON.parse(fs.readFileSync(archivedPath + '.quarantine.json', 'utf8'))
  assert.equal(prepared.status, 'QUARANTINE_PREPARED')
  assert.equal(fs.readdirSync(f.issued).length, 0)
  assert.equal(fs.readdirSync(f.consumed).length, 0)
})

test('dispatch workflow is fixed-purpose, protected, and excluded from default deployment triggers', () => {
  const workflow = fs.readFileSync('.github/workflows/quarantine-invalid-production-attestation.yml', 'utf8')
  const deploy = fs.readFileSync('.github/workflows/deploy.yml', 'utf8')
  const infraCi = fs.readFileSync('.github/workflows/android-release-infra-ci.yml', 'utf8')
  const deployTest = fs.readFileSync('tests/deploy-backup-gate.test.ts', 'utf8')
  const source = fs.readFileSync('scripts/quarantine-invalid-production-attestation.mjs', 'utf8')
  const ignoreStart = deploy.indexOf('    paths-ignore:')
  const ignoreEnd = deploy.indexOf('\n  workflow_dispatch:', ignoreStart)
  const ignore = ignoreStart >= 0 && ignoreEnd > ignoreStart ? deploy.slice(ignoreStart, ignoreEnd) : ''

  assert.ok(workflow.includes('on:\n  workflow_dispatch: {}'))
  assert.ok(!workflow.includes('workflow_dispatch:\n    inputs:'))
  assert.ok(!workflow.includes('${{ inputs.') && !workflow.includes('github.event.inputs'))
  assert.ok(workflow.includes("github.ref == 'refs/heads/main'"))
  assert.ok(workflow.includes('name: Production'))
  assert.ok(workflow.includes('group: production-deploy') && workflow.includes('cancel-in-progress: false'))
  assert.ok(workflow.includes('StrictHostKeyChecking=yes'))
  assert.ok(workflow.includes('PINNED_FINGERPRINT'))
  assert.ok(workflow.includes('flock -n 9'))
  assert.ok(workflow.includes('exec 9<>"$LOCK_FILE"'))
  assert.ok(workflow.includes('node "$TEMP_DIR/quarantine-invalid-production-attestation.mjs" --cli quarantine'))
  for (const unsafe of ['StrictHostKeyChecking=no', 'ssh-keyscan', 'migrate deploy', 'deploy-production-git', 'risk_acceptance', 'issueRiskAcceptance', 'consumeRiskAcceptance']) {
    assert.ok(!workflow.includes(unsafe), `workflow must not contain ${unsafe}`)
  }
  assert.ok(source.includes("sourcePath: '/home/apps/easonfansclub/shared/.backup-verification.json'"))
  assert.ok(source.includes("proofSha256: 'b7c50aad63c213282ab5b7bc962b24b0461b3723f01e62a72eec11203702460c'"))
  assert.ok(source.includes('process.argv.length !== 4'))
  assert.ok(source.includes("basename(process.argv[1] ?? '') === 'quarantine-invalid-production-attestation.mjs'"))
  for (const file of [
    'scripts/quarantine-invalid-production-attestation.mjs',
    'tests/production-attestation-quarantine.test.mjs',
  ]) assert.ok(ignore.includes(`'${file}'`), `${file} must not trigger default production deployment`)
  for (const file of [
    '.github/workflows/quarantine-invalid-production-attestation.yml',
    'scripts/quarantine-invalid-production-attestation.mjs',
    'tests/production-attestation-quarantine.test.mjs',
  ]) assert.ok(infraCi.includes(`'${file}'`), `${file} must run release-infrastructure CI`)
  assert.ok(infraCi.includes('node --test tests/production-attestation-quarantine.test.mjs'))
  assert.ok(deployTest.includes('scripts/quarantine-invalid-production-attestation.mjs'))
  assert.ok(deployTest.includes('tests/production-attestation-quarantine.test.mjs'))
})
