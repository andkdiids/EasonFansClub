export const ACTIVITY_RISK_SIGNALS = [
  'SHARED_DEVICE',
  'SHARED_IP',
  'SHARED_IP_BURST',
  'HIGH_FREQUENCY_IP',
  'NEW_ACCOUNT_REGISTRATION',
] as const

export type ActivityRiskSignal = (typeof ACTIVITY_RISK_SIGNALS)[number]
export type ActivityRiskLevel = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH'

export const ACTIVITY_RISK_RULES = {
  newAccountFastMinutes: 5,
  newAccountWindowMinutes: 30,
  sharedDeviceMediumCount: 2,
  sharedDeviceHighCount: 3,
  batchNewAccountHighCount: 2,
  sharedIpMediumCount: 2,
  sharedIpBurstCount: 3,
  sharedIpBurstWindowMinutes: 30,
  sharedIpDayCount: 5,
  sharedIpDayWindowHours: 24,
} as const

export type ActivityRiskRegistrationInput = {
  registrationId: string
  userId: string
  accountRegisteredAt: Date | string | null
  activityRegisteredAt: Date | string | null
  registrationIpHash?: string | null
  registrationDeviceId?: string | null
  registrationUserAgent?: string | null
  registrationRequestId?: string | null
}

export type ActivityRiskRegistrationResult = {
  registrationId: string
  userId: string
  level: Exclude<ActivityRiskLevel, 'NONE'>
  signals: ActivityRiskSignal[]
  reasons: string[]
  riskGroupId: string
  riskGroupAccountCount: number
  legacyWithoutAuditData: boolean
}

export type ActivityRiskGroupResult = {
  id: string
  level: Exclude<ActivityRiskLevel, 'NONE'>
  accountCount: number
  registrationCount: number
  signals: ActivityRiskSignal[]
  reasons: string[]
  windowStart: string | null
  windowEnd: string | null
  registrations: ActivityRiskRegistrationResult[]
}

export type ActivityRiskEvaluation = {
  totalRegistrations: number
  normalCount: number
  lowCount: number
  mediumCount: number
  highCount: number
  legacyWithoutAuditData: number
  groups: ActivityRiskGroupResult[]
  byRegistrationId: Record<string, ActivityRiskRegistrationResult>
}

type MutableRegistrationState = {
  signals: Set<ActivityRiskSignal>
  newAccountWindowMinutes: number | null
}

type Window = {
  indexes: number[]
  start: number
  end: number
}

const signalOrder = new Map<ActivityRiskSignal, number>(ACTIVITY_RISK_SIGNALS.map((signal, index) => [signal, index]))
const thirtyMinutes = ACTIVITY_RISK_RULES.newAccountWindowMinutes * 60 * 1000
const oneDay = ACTIVITY_RISK_RULES.sharedIpDayWindowHours * 60 * 60 * 1000

function timeOf(value: Date | string | null | undefined) {
  if (!value) return Number.NaN
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime()
  return Number.isFinite(time) ? time : Number.NaN
}

function normalizedSignalValue(value: string | null | undefined) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function groupIndexesByValue(values: Array<string | null | undefined>) {
  const groups = new Map<string, number[]>()
  values.forEach((value, index) => {
    const normalized = normalizedSignalValue(value)
    if (!normalized) return
    const current = groups.get(normalized) || []
    current.push(index)
    groups.set(normalized, current)
  })
  return groups
}

function largestWindow(indexes: number[], times: number[], windowSize: number): Window | null {
  const sorted = indexes.filter((index) => Number.isFinite(times[index])).sort((left, right) => times[left] - times[right])
  if (!sorted.length) return null
  let best: number[] = []
  let right = 0
  for (let left = 0; left < sorted.length; left += 1) {
    if (right < left) right = left
    while (right + 1 < sorted.length && times[sorted[right + 1]] - times[sorted[left]] <= windowSize) right += 1
    const candidate = sorted.slice(left, right + 1)
    if (candidate.length > best.length) best = candidate
  }
  if (!best.length) return null
  return { indexes: best, start: times[best[0]], end: times[best[best.length - 1]] }
}

function isoOrNull(time: number) {
  return Number.isFinite(time) ? new Date(time).toISOString() : null
}

function signalReason(signal: ActivityRiskSignal, count: number) {
  if (signal === 'SHARED_DEVICE') return `同一匿名设备标识关联 ${count} 个报名账号`
  if (signal === 'SHARED_IP_BURST') return `同一 IP 在 30 分钟内出现 ${count} 个报名账号`
  if (signal === 'HIGH_FREQUENCY_IP') return `同一 IP 在 24 小时内出现 ${count} 个报名账号`
  if (signal === 'SHARED_IP') return `同一 IP 关联 ${count} 个报名账号`
  return `注册后 30 分钟内报名 ${count} 个账号`
}

function levelRank(level: Exclude<ActivityRiskLevel, 'NONE'>) {
  return level === 'HIGH' ? 3 : level === 'MEDIUM' ? 2 : 1
}

function legacyRegistration(input: ActivityRiskRegistrationInput) {
  return !normalizedSignalValue(input.registrationIpHash)
    && !normalizedSignalValue(input.registrationDeviceId)
    && !normalizedSignalValue(input.registrationUserAgent)
    && !normalizedSignalValue(input.registrationRequestId)
}

/**
 * Pure, explainable first-phase rules. It deliberately returns risk hints,
 * never a cheating verdict and never a blocking decision.
 */
export function evaluateActivityRisk(inputs: readonly ActivityRiskRegistrationInput[]): ActivityRiskEvaluation {
  const states = inputs.map((): MutableRegistrationState => ({ signals: new Set<ActivityRiskSignal>(), newAccountWindowMinutes: null }))
  const times = inputs.map((input) => timeOf(input.activityRegisteredAt))
  const parent = inputs.map((_, index) => index)
  const find = (index: number): number => {
    let root = index
    while (parent[root] !== root) root = parent[root]
    while (parent[index] !== index) {
      const next = parent[index]
      parent[index] = root
      index = next
    }
    return root
  }
  const union = (left: number, right: number) => {
    const leftRoot = find(left)
    const rightRoot = find(right)
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot
  }

  const deviceGroups = groupIndexesByValue(inputs.map((input) => input.registrationDeviceId))
  const ipGroups = groupIndexesByValue(inputs.map((input) => input.registrationIpHash))
  const deviceGroupCounts = new Map<string, number>()
  const ipGroupCounts = new Map<string, number>()
  const ipBurstWindows = new Map<string, Window>()
  const ipDayWindows = new Map<string, Window>()

  for (const [device, indexes] of deviceGroups) {
    deviceGroupCounts.set(device, indexes.length)
    if (indexes.length < 2) continue
    indexes.slice(1).forEach((index) => union(indexes[0], index))
    indexes.forEach((index) => states[index].signals.add('SHARED_DEVICE'))
  }

  for (const [ip, indexes] of ipGroups) {
    ipGroupCounts.set(ip, indexes.length)
    if (indexes.length < 2) continue
    indexes.slice(1).forEach((index) => union(indexes[0], index))
    indexes.forEach((index) => states[index].signals.add('SHARED_IP'))
    const burst = largestWindow(indexes, times, thirtyMinutes)
    if (burst && burst.indexes.length >= ACTIVITY_RISK_RULES.sharedIpBurstCount) {
      ipBurstWindows.set(ip, burst)
      burst.indexes.forEach((index) => states[index].signals.add('SHARED_IP_BURST'))
    }
    const day = largestWindow(indexes, times, oneDay)
    if (day && day.indexes.length >= ACTIVITY_RISK_RULES.sharedIpDayCount) {
      ipDayWindows.set(ip, day)
      day.indexes.forEach((index) => states[index].signals.add('HIGH_FREQUENCY_IP'))
    }
  }

  inputs.forEach((input, index) => {
    const accountTime = timeOf(input.accountRegisteredAt)
    const activityTime = times[index]
    const age = activityTime - accountTime
    if (!Number.isFinite(age) || age < 0 || age >= thirtyMinutes) return
    states[index].signals.add('NEW_ACCOUNT_REGISTRATION')
    states[index].newAccountWindowMinutes = age < ACTIVITY_RISK_RULES.newAccountFastMinutes * 60 * 1000 ? ACTIVITY_RISK_RULES.newAccountFastMinutes : ACTIVITY_RISK_RULES.newAccountWindowMinutes
  })

  const componentIndexes = new Map<number, number[]>()
  inputs.forEach((_, index) => {
    const root = find(index)
    const current = componentIndexes.get(root) || []
    current.push(index)
    componentIndexes.set(root, current)
  })

  const groups: Array<ActivityRiskGroupResult & { indexes: number[]; sortTime: number }> = []
  for (const indexes of componentIndexes.values()) {
    const candidateIndexes = indexes.filter((index) => states[index].signals.size > 0)
    if (!candidateIndexes.length) continue

    const signals = new Set<ActivityRiskSignal>()
    candidateIndexes.forEach((index) => states[index].signals.forEach((signal) => signals.add(signal)))
    const accountCount = new Set(candidateIndexes.map((index) => inputs[index].userId)).size
    const newAccountCount = candidateIndexes.filter((index) => states[index].signals.has('NEW_ACCOUNT_REGISTRATION')).length
    const componentDeviceCounts = [...deviceGroups.entries()]
      .filter(([, deviceIndexes]) => deviceIndexes.some((index) => indexes.includes(index)))
      .map(([device]) => deviceGroupCounts.get(device) || 0)
    const maxDeviceCount = Math.max(0, ...componentDeviceCounts)
    const componentIpCounts = [...ipGroups.entries()]
      .filter(([, ipIndexes]) => ipIndexes.some((index) => indexes.includes(index)))
      .map(([ip]) => ipGroupCounts.get(ip) || 0)
    const maxIpCount = Math.max(0, ...componentIpCounts)
    const level: Exclude<ActivityRiskLevel, 'NONE'> = maxDeviceCount >= ACTIVITY_RISK_RULES.sharedDeviceHighCount || (maxDeviceCount >= ACTIVITY_RISK_RULES.sharedDeviceMediumCount && newAccountCount >= ACTIVITY_RISK_RULES.batchNewAccountHighCount)
      ? 'HIGH'
      : maxDeviceCount >= ACTIVITY_RISK_RULES.sharedDeviceMediumCount || (maxIpCount >= ACTIVITY_RISK_RULES.sharedIpMediumCount && newAccountCount >= 1)
        ? 'MEDIUM'
        : 'LOW'

    const reasons: string[] = []
    let windowStart = Number.POSITIVE_INFINITY
    let windowEnd = Number.NEGATIVE_INFINITY
    for (const signal of ACTIVITY_RISK_SIGNALS) {
      if (!signals.has(signal)) continue
      if (signal === 'SHARED_DEVICE') {
        const count = Math.max(0, ...componentDeviceCounts)
        reasons.push(signalReason(signal, count))
      } else if (signal === 'SHARED_IP_BURST') {
        const windows = [...ipBurstWindows.values()].filter((window) => window.indexes.some((index) => indexes.includes(index)))
        const window = windows.sort((left, right) => right.indexes.length - left.indexes.length)[0]
        reasons.push(signalReason(signal, window?.indexes.length || 0))
        if (window) { windowStart = Math.min(windowStart, window.start); windowEnd = Math.max(windowEnd, window.end) }
      } else if (signal === 'HIGH_FREQUENCY_IP') {
        const windows = [...ipDayWindows.values()].filter((window) => window.indexes.some((index) => indexes.includes(index)))
        const window = windows.sort((left, right) => right.indexes.length - left.indexes.length)[0]
        reasons.push(signalReason(signal, window?.indexes.length || 0))
        if (window) { windowStart = Math.min(windowStart, window.start); windowEnd = Math.max(windowEnd, window.end) }
      } else if (signal === 'SHARED_IP') {
        reasons.push(signalReason(signal, Math.max(0, ...componentIpCounts)))
      } else {
        const fiveMinuteCount = candidateIndexes.filter((index) => states[index].newAccountWindowMinutes === 5).length
        const thirtyMinuteCount = candidateIndexes.filter((index) => states[index].newAccountWindowMinutes !== null).length
        reasons.push(`注册后 30 分钟内报名 ${thirtyMinuteCount} 个账号${fiveMinuteCount ? `，其中 ${fiveMinuteCount} 个在 5 分钟内` : ''}`)
      }
    }
    const componentTimes = indexes.map((index) => times[index]).filter(Number.isFinite)
    if (componentTimes.length) {
      windowStart = Math.min(windowStart, ...componentTimes)
      windowEnd = Math.max(windowEnd, ...componentTimes)
    }
    groups.push({
      id: '',
      level,
      accountCount,
      registrationCount: candidateIndexes.length,
      signals: [...signals].sort((left, right) => (signalOrder.get(left) || 0) - (signalOrder.get(right) || 0)),
      reasons,
      windowStart: isoOrNull(windowStart),
      windowEnd: isoOrNull(windowEnd),
      registrations: [],
      indexes: candidateIndexes,
      sortTime: Number.isFinite(windowStart) ? windowStart : Number.POSITIVE_INFINITY,
    })
  }

  groups.sort((left, right) => levelRank(right.level) - levelRank(left.level) || right.accountCount - left.accountCount || left.sortTime - right.sortTime)
  const byRegistrationId: Record<string, ActivityRiskRegistrationResult> = {}
  groups.forEach((group, groupIndex) => {
    const id = `RISK-${String(groupIndex + 1).padStart(3, '0')}`
    const registrations = group.indexes.map((index) => {
      const input = inputs[index]
      const result: ActivityRiskRegistrationResult = {
        registrationId: input.registrationId,
        userId: input.userId,
        level: group.level,
        signals: [...states[index].signals].sort((left, right) => (signalOrder.get(left) || 0) - (signalOrder.get(right) || 0)),
        reasons: group.reasons,
        riskGroupId: id,
        riskGroupAccountCount: group.accountCount,
        legacyWithoutAuditData: legacyRegistration(input),
      }
      byRegistrationId[result.registrationId] = result
      return result
    })
    group.id = id
    group.registrations = registrations
  })

  const legacyWithoutAuditData = inputs.filter(legacyRegistration).length
  const evaluation = {
    totalRegistrations: inputs.length,
    normalCount: inputs.length - Object.keys(byRegistrationId).length,
    lowCount: groups.filter((group) => group.level === 'LOW').reduce((total, group) => total + group.registrationCount, 0),
    mediumCount: groups.filter((group) => group.level === 'MEDIUM').reduce((total, group) => total + group.registrationCount, 0),
    highCount: groups.filter((group) => group.level === 'HIGH').reduce((total, group) => total + group.registrationCount, 0),
    legacyWithoutAuditData,
    groups: groups.map((group) => Object.fromEntries(
      Object.entries(group).filter(([key]) => key !== 'indexes' && key !== 'sortTime'),
    ) as ActivityRiskGroupResult),
    byRegistrationId,
  }
  return evaluation
}
