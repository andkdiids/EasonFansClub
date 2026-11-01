import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'
import { fileURLToPath } from 'node:url'

const TEST_DATABASE = 'recording_sessions_v2_qa'
const MIGRATION_PATH = fileURLToPath(new URL('../prisma/migrations/20261102090000_add_social_post_text_media_type/migration.sql', import.meta.url))
let stage = 'test-setup'

function resolveTestUrl() {
  if (process.env.DATABASE_URL) throw new Error('TEST_DATABASE_FALLBACK_FORBIDDEN')
  const raw = process.env.INSTAGRAM_TEXT_TEST_ADMIN_URL
  if (!raw) throw new Error('DEDICATED_TEST_DATABASE_REQUIRED')
  const url = new URL(raw)
  if (url.protocol !== 'mysql:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.port !== '3306' || url.pathname !== `/${TEST_DATABASE}` || url.search || url.hash) {
    throw new Error('TEST_DATABASE_IDENTITY_MISMATCH')
  }
  return raw
}

async function main() {
  const testUrl = resolveTestUrl()
  const testDb = new PrismaClient({ datasources: { db: { url: testUrl } } })
  let tableCreated = false
  stage = 'database-identity'
  try {
    const identity = await testDb.$queryRaw<Array<{ database_name: string }>>`SELECT DATABASE() AS database_name`
    assert.equal(identity[0]?.database_name, TEST_DATABASE)
    stage = 'empty-schema-check'
    const tables = await testDb.$queryRaw<Array<{ table_count: bigint }>>`
      SELECT COUNT(*) AS table_count FROM information_schema.tables WHERE table_schema = DATABASE()
    `
    assert.equal(Number(tables[0]?.table_count), 0, 'isolated MySQL schema must start empty')
    stage = 'legacy-schema-fixture'
    await testDb.$executeRawUnsafe("CREATE TABLE `SocialPost` (`id` VARCHAR(191) NOT NULL, `mediaType` ENUM('IMAGE', 'VIDEO', 'CAROUSEL', 'REEL') NOT NULL, PRIMARY KEY (`id`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci")
    tableCreated = true
    await testDb.$executeRawUnsafe("INSERT INTO `SocialPost` (`id`, `mediaType`) VALUES ('existing-image', 'IMAGE'), ('existing-video', 'VIDEO'), ('existing-carousel', 'CAROUSEL'), ('existing-reel', 'REEL')")

    stage = 'migration-shape-check'
    const statements = readFileSync(MIGRATION_PATH, 'utf8').split(/;\s*(?:\r?\n|$)/).map((statement) => statement.trim()).filter(Boolean)
    assert.equal(statements.length, 1, 'TEXT migration must contain one statement')
    assert.match(statements[0].replace(/\s+/g, ' '), /^ALTER TABLE `SocialPost` MODIFY `mediaType` ENUM\('IMAGE', 'VIDEO', 'CAROUSEL', 'REEL', 'TEXT'\) NOT NULL$/)
    stage = 'migration-apply'
    await testDb.$executeRawUnsafe(statements[0])

    stage = 'column-definition-check'
    const column = await testDb.$queryRaw<Array<{ column_type: string; is_nullable: string }>>`
        SELECT COLUMN_TYPE AS column_type, IS_NULLABLE AS is_nullable
        FROM information_schema.columns
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'SocialPost' AND COLUMN_NAME = 'mediaType'
      `
    assert.equal(column[0]?.column_type, "enum('IMAGE','VIDEO','CAROUSEL','REEL','TEXT')")
    assert.equal(column[0]?.is_nullable, 'NO')

    stage = 'existing-values-check'
    const existingRows = await testDb.$queryRaw<Array<{ id: string; media_type: string }>>`
        SELECT id, mediaType AS media_type FROM SocialPost ORDER BY id
      `
    assert.deepEqual(existingRows, [
      { id: 'existing-carousel', media_type: 'CAROUSEL' },
      { id: 'existing-image', media_type: 'IMAGE' },
      { id: 'existing-reel', media_type: 'REEL' },
      { id: 'existing-video', media_type: 'VIDEO' },
    ])

    stage = 'text-roundtrip-check'
    await testDb.$executeRawUnsafe("INSERT INTO `SocialPost` (`id`, `mediaType`) VALUES ('new-text', 'TEXT')")
    const textRows = await testDb.$queryRaw<Array<{ media_type: string }>>`SELECT mediaType AS media_type FROM SocialPost WHERE id = 'new-text'`
    assert.equal(textRows[0]?.media_type, 'TEXT')
    console.log('INSTAGRAM_TEXT_ENUM_MIGRATION=PASS')
    console.log('EXISTING_MEDIA_VALUES_PRESERVED=PASS')
    console.log('TEXT_INSERT_READ=PASS')
  } finally {
    try {
      if (tableCreated) await testDb.$executeRawUnsafe('DROP TABLE `SocialPost`')
    } finally {
      await testDb.$disconnect()
    }
  }
}

main().catch((error: unknown) => {
  const errorType = error && typeof error === 'object' && 'name' in error && typeof error.name === 'string'
    ? error.name.replace(/[^A-Za-z0-9_]/g, '').slice(0, 60)
    : 'UNKNOWN'
  const errorCode = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code
    : 'UNKNOWN'
  console.error(`INSTAGRAM_TEXT_ENUM_MIGRATION=FAIL STAGE=${stage} TYPE=${errorType} CODE=${errorCode}`)
  process.exitCode = 1
})
