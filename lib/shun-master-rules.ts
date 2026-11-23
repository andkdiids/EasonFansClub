import { randomInt } from 'node:crypto'

export const defaultShunConfig = {
  enabled: false, attempts: 7, victimCap: 4, goldenMinutes: 10, budget: 1000,
  probabilities: [25, 21, 17, 14, 10, 7, 6], weights: [130, 122, 115, 108, 100],
}
export type ShunConfig = typeof defaultShunConfig

export function shunRulesChanged(previous: ShunConfig, next: ShunConfig) {
  return previous.attempts !== next.attempts || previous.victimCap !== next.victimCap
    || previous.goldenMinutes !== next.goldenMinutes
    || previous.probabilities.some((value, i) => value !== next.probabilities[i])
}

export function validateShunConfig(value: unknown): ShunConfig | null {
  if (!value || typeof value !== 'object') return null
  const c = value as ShunConfig
  const bounded = (n: number, low: number, high: number) => Number.isInteger(n) && n >= low && n <= high
  if (typeof c.enabled !== 'boolean' || !bounded(c.attempts, 1, 30) || !bounded(c.victimCap, 1, 20)
    || !bounded(c.goldenMinutes, 1, 60) || !bounded(c.budget, 0, 10000000)
    || !Array.isArray(c.probabilities) || c.probabilities.length !== 7
    || !c.probabilities.every((n, i, values) => bounded(n, 1, 100) && (i === 0 || n < values[i - 1]))
    || c.probabilities.reduce((sum, n) => sum + n, 0) !== 100
    || !Array.isArray(c.weights) || c.weights.length !== 5
    || !c.weights.every((n, i, values) => bounded(n, 100, 130) && (i === 0 || n <= values[i - 1]))) return null
  return { enabled: c.enabled, attempts: c.attempts, victimCap: c.victimCap, goldenMinutes: c.goldenMinutes,
    budget: c.budget, probabilities: c.probabilities, weights: c.weights }
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
