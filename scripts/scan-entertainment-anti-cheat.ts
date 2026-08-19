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

  const report: Array<{
    uid: number
    userId: string
    game: string
    mode: string
    score: number
    completionTimeMs: number | null
    averageAnswerTimeMs: number | null
    risk: string
    reason: string
  }> = []
  let flagged = 0

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
        User: { select: { uid: true } },
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
        reasons.push(`总完成时间 ${session.completionTimeMs}ms / ${session.questionCount} 题，平均 ${(session.completionTimeMs / session.questionCount).toFixed(0)}ms/题，低于 ${ANTI_CHEAT_AVERAGE_FAST_MS / 1000} 秒/题`)
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
      const avgMs = latencies.length ? averageAnswerTime(latencies)
        : session.completionTimeMs !== null && session.questionCount > 0 ? Math.round(session.completionTimeMs / session.questionCount) : null
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
            averageAnswerTime: avgMs,
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
        uid: session.User?.uid ?? 0,
        userId: session.userId,
        game: '想听',
        mode: session.mode,
        score: session.score,
        completionTimeMs: session.completionTimeMs,
        averageAnswerTimeMs: avgMs,
        risk,
        reason: reasons.join('；'),
      })
    }
  }

  // ---------- 2) 听听（guess-song）已有风险场次 ----------
  const riskSessions = await prisma.guessSongSession.findMany({
    where: { OR: [{ status: 'CHEAT_DETECTED' }, { isValid: false }] },
    orderBy: { riskScore: 'desc' },
    take: 200,
    select: { id: true, userId: true, mode: true, score: true, correctCount: true, riskScore: true, createdAt: true, User: { select: { uid: true } } },
  })
  // ---------- 3) 听听·对决可疑场次 ----------
  const suspiciousDuels = await prisma.guessSongDuelMatch.findMany({
    where: { isSuspicious: true },
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: { id: true, winnerId: true, mode: true, rewardAmount: true, createdAt: true, Winner: { select: { uid: true } } },
  })

  console.info('')
  console.info('=== 娱乐天空反作弊扫描结果 ===')
  console.info(`[want-listen] 本次新标记 SUSPICIOUS: ${flagged}`)
  console.info(`[guess-song] 已有风险场次: ${riskSessions.length}`)
  console.info(`[duel]      已有 isSuspicious 场次: ${suspiciousDuels.length}`)
  console.info('')

  if (report.length) {
    console.info('--- 想听 / 粤语残片 / 防不胜防 异常名单 ---')
    console.info('UID\t游戏\t模式\t成绩\t完成时间(ms)\t平均答速(ms/题)\t风险\t原因')
    for (const row of report) {
      console.info(`${row.uid}\t${row.game}\t${row.mode}\t${row.score}\t${row.completionTimeMs ?? '-'}\t${row.averageAnswerTimeMs ?? '-'}\t${row.risk}\t${row.reason}`)
    }
    console.info('')
  } else {
    console.info('--- 想听 / 粤语残片 / 防不胜防：本次未发现新异常场次 ---')
    console.info('')
  }

  if (riskSessions.length) {
    console.info('--- 听听（guess-song）已有风险场次名单 ---')
    console.info('UID\t模式\t成绩\t答对\triskScore\t创建时间')
    for (const row of riskSessions) {
      console.info(`${row.User?.uid ?? 0}\t${row.mode}\t${row.score}\t${row.correctCount}\t${row.riskScore}\t${row.createdAt.toISOString()}`)
    }
    console.info('')
  }

  if (suspiciousDuels.length) {
    console.info('--- 听听·对决（duel）可疑场次名单 ---')
    console.info('UID\t模式\t奖金\t创建时间')
    for (const row of suspiciousDuels) {
      console.info(`${row.Winner?.uid ?? 0}\t${row.mode}\t${row.rewardAmount}\t${row.createdAt.toISOString()}`)
    }
    console.info('')
  }

  await prisma.$disconnect()
}

main().catch((error) => {
  console.error('[anti-cheat:scan] failed', error)
  process.exitCode = 1
})
