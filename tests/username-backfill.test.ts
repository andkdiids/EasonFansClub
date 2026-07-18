import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { buildUsernameBatchUpdate, classifyExistingStaging, prepareUsernameBackfill } from '../lib/username-backfill'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

function users(count = 84) {
  return Array.from({ length: count }, (_, index) => ({ id: `user-${index + 1}`, uid: index + 1, username: `User${String(index + 1).padStart(3, '0')}` }))
}

test('84 名用户在事务外一次性生成稳定映射和快照', () => {
  const prepared = prepareUsernameBackfill(users())
  assert.equal(prepared.blocked, false)
  assert.equal(prepared.mapping.length, 84)
  assert.equal(prepared.duplicateIds, 0)
  assert.equal(prepared.duplicateUids, 0)
  assert.equal(prepared.invalid.length, 0)
  assert.equal(prepared.conflicts.length, 0)
  assert.equal(prepared.mapping[0].normalized, 'user001')
  assert.equal(prepared.snapshotFingerprint.length, 64)
})

test('规范化冲突、重复 id 和重复 UID 会在生成写事务前阻断', () => {
  const rows = [
    { id: 'one', uid: 1, username: 'World' },
    { id: 'two', uid: 2, username: 'ＷＯＲＬＤ' },
    { id: 'two', uid: 2, username: 'Another' },
  ]
  const prepared = prepareUsernameBackfill(rows)
  assert.equal(prepared.blocked, true)
  assert.equal(prepared.conflicts.length, 1)
  assert.equal(prepared.duplicateIds, 1)
  assert.equal(prepared.duplicateUids, 1)
})

test('批量 UPDATE 只生成一条参数化 VALUES SQL', () => {
  const batch = buildUsernameBatchUpdate([
    { id: 'user-1', normalized: 'world' },
    { id: 'user-2', normalized: 'eason' },
  ])
  assert.match(batch.text, /^UPDATE "User" AS u SET "usernameNormalized" = v\.normalized FROM \(VALUES /)
  assert.match(batch.text, /\(\$1::text, \$2::text\), \(\$3::text, \$4::text\)/)
  assert.deepEqual(batch.parameters, ['user-1', 'world', 'user-2', 'eason'])
  assert.doesNotMatch(batch.text, /world|eason|user-1|user-2/)
})

test('已有 staging 字段仅允许全空或完全匹配，部分回填会拒绝', () => {
  const mapping = [{ id: 'one', normalized: 'world' }, { id: 'two', normalized: 'eason' }]
  assert.equal(classifyExistingStaging([{ id: 'one', usernameNormalized: null }, { id: 'two', usernameNormalized: null }], mapping), 'EMPTY')
  assert.equal(classifyExistingStaging([{ id: 'one', usernameNormalized: 'world' }, { id: 'two', usernameNormalized: 'eason' }], mapping), 'COMPLETE')
  assert.equal(classifyExistingStaging([{ id: 'one', usernameNormalized: 'world' }, { id: 'two', usernameNormalized: null }], mapping), 'PARTIAL_OR_MISMATCHED')
})

test('生产脚本不再使用 Prisma interactive transaction 或逐条 update', () => {
  const script = source('scripts/backfill-username-normalized.ts')
  assert.doesNotMatch(script, /prisma\.\$transaction\s*\(\s*async/)
  assert.doesNotMatch(script, /tx\.user\.update|for\s*\([^)]*\)\s*\{[\s\S]*?UPDATE "User"/)
  assert.match(script, /buildUsernameBatchUpdate\(prepared\.mapping\)/)
  assert.match(script, /batchUpdateStatements: 1/)
})

test('脚本优先 DIRECT_URL 并拒绝 Transaction Pooler', () => {
  const script = source('scripts/backfill-username-normalized.ts')
  assert.match(script, /process\.env\.DIRECT_URL \|\| process\.env\.DATABASE_URL/)
  assert.match(script, /port === 6543/)
  assert.match(script, /TRANSACTION_POOLER/)
  assert.match(script, /禁止执行回填/)
})

test('原子事务包含 advisory lock、用户锁、行数校验、COMMIT 与 ROLLBACK', () => {
  const script = source('scripts/backfill-username-normalized.ts')
  assert.match(script, /pg_try_advisory_xact_lock/)
  assert.match(script, /LOCK TABLE "User" IN SHARE ROW EXCLUSIVE MODE/)
  assert.match(script, /update\.rowCount !== prepared\.mapping\.length/)
  assert.match(script, /USERNAME_BACKFILL_SNAPSHOT_CHANGED/)
  assert.match(script, /USERNAME_BACKFILL_ADVISORY_LOCK_UNAVAILABLE/)
  assert.match(script, /await writeClient\.query\('COMMIT'\)/)
  assert.match(script, /await writeClient\.query\('ROLLBACK'\)/)
})

test('脚本不会更新 username、UID、User.id 或输出连接凭据', () => {
  const script = source('scripts/backfill-username-normalized.ts')
  assert.doesNotMatch(script, /SET\s+username\s*=/i)
  assert.doesNotMatch(script, /SET\s+(uid|id)\s*=/i)
  assert.doesNotMatch(script, /console\.(log|info|error).*connectionString|DATABASE_URL.*console/i)
  assert.doesNotMatch(script, /passwordHash|answerHash|tokenHash|cookie/i)
})

test('migration 要求 staging 字段存在且不会自行添加该字段', () => {
  const migration = source('prisma/migrations/20260719120000_add_login_account_and_checkin_preferences/migration.sql')
  assert.match(migration, /USERNAME_NORMALIZED_STAGING_COLUMN_REQUIRED/)
  assert.doesNotMatch(migration, /ADD COLUMN(?: IF NOT EXISTS)? "usernameNormalized"/)
  assert.match(migration, /USERNAME_NORMALIZED_BACKFILL_REQUIRED/)
  assert.match(migration, /USERNAME_NORMALIZED_CONFLICTS_EXIST/)
})
