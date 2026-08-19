/**
 * 娱乐天空历史成绩反作弊扫描（需求 7）。
 *
 * 扫描已有排行榜成绩，找出明显机器人行为并标记 SUSPICIOUS（不删除任何数据）：
 *   - 想听 / 粤语残片 / 防不胜防：完成时间过短（平均 <2 秒/题）、连续 <1 秒答题、单题耗时异常
 *   - 听听（guess-song）：已有 riskScore >= 80 / isValid=false 的场次
 *   - 听听·对决：isSuspicious 场次
 *
 * 标记后：
 *   - WantListenSession.antiCheatStatus = SUSPICIOUS → 自动从排行榜读取中过滤（不删除记录）
 *   - 统一写入 GameAntiCheatLog
 *
 * 运行（需可写数据库权限，建议低峰期执行）：
 *   pnpm anti-cheat:scan
 */
import { loadEnvFile } from 'node:process'
import type { Prisma } from '@prisma/client'

const BATCH_SIZE = 200

async function main() {
  if (!process.env.DATABASE_URL) loadEnvFile('.env')
  const [{ prisma }] = await Promise.all([import('../lib/prisma')])
  const { assessWantListenLatencies, maxConsecutiveFastAnswers, averageAnswerTime, ANTI_CHEAT_AVERAGE_FAST_MS, ANTI_CHEAT_CONSECUTIVE_FAST_COUNT, ANTI_CHEAT_MIN_SAMPLES } = await import('../lib/anti-cheat')

  const report: Array<{ userId: string; game: string; score: number; completionTimeMs: number | null; risk: string; reason: string }> = []
  let flagged = 0
  let skipped = 0

  // ---------- 1) 想听 / 粤语残片 / 防不胜防 ----------
  for (let skip = 0; ; skip += BATCH_SIZE) {
    const sessions = await prisma.wantListenSession.findMany({
      where: { status: 'COMPLETED', antiCheatStatus: { not: 'SUSPICIOUS' } },
      orderBy: { id: 'asc' },
      skip,
      take: BATCH_SIZE,
      select: {
        id: true,
        userId: true,
        mode: true,
        score: true,
        correctCount: true,
        questionCount: true,
        completionTimeMs: true,
        completedAt: true,
        ipAddress: true,
        userAgent: true,
        WantListenSessionQuestion: { select: { answerLatencyMs: true }, orderBy: { position: 'asc' } },
      },
    })
    if (!sessions.length) break

    for (const session of sessions) {
      const latencies = session.WantListenSessionQuestion
        .map((question) => question.answerLatencyMs)
        .filter((ms): ms is number => ms !== null && ms !== undefined)
      const reasons: string[] = []

      // 完成总时长平均 < 2 秒/题
      if (session.completionTimeMs !== null && session.questionCount > 0 && session.completionTimeMs < session.questionCount * ANTI_CHEAT_AVERAGE_FAST_MS) {
        reasons.push(`总完成时间 ${session.completionTimeMs}ms / ${session.questionCount} 题，平均低于 ${ANTI_CHEAT_AVERAGE_FAST_MS / 1000} 秒/题`)
      }
      // 单题耗时序列评估（至少 ANTI_CHEAT_MIN_SAMPLES 道有记录）
      if (latencies.length >= ANTI_CHEAT_MIN_SAMPLES) {
        const assessment = assessWantListenLatencies(latencies)
        reasons.push(...assessment.reasons)
        const consecutive = maxConsecutiveFastAnswers(latencies)
        if (consecutive >= ANTI_CHEAT_CONSECUTIVE_FAST_COUNT) {
          reasons.push(`存在连续 ${consecutive} 题低于 1 秒`)
        }
      } else if (latencies.length > 0) {
        // 题数不足时用已有的单题耗时兜底判定
        const avg = averageAnswerTime(latencies)
        if (avg !== null && avg < ANTI_CHEAT_AVERAGE_FAST_MS) {
          reasons.push(`已有 ${latencies.length} 题平均耗时 ${avg}ms，低于 ${ANTI_CHEAT_AVERAGE_FAST_MS / 1000} 秒/题`)
        }
      }

      if (!reasons.length) continue

      const risk = reasons.length >= 2 ? 'HIGH' : 'MEDIUM'
      await prisma.$transaction(async (tx) => {
        await tx.wantListenSession.update({
          where: { id: session.id },
          data: { antiCheatStatus: 'SUSPICIOUS', antiCheatReasons: reasons as unknown as Prisma.InputJsonValue },
        }).catch(() => null)
        await tx.gameAntiCheatLog.create({
          data: {
            userId: session.userId,
            gameType: `want-listen:${session.mode}`,
            sessionId: session.id,
            questionCount: session.questionCount,
            fastestAnswerTime: latencies.length ? Math.min(...latencies) : null,
            averageAnswerTime: averageAnswerTime(latencies),
            ip: session.ipAddress,
            userAgent: session.userAgent,
            suspiciousType: 'FAST_ANSWER',
            details: { reasons, mode: session.mode, score: session.score, correctCount: session.correctCount, risk } as unknown as Prisma.InputJsonValue,
          },
        })
      }).catch((error: unknown) => {
        console.error('[anti-cheat] update failed', session.id, error)
        return
      })
      flagged += 1
      report.push({
        userId: session.userId,
        game: `想听:${session.mode}`,
        score: session.score,
        completionTimeMs: session.completionTimeMs,
        risk,
        reason: reasons.join('；'),
      })
    }
    void skipped
  }

  // ---------- 2) 听听（guess-song）已有风险场次 ----------
  const cheatSessions = await prisma.guessSongSession.count({ where: { status: 'CHEAT_DETECTED' } })
  const invalidSessions = await prisma.guessSongSession.count({ where: { isValid: false } })
  // ---------- 3) 听听·对决可疑场次 ----------
  const suspiciousDuels = await prisma.guessSongDuelMatch.count({ where: { isSuspicious: true } })

  console.info('')
  console.info('=== 娱乐天空反作弊扫描结果 ===')
  console.info(`[want-listen] 新标记 SUSPICIOUS: ${flagged}`)
  console.info(`[guess-song] 已有 CHEAT_DETECTED 场次: ${cheatSessions}（原有 riskScore 机制）`)
  console.info(`[guess-song] 已有 isValid=false 场次: ${invalidSessions}（原有 riskScore 机制）`)
  console.info(`[duel]      已有 isSuspicious 场次: ${suspiciousDuels}（原标记，已阻止奖金/胜场）`)
  if (report.length) {
    console.info('')
    console.info('--- 检测报告 ---')
    for (const row of report) {
      console.info(`${row.risk}\t${row.userId}\t${row.game}\tscore=${row.score}\t完成=${row.completionTimeMs}ms\t${row.reason}`)
    }
  }
  await prisma.$disconnect()
}

main().catch((error) => {
  console.error('[anti-cheat:scan] failed', error)
  process.exitCode = 1
})
