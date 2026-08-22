import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  inspectMigrationSql,
  runMigrationMysqlCheck,
  stripSqlComments,
} from '../scripts/check-migrations-mysql'

const read = (filePath: string) => readFileSync(filePath, 'utf8')

test('legacy PostgreSQL migration is explicitly excluded from MySQL static checks', () => {
  const inspection = inspectMigrationSql(
    '20260727220000_legacy',
    'ALTER TYPE "PointActionType" ADD VALUE \'POST_DAILY_FIRST\';',
    true,
  )
  assert.equal(inspection.legacy, true)
  assert.deepEqual(inspection.findings, [])
})

test('SQL comments are removed without false-positive PostgreSQL findings', () => {
  const source = `-- ALTER TYPE "Table"\n/* DO $$; ON CONFLICT; */\nCREATE TABLE \`Safe\` (\`id\` VARCHAR(191) NOT NULL);`
  const executable = stripSqlComments(source)
  assert.doesNotMatch(executable, /ALTER TYPE|DO \$\$|ON CONFLICT/)
  assert.deepEqual(inspectMigrationSql('future', source).findings, [])
})

test('future MySQL migrations reject PostgreSQL SQL and double-quoted identifiers', () => {
  const findings = inspectMigrationSql('future', 'CREATE TABLE "Table" ("column" JSONB);').findings
  assert.ok(findings.some((finding) => finding.code === 'PG_JSONB'))
  assert.ok(findings.some((finding) => finding.code === 'PG_DOUBLE_QUOTED_IDENTIFIER'))
})

test('static checker reports long identifiers and CHECK/FK risk', () => {
  const longIndex = 'x'.repeat(65)
  const findings = inspectMigrationSql('future', `CREATE TABLE \`Safe\` (\`id\` VARCHAR(191), CHECK (\`id\` <> \'\'), CONSTRAINT \`${longIndex}\` FOREIGN KEY (\`id\`) REFERENCES \`Other\`(\`id\`) ON DELETE CASCADE);`).findings
  assert.ok(findings.some((finding) => finding.code === 'MYSQL_IDENTIFIER_TOO_LONG'))
  assert.ok(findings.some((finding) => finding.code === 'MYSQL_3823_RISK' && finding.severity === 'HIGH'))
})

test('repository migration check skips exactly the legacy boundary and passes future SQL', () => {
  const result = runMigrationMysqlCheck()
  assert.equal(result.legacy.length, 21)
  assert.ok(result.future.length > 0)
  assert.equal(result.passed, true)
})

test('Honor Badge migration orders nullable backfill before NOT NULL and has no AUTO rule backfill', () => {
  const honor = read('prisma/migrations/20260821153000_add_honor_badge_system/migration.sql')
  const rule = read('prisma/migrations/20260822100000_add_badge_auto_rules/migration.sql')
  assert.ok(honor.indexOf('ADD COLUMN `code` VARCHAR(191) NULL') < honor.indexOf('UPDATE `Badge`'))
  assert.ok(honor.indexOf('UPDATE `Badge`') < honor.indexOf('MODIFY COLUMN `code` VARCHAR(191) NOT NULL'))
  assert.ok(honor.indexOf('ADD COLUMN `obtainedAt` DATETIME(3) NULL') < honor.indexOf('UPDATE `UserBadge`'))
  assert.ok(honor.indexOf('UPDATE `UserBadge`') < honor.indexOf('MODIFY COLUMN `obtainedAt` DATETIME(3) NOT NULL'))
  assert.doesNotMatch(`${honor}\n${rule}`, /INSERT\s+INTO\s+`?BadgeRule`?/i)
  assert.match(honor, /equippedBadgeId[\s\S]*?ON DELETE SET NULL/i)
  assert.match(honor, /grantedBy[\s\S]*?ON DELETE SET NULL/i)
})
