import { randomInt } from 'node:crypto'

export const defaultShunConfig = {
  enabled: false, attempts: 7, victimCap: 4, goldenMinutes: 10,
  probabilities: [25, 21, 17, 14, 10, 7, 6], weights: [130, 122, 115, 108, 100],
}
export type ShunConfig = typeof defaultShunConfig

export function shunRulesChanged(previous: ShunConfig, next: ShunConfig) {
  return previous.attempts !== next.attempts || previous.victimCap !== next.victimCap
    || previous.goldenMinutes !== next.goldenMinutes
    || previous.probabilities.some((value, i) => value !== next.probabilities[i])
}

const bounded = (value: unknown, low: number, high: number) =>
  typeof value === 'number' && Number.isInteger(value) && value >= low && value <= high

// Budget is no longer a rule: historical configs may still carry it, but it
// is ignored on read and never written back. Errors name the actual bad field
// so administrators are not told to fix a probability when a count is wrong.
export function shunConfigError(value: unknown): string | null {
  if (!value || typeof value !== 'object') return '配置格式无效。'
  const c = value as Record<string, unknown>
  if (typeof c.enabled !== 'boolean') return '启用状态无效。'
  if (!bounded(c.attempts, 1, 30)) return '每日顺取次数必须是 1 到 30 的整数。'
  if (!bounded(c.victimCap, 1, 20)) return '每日被顺上限必须是 1 到 20 的整数。'
  if (!bounded(c.goldenMinutes, 1, 60)) return '黄金抓捕期必须是 1 到 60 分钟的整数。'
  if (!Array.isArray(c.probabilities) || c.probabilities.length !== 7
    || !c.probabilities.every((n) => bounded(n, 1, 100))) {
    return '金额概率必须是 7 档 1 到 100 的整数。'
  }
  if (c.probabilities.reduce((sum: number, n) => sum + (n as number), 0) !== 100) return '金额概率必须合计 100%。'
  if (!c.probabilities.every((n, i, values) => i === 0 || (n as number) < (values[i - 1] as number))) {
    return '金额概率必须严格递减。'
  }
  if (!Array.isArray(c.weights) || c.weights.length !== 5
    || !c.weights.every((n, i, values) => bounded(n, 100, 130)
      && (i === 0 || (n as number) <= (values[i - 1] as number)))) {
    return '活跃度权重必须是 5 档不递增的 100 到 130 的整数。'
  }
  return null
}

export function validateShunConfig(value: unknown): ShunConfig | null {
  if (shunConfigError(value)) return null
  const c = value as ShunConfig
  return { enabled: c.enabled, attempts: c.attempts, victimCap: c.victimCap,
    goldenMinutes: c.goldenMinutes, probabilities: c.probabilities, weights: c.weights }
}

export function shunDay(now: Date) {
  return new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10)
}

export function weightedIndex(weights: number[], draw = randomInt) {
  let ticket = draw(weights.reduce((sum, n) => sum + n, 0))
  return weights.findIndex((weight) => (ticket -= weight) < 0)
}

export function captureMode(now: Date, goldenUntil: Date) {
  return now < goldenUntil ? 2 : 3
}

export function shuffle<T>(values: T[]): T[] {
  const result = [...values]
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}
