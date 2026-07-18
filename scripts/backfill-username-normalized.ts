import { loadEnvFile } from 'node:process'
import { Client } from 'pg'
import { buildUsernameBatchUpdate, classifyExistingStaging, prepareUsernameBackfill, type UsernameBackfillUser } from '../lib/username-backfill'
import { maskLoginAccount, maskUserId } from '../lib/login-account'
import { formatUid } from '../lib/uid'

const apply = process.argv.includes('--apply')
const advisoryLockKey = 'easonfansclub:username-normalized-backfill:v1'

function connectionTarget() {
  if (!process.env.DIRECT_URL && !process.env.DATABASE_URL) loadEnvFile('.env')
  const source = process.env.DIRECT_URL ? 'DIRECT_URL' : 'DATABASE_URL'
  const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL
  if (!connectionString) throw new Error('缺少 DIRECT_URL 或 DATABASE_URL')
  const parsed = new URL(connectionString)
  const port = Number(parsed.port || 5432)
  const transactionPooler = port === 6543 || parsed.searchParams.get('pgbouncer') === 'true'
  const connectionType = transactionPooler ? 'TRANSACTION_POOLER' : parsed.hostname.includes('.pooler.supabase.com') ? 'SESSION_POOLER' : 'DIRECT'
  const host = parsed.hostname.startsWith('db.') ? 'db.***.supabase.co' : parsed.hostname
  return { source, connectionString, host, port, connectionType, transactionPooler }
}

function safeAudit(prepared: ReturnType<typeof prepareUsernameBackfill>) {
  return {
    blocked: prepared.blocked,
    invalid: prepared.invalid.map((item) => ({ uid: formatUid(item.uid), userId: maskUserId(item.id), reason: item.reason })),
    conflicts: prepared.conflicts.map((item) => ({ maskedUsername: maskLoginAccount(item.normalized), count: item.userIds.length, uids: item.uids.map(formatUid), userIds: item.userIds.map(maskUserId) })),
    duplicateIds: prepared.duplicateIds,
    duplicateUids: prepared.duplicateUids,
  }
}

async function readUsers(client: Client) {
  const result = await client.query<UsernameBackfillUser>('SELECT id, uid, username FROM "User" ORDER BY uid')
  return result.rows
}

async function main() {
  const target = connectionTarget()
  if (target.transactionPooler) throw new Error('当前连接是 Transaction Pooler，禁止执行回填；请配置 DIRECT_URL 或 Session Pooler')

  const readClient = new Client({ connectionString: target.connectionString })
  await readClient.connect()
  let snapshot: UsernameBackfillUser[]
  try {
    snapshot = await readUsers(readClient)
  } finally {
    await readClient.end()
  }
  const prepared = prepareUsernameBackfill(snapshot)
  console.info(JSON.stringify({
    mode: apply ? 'apply-requested' : 'dry-run',
    connection: { source: target.source, host: target.host, port: target.port, type: target.connectionType },
    usersScanned: snapshot.length,
    expectedUpdates: prepared.mapping.length,
    databaseWrites: 0,
    fieldsCreated: 0,
    ...safeAudit(prepared),
  }, null, 2))
  if (prepared.blocked) {
    process.exitCode = 2
    return
  }
  if (!apply) return

  const writeClient = new Client({ connectionString: target.connectionString })
  await writeClient.connect()
  let committed = false
  try {
    await writeClient.query('BEGIN')
    const lock = await writeClient.query<{ acquired: boolean }>('SELECT pg_try_advisory_xact_lock(hashtext($1)) AS acquired', [advisoryLockKey])
    if (!lock.rows[0]?.acquired) throw new Error('USERNAME_BACKFILL_ADVISORY_LOCK_UNAVAILABLE')
    await writeClient.query('LOCK TABLE "User" IN SHARE ROW EXCLUSIVE MODE')

    const lockedRows = await readUsers(writeClient)
    const lockedPrepared = prepareUsernameBackfill(lockedRows)
    if (lockedPrepared.blocked || lockedRows.length !== snapshot.length || lockedPrepared.snapshotFingerprint !== prepared.snapshotFingerprint) {
      throw new Error('USERNAME_BACKFILL_SNAPSHOT_CHANGED')
    }

    const column = await writeClient.query<{ exists: boolean }>(`SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'User' AND column_name = 'usernameNormalized') AS exists`)
    if (column.rows[0]?.exists) {
      const existing = await writeClient.query<{ id: string; usernameNormalized: string | null }>('SELECT id, "usernameNormalized" FROM "User" ORDER BY uid')
      const stagingState = classifyExistingStaging(existing.rows, prepared.mapping)
      if (stagingState === 'PARTIAL_OR_MISMATCHED') throw new Error('USERNAME_NORMALIZED_STAGING_PARTIAL_OR_MISMATCHED')
      if (stagingState === 'COMPLETE') throw new Error('USERNAME_NORMALIZED_STAGING_ALREADY_COMPLETE')
    } else {
      await writeClient.query('ALTER TABLE "User" ADD COLUMN "usernameNormalized" TEXT')
    }

    const batch = buildUsernameBatchUpdate(prepared.mapping)
    const update = await writeClient.query(batch.text, batch.parameters)
    if (update.rowCount !== prepared.mapping.length) throw new Error(`USERNAME_BACKFILL_ROW_COUNT_MISMATCH:${update.rowCount}`)

    const verification = await writeClient.query<{ total: number; nonNull: number; empty: number; duplicates: number }>(`
      SELECT
        COUNT(*)::int AS total,
        COUNT("usernameNormalized")::int AS "nonNull",
        COUNT(*) FILTER (WHERE "usernameNormalized" = '')::int AS empty,
        (SELECT COUNT(*)::int FROM (SELECT "usernameNormalized" FROM "User" GROUP BY "usernameNormalized" HAVING COUNT(*) > 1) duplicate_groups) AS duplicates
      FROM "User"
    `)
    const verifiedRows = await writeClient.query<{ id: string; uid: number; username: string; usernameNormalized: string | null }>('SELECT id, uid, username, "usernameNormalized" FROM "User" ORDER BY uid')
    const expected = new Map(prepared.mapping.map((item) => [item.id, item.normalized]))
    const mappingMatches = verifiedRows.rows.every((row) => expected.get(row.id) === row.usernameNormalized)
    const usernameSnapshotMatches = prepareUsernameBackfill(verifiedRows.rows.map(({ id, uid, username }) => ({ id, uid, username }))).snapshotFingerprint === prepared.snapshotFingerprint
    const totals = verification.rows[0]
    if (!totals || totals.total !== snapshot.length || totals.nonNull !== snapshot.length || totals.empty !== 0 || totals.duplicates !== 0 || !mappingMatches || !usernameSnapshotMatches) {
      throw new Error('USERNAME_BACKFILL_VERIFICATION_FAILED')
    }

    await writeClient.query('COMMIT')
    committed = true
    console.info(JSON.stringify({ mode: 'applied', transaction: 'COMMIT', batchUpdateStatements: 1, expectedUpdates: prepared.mapping.length, actualUpdates: update.rowCount, integrity: { total: totals.total, nonNull: totals.nonNull, null: totals.total - totals.nonNull, empty: totals.empty, duplicates: totals.duplicates, mappingMatches, usernameSnapshotMatches } }, null, 2))
  } catch (error) {
    await writeClient.query('ROLLBACK').catch(() => undefined)
    console.error(JSON.stringify({ mode: 'apply-failed', transaction: 'ROLLBACK', error: error instanceof Error ? error.message : 'UNKNOWN_ERROR' }))
    throw error
  } finally {
    await writeClient.end()
  }
  if (!committed) throw new Error('USERNAME_BACKFILL_NOT_COMMITTED')
}

main().catch((error) => {
  console.error(`USERNAME_BACKFILL_FAILED: ${error instanceof Error ? error.message : 'UNKNOWN_ERROR'}`)
  process.exitCode = 1
})
