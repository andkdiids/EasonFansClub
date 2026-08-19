import { Prisma, type GameAntiCheatSuspiciousType } from '@prisma/client'

/** 单题答题时间低于该值（毫秒）即记录异常 */
export const ANTI_CHEAT_FAST_ANSWER_THRESHOLD_MS = 1000
/** 平均答题时间低于该值（毫秒）直接标记 SUSPICIOUS（用户需求：20 题模式平均 <2 秒） */
export const ANTI_CHEAT_AVERAGE_FAST_MS = 2000
/** 连续 N 题低于 1 秒判定为高风险 */
export const ANTI_CHEAT_CONSECUTIVE_FAST_COUNT = 5
/** 平均耗时规则至少需要多少道已答题，避免首题即误判 */
export const ANTI_CHEAT_MIN_SAMPLES = 5

/** 客户端可传入的答题事件（防刷分：所有时间、分数由服务端计算，客户端只交题目与选项） */
export type AntiCheatTimingInput = {
  questionStartedAt: Date | null | undefined
  answeredAt: Date | null | undefined
}

/** 服务端计算的单题耗时（毫秒）。不信任任何客户端传入的时间。 */
export function computeServerElapsedMs(startedAt: Date | null | undefined, answeredAt: Date | null | undefined): number | null {
  if (!startedAt || !answeredAt) return null
  return Math.max(0, answeredAt.getTime() - startedAt.getTime())
}

/** 单题答题时间是否过短（<1 秒，明显非真人） */
export function isSingleAnswerTooFast(latencyMs: number | null | undefined): boolean {
  return latencyMs !== null && latencyMs !== undefined && latencyMs >= 0 && latencyMs < ANTI_CHEAT_FAST_ANSWER_THRESHOLD_MS
}

export function fastestAnswerTime(latencies: readonly number[]): number | null {
  return latencies.length ? Math.min(...latencies) : null
}

export function averageAnswerTime(latencies: readonly number[]): number | null {
  if (!latencies.length) return null
  return Math.round(latencies.reduce((sum, ms) => sum + ms, 0) / latencies.length)
}

/** 连续低于 1 秒的答题数（历史最高） */
export function maxConsecutiveFastAnswers(latencies: readonly number[]): number {
  let best = 0
  let run = 0
  for (const ms of latencies) {
    if (ms < ANTI_CHEAT_FAST_ANSWER_THRESHOLD_MS) {
      run += 1
      if (run > best) best = run
    } else {
      run = 0
    }
  }
  return best
}

/** 平均答题时间是否异常（需要至少 ANTI_CHEAT_MIN_SAMPLES 个样本） */
export function isAverageAnswerTooFast(latencies: readonly number[]): boolean {
  if (latencies.length < ANTI_CHEAT_MIN_SAMPLES) return false
  const avg = averageAnswerTime(latencies)
  return avg !== null && avg < ANTI_CHEAT_AVERAGE_FAST_MS
}

export type AntiCheatAssessment = {
  suspicious: boolean
  reasons: string[]
}

/** 对一局游戏的答题耗时序列做整体评估（服务端判定） */
export function assessWantListenLatencies(latencies: readonly number[]): AntiCheatAssessment {
  const reasons: string[] = []
  const consecutive = maxConsecutiveFastAnswers(latencies)
  if (consecutive >= ANTI_CHEAT_CONSECUTIVE_FAST_COUNT) {
    reasons.push(`连续 ${consecutive} 题答题时间低于 ${ANTI_CHEAT_FAST_ANSWER_THRESHOLD_MS / 1000} 秒`)
  }
  if (isAverageAnswerTooFast(latencies)) {
    reasons.push(`平均答题时间低于 ${ANTI_CHEAT_AVERAGE_FAST_MS / 1000} 秒`)
  }
  return { suspicious: reasons.length > 0, reasons }
}

export type AntiCheatLogInput = {
  userId: string
  gameType: string
  sessionId?: string | null
  questionCount?: number | null
  fastestAnswerTime?: number | null
  averageAnswerTime?: number | null
  ip?: string | null
  userAgent?: string | null
  suspiciousType: GameAntiCheatSuspiciousType
  details?: Prisma.InputJsonValue
}

/** 统一的反作弊日志写入（事务内调用），供全部娱乐天空游戏复用 */
export async function recordAntiCheatLog(
  database: {
    gameAntiCheatLog: { create(args: { data: Prisma.GameAntiCheatLogUncheckedCreateInput }): Promise<unknown> }
  },
  input: AntiCheatLogInput,
) {
  await database.gameAntiCheatLog.create({
    data: {
      userId: input.userId,
      gameType: input.gameType,
      sessionId: input.sessionId ?? null,
      questionCount: input.questionCount ?? null,
      fastestAnswerTime: input.fastestAnswerTime ?? null,
      averageAnswerTime: input.averageAnswerTime ?? null,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      suspiciousType: input.suspiciousType,
      details: input.details ?? undefined,
    },
  })
}

export type { GameAntiCheatSuspiciousType }
