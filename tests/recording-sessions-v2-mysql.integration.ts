import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'
import { fileURLToPath } from 'node:url'

const EXPECTED_DATABASE = 'recording_sessions_v2_qa'
const MIGRATION_PATHS = [
  '../prisma/migrations/20261027130000_add_concert_discussions_v2/migration.sql',
  '../prisma/migrations/20261027140000_add_concert_discussion_replies/migration.sql',
].map((path) => fileURLToPath(new URL(path, import.meta.url)))

function resolveTestUrl() {
  if (process.env.DATABASE_URL) throw new Error('TEST_DATABASE_FALLBACK_FORBIDDEN')
  const raw = process.env.RECORDING_SESSIONS_TEST_DATABASE_URL
  if (!raw) throw new Error('DEDICATED_TEST_DATABASE_REQUIRED')
  const url = new URL(raw)
  if (url.protocol !== 'mysql:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.port !== '3306' || url.pathname !== `/${EXPECTED_DATABASE}` || url.search || url.hash) {
    throw new Error('TEST_DATABASE_IDENTITY_MISMATCH')
  }
  return raw
}

async function main() {
  const connectionUrl = resolveTestUrl()
  const prisma = new PrismaClient({ datasources: { db: { url: connectionUrl } } })
  try {
    const databaseRows = await prisma.$queryRaw<Array<{ database_name: string }>>`SELECT DATABASE() AS database_name`
    assert.equal(databaseRows[0]?.database_name, EXPECTED_DATABASE)
    const existingTables = await prisma.$queryRaw<Array<{ table_count: bigint }>>`
      SELECT COUNT(*) AS table_count FROM information_schema.tables WHERE table_schema = DATABASE()
    `
    assert.equal(Number(existingTables[0]?.table_count), 0, 'isolated MySQL schema must start empty')

    await prisma.$executeRawUnsafe('CREATE TABLE `ConcertEvent` (`id` VARCHAR(191) NOT NULL, PRIMARY KEY (`id`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci')
    await prisma.$executeRawUnsafe('CREATE TABLE `ConcertShow` (`id` VARCHAR(191) NOT NULL, PRIMARY KEY (`id`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci')
    await prisma.$executeRawUnsafe('CREATE TABLE `User` (`id` VARCHAR(191) NOT NULL, PRIMARY KEY (`id`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci')

    const migrationStatements = MIGRATION_PATHS.map((path) => readFileSync(path, 'utf8').split(/;\s*(?:\r?\n|$)/).map((statement) => statement.trim()).filter(Boolean))
    assert.deepEqual(migrationStatements.map((statements) => statements.length), [3, 1], 'base and reply migrations should have expected statements')
    for (const statements of migrationStatements) for (const statement of statements) await prisma.$executeRawUnsafe(statement)

    const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT TABLE_NAME AS table_name FROM information_schema.tables
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('ConcertDiscussionComment', 'ConcertDiscussionImage')
    `
    assert.deepEqual(new Set(tables.map((row) => row.table_name)), new Set(['ConcertDiscussionComment', 'ConcertDiscussionImage']))

    const columns = await prisma.$queryRaw<Array<{ column_name: string; data_type: string; is_nullable: string }>>`
      SELECT COLUMN_NAME AS column_name, DATA_TYPE AS data_type, IS_NULLABLE AS is_nullable
      FROM information_schema.columns WHERE TABLE_SCHEMA = DATABASE()
        AND ((TABLE_NAME = 'ConcertEvent' AND COLUMN_NAME = 'backgroundImageUrl')
          OR (TABLE_NAME = 'ConcertDiscussionComment' AND COLUMN_NAME IN ('showId', 'parentCommentId')))
    `
    assert.ok(columns.some((column) => column.column_name === 'backgroundImageUrl' && column.data_type === 'text' && column.is_nullable === 'YES'))
    assert.ok(columns.some((column) => column.column_name === 'showId' && column.data_type === 'varchar' && column.is_nullable === 'YES'))
    assert.ok(columns.some((column) => column.column_name === 'parentCommentId' && column.data_type === 'varchar' && column.is_nullable === 'YES'))

    const indexes = await prisma.$queryRaw<Array<{ index_name: string }>>`
      SELECT DISTINCT INDEX_NAME AS index_name FROM information_schema.statistics
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('ConcertDiscussionComment', 'ConcertDiscussionImage')
    `
    const indexNames = new Set(indexes.map((index) => index.index_name))
    for (const name of [
      'ConcertDiscussionComment_author_request_key',
      'ConcertDiscussionComment_scope_feed_idx',
      'ConcertDiscussionComment_author_created_idx',
      'ConcertDiscussionComment_parent_feed_idx',
      'ConcertDiscussionImage_comment_order_idx',
    ]) assert.ok(indexNames.has(name), `missing expected index ${name}`)

    const constraints = await prisma.$queryRaw<Array<{ constraint_name: string }>>`
      SELECT CONSTRAINT_NAME AS constraint_name FROM information_schema.table_constraints
      WHERE TABLE_SCHEMA = DATABASE() AND CONSTRAINT_TYPE = 'FOREIGN KEY'
    `
    const constraintNames = new Set(constraints.map((constraint) => constraint.constraint_name))
    for (const name of [
      'ConcertDiscussionComment_eventId_fkey',
      'ConcertDiscussionComment_showId_fkey',
      'ConcertDiscussionComment_authorId_fkey',
      'ConcertDiscussionComment_parentCommentId_fkey',
      'ConcertDiscussionImage_commentId_fkey',
    ]) assert.ok(constraintNames.has(name), `missing expected foreign key ${name}`)

    await prisma.$executeRawUnsafe("INSERT INTO `ConcertEvent` (`id`) VALUES ('event-1'), ('event-2')")
    await prisma.$executeRawUnsafe("INSERT INTO `ConcertShow` (`id`) VALUES ('show-1'), ('show-2')")
    await prisma.$executeRawUnsafe("INSERT INTO `User` (`id`) VALUES ('author-1')")
    const insertComment = (id: string, eventId: string, showId: string | null, requestId: string, parentCommentId: string | null = null) => prisma.$executeRawUnsafe(
      'INSERT INTO `ConcertDiscussionComment` (`id`, `eventId`, `showId`, `parentCommentId`, `authorId`, `requestId`, `content`, `createdAt`, `updatedAt`) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))',
      id, eventId, showId, parentCommentId, 'author-1', requestId, id,
    )
    await insertComment('comment-show-1', 'event-1', 'show-1', '10000000-0000-4000-8000-000000000001')
    await insertComment('reply-show-1', 'event-1', 'show-1', '10000000-0000-4000-8000-000000000005', 'comment-show-1')
    await insertComment('comment-event', 'event-1', null, '10000000-0000-4000-8000-000000000002')
    await insertComment('comment-show-2', 'event-1', 'show-2', '10000000-0000-4000-8000-000000000003')
    await insertComment('comment-event-2', 'event-2', null, '10000000-0000-4000-8000-000000000004')
    await prisma.$executeRawUnsafe("INSERT INTO `ConcertDiscussionImage` (`id`, `commentId`, `url`) VALUES ('image-show-1', 'comment-show-1', 'https://media.example.test/source.webp'), ('image-event', 'comment-event', 'https://media.example.test/source.webp')")
    const replyRelation = await prisma.$queryRaw<Array<{ parentCommentId: string | null }>>`SELECT parentCommentId FROM ConcertDiscussionComment WHERE id = 'reply-show-1'`
    assert.equal(replyRelation[0]?.parentCommentId, 'comment-show-1', 'replies must retain an explicit parent relationship')

    let duplicateRejected = false
    try {
      await insertComment('comment-duplicate-request', 'event-1', null, '10000000-0000-4000-8000-000000000002')
    } catch (error) {
      const candidate = error && typeof error === 'object'
        ? error as { code?: unknown; meta?: { code?: unknown; message?: unknown } }
        : null
      duplicateRejected = candidate?.code === 'P2010'
        && (candidate.meta?.code === '23000'
          || candidate.meta?.code === '1062'
          || candidate.meta?.code === 'ER_DUP_ENTRY'
          || (typeof candidate.meta?.message === 'string' && /duplicate entry/i.test(candidate.meta.message)))
    }
    assert.equal(duplicateRejected, true, 'author/request idempotency key must be unique')

    await prisma.$executeRawUnsafe("DELETE FROM `ConcertShow` WHERE `id` = 'show-1'")
    const afterShowDelete = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM ConcertDiscussionComment ORDER BY id
    `
    assert.deepEqual(afterShowDelete.map((row) => row.id), ['comment-event', 'comment-event-2', 'comment-show-2'])
    const remainingImages = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM ConcertDiscussionImage ORDER BY id
    `
    assert.deepEqual(remainingImages.map((row) => row.id), ['image-event'])

    await prisma.$executeRawUnsafe("DELETE FROM `ConcertEvent` WHERE `id` = 'event-1'")
    const afterEventDelete = await prisma.$queryRaw<Array<{ id: string }>>`SELECT id FROM ConcertDiscussionComment`
    assert.deepEqual(afterEventDelete.map((row) => row.id), ['comment-event-2'])
    const imagesAfterEventDelete = await prisma.$queryRaw<Array<{ id: string }>>`SELECT id FROM ConcertDiscussionImage`
    assert.deepEqual(imagesAfterEventDelete, [])

    console.log('RECORDING_SESSIONS_MYSQL_MIGRATION=PASS')
    console.log('SCHEMA_OBJECTS=PASS')
    console.log('SCOPED_CASCADE_AND_IDEMPOTENCY=PASS')
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error: unknown) => {
  const errorCode = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code
    : 'UNKNOWN'
  console.error(`RECORDING_SESSIONS_MYSQL_MIGRATION=FAIL CODE=${errorCode}`)
  process.exitCode = 1
})
