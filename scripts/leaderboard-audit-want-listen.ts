/**
 * 想听排行榜成绩一致性审计（只读，不修改任何数据）。
 *
 * 检查 WantListenLeaderboardEntry 中 score / correctCount / totalQuestions / maxStreak
 * 是否满足游戏真实计分规则，并确认排行榜字段与对应 WantListenSession 是否一致
 * （排行榜必须完整取同一条成绩记录，禁止字段来自不同记录）。
 *
 * 检测项：
 *  - CORRECT_GREATER_THAN_COMPLETED ：答对题数 > 完成题数
 *  - SCORE_NOT_MATCH_RULES          ：分数超过该答对题数可能达到的最高分（含连击奖励），疑似凭空捏造
 *  - SCORE_SUM_MISMATCH             ：Session.score 与历史每题 awardedScore 之和不一致（Hint 扣分 / 连击奖励后仍能对账）
 *  - FIELD_MISMATCH_WITH_SESSION    ：排行榜字段与 Session 不一致（字段疑似来自不同记录）
 *  - SESSION_MISSING                ：排行榜引用的 Session 不存在
 *  - HINT_SCORE_MISMATCH            ：使用了提示（hintLevel>1）但 awardedScore 仍按完整基础分（或仍吃到连击奖励），与提示扣分规则不符
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
  const hintMismatches: Array<{
    userId: string
    uid: number
    nickname: string
    mode: string
    sessionId: string
    questionId: string
    hintCount: number
    awardedScore: number
    expectedScore: number
    createdAt: string
  }> = []
  let scanned = 0

  for (let skip = 0; ; skip += BATCH_SIZE) {
    const entries = await prisma.wantListenLeaderboardEntry.findMany({
      where,
      orderBy: [{ mode: 'asc' }, { score: 'desc' }],
      skip,
      take: BATCH_SIZE,
      include: {
        User: { select: { uid: true, nickname: true } },
        WantListenSession: {
          select: {
            id: true,
            score: true,
            correctCount: true,
            maxStreak: true,
            totalQuestions: true,
            WantListenSessionQuestion: {
              select: { id: true, answeredAt: true, isCorrect: true, awardedScore: true, hintLevel: true },
            },
          },
        },
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
        // 按历史每题 awardedScore 重算，与 Session.score 对账（Hint 扣分后依然可对账）
        const questions = session.WantListenSessionQuestion
        if (questions.length) {
          let sumScore = 0
          let sumCorrect = 0
          let sumTotal = 0
          for (const question of questions) {
            if (!question.answeredAt) continue
            sumTotal += 1
            if (question.isCorrect) {
              sumCorrect += 1
              sumScore += question.awardedScore
            }
          }
          if (session.score !== sumScore || session.correctCount !== sumCorrect || session.totalQuestions !== sumTotal) {
            reasons.push(`SCORE_SUM_MISMATCH:session=${session.score}/sum=${sumScore}`)
          }
          // 提示扣分规则检查：使用过提示（hintLevel>1）但题目 awardedScore 仍超过「提示后基础分」
          for (const question of questions) {
            if (!question.answeredAt || !question.isCorrect) continue
            const hintsUsed = Math.max(0, question.hintLevel - 1)
            if (hintsUsed <= 0) continue
            const expectedBase = Math.max(0, 100 - hintsUsed * 25)
            if (question.awardedScore > expectedBase) {
              reasons.push('HINT_SCORE_MISMATCH')
              hintMismatches.push({
                userId: entry.userId,
                uid: entry.User.uid,
                nickname: entry.User.nickname,
                mode: entry.mode,
                sessionId: session.id,
                questionId: question.id,
                hintCount: hintsUsed,
                awardedScore: question.awardedScore,
                expectedScore: expectedBase,
                createdAt: question.answeredAt.toISOString(),
              })
            }
          }
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
  if (hintMismatches.length) {
    console.info('')
    console.info(`--- 提示扣分异常（HINT_SCORE_MISMATCH）${hintMismatches.length} 条 ---`)
    for (const item of hintMismatches) {
      console.info(
        `${item.mode}\tuid=${item.uid}\t${item.nickname}\tsession=${item.sessionId}\tquestion=${item.questionId}\t` +
        `hintCount=${item.hintCount}\tawardedScore=${item.awardedScore}\texpectedScore=${item.expectedScore}\tcreatedAt=${item.createdAt}`,
      )
    }
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
