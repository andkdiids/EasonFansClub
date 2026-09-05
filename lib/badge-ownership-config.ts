export const BADGE_OWNERSHIP_MATCH_MODES = ['ALL', 'ANY', 'AT_LEAST'] as const
export type BadgeOwnershipMatchMode = typeof BADGE_OWNERSHIP_MATCH_MODES[number]

export type BadgeOwnershipRuleConfig = {
  badgeIds: string[]
  matchMode: BadgeOwnershipMatchMode
  minimumCount?: number
  /** Server-resolved snapshots used only to build human-readable copy. */
  badgeNames?: string[]
}

const BADGE_ID_PATTERN = /^[A-Za-z0-9_-]{1,191}$/

function parsePositiveInteger(value: unknown) {
  const parsed = typeof value === 'number' && Number.isInteger(value)
    ? value
    : typeof value === 'string' && /^\d+$/.test(value.trim())
      ? Number(value.trim())
      : Number.NaN
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function normalizeBadgeOwnershipRuleConfig(value: unknown): { config?: BadgeOwnershipRuleConfig; error?: string } {
  if (!isRecord(value)) return { error: '拥有指定勋章规则必须指定前置勋章' }
  if (!Array.isArray(value.badgeIds)) return { error: '拥有指定勋章规则必须指定前置勋章' }

  const badgeIds: string[] = []
  for (const rawId of value.badgeIds) {
    if (typeof rawId !== 'string' || !BADGE_ID_PATTERN.test(rawId.trim())) return { error: '指定勋章标识无效' }
    const badgeId = rawId.trim()
    if (!badgeIds.includes(badgeId)) badgeIds.push(badgeId)
  }
  if (!badgeIds.length) return { error: '拥有指定勋章规则至少需要选择一枚前置勋章' }

  const rawMode = value.matchMode === undefined ? 'ALL' : value.matchMode
  const matchMode = typeof rawMode === 'string' ? rawMode.toUpperCase() : ''
  if (!(BADGE_OWNERSHIP_MATCH_MODES as readonly string[]).includes(matchMode)) return { error: '拥有指定勋章规则的满足条件无效' }

  const rawNames = Array.isArray(value.badgeNames) ? value.badgeNames : []
  const badgeNames = rawNames.length === badgeIds.length && rawNames.every((name) => typeof name === 'string' && name.trim())
    ? rawNames.map((name) => String(name).trim().slice(0, 120))
    : undefined
  const withNames = (config: BadgeOwnershipRuleConfig): BadgeOwnershipRuleConfig => badgeNames ? { ...config, badgeNames } : config

  if (matchMode === 'AT_LEAST') {
    const minimumCount = parsePositiveInteger(value.minimumCount)
    if (!minimumCount || minimumCount > badgeIds.length) return { error: `至少拥有数量必须是 1 到 ${badgeIds.length} 的整数` }
    return { config: withNames({ badgeIds, matchMode, minimumCount }) }
  }

  return { config: withNames({ badgeIds, matchMode: matchMode as Exclude<BadgeOwnershipMatchMode, 'AT_LEAST'> }) }
}

export function withBadgeOwnershipNames(config: BadgeOwnershipRuleConfig, names: readonly (string | null | undefined)[]) {
  const badgeNames = names.map((name) => typeof name === 'string' ? name.trim().slice(0, 120) : '').filter(Boolean)
  return { ...config, ...(badgeNames.length === config.badgeIds.length ? { badgeNames } : {}) }
}

export function getBadgeOwnershipRuleConfig(value: unknown): BadgeOwnershipRuleConfig | null {
  const parsed = normalizeBadgeOwnershipRuleConfig(value)
  return parsed.config || null
}

export function matchBadgeOwnershipRule(input: {
  ownedBadgeIds: Iterable<string>
  requiredBadgeIds: readonly string[]
  matchMode: BadgeOwnershipMatchMode
  minimumCount?: number | null
}) {
  const owned = new Set(input.ownedBadgeIds)
  const matchedCount = input.requiredBadgeIds.reduce((count, badgeId) => count + (owned.has(badgeId) ? 1 : 0), 0)
  if (!input.requiredBadgeIds.length) return false
  if (input.matchMode === 'ANY') return matchedCount >= 1
  if (input.matchMode === 'AT_LEAST') return matchedCount >= (input.minimumCount || Number.POSITIVE_INFINITY)
  return matchedCount === input.requiredBadgeIds.length
}

export function matchBadgeOwnershipConfig(ownedBadgeIds: Iterable<string>, config: BadgeOwnershipRuleConfig) {
  return matchBadgeOwnershipRule({
    ownedBadgeIds,
    requiredBadgeIds: config.badgeIds,
    matchMode: config.matchMode,
    minimumCount: config.minimumCount,
  })
}

export function describeBadgeOwnershipRule(value: unknown) {
  const config = getBadgeOwnershipRuleConfig(value)
  if (!config) return '拥有指定勋章后获得'
  const names = (config.badgeNames || []).filter(Boolean)
  if (config.matchMode === 'AT_LEAST') {
    return names.length === config.badgeIds.length
      ? `获得指定 ${config.badgeIds.length} 枚勋章中的任意 ${config.minimumCount} 枚后获得`
      : `获得指定勋章中的任意 ${config.minimumCount} 枚后获得`
  }
  if (!names.length) return config.matchMode === 'ANY' ? '获得指定勋章中的任意一枚后获得' : '集齐指定勋章后获得'
  const quoted = names.map((name) => `「${name}」`).join(config.matchMode === 'ANY' ? '' : '、')
  return config.matchMode === 'ANY'
    ? `获得${quoted}中的任意一枚后获得`
    : `集齐${quoted}后获得`
}

export function findBadgeOwnershipDependencyCycle(graph: ReadonlyMap<string, readonly string[]>) {
  const visiting = new Set<string>()
  const visited = new Set<string>()

  const visit = (badgeId: string): boolean => {
    if (visiting.has(badgeId)) return true
    if (visited.has(badgeId)) return false
    visiting.add(badgeId)
    for (const dependency of graph.get(badgeId) || []) {
      if (visit(dependency)) return true
    }
    visiting.delete(badgeId)
    visited.add(badgeId)
    return false
  }

  for (const badgeId of new Set([...graph.keys(), ...[...graph.values()].flat()])) {
    if (visit(badgeId)) return true
  }
  return false
}

export function hasCurrentBadgeOwnership(record: { status?: string | null; expiresAt?: Date | string | null }, now = new Date()) {
  if (record.status !== 'ACTIVE') return false
  if (!record.expiresAt) return true
  const expiresAt = record.expiresAt instanceof Date ? record.expiresAt : new Date(record.expiresAt)
  return !Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() > now.getTime()
}

export type BadgeAcquisitionSourceSnapshot = {
  sourceType: string | null
  sourceId: string | null
  isActive: boolean
  expiresAt?: Date | string | null
}

/** Manual grants and any still-valid source keep the aggregate UserBadge. */
export function shouldRetainBadgeFromSources(sources: readonly BadgeAcquisitionSourceSnapshot[], now = new Date()) {
  return sources.some((source) => source.isActive && hasCurrentBadgeOwnership({ status: 'ACTIVE', expiresAt: source.expiresAt }, now))
}
