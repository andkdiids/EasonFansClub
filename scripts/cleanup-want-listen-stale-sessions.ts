/**
 * 想听无尽模式旧 session 残留清理（历史数据修复）。
 *
 * 同一用户同一模式仅允许一个有效进行中的 session：
 *   - 已过期（expiresAt <= now）的 IN_PROGRESS → EXPIRED
 *   - 每组 (userId, mode) 中保留最新一个 IN_PROGRESS，其余历史残留 → ABANDONED
 * 只改状态、不删除任何数据。
 *
 * 运行：
 *   pnpm tsx scripts/cleanup-want-listen-stale-sessions.ts
 */
import { loadEnvFile } from 'node:process'

const BATCH_SIZE = 500

async function main() {
  if (!process.env.DATABASE_URL) loadEnvFile('.env')
  const [{ prisma }] = await Promise.all([import('../lib/prisma')])

  const now = new Date()

  // 1) 过期的进行中会话 → EXPIRED
  const expired = await prisma.wantListenSession.updateMany({
    where: { status: 'IN_PROGRESS', expiresAt: { lte: now } },
    data: { status: 'EXPIRED', activeKey: null },
  })

  // 2) 按 (userId, mode) 分组，保留最新，其余 → ABANDONED
  let abandoned = 0
  let cursor = ''
  const seenGroups = new Set<string>()
  while (true) {
    const rows = await prisma.wantListenSession.findMany({
      where: { status: 'IN_PROGRESS', ...(cursor ? { id: { gt: cursor } } : {}) },
      orderBy: { id: 'asc' },
      select: { id: true, userId: true, mode: true },
      take: BATCH_SIZE,
    })
    if (!rows.length) break

    const staleIds: string[] = []
    for (const row of rows) {
      const groupKey = `${row.userId}:${row.mode}`
      if (seenGroups.has(groupKey)) {
        staleIds.push(row.id)
      } else {
        seenGroups.add(groupKey)
      }
      cursor = row.id
    }
    if (staleIds.length) {
      const result = await prisma.wantListenSession.updateMany({
        where: { id: { in: staleIds } },
        data: { status: 'ABANDONED', activeKey: null },
      })
      abandoned += result.count
    }
    if (rows.length < BATCH_SIZE) break
  }

  const remaining = await prisma.wantListenSession.count({ where: { status: 'IN_PROGRESS' } })
  console.log(`清理完成：过期→EXPIRED ${expired.count} 条，历史残留→ABANDONED ${abandoned} 条`)
  console.log(`剩余有效 IN_PROGRESS：${remaining} 条（每用户每模式至多 1 条）`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
