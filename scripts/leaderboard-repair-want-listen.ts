/**
 * 想听排行榜成绩修复（默认 DRY-RUN，不写库；加 --apply 才实际修改）。
 *
 * 优先级恢复顺序：
 *   1) 找到对应完整 GameResult（WantListenSession），以 Session 权威数据同步排行榜
 *   2) 根据历史答题记录（WantListenSessionQuestion.awardedScore/isCorrect）重算
 *   3) 都找不到 / 无法推导 → NEEDS_MANUAL_REVIEW
 *
 * 禁止：为了让数字看起来合理而猜测答对数或连击。无法权威推导的一律标记人工复核。
 *
 * 运行：
 *   pnpm leaderboard:repair                                  # dry-run，仅生成计划
 *   pnpm leaderboard:repair -- --apply                        # 实际执行（谨慎）
 *   pnpm leaderboard:repair -- --apply --userId <id> --mode WANT_LISTEN
 */
import { loadEnvFile } from 'node:process'
import type { Prisma } from '@prisma/client'

const BATCH_SIZE = 500

type ScoreState = { score: number; correctCount: number; maxStreak: number; totalQuestions: number }

type RepairPlan = {
  kind: 'SYNC_FROM_SESSION' | 'RECOMPUTE_FROM_QUESTION_HISTORY' | 'NEEDS_MANUAL_REVIEW'
  entryId: string
  sessionId: string | null
  uid: number
  nickname: string
  mode: string
  periodType: string
  periodKey: string
  reason: string
  before: ScoreState
  after: ScoreState | null
}

function parseArgs(argv: string[]) {
  const args: { apply: boolean; userId: string | null; mode: string | null; periodType: string | null; periodKey: string | null } = {
    apply: false,
    userId: null,
    mode: null,
    periodType: null,
    periodKey: null,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--apply') args.apply = true
    else if (arg === '--userId') args.userId = argv[index + 1] ?? null
    else if (arg === '--mode') args.mode = argv[index + 1] ?? null
    else if (arg === '--periodType') args.periodType = argv[index + 1] ?? null
    else if (arg === '--periodKey') args.periodKey = argv[index + 1] ?? null
  }
  return args
}

function stateEqual(left: ScoreState, right: ScoreState) {
  return left.score === right.score
    && left.correctCount === right.correctCount
    && left.maxStreak === right.maxStreak
    && left.totalQuestions === right.totalQuestions
}

/** 根据历史答题记录重算成绩（awardedScore 为每题的权威加分，isCorrect 还原连击） */
function recomputeFromQuestions(
  questions: Array<{ answeredAt: Date | null; isCorrect: boolean | null; awardedScore: number }>,
): ScoreState {
  let score = 0
  let correctCount = 0
  let totalQuestions = 0
  let maxStreak = 0
  let streak = 0
  for (const question of questions) {
    if (!question.answeredAt) continue
    totalQuestions += 1
    if (question.isCorrect) {
      correctCount += 1
      streak += 1
      if (streak > maxStreak) maxStreak = streak
      score += question.awardedScore
    } else {
      streak = 0
    }
  }
  return { score, correctCount, maxStreak, totalQuestions }
}

function buildRepairPlan(
  entry: Prisma.WantListenLeaderboardEntryGetPayload<{
    include: {
      User: { select: { uid: true; nickname: true } }
      WantListenSession: { include: { WantListenSessionQuestion: { orderBy: { position: 'asc' } } } }
    }
  }>,
  validate: (state: ScoreState) => { ok: boolean; reason?: string },
): RepairPlan | null {
  const before: ScoreState = {
    score: entry.score,
    correctCount: entry.correctCount,
    maxStreak: entry.maxStreak,
    totalQuestions: entry.totalQuestions,
  }
  const base = {
    entryId: entry.id,
    sessionId: entry.sessionId,
    uid: entry.User.uid,
    nickname: entry.User.nickname,
    mode: entry.mode,
    periodType: entry.periodType,
    periodKey: entry.periodKey,
    before,
  }
  const session = entry.WantListenSession

  if (session) {
    const sessionState: ScoreState = {
      score: session.score,
      correctCount: session.correctCount,
      maxStreak: session.maxStreak,
      totalQuestions: session.totalQuestions,
    }
    const sessionValid = validate(sessionState)
    if (sessionValid.ok) {
      if (stateEqual(before, sessionState)) return null // 健康，无需处理
      return {
        ...base,
        kind: 'SYNC_FROM_SESSION',
        reason: '排行榜字段与 Session 不一致，以 Session 权威数据同步',
        after: sessionState,
      }
    }
    // Session 本身不合法 → 尝试按历史答题记录重算
    const recomputed = recomputeFromQuestions(session.WantListenSessionQuestion)
    if (recomputed.totalQuestions === 0 && session.score > 0) {
      return {
        ...base,
        kind: 'NEEDS_MANUAL_REVIEW',
        reason: 'FABRICATED_SCORE_NO_QUESTION_HISTORY：Session 分数大于 0 但无任何答题记录，疑似旧版直接写分产生',
        after: null,
      }
    }
    const recomputedValid = validate(recomputed)
    if (recomputedValid.ok) {
      return {
        ...base,
        kind: 'RECOMPUTE_FROM_QUESTION_HISTORY',
        reason: 'Session 数据不合法，按历史答题记录重算',
        after: recomputed,
      }
    }
    return {
      ...base,
      kind: 'NEEDS_MANUAL_REVIEW',
      reason: `Session 与答题记录均无法推导合法成绩（${recomputedValid.reason || '未知'}）`,
      after: null,
    }
  }

  return {
    ...base,
    kind: 'NEEDS_MANUAL_REVIEW',
    reason: 'SESSION_MISSING：排行榜引用的 Session 不存在',
    after: null,
  }
}

async function main() {
  if (!process.env.DATABASE_URL) loadEnvFile('.env')
  const [{ prisma }] = await Promise.all([import('../lib/prisma')])
  const { validateWantListenScoreConsistency } = await import('../lib/want-listen-score')
  const args = parseArgs(process.argv.slice(2))
  const dryRun = !args.apply

  const where: Prisma.WantListenLeaderboardEntryWhereInput = {}
  if (args.userId) where.userId = args.userId
  if (args.mode) where.mode = args.mode as never
  if (args.periodType) where.periodType = args.periodType as never
  if (args.periodKey) where.periodKey = args.periodKey

  const entries = await prisma.wantListenLeaderboardEntry.findMany({
    where,
    include: {
      User: { select: { uid: true, nickname: true } },
      WantListenSession: { include: { WantListenSessionQuestion: { orderBy: { position: 'asc' } } } },
    },
  })

  const plans: RepairPlan[] = []
  for (const entry of entries) {
    const plan = buildRepairPlan(entry, validateWantListenScoreConsistency)
    if (plan) plans.push(plan)
  }

  const manualReview = plans.filter((plan) => plan.kind === 'NEEDS_MANUAL_REVIEW')
  const autoFix = plans.filter((plan) => plan.kind !== 'NEEDS_MANUAL_REVIEW')

  console.info(`=== 想听排行榜修复（${dryRun ? 'DRY-RUN，不写库' : 'APPLY，将写入数据库'}）===`)
  console.info(`扫描 ${entries.length} 条成绩 → 需处理 ${plans.length} 条（可自动修复 ${autoFix.length}，需人工复核 ${manualReview.length}）`)
  console.info('')

  if (dryRun) {
    for (const plan of plans) {
      const after = plan.after
        ? `score=${plan.after.score}\tcorrect=${plan.after.correctCount}\tcompleted=${plan.after.totalQuestions}\tmaxStreak=${plan.after.maxStreak}`
        : '无自动修复方案'
      console.info(
        `[${plan.kind}] ${plan.mode}/${plan.periodType}/${plan.periodKey}\tuid=${plan.uid}\t${plan.nickname}\n` +
        `   当前：score=${plan.before.score}\tcorrect=${plan.before.correctCount}\tcompleted=${plan.before.totalQuestions}\tmaxStreak=${plan.before.maxStreak}\n` +
        `   修复后：${after}\n` +
        `   原因：${plan.reason}`,
      )
    }
    console.info('')
    console.info('默认 dry-run 不修改任何数据；确认修复计划无误后，加 --apply 执行（建议先备份）。')
    process.exitCode = manualReview.length ? 1 : 0
    return
  }

  let fixed = 0
  for (const plan of plans) {
    if (plan.kind === 'NEEDS_MANUAL_REVIEW') continue
    const after = plan.after as ScoreState
    if (plan.kind === 'SYNC_FROM_SESSION' && plan.sessionId) {
      await prisma.wantListenLeaderboardEntry.update({
        where: { id: plan.entryId },
        data: { score: after.score, correctCount: after.correctCount, maxStreak: after.maxStreak, totalQuestions: after.totalQuestions },
      })
    } else if (plan.kind === 'RECOMPUTE_FROM_QUESTION_HISTORY' && plan.sessionId) {
      await prisma.wantListenSession.update({
        where: { id: plan.sessionId },
        data: { score: after.score, correctCount: after.correctCount, maxStreak: after.maxStreak, totalQuestions: after.totalQuestions },
      })
      await prisma.wantListenLeaderboardEntry.update({
        where: { id: plan.entryId },
        data: { score: after.score, correctCount: after.correctCount, maxStreak: after.maxStreak, totalQuestions: after.totalQuestions },
      })
    } else {
      console.info(`[跳过] ${plan.entryId} 缺少 Session，无法自动修复`)
      continue
    }
    fixed += 1
    console.info(`[已修复] ${plan.kind} ${plan.mode}/${plan.periodType}/${plan.periodKey} uid=${plan.uid}`)
  }

  console.info(`修复完成：自动修复 ${fixed} 条，需人工复核 ${manualReview.length} 条。`)
  if (manualReview.length) {
    console.info('需人工复核记录（请勿猜测数据）：')
    for (const plan of manualReview) {
      console.info(`  ${plan.mode}/${plan.periodType}/${plan.periodKey}\tuid=${plan.uid}\t${plan.nickname}\t原因=${plan.reason}`)
    }
  }
  process.exitCode = manualReview.length ? 1 : 0
}

main().catch((error) => {
  console.error('[leaderboard-repair] 执行失败', error)
  process.exitCode = 2
})
