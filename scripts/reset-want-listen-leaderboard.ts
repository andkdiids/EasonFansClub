/**
 * 重置想听/粤语残片/防不胜防排行榜（WantListenLeaderboardEntry）。
 *
 * 步骤：
 *   1) 按模式统计当前排行榜数量
 *   2) 全量导出备份（JSON，含时间戳）
 *   3) 仅删除 WantListenLeaderboardEntry（不触碰用户/会话/成就/反作弊日志）
 *   4) 验证排行榜为空
 *   5) 功能自检：事务内验证 CLEAN 完成场次可重新写入排行榜（回滚，不落库）
 *
 * 运行：
 *   node --import tsx scripts/reset-want-listen-leaderboard.ts
 */
import { loadEnvFile } from 'node:process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

async function main() {
  if (!process.env.DATABASE_URL) loadEnvFile('.env')
  const [{ prisma }] = await Promise.all([import('../lib/prisma')])
  const { recordWantListenLeaderboard } = await import('../lib/want-listen-leaderboard')

  // ---------- 1) 统计 ----------
  const byMode = await prisma.wantListenLeaderboardEntry.groupBy({ by: ['mode'], _count: { _all: true } })
  const modeLabels: Record<string, string> = { WANT_LISTEN: '想听', CANTONESE_FRAGMENT: '粤语残片', FALSE_TITLE: '防不胜防' }
  const totalBefore = byMode.reduce((sum, row) => sum + row._count._all, 0)
  console.info('=== 1) 重置前排行榜统计 ===')
  for (const row of byMode) {
    console.info(`${modeLabels[row.mode] || row.mode}: ${row._count._all} 条`)
  }
  console.info(`合计: ${totalBefore} 条`)

  // ---------- 2) 导出备份 ----------
  const entries = await prisma.wantListenLeaderboardEntry.findMany({ orderBy: [{ mode: 'asc' }, { periodType: 'asc' }, { score: 'desc' }] })
  const backupDir = join(process.cwd(), 'backups')
  mkdirSync(backupDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = join(backupDir, `want-listen-leaderboard-${stamp}.json`)
  writeFileSync(backupPath, JSON.stringify({ exportedAt: new Date().toISOString(), total: entries.length, entries }, null, 2), 'utf8')
  console.info(`=== 2) 备份完成: ${backupPath} (${entries.length} 条) ===`)

  // ---------- 3) 仅删除排行榜 ----------
  const deleted = await prisma.wantListenLeaderboardEntry.deleteMany({})
  console.info(`=== 3) 已删除排行榜成绩: ${deleted.count} 条 ===`)

  // ---------- 4) 验证为空 ----------
  const remaining = await prisma.wantListenLeaderboardEntry.count()
  console.info(`=== 4) 验证排行榜剩余: ${remaining} 条 ${remaining === 0 ? '（通过）' : '（失败！）'} ===`)

  // ---------- 5) 功能自检（事务回滚，不落库） ----------
  let functionalPass = false
  try {
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.findFirst({ where: { isDeleted: false }, select: { id: true } })
      if (!user) throw new Error('未找到可用用户，跳过功能自检')
      const now = new Date()
      const session = await tx.wantListenSession.create({
        data: {
          userId: user.id,
          mode: 'FALSE_TITLE',
          status: 'COMPLETED',
          questionCount: 20,
          score: 100,
          correctCount: 10,
          completionTimeMs: 60000,
          completedAt: now,
          expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
        },
      })
      await recordWantListenLeaderboard(session.id, tx)
      const created = await tx.wantListenLeaderboardEntry.count({ where: { sessionId: session.id } })
      functionalPass = created >= 3 // DAY / WEEK / ALL 各一条
      throw new Error('__ROLLBACK_VERIFY__')
    })
  } catch (error) {
    if (!(error instanceof Error && error.message === '__ROLLBACK_VERIFY__')) {
      console.error('[self-check] 事务异常', error)
      process.exitCode = 1
    }
  }
  const after = await prisma.wantListenLeaderboardEntry.count()
  console.info(`=== 5) 新用户可正常进入排行榜: ${functionalPass ? '通过' : '失败'}（自检后余额: ${after} 条，已回滚） ===`)

  await prisma.$disconnect()
}

main().catch((error) => {
  console.error('[reset] failed', error)
  process.exitCode = 1
})
