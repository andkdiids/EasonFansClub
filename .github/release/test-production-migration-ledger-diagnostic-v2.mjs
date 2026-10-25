import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import {
  CANDIDATE_SHA,
  EXPECTED_PRODUCTION_SHA,
  MIGRATIONS,
  classifyMigration,
  checksumsEqual,
  compareSchema,
  databaseIdentityMatches,
  ledgerChecksumEvidence,
  metadataVisibilityStatus,
  parseDatabaseGrantScope,
  parseDatabaseUrlTarget,
  parseMigrationSql,
  preserveLedgerRows,
  readDatabaseContext,
  safeErrorClass,
  validateHostIdentity,
} from './production-migration-ledger-diagnostic-v2.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')
const workflowPath = path.join(root, '.github/workflows/production-migration-ledger-diagnostic-v2.yml')
const helperPath = path.join(here, 'production-migration-ledger-diagnostic-v2.mjs')
const requiredFields = new Set(['id', 'migration_name', 'checksum', 'started_at', 'finished_at', 'rolled_back_at', 'applied_steps_count', 'logs'])
const checksum = 'a'.repeat(64)
const started = '2026-08-15 09:00:00.000'
const finished = '2026-08-15 09:00:01.000'
const rolledBack = '2026-08-15 09:00:02.000'
const ledgerRow = overrides => ({
  id: 'fixture-id-1', migration_name: MIGRATIONS[0], checksum,
  started_at: started, finished_at: finished, rolled_back_at: null,
  applied_steps_count: '1', logs_status: 'NULL', ...overrides,
})

test('diagnostic targets remain pinned to the approved production and candidate SHAs', () => {
  assert.equal(CANDIDATE_SHA, '2b6d06b630dfed7e8ce6e518e10bda52b919af8b')
  assert.equal(EXPECTED_PRODUCTION_SHA, '1a0c8b9d85c7aa61f5a70e37bcdee563b5bff063')
  assert.deepEqual(MIGRATIONS, [
    '20260815090000_add_song_ratings',
    '20260816120000_add_want_listen_game',
    '20260820140000_add_want_listen_session_exclusion',
    '20260821120000_add_rate_limit_log',
    '20260826100000_add_anywhere_door_social_posts',
    '20260827100000_add_anywhere_door_safety_state',
  ])
})

test('pinned SSH identity accepts exact trusted host, key, and fingerprint', () => {
  const keyBlob = Buffer.from('synthetic-public-key').toString('base64')
  const fingerprint = `SHA256:${(awaitlessHash(Buffer.from('synthetic-public-key'))).replace(/=+$/, '')}`
  assert.deepEqual(validateHostIdentity({
    host: 'prod.example.invalid', user: 'deploy', port: '22', sshKey: 'synthetic-private-key',
    pinnedHosts: `prod.example.invalid ssh-ed25519 ${keyBlob}`, pinnedFingerprint: fingerprint,
  }), { verified: true })
})

test('pinned SSH identity rejects a fingerprint mismatch', () => {
  const keyBlob = Buffer.from('synthetic-public-key').toString('base64')
  assert.throws(() => validateHostIdentity({
    host: 'prod.example.invalid', user: 'deploy', port: '22', sshKey: 'synthetic-private-key',
    pinnedHosts: `prod.example.invalid ssh-ed25519 ${keyBlob}`, pinnedFingerprint: 'SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  }), error => error.code === 'HOST_FINGERPRINT_MISMATCH')
})

test('pinned SSH identity fails closed when trusted fingerprint is absent', () => {
  assert.throws(() => validateHostIdentity({
    host: 'prod.example.invalid', user: 'deploy', port: '22', sshKey: 'synthetic-private-key',
    pinnedHosts: 'prod.example.invalid ssh-ed25519 QUJD', pinnedFingerprint: '',
  }), error => error.code === 'HOST_FINGERPRINT_MISSING')
})

test('pinned SSH identity binds non-default port to the trusted known-host entry', () => {
  const keyBytes = Buffer.from('port-specific-key')
  const keyBlob = keyBytes.toString('base64')
  const fingerprint = `SHA256:${awaitlessHash(keyBytes).replace(/=+$/, '')}`
  assert.throws(() => validateHostIdentity({
    host: 'prod.example.invalid', user: 'deploy', port: '2222', sshKey: 'synthetic-private-key',
    pinnedHosts: `prod.example.invalid ssh-ed25519 ${keyBlob}`, pinnedFingerprint: fingerprint,
  }), error => error.code === 'HOST_BINDING_INVALID')
})

test('all six pinned candidate SQL blobs parse and match the production baseline blobs', () => {
  for (const name of MIGRATIONS) {
    const file = `prisma/migrations/${name}/migration.sql`
    const candidateBytes = execFileSync('git', ['show', `${CANDIDATE_SHA}:${file}`], { cwd: root })
    const productionBytes = execFileSync('git', ['show', `${EXPECTED_PRODUCTION_SHA}:${file}`], { cwd: root })
    assert.ok(candidateBytes.equals(productionBytes), `${name} differs between fixed production baseline and RC`)
    const sql = candidateBytes.toString('utf8')
    assert.ok(Buffer.from(sql, 'utf8').equals(candidateBytes), `${name} is not valid UTF-8`)
    const manifest = parseMigrationSql(sql)
    assert.ok(Object.values(manifest).some(entries => entries.length > 0), `${name} yielded no schema objects`)
  }
})

test('normal single-success ledger record classifies only with checksum and schema match', () => {
  assert.equal(classifyMigration({ rows: [ledgerRow()], availableFields: requiredFields, productionSha: checksum, rcSha: checksum, schemaMatch: 'YES' }), 'NORMAL_SUCCESS')
})

test('checksum comparison is hexadecimal case-insensitive while preserving raw ledger text', () => {
  const upper = checksum.toUpperCase()
  assert.equal(checksumsEqual(upper, checksum), true)
  assert.equal(preserveLedgerRows([ledgerRow({ checksum: upper })], requiredFields)[0].checksum, upper)
})

test('historical rollback plus exactly one success is distinguished', () => {
  const rolled = ledgerRow({ id: 'fixture-id-rolled', finished_at: null, rolled_back_at: rolledBack })
  assert.equal(classifyMigration({ rows: [rolled, ledgerRow({ id: 'fixture-id-success' })], availableFields: requiredFields, productionSha: checksum, rcSha: checksum, schemaMatch: 'YES' }), 'HISTORICAL_ROLLED_BACK_PLUS_SUCCESS')
})

test('historical rollback checksum differences do not invalidate the matching current success', () => {
  const rolled = ledgerRow({ id: 'fixture-id-rolled', checksum: 'b'.repeat(64), finished_at: null, rolled_back_at: rolledBack })
  const successful = ledgerRow({ id: 'fixture-id-success', checksum })
  assert.equal(classifyMigration({ rows: [rolled, successful], availableFields: requiredFields, productionSha: checksum, rcSha: checksum, schemaMatch: 'YES' }), 'HISTORICAL_ROLLED_BACK_PLUS_SUCCESS')
  assert.deepEqual(ledgerChecksumEvidence([rolled, successful], checksum, checksum), [
    { row: 1, type: 'ROLLED_BACK', productionMatch: 'NO', candidateMatch: 'NO' },
    { row: 2, type: 'SUCCESS', productionMatch: 'YES', candidateMatch: 'YES' },
  ])
})

test('a current successful ledger checksum mismatch remains a hard mismatch', () => {
  assert.equal(classifyMigration({ rows: [ledgerRow({ checksum: 'b'.repeat(64) })], availableFields: requiredFields, productionSha: checksum, rcSha: checksum, schemaMatch: 'YES' }), 'CHECKSUM_MISMATCH')
})

test('database URL target parsing handles encoded credential punctuation without returning credentials', () => {
  const target = parseDatabaseUrlTarget('mysql://qa-user:p%40ss%3Aword%23part@db.example.invalid:3307/ecfc%5Fprod?connection_limit=5')
  assert.deepEqual(target, { hostPresent: true, portPresent: true, port: 3307, databaseName: 'ecfc_prod' })
  assert.equal(Object.hasOwn(target, 'username'), false)
  assert.equal(Object.hasOwn(target, 'password'), false)
  assert.deepEqual(parseDatabaseUrlTarget('mysql://qa-user:secret@db.example.invalid/ecfc_prod'), {
    hostPresent: true,
    portPresent: false,
    port: 3306,
    databaseName: 'ecfc_prod',
  })
})

test('database identity requires exact URL schema match and visible current schema', () => {
  assert.equal(databaseIdentityMatches('ecfc_prod', 'ecfc_prod', true), true)
  assert.equal(databaseIdentityMatches('ecfc_prod', 'other_db', true), false)
  assert.equal(databaseIdentityMatches('ecfc_prod', 'ecfc_prod', false), false)
  assert.equal(databaseIdentityMatches('ecfc_prod', null, true), false)
})

test('schema-wide grants establish metadata visibility while object-only grants do not', () => {
  const broad = parseDatabaseGrantScope([
    { grant: 'GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER ON `ecfc_prod`.* TO `app`@`%`' },
    { grant: 'GRANT USAGE ON *.* TO `app`@`%`' },
  ], 'ecfc_prod')
  assert.deepEqual(broad, { readable: true, scope: 'SCHEMA_WIDE', schemaWide: true, roleAssignments: 'NO' })

  const objectOnly = parseDatabaseGrantScope([
    { grant: 'GRANT SELECT ON `ecfc_prod`.`_prisma_migrations` TO `app`@`%`' },
  ], 'ecfc_prod')
  assert.equal(objectOnly.scope, 'OBJECT_LEVEL')
  assert.equal(objectOnly.schemaWide, false)
  assert.equal(metadataVisibilityStatus({ schemaPresent: true, ledgerVisible: true, grantScope: objectOnly }), 'PARTIAL')
  assert.equal(metadataVisibilityStatus({ schemaPresent: true, ledgerVisible: true, grantScope: broad }), 'VERIFIED')
  assert.equal(metadataVisibilityStatus({ schemaPresent: true, ledgerVisible: false, grantScope: broad }), 'UNKNOWN')
})

test('partial revokes prevent a broad grant from being treated as complete visibility', () => {
  const scope = parseDatabaseGrantScope([
    { grant: 'GRANT SELECT ON *.* TO `app`@`%`' },
    { grant: 'REVOKE SELECT ON `ecfc_prod`.* FROM `app`@`%`' },
  ], 'ecfc_prod')
  assert.equal(scope.scope, 'REVOKED_OR_PARTIAL')
  assert.equal(scope.schemaWide, false)
})

test('routine-only schema grants do not prove table metadata visibility', () => {
  const scope = parseDatabaseGrantScope([
    { grant: 'GRANT EXECUTE, CREATE ROUTINE ON `ecfc_prod`.* TO `app`@`%`' },
  ], 'ecfc_prod')
  assert.equal(scope.scope, 'NON_TABLE_PRIVILEGE')
  assert.equal(scope.schemaWide, false)
  assert.equal(metadataVisibilityStatus({ schemaPresent: true, ledgerVisible: true, grantScope: scope }), 'UNKNOWN')
})

test('database context probe stays on the selected schema and uses only read-only statements', async () => {
  const calls = []
  const db = {
    async $queryRawUnsafe(sql, ...values) {
      calls.push({ sql, values })
      if (sql === 'SELECT DATABASE() AS selectedDatabase') return [{ selectedDatabase: 'ecfc_prod' }]
      if (sql.includes('INFORMATION_SCHEMA.SCHEMATA')) return [{ schemaName: 'ecfc_prod' }]
      if (sql.includes('COUNT(*) AS tableCount')) return [{ tableCount: 249n }]
      if (sql.includes('INFORMATION_SCHEMA.TABLES')) return [{ tableName: 'User' }, { tableName: '_prisma_migrations' }, { tableName: 'SongRating' }]
      if (sql === 'SHOW GRANTS') return [{ grant: 'GRANT SELECT ON `ecfc_prod`.* TO `app`@`%`' }]
      throw new Error('Unexpected test query')
    },
  }
  const target = { hostPresent: true, portPresent: false, port: 3306, databaseName: 'ecfc_prod' }
  const context = await readDatabaseContext(db, target, ['SongRating'])
  assert.equal(context.identityVerified, true)
  assert.equal(context.currentSchemaTableCount, 249)
  assert.equal(context.ledgerTableVisible, true)
  assert.deepEqual(context.currentNames, ['SongRating', 'User', '_prisma_migrations'])
  assert.equal(context.grantScope.scope, 'SCHEMA_WIDE')
  assert.ok(calls.every(({ sql }) => /^SELECT\b/i.test(sql) || sql === 'SHOW GRANTS'))
  assert.ok(calls.filter(({ sql }) => sql.includes('INFORMATION_SCHEMA.TABLES')).every(({ sql }) => /TABLE_SCHEMA\s*=\s*DATABASE\(\)/i.test(sql)))
})

test('multiple successful ledger records classify as duplicate success', () => {
  assert.equal(classifyMigration({ rows: [ledgerRow(), ledgerRow({ id: 'fixture-id-2', started_at: '2026-08-15 09:01:00.000' })], availableFields: requiredFields, productionSha: checksum, rcSha: checksum, schemaMatch: 'YES' }), 'DUPLICATE_SUCCESS')
})

test('unfinished non-rolled-back ledger record is an active failure', () => {
  assert.equal(classifyMigration({ rows: [ledgerRow({ finished_at: null })], availableFields: requiredFields, productionSha: checksum, rcSha: checksum, schemaMatch: 'YES' }), 'ACTIVE_FAILED')
})

test('ledger checksum mismatch is never hidden by a matching local file pair', () => {
  assert.equal(classifyMigration({ rows: [ledgerRow({ checksum: 'b'.repeat(64) })], availableFields: requiredFields, productionSha: checksum, rcSha: checksum, schemaMatch: 'YES' }), 'CHECKSUM_MISMATCH')
})

test('only rolled-back records are not classified as success', () => {
  assert.equal(classifyMigration({ rows: [ledgerRow({ finished_at: null, rolled_back_at: rolledBack })], availableFields: requiredFields, productionSha: checksum, rcSha: checksum, schemaMatch: 'YES' }), 'ROLLED_BACK_ONLY')
})

test('ambiguous ledger rows with both finished and rollback timestamps fail closed', () => {
  assert.equal(classifyMigration({ rows: [ledgerRow({ rolled_back_at: rolledBack })], availableFields: requiredFields, productionSha: checksum, rcSha: checksum, schemaMatch: 'YES' }), 'UNKNOWN')
})

test('missing expected table, column, index, foreign key, or check stays visible as schema mismatch', () => {
  const manifest = parseMigrationSql('CREATE TABLE `Probe` (`id` VARCHAR(191) NOT NULL, PRIMARY KEY (`id`), CONSTRAINT `Probe_id_chk` CHECK (`id` <> \'\'));')
  const comparison = compareSchema(manifest, { tables: [], columns: [], indexes: [], foreignKeys: [], checks: [] })
  assert.equal(comparison.match, 'NO')
  assert.equal(comparison.missing.length, 4)
  assert.equal(comparison.unexpected.length, 0)
})

test('schema comparison verifies table, column, index, foreign-key, and check definitions', () => {
  const manifest = parseMigrationSql(`CREATE TABLE \`Probe\` (
    \`id\` INT NOT NULL,
    \`parentId\` INT NULL DEFAULT NULL,
    PRIMARY KEY (\`id\`),
    UNIQUE INDEX \`Probe_parentId_key\` (\`parentId\`),
    CONSTRAINT \`Probe_parentId_fkey\` FOREIGN KEY (\`parentId\`) REFERENCES \`Parent\` (\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT \`Probe_id_chk\` CHECK (\`id\` > 0)
  );
  CREATE INDEX \`Probe_parentId_idx\` ON \`Probe\` (\`parentId\`);`)
  const actual = {
    tables: manifest.tables.map(name => ({ name, type: 'BASE TABLE' })),
    columns: manifest.columns.map(item => ({ ...item, columnType: item.type, dataType: item.type, defaultValue: item.defaultValue })),
    indexes: manifest.indexes.map(item => ({ ...item, columns: [...item.columns] })),
    foreignKeys: manifest.foreignKeys.map(item => ({ ...item, columns: [...item.columns], referencedColumns: [...item.referencedColumns], onUpdate: 'RESTRICT' })),
    checks: manifest.checks.map(item => ({ ...item })),
  }
  assert.equal(compareSchema(manifest, actual).match, 'YES')
  actual.columns[0].nullable = 'YES'
  const mismatch = compareSchema(manifest, actual)
  assert.equal(mismatch.match, 'NO')
  assert.equal(mismatch.unexpected.length, 1)
  assert.ok(mismatch.actual.some(item => item.kind === 'COLUMN' && item.nullable === 'YES'))
})

test('raw database error messages are reduced to safe error classes', () => {
  const secretCanary = 'mysql://synthetic-user:synthetic-secret@db.invalid/schema'
  assert.equal(safeErrorClass(new Error(secretCanary), 'database-connect'), 'DATABASE_CONNECTIVITY_FAILED')
  assert.equal(safeErrorClass(new Error(secretCanary), 'ledger-query'), 'LEDGER_METADATA_READ_FAILED')
})

test('same-name ledger rows are preserved separately and never folded', () => {
  const rows = [ledgerRow(), ledgerRow({ id: 'fixture-id-2', finished_at: null, rolled_back_at: rolledBack })]
  const output = preserveLedgerRows(rows, requiredFields)
  assert.equal(output.length, 2)
  assert.deepEqual(output.map(row => row.id), ['fixture-id-1', 'fixture-id-2'])
})

test('only relevant ledger metadata fields are emitted by the diagnostic', () => {
  const source = fs.readFileSync(helperPath, 'utf8')
  assert.match(source, /LEDGER_TABLE_COLUMNS', JSON\.stringify\(LEDGER_FIELDS\.map/)
})

test('logs content is reduced to NULL EMPTY or NONEMPTY and never emitted', () => {
  const canary = 'synthetic-private-log-canary'
  const output = JSON.stringify(preserveLedgerRows([ledgerRow({ logs_status: 'NONEMPTY', logs: canary })], requiredFields))
  assert.match(output, /"logs":"NONEMPTY"/)
  assert.doesNotMatch(output, new RegExp(canary))
})

test('diagnostic performs no database write API calls or migration command', () => {
  const source = fs.readFileSync(helperPath, 'utf8')
  assert.doesNotMatch(source, /\.(?:\$executeRaw|\$executeRawUnsafe|\$transaction)\b/)
  assert.doesNotMatch(source, /\b(?:migrate\s+(?:deploy|resolve)|db\s+(?:push|reset))\b/i)
  assert.doesNotMatch(source, /console\.(?:log|error)\([^\n]*(?:databaseUrl|error\.message|error\.stack|parsed\.DATABASE_URL)/i)
  const queryCalls = [...source.matchAll(/\$queryRawUnsafe\(\s*`?['`]?\s*(SELECT)\b/gi)]
  assert.ok(queryCalls.length >= 6)
  assert.match(source, /\$queryRawUnsafe\('SHOW GRANTS'\)/)
  assert.doesNotMatch(source, /FROM INFORMATION_SCHEMA\.TABLES WHERE TABLE_NAME IN/i)
  assert.doesNotMatch(source, /console\.log\([^\n]*(?:databaseUrl|selectedDatabase|currentUser|grantScope\.rows)/i)
})

test('workflow is manual-only, read-only, and does not invoke release workflow', () => {
  const source = fs.readFileSync(workflowPath, 'utf8')
  assert.match(source, /^on:\s*\r?\n\s+workflow_dispatch:/m)
  assert.doesNotMatch(source, /^\s+(?:push|pull_request|schedule|workflow_run|repository_dispatch):/m)
  assert.match(source, /environment:\s*Production/)
  assert.match(source, /git -C "\$GITHUB_WORKSPACE\/workflow-source" rev-parse HEAD/)
  assert.match(source, /repos\/\$\{repository\}\/git\/ref\/heads\/integration\/mobile-server-rc-v3/)
  assert.match(source, /body\?\.object\?\.sha !== expected/)
  assert.match(source, /uses:\s*actions\/checkout@11d5960a326750d5838078e36cf38b85af677262/)
  assert.doesNotMatch(source, /uses:\s*actions\/checkout@v\d+/)
  assert.doesNotMatch(source, /production-server-rc-v3|production-release-approved|workflow run|gh run|migrate\s+(?:deploy|resolve)/i)
  assert.match(source, /StrictHostKeyChecking=yes/)
  assert.doesNotMatch(source, /StrictHostKeyChecking=no|ssh-keyscan/)
})

test('workflow confines production removal to the validated temporary diagnostic directory', () => {
  const source = fs.readFileSync(workflowPath, 'utf8')
  assert.match(source, /\/tmp\/ecfc-migration-ledger-v2\\\./)
  assert.match(source, /trap 'rm -rf -- "\$tmp"' EXIT/)
  assert.match(source, /\[\[ "\$path" =~ \^\/tmp\/ecfc-migration-ledger-v2/)
  assert.match(source, /rm -rf -- "\$path"/)
  assert.doesNotMatch(source, /sudo\s|systemctl\s+(?:restart|reload)|pm2\s+(?:restart|reload|start|stop|delete|save)|\bln\s+-s|\bprisma\b.*\bmigrate\b/i)
})

function awaitlessHash(bytes) {
  return createHash('sha256').update(bytes).digest('base64')
}
