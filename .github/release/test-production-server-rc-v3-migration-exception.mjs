import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import test from 'node:test'

const here = path.dirname(fileURLToPath(import.meta.url))
const workflowPath = path.resolve(here, '../workflows/production-server-rc-v3.yml')
const workflow = readFileSync(workflowPath, 'utf8')
const helperBlocks = [...workflow.matchAll(/\/\/ BEGIN M3 historical checksum exception\r?\n([\s\S]*?)^\s*\/\/ END M3 historical checksum exception/gm)]
  .map(match => match[1].split(/\r?\n/).map(line => line.trim()).filter(Boolean).join('\n'))

assert.equal(helperBlocks.length, 2, 'expected one exception helper in preflight and one in postcheck')
const policy = Object.freeze({
  name: '20260820140000_add_want_listen_session_exclusion',
  productionHash: '6b4c152b30679ca0a8f8d1ebe1bf9a1a25f2f16eb2944cfff413819362e48caa',
  candidateHash: '6b4c152b30679ca0a8f8d1ebe1bf9a1a25f2f16eb2944cfff413819362e48caa',
  ledgerChecksum: '9499df145c0984d16416b4210eb2061c5bd46273b5bc129fe9da94bff761d5b3',
})
const successfulRow = (checksum = policy.ledgerChecksum) => ({ checksum, finished_at: '2026-08-21 05:52:19.279', rolled_back_at: null })
const rolledBackRow = () => ({ checksum: 'f'.repeat(64), finished_at: null, rolled_back_at: '2026-08-21 05:49:10.329' })
const validColumn = () => ({ COLUMN_NAME: 'excludedFromLeaderboard', COLUMN_TYPE: 'tinyint(1)', IS_NULLABLE: 'NO', COLUMN_DEFAULT: '0' })
const validIndexes = () => [
  { INDEX_NAME: 'WantListenSession_excludedFromLeaderboard_status_completedAt_idx', NON_UNIQUE: 1, SEQ_IN_INDEX: 1, COLUMN_NAME: 'excludedFromLeaderboard' },
  { INDEX_NAME: 'WantListenSession_excludedFromLeaderboard_status_completedAt_idx', NON_UNIQUE: 1, SEQ_IN_INDEX: 2, COLUMN_NAME: 'status' },
  { INDEX_NAME: 'WantListenSession_excludedFromLeaderboard_status_completedAt_idx', NON_UNIQUE: 1, SEQ_IN_INDEX: 3, COLUMN_NAME: 'completedAt' },
]

function loadHelper(source) {
  const sandbox = {}
  vm.runInNewContext(`${source}\nglobalThis.__api = { migration3HistoricalExceptionPolicy, migration3SchemaMatches, isMigration3HistoricalChecksumException }`, sandbox)
  return sandbox.__api
}

function makeInput(overrides = {}) {
  return {
    name: policy.name,
    productionHash: policy.productionHash,
    candidateHash: policy.candidateHash,
    ledger: [rolledBackRow(), successfulRow()],
    schemaVerified: true,
    ...overrides,
  }
}

test('preflight and postcheck use byte-equivalent exception policy and predicate', () => {
  assert.equal(helperBlocks[0], helperBlocks[1])
  const preflight = loadHelper(helperBlocks[0])
  const postcheck = loadHelper(helperBlocks[1])
  assert.equal(preflight.isMigration3HistoricalChecksumException(makeInput()), true)
  assert.equal(postcheck.isMigration3HistoricalChecksumException(makeInput()), true)
})

test('exact production SQL, candidate SQL, ledger checksum, successful row, and verified schema are required', () => {
  const helper = loadHelper(helperBlocks[0])
  assert.equal(helper.migration3HistoricalExceptionPolicy.name, policy.name)
  assert.equal(helper.migration3HistoricalExceptionPolicy.productionSqlSha256, policy.productionHash)
  assert.equal(helper.migration3HistoricalExceptionPolicy.candidateSqlSha256, policy.candidateHash)
  assert.equal(helper.migration3HistoricalExceptionPolicy.successfulLedgerChecksum, policy.ledgerChecksum)
  assert.equal(helper.isMigration3HistoricalChecksumException(makeInput()), true)
})

test('production or candidate SQL hash changes fail closed', () => {
  const helper = loadHelper(helperBlocks[0])
  assert.equal(helper.isMigration3HistoricalChecksumException(makeInput({ productionHash: 'a'.repeat(64) })), false)
  assert.equal(helper.isMigration3HistoricalChecksumException(makeInput({ candidateHash: 'b'.repeat(64) })), false)
})

test('ledger checksum change fails closed', () => {
  const helper = loadHelper(helperBlocks[0])
  assert.equal(helper.isMigration3HistoricalChecksumException(makeInput({ ledger: [rolledBackRow(), successfulRow('c'.repeat(64))] })), false)
})

test('preflight and postcheck reject a successful ledger checksum change before considering SQL identity', () => {
  const guards = [...workflow.matchAll(/if \(migration3LedgerState\.succeeded && migration3LedgerState\.checksum !== migration3HistoricalExceptionPolicy\.successfulLedgerChecksum\) (?:fail|stop)\('MIGRATION_3_EXCEPTION_CONTEXT_INVALID'\)/g)]
  assert.equal(guards.length, 2, 'both preflight and postcheck must reject checksum drift unconditionally')
  assert.match(workflow, /pHash !== rHash/)
  assert.match(workflow, /dbChecksum !== pHash/)
  assert.match(workflow, /dbChecksum !== rHash/)
})

test('schema mismatch and incomplete schema metadata fail closed', () => {
  const helper = loadHelper(helperBlocks[0])
  assert.equal(helper.isMigration3HistoricalChecksumException(makeInput({ schemaVerified: false })), false)
  assert.equal(helper.migration3SchemaMatches([validColumn()], validIndexes()), true)
  assert.equal(helper.migration3SchemaMatches([{ ...validColumn(), IS_NULLABLE: 'YES' }], validIndexes()), false)
  assert.equal(helper.migration3SchemaMatches([validColumn()], validIndexes().slice(0, 2)), false)
  assert.equal(helper.migration3SchemaMatches([validColumn()], [{ ...validIndexes()[0], COLUMN_NAME: 'other' }, ...validIndexes().slice(1)]), false)
})

test('active failed ledger row blocks the exception even beside one successful row', () => {
  const helper = loadHelper(helperBlocks[0])
  const activeFailed = { checksum: 'd'.repeat(64), finished_at: null, rolled_back_at: null }
  assert.equal(helper.isMigration3HistoricalChecksumException(makeInput({ ledger: [rolledBackRow(), successfulRow(), activeFailed] })), false)
})

test('duplicate successful ledger rows block the exception', () => {
  const helper = loadHelper(helperBlocks[0])
  assert.equal(helper.isMigration3HistoricalChecksumException(makeInput({ ledger: [rolledBackRow(), successfulRow(), successfulRow()] })), false)
})

test('workflow queries the same read-only schema metadata in both gates and binds preflight hashes to postcheck', () => {
  const columnQuery = "SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'WantListenSession' AND COLUMN_NAME = 'excludedFromLeaderboard'"
  const indexQuery = "SELECT INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'WantListenSession' AND INDEX_NAME = 'WantListenSession_excludedFromLeaderboard_status_completedAt_idx' ORDER BY SEQ_IN_INDEX"
  assert.equal(workflow.split(columnQuery).length - 1, 2)
  assert.equal(workflow.split(indexQuery).length - 1, 2)
  assert.match(workflow, /migration_3_production_sql_sha256=%s/)
  assert.match(workflow, /migration_3_candidate_sql_sha256=%s/)
  assert.match(workflow, /EXPECTED_MIGRATION_3_PRODUCTION_SQL_SHA256: \$\{\{ steps\.production_preflight\.outputs\.migration_3_production_sql_sha256 \}\}/)
  assert.match(workflow, /EXPECTED_MIGRATION_3_CANDIDATE_SQL_SHA256: \$\{\{ steps\.production_preflight\.outputs\.migration_3_candidate_sql_sha256 \}\}/)
  assert.match(workflow, /CANDIDATE_SHA: 2b6d06b630dfed7e8ce6e518e10bda52b919af8b/)
  assert.match(workflow, /ORIGINAL_MAIN_BASE_SHA: 1a0c8b9d85c7aa61f5a70e37bcdee563b5bff063/)
  const configuredAuditedParent = workflow.match(/^\s*AUDITED_WORKFLOW_PARENT_SHA:\s*([0-9a-f]{40})\s*$/m)?.[1]
  const expectedAuditedParent = workflow.match(/const expectedAuditedParent = '([0-9a-f]{40})'/)?.[1]
  assert.match(configuredAuditedParent || '', /^[0-9a-f]{40}$/)
  assert.equal(configuredAuditedParent, expectedAuditedParent)
  assert.match(workflow, /const migration3ExceptionTestPath = '\.github\/release\/test-production-server-rc-v3-migration-exception\.mjs'/)
  assert.match(workflow, /dbChecksum !== rHash\)\) && !migration3ExceptionForName/)
  assert.match(workflow, /ledgerState\.checksum !== checksum && !migration3ExceptionForName/)
  assert.match(workflow, /if \(migration3LedgerState\.succeeded && migration3LedgerState\.checksum !== migration3HistoricalExceptionPolicy\.successfulLedgerChecksum\) stop/)
  assert.match(workflow, /grep -qx 'MIGRATION_3_HISTORICAL_CHECKSUM_EXCEPTION=APPLIED'/)
  assert.match(workflow, /'MIGRATION_3_HISTORICAL_CHECKSUM_EXCEPTION=APPLIED' 'POST_DEPLOY_MIGRATION_CHECK=PASS'/)
})
