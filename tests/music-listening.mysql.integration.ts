import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { PrismaClient } from '@prisma/client'

async function main() {
  const raw = process.env.MUSIC_LISTENING_MYSQL_URL || ''
  const url = new URL(raw)
  const allowed = url.protocol === 'mysql:'
    && url.hostname === '127.0.0.1'
    && ((url.port === '33319' && url.pathname === '/music_listening_qa')
      || (url.port === '3306' && url.pathname === '/music_listening_qa'))
    && url.search === ''
  if (!allowed) throw new Error('REFUSING_NON_ISOLATED_DATABASE')

  process.env.DATABASE_URL = raw
  const db = new PrismaClient({ datasources: { db: { url: raw } } })
  let createdTables = false
  try {
    const tables = await db.$queryRaw<Array<{ TABLE_NAME: string }>>`
      SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE()
    `
    if (tables.length) throw new Error('REFUSING_NONEMPTY_DATABASE')

    await db.$executeRawUnsafe(`CREATE TABLE \`User\` (
      \`id\` VARCHAR(191) NOT NULL,
      PRIMARY KEY (\`id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
    await db.$executeRawUnsafe(`CREATE TABLE \`MusicPlayRecord\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`durationSeconds\` INT NOT NULL DEFAULT 0,
      \`playedAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`trackId\` VARCHAR(191) NOT NULL,
      \`userId\` VARCHAR(191) NOT NULL,
      PRIMARY KEY (\`id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
    createdTables = true

    const migration = await readFile(resolve('prisma/migrations/20261117110000_add_music_listening_stats/migration.sql'), 'utf8')
    await db.$executeRawUnsafe(migration)
    await db.$executeRaw`INSERT INTO \`User\` (\`id\`) VALUES ('music-listening-user')`
    await db.$executeRaw`
      INSERT INTO \`MusicPlayRecord\` (\`id\`, \`durationSeconds\`, \`playedAt\`, \`trackId\`, \`userId\`)
      VALUES ('legacy-play', 9, UTC_TIMESTAMP(3), 'legacy-track', 'music-listening-user')
    `

    const { prisma } = await import('../lib/prisma')
    const { MusicListeningError, getMusicListeningStats, normalizeMusicListeningEvents, recordMusicListeningEvents } = await import('../lib/music-listening')
    const now = new Date()
    const event = (eventId: string, source: 'ONLINE' | 'LOCAL', startOffset: number, endOffset: number) => ({
      eventId,
      source,
      seconds: 60,
      startedAt: new Date(now.getTime() + startOffset * 1000).toISOString(),
      endedAt: new Date(now.getTime() + endOffset * 1000).toISOString(),
    })
    const online = event('online-1', 'ONLINE', -240, -180)
    const local = event('local-1', 'LOCAL', -120, -60)
    const overlap = event('local-overlap', 'LOCAL', -90, -30)
    const normalized = normalizeMusicListeningEvents([online, local, overlap], now)
    const first = await recordMusicListeningEvents('music-listening-user', normalized)
    assert.deepEqual(new Set(first.acknowledgedEventIds), new Set(['online-1', 'local-1']))
    assert.deepEqual(first.rejectedEventIds, ['local-overlap'])
    assert.deepEqual(first.rejectedEvents, [{ eventId: 'local-overlap', reason: 'OVERLAPPING_INTERVAL' }])
    assert.equal(first.stats.totalSeconds, 129)
    assert.equal(first.stats.onlineSeconds, 69)
    assert.equal(first.stats.localSeconds, 60)
    const dayStart = Math.floor((now.getTime() + 8 * 3_600_000) / 86_400_000) * 86_400_000 - 8 * 3_600_000
    const expectedToday = 9 + [online, local].reduce((seconds, item) => seconds + Math.max(0,
      Math.floor((Math.min(Date.parse(item.endedAt), dayStart + 86_400_000) - Math.max(Date.parse(item.startedAt), dayStart)) / 1000)), 0)
    assert.equal(first.stats.todaySeconds, expectedToday)

    const retry = await recordMusicListeningEvents('music-listening-user', normalized)
    assert.deepEqual(new Set(retry.acknowledgedEventIds), new Set(['online-1', 'local-1']))
    assert.deepEqual(retry.rejectedEventIds, ['local-overlap'])
    assert.deepEqual(retry.rejectedEvents, [{ eventId: 'local-overlap', reason: 'OVERLAPPING_INTERVAL' }])
    assert.deepEqual(retry.stats, first.stats)
    assert.equal(await prisma.musicPlayRecord.count({ where: { userId: 'music-listening-user' } }), 3)

    const crossMidnightStart = new Date('2027-01-01T15:59:30.000Z')
    const crossMidnightEnd = new Date('2027-01-01T16:00:30.000Z')
    await db.$executeRaw`
      INSERT INTO \`MusicPlayRecord\`
        (\`id\`, \`durationSeconds\`, \`playedAt\`, \`trackId\`, \`userId\`, \`source\`, \`eventId\`, \`startedAt\`, \`endedAt\`)
      VALUES ('cross-midnight', 60, ${crossMidnightEnd}, NULL, 'music-listening-user', 'ONLINE', 'cross-midnight', ${crossMidnightStart}, ${crossMidnightEnd})
    `
    const crossMidnightStats = await getMusicListeningStats('music-listening-user', new Date('2027-01-02T00:00:30.000+08:00'))
    assert.equal(crossMidnightStats.todaySeconds, 30)

    await assert.rejects(
      recordMusicListeningEvents('music-listening-user', normalizeMusicListeningEvents([
        { ...online, seconds: 59 },
      ], now)),
      (error: unknown) => error instanceof MusicListeningError && error.code === 'IDEMPOTENCY_CONFLICT',
    )

    const [concurrentA, concurrentB] = await Promise.all([
      recordMusicListeningEvents('music-listening-user', normalizeMusicListeningEvents([event('concurrent-a', 'LOCAL', -600, -540)], now)),
      recordMusicListeningEvents('music-listening-user', normalizeMusicListeningEvents([event('concurrent-b', 'LOCAL', -540, -480)], now)),
    ])
    assert.deepEqual(concurrentA.rejectedEventIds, [])
    assert.deepEqual(concurrentB.rejectedEventIds, [])
    assert.equal(await prisma.musicPlayRecord.count({ where: { userId: 'music-listening-user' } }), 6)
    console.log('REAL_MYSQL_MUSIC_LISTENING_IDEMPOTENCY_PARTIAL_ACCEPTANCE=PASS')
    console.log('REAL_MYSQL_MUSIC_LISTENING_USER_LOCK_CONCURRENCY=PASS')
  } finally {
    if (createdTables) await db.$executeRawUnsafe('DROP TABLE IF EXISTS `MusicPlayRecord`')
    if (createdTables) await db.$executeRawUnsafe('DROP TABLE IF EXISTS `User`')
    await db.$disconnect()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'INTEGRATION_FAILED')
  process.exitCode = 1
})
