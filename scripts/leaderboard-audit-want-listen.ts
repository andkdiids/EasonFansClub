/**
 * 想听排行榜成绩一致性审计（只读，不修改任何数据）。
 *
 * 检查 WantListenLeaderboardEntry 中 score / correctCount / totalQuestions / maxStreak
 * 是否满足游戏真实计分规则，并确认排行榜字段与对应 WantListenSession 是否一致
 * （排行榜必须完整取同一条成绩记录，禁止字段来自不同记录）。
 *
 * 检测项：
 *  - CORRECT_GREATER_THAN_COMPLETED ：答对题数 > 完成题数
 *  - SCORE_NOT_MATCH_RULES          ：分数无法由游戏规则推导（如 28770 分/答对 64 题）
 *  - FIELD_MISMATCH_WITH_SESSION    ：排行榜字段与 Session 不一致（字段疑似来自不同记录）
 *  - SESSION_MISSING                ：排行榜引用的 Session 不存在
 *
 * 运行（只读，不落库）：
 *   pnpm leaderboard:audit
 *   pnpm leaderboard:audit -- --userId <id> --mode WANT_LISTEN
 */
import { loadEnvFile } from 'node:process'
import type { Prisma } from '@prisma/client'

const BATCH_SIZE = 500

type AuditIssue = {
  userId: string
  uid: number
  nickname: string
  mode: string
  periodType: string
  periodKey: string
  score: number
  correctCount: number
  completedCount: number
  maxStreak: number
  resultId: string | null
  reasons: string[]
}

function parseArgs(argv: string[]) {
  const args: { userId: string | null; mode: string | null; periodType: string | null; periodKey: string | null } = {
    userId: null,
    mode: null,
    periodType: null,
    periodKey: null,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--userId') args.userId = argv[index + 1] ?? null
    else if (arg === '--mode') args.mode = argv[index + 1] ?? null
    else if (arg === '--periodType') args.periodType = argv[index + 1] ?? null
    else if (arg === '--periodKey') args.periodKey = argv[index + 1] ?? null
  }
  return args
}

async function main() {
  if (!process.env.DATABASE_URL) loadEnvFile('.env')
  const [{ prisma }] = await Promise.all([import('../lib/prisma')])
  const { validateWantListenScoreConsistency } = await import('../lib/want-listen-score')
  const args = parseArgs(process.argv.slice(2))

  const where: Prisma.WantListenLeaderboardEntryWhereInput = {}
  if (args.userId) where.userId = args.userId
  if (args.mode) where.mode = args.mode as never
  if (args.periodType) where.periodType = args.periodType as never
  if (args.periodKey) where.periodKey = args.periodKey

  const issues: AuditIssue[] = []
  let scanned = 0

  for (let skip = 0; ; skip += BATCH_SIZE) {
    const entries = await prisma.wantListenLeaderboardEntry.findMany({
      where,
      orderBy: [{ mode: 'asc' }, { score: 'desc' }],
      skip,
      take: BATCH_SIZE,
      include: {
        User: { select: { uid: true, nickname: true } },
        WantListenSession: { select: { id: true, score: true, correctCount: true, maxStreak: true, totalQuestions: true } },
      },
    })
    if (!entries.length) break
    scanned += entries.length

    for (const entry of entries) {
      const reasons: string[] = []
      const session = entry.WantListenSession
      if (!session) {
        reasons.push('SESSION_MISSING')
      } else {
        const fieldPairs: Array<[string, number, number]> = [
          ['score', entry.score, session.score],
          ['correctCount', entry.correctCount, session.correctCount],
          ['maxStreak', entry.maxStreak, session.maxStreak],
          ['totalQuestions', entry.totalQuestions, session.totalQuestions],
        ]
        for (const [field, entryValue, sessionValue] of fieldPairs) {
          if (entryValue !== sessionValue) reasons.push(`FIELD_MISMATCH_WITH_SESSION:${field}`)
        }
      }
      const validation = validateWantListenScoreConsistency({
        score: entry.score,
        correctCount: entry.correctCount,
        maxStreak: entry.maxStreak,
        totalQuestions: entry.totalQuestions,
      })
      if (!validation.ok) reasons.push(`SCORE_NOT_MATCH_RULES:${validation.reason}`)
      if (entry.correctCount > entry.totalQuestions) reasons.push('CORRECT_GREATER_THAN_COMPLETED')

      if (reasons.length) {
        issues.push({
          userId: entry.userId,
          uid: entry.User.uid,
          nickname: entry.User.nickname,
          mode: entry.mode,
          periodType: entry.periodType,
          periodKey: entry.periodKey,
          score: entry.score,
          correctCount: entry.correctCount,
          completedCount: entry.totalQuestions,
          maxStreak: entry.maxStreak,
          resultId: entry.sessionId,
          reasons,
        })
      }
    }
    if (entries.length < BATCH_SIZE) break
  }

  console.info(`=== 想听排行榜一致性审计 ===`)
  console.info(`扫描 ${scanned} 条排行榜成绩，发现 ${issues.length} 条异常`)
  for (const item of issues) {
    console.info(
      `${item.mode}/${item.periodType}/${item.periodKey}\tuid=${item.uid}\t${item.nickname}\t` +
      `score=${item.score}\tcorrect=${item.correctCount}\tcompleted=${item.completedCount}\tmaxStreak=${item.maxStreak}\t` +
      `resultId=${item.resultId ?? '—'}\t原因=${item.reasons.join(';')}`,
    )
  }
  if (issues.length) {
    console.info('检测到异常成绩。修复前请先确认根因；可用 pnpm leaderboard:repair（默认 dry-run）生成修复计划。')
  }
  process.exitCode = issues.length ? 1 : 0
}

main().catch((error) => {
  console.error('[leaderboard-audit] 执行失败', error)
  process.exitCode = 2
})
