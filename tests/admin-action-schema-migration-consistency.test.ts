import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const schema = readFileSync(join(here, '..', 'prisma', 'schema.prisma'), 'utf8')
const migration = readFileSync(
  join(here, '..', 'prisma', 'migrations', '20260818210000_repair_admin_action_audit_fields', 'migration.sql'),
  'utf8',
)

// Pull a single model block out of the Prisma schema.
function extractModel(src: string, name: string): string {
  const start = src.indexOf(`model ${name} {`)
  assert.ok(start !== -1, `model ${name} not found in schema`)
  const afterBrace = src.indexOf('{', start)
  const rest = src.slice(afterBrace + 1)
  const end = rest.indexOf('\n}')
  assert.ok(end !== -1, `model ${name} closing brace not found`)
  return rest.slice(0, end)
}

const adminActionModel = extractModel(schema, 'AdminAction')

// Scalar columns are the plain `name Type` lines (not relations, not @@index).
const scalarFields = adminActionModel
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('@@') && !line.includes('@relation'))
  .map((line) => line.split(/\s+/)[0])
  .filter((name) => name && /^[a-zA-Z_]/.test(name))

// Columns already present on the production table (confirmed via SHOW CREATE TABLE).
// If a future migration adds columns to production, extend this baseline so the
// drift check keeps targeting only the genuinely missing columns.
const productionBaseline = new Set<string>([
  'id',
  'action',
  'reason',
  'metadata',
  'createdAt',
  'adminId',
  'targetUserId',
  'postId',
  'replyId',
  'boardId',
])

// Every AdminAction column the app expects but production lacks today must be
// added by the repair migration. This is the regression guard: if someone adds
// a new scalar field to the model without updating the migration, this list
// grows and the migration assertion fails.
const expectedAddedColumns = scalarFields.filter((field) => !productionBaseline.has(field))

test('AdminAction columns missing in production are added by the repair migration', () => {
  assert.ok(expectedAddedColumns.length > 0, 'expected at least one missing audit column')
  for (const column of expectedAddedColumns) {
    assert.ok(adminActionModel.includes(column), `schema AdminAction must define ${column}`)
    assert.match(
      migration,
      new RegExp(`ADD COLUMN \`${column}\``),
      `repair migration must add column ${column}`,
    )
  }
})

test('repair migration relaxes adminId to nullable and rebuilds the FK as SET NULL', () => {
  assert.match(migration, /DROP FOREIGN KEY `AdminAction_adminId_fkey`/)
  assert.match(migration, /MODIFY COLUMN `adminId`[^;]*NULL/)
  assert.match(
    migration,
    /ADD CONSTRAINT `AdminAction_adminId_fkey`[\s\S]*ON DELETE SET NULL ON UPDATE CASCADE/,
  )
})

test('repair migration adds the four missing composite indexes', () => {
  for (const index of [
    'AdminAction_operationType_createdAt_idx',
    'AdminAction_operatorUid_createdAt_idx',
    'AdminAction_targetType_createdAt_idx',
    'AdminAction_targetId_createdAt_idx',
  ]) {
    assert.match(migration, new RegExp(`CREATE INDEX \`${index}\``), `migration must create index ${index}`)
  }
})

test('repair migration never drops or rebuilds the AdminAction table', () => {
  // Match real SQL statements only (a comment line mentions these words for
  // documentation, so anchor on the statement keyword at line start).
  assert.ok(!/^\s*DROP TABLE `AdminAction`/im.test(migration), 'must not drop the table')
  assert.ok(!/^\s*CREATE TABLE `AdminAction`/im.test(migration), 'must not recreate the table')
  assert.ok(!/^\s*TRUNCATE\b/im.test(migration), 'must not truncate')
  assert.ok(!/^\s*DROP COLUMN/im.test(migration), 'must not drop any column')
})
