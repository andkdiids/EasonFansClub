// 想听系列（想听 / 粤语残片 / 防不胜防）统一计分与成绩一致性校验。
//
// 设计目标：前台游戏结算、Session 结算、后台补录必须走同一套计分规则。
//  - 前台逐题计分唯一入口：scoreForWantListenAnswer（lib/want-listen-config.ts）
//  - 后台补录 / 恢复复用本模块：不再允许管理员直接填写 score
//
// 计分规则（与 scoreForWantListenAnswer 一一对应）：
//  - 答对 +100（WANT_LISTEN_BASE_SCORE）
//  - 连续答对每满 10 题（streak % 10 === 0）额外 +270（WANT_LISTEN_ENDLESS_COMBO_BONUS）
//  - 答错 +0，且连击清零
import {
  WANT_LISTEN_BASE_SCORE,
  WANT_LISTEN_ENDLESS_COMBO_BONUS,
  WANT_LISTEN_ENDLESS_COMBO_INTERVAL,
  scoreForWantListenAnswer,
  type WantListenMode,
} from '@/lib/want-listen-config'
import { compareWantListenScores } from '@/lib/want-listen-period'

export type WantListenScoreState = {
  score: number
  correctCount: number
  maxStreak: number
  totalQuestions: number
}

export type WantListenBackfillCompensation = {
  correctAnswers: number
  startingStreak: number
  endStreak: number
  baseScore: number
  comboBonus: number
  milestones: number
  totalScore: number
}

/**
 * 后台补录核心计算器：模拟「从 startingStreak 起连续答对 correctAnswers 题」，
 * 逐题调用与前台完全相同的 scoreForWantListenAnswer，因此跨越 90/100/110 等
 * 连击奖励节点时也会被精确计入（不会退化为 题数 × 基础分）。
 */
export function calculateWantListenBackfillScore(input: {
  correctAnswers: number
  startingStreak: number
}): WantListenBackfillCompensation {
  const correctAnswers = Math.max(0, Math.floor(input.correctAnswers || 0))
  const startingStreak = Math.max(0, Math.floor(input.startingStreak || 0))
  let totalScore = 0
  let comboBonus = 0
  let milestones = 0
  for (let index = 1; index <= correctAnswers; index += 1) {
    const streak = startingStreak + index
    const awarded = scoreForWantListenAnswer(true, streak)
    totalScore += awarded
    if (awarded > WANT_LISTEN_BASE_SCORE) {
      comboBonus += awarded - WANT_LISTEN_BASE_SCORE
      milestones += 1
    }
  }
  return {
    correctAnswers,
    startingStreak,
    endStreak: startingStreak + correctAnswers,
    baseScore: correctAnswers * WANT_LISTEN_BASE_SCORE,
    comboBonus,
    milestones,
    totalScore,
  }
}

/**
 * 人工补题：在既有成绩基础上累加补答题数，返回补录后的完整成绩状态与校验结果。
 * 正确题从 startingStreak 起连续计入连击；错误题追加在正确题之后（不增加分数，但增加完成题数）。
 */
export function computeWantListenManualBackfill(input: {
  base: WantListenScoreState
  correctDelta: number
  wrongDelta: number
  startingStreak: number
}) {
  const correctDelta = Math.max(0, Math.floor(input.correctDelta || 0))
  const wrongDelta = Math.max(0, Math.floor(input.wrongDelta || 0))
  const compensation = calculateWantListenBackfillScore({ correctAnswers: correctDelta, startingStreak: input.startingStreak })
  const afterScore = input.base.score + compensation.totalScore
  const afterCorrect = input.base.correctCount + correctDelta
  const afterTotal = input.base.totalQuestions + correctDelta + wrongDelta
  const afterMaxStreak = correctDelta > 0 ? Math.max(input.base.maxStreak, compensation.endStreak) : input.base.maxStreak
  const after: WantListenScoreState = { score: afterScore, correctCount: afterCorrect, maxStreak: afterMaxStreak, totalQuestions: afterTotal }
  return {
    compensation,
    afterScore,
    afterCorrect,
    afterTotal,
    afterMaxStreak,
    after,
    validation: validateWantListenScoreConsistency(after),
  }
}

/**
 * 成绩一致性校验：score / correctCount / maxStreak / totalQuestions 必须能由
 * 同一局真实游戏产生，禁止出现「28770 分 / 答对 64 题 / 最高连击 35」这类
 * 分数与答题数据对不上的记录。
 *
 * 规则（严格推导自 scoreForWantListenAnswer）：
 *  - correctCount <= totalQuestions（答对不能超过完成题数）
 *  - maxStreak <= correctCount，且 correctCount > 0 时 maxStreak >= 1
 *  - score = correctCount * 100 + 连击奖励次数 * 270（奖励次数必须为整数）
 *  - 连击奖励次数必须在可行区间内：
 *      min = floor(maxStreak / 10)                    —— 至少存在一条长度 maxStreak 的连续答对段
 *      max = floor(maxStreak / 10) + floor((correctCount - maxStreak) / 10)  —— 剩余题数最多再贡献
 */
export function validateWantListenScoreConsistency(
  state: WantListenScoreState,
  _mode?: WantListenMode,
): { ok: boolean; reason?: string } {
  const { score, correctCount, maxStreak, totalQuestions } = state
  if (!Number.isInteger(score) || score < 0) return { ok: false, reason: '分数非法' }
  if (!Number.isInteger(correctCount) || correctCount < 0) return { ok: false, reason: '答对题数非法' }
  if (!Number.isInteger(totalQuestions) || totalQuestions < 0) return { ok: false, reason: '完成题数非法' }
  if (!Number.isInteger(maxStreak) || maxStreak < 0) return { ok: false, reason: '最高连击非法' }
  if (correctCount > totalQuestions) return { ok: false, reason: '答对题数不能大于完成题数' }
  if (maxStreak > correctCount) return { ok: false, reason: '最高连击不能大于答对题数' }
  if (correctCount === 0) {
    if (score !== 0) return { ok: false, reason: '答对 0 题时分数必须为 0' }
    if (maxStreak !== 0) return { ok: false, reason: '答对 0 题时最高连击必须为 0' }
    return { ok: true }
  }
  if (maxStreak < 1) return { ok: false, reason: '有答对题数时最高连击至少为 1' }

  const baseScore = correctCount * WANT_LISTEN_BASE_SCORE
  if (score < baseScore) return { ok: false, reason: '分数低于答对题数对应的基础分' }
  const remainder = score - baseScore
  if (remainder % WANT_LISTEN_ENDLESS_COMBO_BONUS !== 0) {
    return { ok: false, reason: `分数与连击奖励规则不符（应为每题 ${WANT_LISTEN_BASE_SCORE} 分 + 每连续 ${WANT_LISTEN_ENDLESS_COMBO_INTERVAL} 题 +${WANT_LISTEN_ENDLESS_COMBO_BONUS} 分）` }
  }
  const milestones = remainder / WANT_LISTEN_ENDLESS_COMBO_BONUS
  const minMilestones = maxStreak >= WANT_LISTEN_ENDLESS_COMBO_INTERVAL
    ? Math.floor(maxStreak / WANT_LISTEN_ENDLESS_COMBO_INTERVAL)
    : 0
  const maxMilestones = maxStreak >= WANT_LISTEN_ENDLESS_COMBO_INTERVAL
    ? Math.floor(maxStreak / WANT_LISTEN_ENDLESS_COMBO_INTERVAL) + Math.floor((correctCount - maxStreak) / WANT_LISTEN_ENDLESS_COMBO_INTERVAL)
    : 0
  if (milestones < minMilestones || milestones > maxMilestones) {
    return { ok: false, reason: `连击奖励次数 ${milestones} 超出可行区间 [${minMilestones}, ${maxMilestones}]` }
  }
  return { ok: true }
}

/**
 * 从多条成绩记录中选出「单局最高」的完整记录（与排行榜排序规则完全一致：
 * 分数 → 答对 → 最高连击 → 用时少 → 时间早）。返回的是同一条记录整行，
 * 保证 score / correctCount / maxStreak / totalQuestions 永远属于同一局。
 */
export function pickBestWantListenRecord<T extends WantListenScoreState & { completionTimeMs: number; achievedAt: Date }>(records: T[]): T | null {
  if (!records.length) return null
  return [...records].sort((left, right) => compareWantListenScores(left, right))[0]
}
