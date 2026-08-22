import assert from 'node:assert/strict'
import test from 'node:test'
import { inspectMigrationSql } from '../scripts/check-migrations-mysql'

test('migration preflight does not flag unrelated CHECK and foreign-key columns', () => {
  const inspection = inspectMigrationSql('20260815090000_add_song_ratings', `
    CREATE TABLE \`Rating\` (
      \`score\` INTEGER NOT NULL,
      CHECK (\`score\` BETWEEN 1 AND 10)
    );
    ALTER TABLE \`Rating\`
      ADD CONSTRAINT \`Rating_userId_fkey\`
      FOREIGN KEY (\`userId\`) REFERENCES \`User\`(\`id\`) ON DELETE RESTRICT;
  `)
  assert.equal(inspection.findings.some((finding) => finding.code === 'MYSQL_3823_RISK'), false)
})

test('migration preflight flags a CHECK that covers a foreign-key column', () => {
  const inspection = inspectMigrationSql('20260822000000_same_column_check', `
    CREATE TABLE \`Child\` (
      \`parentId\` VARCHAR(191) NOT NULL,
      CHECK (\`parentId\` <> '')
    );
    ALTER TABLE \`Child\`
      ADD CONSTRAINT \`Child_parentId_fkey\`
      FOREIGN KEY (\`parentId\`) REFERENCES \`Parent\`(\`id\`) ON DELETE CASCADE;
  `)
  assert.equal(inspection.findings.some((finding) => finding.code === 'MYSQL_3823_RISK'), true)
})
